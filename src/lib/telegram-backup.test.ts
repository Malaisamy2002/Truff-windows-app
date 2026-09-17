// This file is the one exception to the app's plain-Node test environment
// (see theme.test.ts / image.test.ts for why the rest of the suite stays on
// Node): setPlatform() below needs a real `window`/`navigator` to flip
// __TAURI_INTERNALS__ and userAgent, and several tests read/write
// window.localStorage directly. A per-file pragma scopes jsdom to just this
// suite instead of switching the global vitest environment, so the
// Node-only guards elsewhere (e.g. image.test.ts's "FileReader is
// unavailable outside a real browser" case) keep working unchanged.
// @vitest-environment jsdom

// Real (in-memory) IndexedDB so buildFullBackup()/restoreFullBackup() run
// against actual Dexie tables, the same way they do in the app.
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKUP_NAME_PREFIX,
  CHUNK_BYTES,
  MANIFEST_NAME,
  botTokenForChunk,
  buildFullBackup,
  chunkCaption,
  chunkCount,
  chunkFileName,
  chunksFromUpdates,
  decodePairingPayload,
  encodePairingPayload,
  fullBackupSummary,
  joinChunks,
  latestCompleteGroup,
  parseChunkName,
  parseFullBackupManifest,
  readLastUpload,
  readTelegramConfig,
  restoreFullBackup,
  restoreSummary,
  retryAfterMs,
  splitIntoChunks,
  telegramErrorMessage,
  uploadFullBackup,
  downloadChunk,
  writeTelegramConfig,
  type TelegramConfig,
} from "./telegram-backup";
import { db, newId, nowIso } from "./localdb";

const cfg = (over: Partial<TelegramConfig> = {}): TelegramConfig => ({
  botToken: "bot-1",
  chatId: "-100123",
  extraBotTokens: [],
  deviceLabel: "Windows",
  ...over,
});

/*
 * `readSecret`/`writeSecret` (telegram-backup.ts) and `secureInvoke`
 * (android-secure-store.ts) both reach the platform's real secret store
 * through a lazy `await import("@tauri-apps/api/core")` — never a static
 * import — so this single mock covers both the desktop keyring
 * (`keyring_get_token`/`keyring_set_token`/`keyring_delete_token`) and the
 * Android secure-store plugin (`plugin:android-save|secure_get/set/delete`)
 * code paths. `vi.hoisted` is required here (not a plain top-level const)
 * because `vi.mock`'s factory runs before this file's own top-level code —
 * referencing an un-hoisted variable from inside it would hit the TDZ.
 */
const { invokeMock, fakeSecretStore, realInvoke } = vi.hoisted(() => {
  const fakeSecretStore = new Map<string, string>();
  const realInvoke = async (
    command: string,
    args?: Record<string, unknown>,
  ) => {
    if (command === "keyring_get_token") {
      const { account } = args as { account: string };
      return fakeSecretStore.get(`keyring:${account}`) ?? null;
    }
    if (command === "keyring_set_token") {
      const { account, token } = args as { account: string; token: string };
      fakeSecretStore.set(`keyring:${account}`, token);
      return undefined;
    }
    if (command === "keyring_delete_token") {
      const { account } = args as { account: string };
      fakeSecretStore.delete(`keyring:${account}`);
      return undefined;
    }
    if (command === "plugin:android-save|secure_get") {
      const { key } = (args as { payload: { key: string } }).payload;
      return { value: fakeSecretStore.get(`secure:${key}`) ?? null };
    }
    if (command === "plugin:android-save|secure_set") {
      const { key, value } = (
        args as { payload: { key: string; value: string } }
      ).payload;
      fakeSecretStore.set(`secure:${key}`, value);
      return undefined;
    }
    if (command === "plugin:android-save|secure_delete") {
      const { key } = (args as { payload: { key: string } }).payload;
      fakeSecretStore.delete(`secure:${key}`);
      return undefined;
    }
    throw new Error(`fake invoke: unexpected command "${command}"`);
  };
  const invokeMock = vi.fn(realInvoke);
  return { invokeMock, fakeSecretStore, realInvoke };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

type Platform = "web" | "desktop" | "android";

/**
 * `desktop.ts`'s `isDesktop()`/`isAndroid()` read `window.__TAURI_INTERNALS__`
 * and `navigator.userAgent` directly (see desktop.ts) — this reproduces
 * exactly those signals rather than mocking `./desktop` itself, so the real
 * platform-detection logic stays exercised by these tests, not stubbed out.
 */
function setPlatform(mode: Platform) {
  const w = window as unknown as Record<string, unknown>;
  if (mode === "web") {
    delete w["__TAURI_INTERNALS__"];
    delete w["__TAURI__"];
  } else {
    w["__TAURI_INTERNALS__"] = {};
  }
  Object.defineProperty(window.navigator, "userAgent", {
    value:
      mode === "android"
        ? "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    configurable: true,
  });
}

async function seedExpenseWithReceipt(
  bytes: Uint8Array,
  spentAt = "2026-09-04",
) {
  const id = newId();
  const path = `Receipts/${spentAt}/${id}.jpg`;
  await db.expenses.add({
    id,
    expense_no: "TX-20260904-0001",
    business: "Turf",
    category: "Maintenance",
    description: "Net repair",
    note: null,
    amount: 500,
    spent_at: spentAt,
    receipt_path: path,
    created_at: nowIso(),
    updated_at: nowIso(),
  } as never);
  await db.receipts.put({
    path,
    blob: new Blob([bytes.slice().buffer as ArrayBuffer]),
    created_at: nowIso(),
  });
  return { id, path };
}

/* ------------------------------------------------------------------ *
 * Archive building & restoring
 * ------------------------------------------------------------------ */

// jsdom (enabled by the file-level pragma above) replaces the global `Blob`
// with its own implementation, which Node's structured-clone algorithm —
// used internally by fake-indexeddb — doesn't recognize: a Blob stored
// through IndexedDB comes back as an empty, prototype-less object instead
// of a real Blob. Real browsers (and the actual Tauri desktop shell) use
// the native Blob, so this is purely a test-environment mismatch, not an
// app bug. Scoped to just these two describes (via stubGlobal/unstub, not a
// file-level swap) because `uploadFullBackup()`'s tests below need jsdom's
// own Blob for jsdom's FormData to accept it.
function useNativeBlobForIndexedDb() {
  beforeEach(() => vi.stubGlobal("Blob", NodeBlob));
  afterEach(() => vi.unstubAllGlobals());
}

describe("buildFullBackup()", () => {
  useNativeBlobForIndexedDb();
  beforeEach(async () => {
    await db.expenses.clear();
    await db.receipts.clear();
    await db.receipt_hashes.clear();
  });

  it("packs the manifest and the receipt photo bytes into one archive", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { path } = await seedExpenseWithReceipt(bytes);

    const result = await buildFullBackup("Windows");
    expect(result.missingFiles).toEqual([]);
    expect(result.backup.device_label).toBe("Windows");
    expect(result.backup.files.map((f) => f.path)).toEqual([path]);

    const zip = await JSZip.loadAsync(result.bytes);
    expect(zip.files[MANIFEST_NAME]).toBeTruthy();
    const stored = await zip.files[path]!.async("uint8array");
    expect(Array.from(stored)).toEqual(Array.from(bytes));

    // Row metadata travels, photo Blobs never do.
    const manifest = parseFullBackupManifest(
      await zip.files[MANIFEST_NAME]!.async("string"),
    );
    expect(manifest.tables["expenses"]).toHaveLength(1);
    expect(JSON.stringify(manifest.tables["receipts"])).not.toContain("blob");
  });

  it("reports a photo the expense claims but the device doesn't have, without failing", async () => {
    const id = newId();
    await db.expenses.add({
      id,
      expense_no: "TX-20260904-0002",
      business: "Turf",
      category: "Maintenance",
      description: "Paint",
      note: null,
      amount: 100,
      spent_at: "2026-09-04",
      receipt_path: `Receipts/2026-09-04/${id}.jpg`,
      created_at: nowIso(),
      updated_at: nowIso(),
    } as never);

    const result = await buildFullBackup("Android");
    expect(result.missingFiles).toEqual([`Receipts/2026-09-04/${id}.jpg`]);
    expect(result.backup.files).toEqual([]);
  });
});

describe("restoreFullBackup()", () => {
  useNativeBlobForIndexedDb();
  beforeEach(async () => {
    await db.customers.clear();
    await db.expenses.clear();
    await db.receipts.clear();
    await db.receipt_hashes.clear();
  });

  it("round-trips rows and photos back onto an empty device", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const { path } = await seedExpenseWithReceipt(bytes);
    const archive = (await buildFullBackup("Windows")).bytes;

    await db.expenses.clear();
    await db.receipts.clear();

    const result = await restoreFullBackup(archive, "replace");
    expect(result.rowsRestored).toBeGreaterThan(0);
    expect(result.filesRestored).toBe(1);
    expect(result.filesCorrupted).toEqual([]);
    const restored = await db.receipts.get(path);
    expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(bytes);
  });

  it("never overwrites a photo already on the device", async () => {
    await seedExpenseWithReceipt(new Uint8Array([1, 1, 1]));
    const archive = (await buildFullBackup("Windows")).bytes;

    const result = await restoreFullBackup(archive, "merge");
    expect(result.filesRestored).toBe(0);
    expect(result.filesSkippedExisting).toBe(1);
  });

  it("restores receipt_hashes rows alongside the photos they fingerprint", async () => {
    const { path } = await seedExpenseWithReceipt(new Uint8Array([5, 6, 7]));
    await db.receipt_hashes.put({
      path,
      sha256: "deadbeef",
      created_at: nowIso(),
    });
    const archive = (await buildFullBackup("Windows")).bytes;

    await db.expenses.clear();
    await db.receipts.clear();
    await db.receipt_hashes.clear();

    await restoreFullBackup(archive, "replace");
    const hashRow = await db.receipt_hashes.get(path);
    expect(hashRow?.sha256).toBe("deadbeef");
  });

  it("merge never overwrites a receipt_hashes row already on the device", async () => {
    const { path } = await seedExpenseWithReceipt(new Uint8Array([5, 6, 7]));
    await db.receipt_hashes.put({
      path,
      sha256: "original-hash",
      created_at: nowIso(),
    });
    const archive = (await buildFullBackup("Windows")).bytes;

    await db.receipt_hashes.put({
      path,
      sha256: "already-here",
      created_at: nowIso(),
    });
    await restoreFullBackup(archive, "merge");
    expect((await db.receipt_hashes.get(path))?.sha256).toBe("already-here");
  });

  it("preserves each photo's original created_at instead of the restore moment", async () => {
    const originalCreatedAt = "2025-01-01T00:00:00.000Z";
    const id = newId();
    const path = `Receipts/2025-01-01/${id}.jpg`;
    await db.expenses.add({
      id,
      expense_no: "TX-20250101-0001",
      business: "Turf",
      category: "Maintenance",
      description: "Net repair",
      note: null,
      amount: 500,
      spent_at: "2025-01-01",
      receipt_path: path,
      created_at: nowIso(),
      updated_at: nowIso(),
    } as never);
    await db.receipts.put({
      path,
      blob: new Blob([new Uint8Array([3, 2, 1]).buffer as ArrayBuffer]),
      created_at: originalCreatedAt,
    });
    const archive = (await buildFullBackup("Windows")).bytes;

    await db.expenses.clear();
    await db.receipts.clear();
    // restoreFullBackup() restores the expense row itself (via
    // restoreBackup(), "replace" mode) before it gets to the photo loop, so
    // knownReceiptPaths already includes this path by the time it matters.
    await restoreFullBackup(archive, "replace");
    const restored = await db.receipts.get(path);
    expect(restored?.created_at).toBe(originalCreatedAt);
  });

  it("refuses to write bytes that fail the manifest checksum", async () => {
    const { path } = await seedExpenseWithReceipt(new Uint8Array([4, 4, 4]));
    const built = await buildFullBackup("Windows");

    // Tamper with the photo bytes while keeping the manifest's checksum.
    const zip = await JSZip.loadAsync(built.bytes);
    zip.file(path, new Uint8Array([0, 0, 0, 0]));
    const tampered = await zip.generateAsync({ type: "uint8array" });

    await db.receipts.clear();
    const result = await restoreFullBackup(tampered, "merge");
    expect(result.filesCorrupted).toEqual([path]);
    expect(result.filesRestored).toBe(0);
    expect(await db.receipts.get(path)).toBeUndefined();
  });

  it("rejects an archive with no manifest", async () => {
    const zip = new JSZip();
    zip.file("Receipts/2026-09-04/x.jpg", new Uint8Array([1]));
    await expect(
      restoreFullBackup(await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow(/manifest/i);
  });

  it("rejects an archive whose manifest carries a corrupted receipt_hashes row, before touching any table", async () => {
    await db.customers.add({
      id: "keep-me",
      name: "Existing",
      phone: null,
      created_at: nowIso(),
    });
    const { path } = await seedExpenseWithReceipt(new Uint8Array([1, 2, 3]));
    const built = await buildFullBackup("Windows");

    // Hand-corrupt the manifest's receipt_hashes block — missing `sha256` —
    // while leaving everything else (including the row data restoreBackup()
    // would otherwise happily apply) intact.
    const zip = await JSZip.loadAsync(built.bytes);
    const manifest = parseFullBackupManifest(
      await zip.files[MANIFEST_NAME]!.async("string"),
    );
    manifest.tables["receipt_hashes"] = [{ path }]; // no sha256
    zip.file(MANIFEST_NAME, JSON.stringify(manifest));
    const corrupted = await zip.generateAsync({ type: "uint8array" });

    await expect(restoreFullBackup(corrupted, "replace")).rejects.toThrow(
      /receipt-hash records look corrupted/i,
    );
    // Nothing should have been restored OR cleared — this device's existing
    // data must survive a manifest that fails validation.
    expect(await db.customers.get("keep-me")).toBeDefined();
  });
});

describe("fullBackupSummary() / restoreSummary()", () => {
  it("counts records and photos in plain words", () => {
    expect(
      fullBackupSummary({
        format: "turf-snack-ledger-full",
        version: 1,
        created_at: nowIso(),
        device_label: "Windows",
        tables: {},
        files: [{ path: "Receipts/a.jpg", expense_id: "e1", sha256: "x" }],
      }),
    ).toContain("1 receipt photo");

    expect(
      restoreSummary({
        rowsRestored: 2,
        filesRestored: 1,
        filesSkippedExisting: 3,
        filesCorrupted: [],
        filesSkippedUnmatched: 0,
      }),
    ).toContain("2 records");
  });
});

/* ------------------------------------------------------------------ *
 * Chunk math, naming and grouping
 * ------------------------------------------------------------------ */

describe("chunk math", () => {
  it("counts parts against the 19 MB limit", () => {
    expect(chunkCount(0)).toBe(1);
    expect(chunkCount(10)).toBe(1);
    expect(chunkCount(CHUNK_BYTES)).toBe(1);
    expect(chunkCount(CHUNK_BYTES + 1)).toBe(2);
    expect(chunkCount(CHUNK_BYTES * 3)).toBe(3);
  });

  it("splits and rejoins to exactly the original bytes", () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const parts = splitIntoChunks(bytes, 300);
    expect(parts.map((p) => p.length)).toEqual([300, 300, 300, 100]);
    expect(joinChunks(parts)).toEqual(bytes);
  });

  it("leaves a small payload as a single part", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(splitIntoChunks(bytes)).toHaveLength(1);
  });
});

describe("chunk names and captions", () => {
  it("omits the part suffix for a single-part backup and round-trips", () => {
    const name = chunkFileName("2026-09-07T10-00-00-000Z", 1, 1);
    expect(name).toBe(`${BACKUP_NAME_PREFIX}-2026-09-07T10-00-00-000Z.zip`);
    expect(parseChunkName(name)).toEqual({
      session: "2026-09-07T10-00-00-000Z",
      part: 1,
      total: 1,
    });
  });

  it("round-trips a multi-part name", () => {
    const name = chunkFileName("S1", 2, 3);
    expect(name).toBe(`${BACKUP_NAME_PREFIX}-S1.zip.part2of3`);
    expect(parseChunkName(name)).toEqual({ session: "S1", part: 2, total: 3 });
  });

  it("ignores files that aren't backup parts", () => {
    expect(parseChunkName("holiday.jpg")).toBeNull();
    expect(parseChunkName("notes.zip")).toBeNull();
  });

  it("names the device and the part in the caption", () => {
    expect(chunkCaption("S1", 2, 3, "Windows")).toBe(
      `${BACKUP_NAME_PREFIX} S1 from Windows part 2/3`,
    );
    expect(chunkCaption("S1", 1, 1, "")).toBe(`${BACKUP_NAME_PREFIX} S1`);
  });
});

describe("latestCompleteGroup()", () => {
  const chunk = (fileName: string, fileId = fileName) => ({ fileName, fileId });

  it("returns the newest complete session, in part order, whatever order they arrived", () => {
    const group = latestCompleteGroup([
      chunk(`${BACKUP_NAME_PREFIX}-2026-09-01.zip.part2of2`),
      chunk(`${BACKUP_NAME_PREFIX}-2026-09-01.zip.part1of2`),
      chunk(`${BACKUP_NAME_PREFIX}-2026-09-05.zip.part2of2`),
      chunk(`${BACKUP_NAME_PREFIX}-2026-09-05.zip.part1of2`),
    ]);
    expect(group?.session).toBe("2026-09-05");
    expect(group?.chunks.map((c) => parseChunkName(c.fileName)?.part)).toEqual([
      1, 2,
    ]);
  });

  it("skips a half-uploaded session and falls back to the last complete one", () => {
    const group = latestCompleteGroup([
      chunk(`${BACKUP_NAME_PREFIX}-2026-09-01.zip`),
      chunk(`${BACKUP_NAME_PREFIX}-2026-09-09.zip.part1of3`),
    ]);
    expect(group?.session).toBe("2026-09-01");
  });

  it("de-dupes a part that was retried into the chat twice", () => {
    const group = latestCompleteGroup([
      chunk(`${BACKUP_NAME_PREFIX}-S.zip.part1of2`),
      chunk(`${BACKUP_NAME_PREFIX}-S.zip.part1of2`),
      chunk(`${BACKUP_NAME_PREFIX}-S.zip.part2of2`),
    ]);
    expect(group?.chunks).toHaveLength(2);
  });

  it("returns nothing when no session is complete", () => {
    expect(
      latestCompleteGroup([chunk(`${BACKUP_NAME_PREFIX}-S.zip.part1of2`)]),
    ).toBeNull();
  });
});

describe("chunksFromUpdates()", () => {
  it("keeps only backup documents from the configured chat", () => {
    const found = chunksFromUpdates(
      [
        {
          message: {
            chat: { id: -100123 },
            message_id: 7,
            document: {
              file_id: "f1",
              file_name: `${BACKUP_NAME_PREFIX}-S.zip`,
            },
          },
        },
        {
          message: {
            chat: { id: -999 },
            message_id: 8,
            document: {
              file_id: "f2",
              file_name: `${BACKUP_NAME_PREFIX}-S.zip`,
            },
          },
        },
        {
          channel_post: {
            chat: { id: "-100123" },
            message_id: 9,
            document: { file_id: "f3", file_name: "cat.jpg" },
          },
        },
      ],
      "-100123",
    );
    expect(found).toEqual([
      { fileName: `${BACKUP_NAME_PREFIX}-S.zip`, fileId: "f1", messageId: 7 },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Config, pairing, multi-bot, rate limits
 * ------------------------------------------------------------------ */

describe("QR pairing", () => {
  it("round-trips credentials", () => {
    const payload = decodePairingPayload(
      encodePairingPayload(cfg({ extraBotTokens: ["bot-2"] })),
    );
    expect(payload).toEqual({
      botToken: "bot-1",
      chatId: "-100123",
      extraBotTokens: ["bot-2"],
    });
  });

  it("explains a QR code that isn't a setup code", () => {
    expect(() => decodePairingPayload("hello")).toThrow(/setup code/i);
    expect(() =>
      decodePairingPayload(JSON.stringify({ botToken: "x" })),
    ).toThrow(/chat ID/i);
  });
});

describe("botTokenForChunk()", () => {
  it("round-robins across the configured bots", () => {
    const c = cfg({ extraBotTokens: ["bot-2", "bot-3"] });
    expect([0, 1, 2, 3].map((i) => botTokenForChunk(c, i))).toEqual([
      "bot-1",
      "bot-2",
      "bot-3",
      "bot-1",
    ]);
  });

  it("uses the single bot when there are no extras", () => {
    expect(botTokenForChunk(cfg(), 5)).toBe("bot-1");
  });
});

describe("retryAfterMs()", () => {
  it("obeys Telegram's own retry_after", () => {
    expect(retryAfterMs({ parameters: { retry_after: 7 } }, 1)).toBe(7000);
  });

  it("backs off exponentially, capped, when Telegram says nothing", () => {
    expect(retryAfterMs(null, 1)).toBe(3000);
    expect(retryAfterMs(null, 2)).toBe(6000);
    expect(retryAfterMs({}, 99)).toBe(60_000);
  });
});

describe("telegramErrorMessage()", () => {
  it("turns Telegram's codes into something actionable", () => {
    expect(telegramErrorMessage(401, null)).toMatch(/bot token/i);
    expect(telegramErrorMessage(403, null)).toMatch(/admin/i);
    expect(
      telegramErrorMessage(400, { description: "Bad Request: chat not found" }),
    ).toMatch(/chat ID/i);
    expect(telegramErrorMessage(500, { description: "boom" })).toMatch(/boom/);
  });
});

/* ------------------------------------------------------------------ *
 * Network: upload, 429 retry, download
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Config storage: keyring / secure store / localStorage round-trip
 * ------------------------------------------------------------------ */

describe("readTelegramConfig() / writeTelegramConfig() — storage round-trip", () => {
  beforeEach(() => {
    fakeSecretStore.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation(realInvoke);
    window.localStorage.clear();
  });
  afterEach(() => {
    setPlatform("web"); // leave a clean, non-Tauri state for any later test
  });

  it("round-trips the bot token and extra bots through the OS keyring on desktop", async () => {
    setPlatform("desktop");
    await writeTelegramConfig(
      cfg({
        botToken: "primary-token",
        extraBotTokens: ["extra-1", "extra-2"],
      }),
    );

    const read = await readTelegramConfig();
    expect(read.botToken).toBe("primary-token");
    expect(read.extraBotTokens).toEqual(["extra-1", "extra-2"]);

    // Actually went through the keyring, not the localStorage fallback —
    // the account names must match the fixed allowlist in src-tauri/src/lib.rs.
    expect(fakeSecretStore.get("keyring:telegram-backup-token")).toBe(
      "primary-token",
    );
    expect(fakeSecretStore.get("keyring:telegram-backup-extra-tokens")).toBe(
      JSON.stringify(["extra-1", "extra-2"]),
    );
    expect(window.localStorage.getItem("ks:telegram-backup-token")).toBeNull();
  });

  it("round-trips through the Android Keystore-backed secure store on Android", async () => {
    setPlatform("android");
    await writeTelegramConfig(
      cfg({ botToken: "android-token", extraBotTokens: ["extra-a"] }),
    );

    const read = await readTelegramConfig();
    expect(read.botToken).toBe("android-token");
    expect(read.extraBotTokens).toEqual(["extra-a"]);

    // Went through the Keystore-backed secure store, not the OS keyring
    // command (that command doesn't exist on Android) and not localStorage.
    expect(fakeSecretStore.get("secure:telegram-backup-token")).toBe(
      "android-token",
    );
    expect(fakeSecretStore.has("keyring:telegram-backup-token")).toBe(false);
    expect(window.localStorage.getItem("ks:telegram-backup-token")).toBeNull();
  });

  it("round-trips through localStorage in the browser/PWA build (no Tauri shell)", async () => {
    setPlatform("web");
    await writeTelegramConfig(
      cfg({ botToken: "web-token", extraBotTokens: ["extra-w"] }),
    );

    const read = await readTelegramConfig();
    expect(read.botToken).toBe("web-token");
    expect(read.extraBotTokens).toEqual(["extra-w"]);

    expect(window.localStorage.getItem("ks:telegram-backup-token")).toBe(
      "web-token",
    );
    expect(fakeSecretStore.size).toBe(0);
  });

  it("clearing the bot token deletes it from the keyring instead of leaving a stale value", async () => {
    setPlatform("desktop");
    await writeTelegramConfig(cfg({ botToken: "will-be-cleared" }));
    expect(fakeSecretStore.get("keyring:telegram-backup-token")).toBe(
      "will-be-cleared",
    );

    await writeTelegramConfig(cfg({ botToken: "" }));
    expect(fakeSecretStore.has("keyring:telegram-backup-token")).toBe(false);
    expect((await readTelegramConfig()).botToken).toBe("");
  });

  it("falls back to localStorage when the Android secure store rejects the write", async () => {
    setPlatform("android");
    // Reject specifically the secure_set call, whichever of the two
    // concurrent writeTelegramConfig() secret writes (token vs. extra
    // tokens) happens to reach invoke() first — Promise.all runs them
    // concurrently, so asserting on call order here would be fragile.
    invokeMock.mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "plugin:android-save|secure_set")
          throw new Error("Keystore unavailable");
        return realInvoke(command, args);
      },
    );

    await writeTelegramConfig(cfg({ botToken: "fallback-token" }));

    // The failed secure_set never landed in the fake secure store...
    expect(fakeSecretStore.has("secure:telegram-backup-token")).toBe(false);
    // ...but the config still round-trips, via the localStorage fallback.
    expect(window.localStorage.getItem("ks:telegram-backup-token")).toBe(
      "fallback-token",
    );
    expect((await readTelegramConfig()).botToken).toBe("fallback-token");
  });

  it("preserves non-secret fields (chat ID, device label) across a round-trip", async () => {
    setPlatform("desktop");
    await writeTelegramConfig(
      cfg({ botToken: "t", chatId: "-100999", deviceLabel: "Kitchen tablet" }),
    );
    const read = await readTelegramConfig();
    expect(read.chatId).toBe("-100999");
    expect(read.deviceLabel).toBe("Kitchen tablet");
  });
});

describe("uploadFullBackup()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.removeItem("ks:telegram-backup-last");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const ok = (messageId: number) =>
    new Response(
      JSON.stringify({ ok: true, result: { message_id: messageId } }),
      { status: 200 },
    );

  it("sends every part with the same session id and reports progress", async () => {
    const calls: string[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        const form = init.body as FormData;
        calls.push(String((form.get("document") as File).name));
        return ok(++n);
      }),
    );

    const progress: number[] = [];
    const result = await uploadFullBackup(cfg(), new Uint8Array(700), {
      session: "S",
      deviceLabel: "Windows",
      onProgress: (p) => progress.push(p.part),
    });

    expect(result).toEqual({ session: "S", parts: 1, messageIds: [1] });
    expect(progress).toEqual([1]);
    expect(calls[0]).toContain("/botbot-1/sendDocument");
    expect(calls[1]).toBe(`${BACKUP_NAME_PREFIX}-S.zip`);
  });

  it("waits out a 429 using Telegram's retry_after and then succeeds", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt++;
      if (attempt === 1)
        return new Response(
          JSON.stringify({ ok: false, parameters: { retry_after: 2 } }),
          {
            status: 429,
          },
        );
      return ok(42);
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = uploadFullBackup(cfg(), new Uint8Array(10), {
      session: "S",
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.messageIds).toEqual([42]);
  });

  it("stops with a readable message when the token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false }), { status: 401 }),
      ),
    );
    await expect(
      uploadFullBackup(cfg(), new Uint8Array(10), { session: "S" }),
    ).rejects.toThrow(/bot token/i);
  });

  it("refuses to upload before setup is finished", async () => {
    await expect(
      uploadFullBackup(cfg({ botToken: "" }), new Uint8Array(10)),
    ).rejects.toThrow(/before backing up/i);
  });

  it("stops the whole upload — without retrying — when a LATER chunk's round-robin bot is revoked", async () => {
    // Two bots in the pool, three parts: part 1 -> bot-1 (primary), part 2 ->
    // bot-2 (extra, revoked), part 3 -> bot-1 again. Only the first two
    // requests should ever happen — a revoked bot must not be silently
    // retried, and the round-robin must not fall through to a bot further
    // down the pool once one comes back rejected.
    const requestedTokens: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const token = /\/bot([^/]+)\/sendDocument/.exec(url)?.[1] ?? "";
      requestedTokens.push(token);
      if (token === "bot-2")
        return new Response(JSON.stringify({ ok: false }), { status: 401 });
      return ok(requestedTokens.length);
    });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = new Uint8Array(CHUNK_BYTES * 2 + 10); // forces exactly 3 parts
    const twoBotCfg = cfg({ botToken: "bot-1", extraBotTokens: ["bot-2"] });

    await expect(
      uploadFullBackup(twoBotCfg, bytes, { session: "S" }),
    ).rejects.toThrow(/bot token/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedTokens).toEqual(["bot-1", "bot-2"]);
    // A partially-sent, ultimately-failed upload must not be recorded as a
    // completed backup — otherwise the "last backup" pointer used elsewhere
    // (e.g. fetchLatestFullBackupArchive's poll) would point at a session
    // Telegram never fully received.
    expect(readLastUpload()).toBeNull();
  });
});

describe("downloadChunk()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the file path, then fetches the bytes", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("getFile"))
          return new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: "documents/a.zip" },
            }),
            {
              status: 200,
            },
          );
        return new Response(new Uint8Array([5, 6, 7]));
      }),
    );

    expect(Array.from(await downloadChunk("bot-1", "fid"))).toEqual([5, 6, 7]);
    expect(urls[1]).toContain("/file/botbot-1/documents/a.zip");
  });

  it("says so when Telegram won't hand back a download path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, result: {} }), {
            status: 200,
          }),
      ),
    );
    await expect(downloadChunk("bot-1", "fid")).rejects.toThrow(
      /download path/i,
    );
  });
});
