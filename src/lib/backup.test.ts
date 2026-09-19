// `fake-indexeddb/auto` installs a real (in-memory) IndexedDB implementation
// globally before Dexie opens the database, so `buildBackup()` can run
// against an actual `db` here the same way it does in the app — this test
// is asserting on buildBackup()'s real output, not a stand-in for it.
import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  buildBackup,
  restoreBackup,
  downloadBackup,
  decodeBackupBytes,
  parseBackup,
  BACKUP_TABLES,
  type BackupFile,
} from "./backup";
import { db, DATA_TABLES, newId, nowIso } from "./localdb";
import { sha256Hex } from "./receipts-share";
import { bytesToBase64 } from "./desktop";
import { writeBackupPassphrase } from "./backup-passphrase";
import {
  encryptFullBackupBytes,
  encryptBackup,
  isEncryptedBackup,
  WrongPassphraseError,
  NoPassphraseSetError,
} from "./backup-crypto";

// `readBackupPassphrase`/`writeBackupPassphrase` fall back to
// `window.localStorage` outside Android/desktop (see backup-passphrase.ts),
// which is a no-op under plain Node (no `window` here — this project runs
// its suite without a DOM). Mocking the module in-memory instead of relying
// on that fallback is what lets these tests set/clear a passphrase reliably,
// the same way `backup-crypto.test.ts` sidesteps storage by calling
// `encryptBackup`/`decryptBackup` with an explicit passphrase.
vi.mock("./backup-passphrase", () => {
  let stored = "";
  return {
    readBackupPassphrase: vi.fn(async () => stored),
    writeBackupPassphrase: vi.fn(async (p: string) => {
      stored = p;
    }),
    hasBackupPassphrase: vi.fn(async () => stored.length > 0),
  };
});

describe("DATA_TABLES / BACKUP_TABLES", () => {
  it("never lists the receipts table among the plain-row tables", () => {
    // Receipt photos are still not part of the row-shaped `tables` object —
    // buildBackup() carries them separately in `photos` (base64-encoded),
    // see the test below. Keeping "receipts" out of this list is what keeps
    // photo bytes out of `tables`, specifically.
    expect(DATA_TABLES).not.toContain("receipts");
    expect(BACKUP_TABLES).not.toContain("receipts");
  });
});

describe("buildBackup()", () => {
  beforeEach(async () => {
    await db.expenses.clear();
    await db.receipts.clear();
  });

  it("includes every receipt photo, base64-encoded, in `photos` — not in `tables`", async () => {
    // An expense with a photo actually attached — receipt_path is a plain
    // string reference, never the bytes themselves.
    const receiptPath = `Receipts/2026-09-04/${newId()}.jpg`;
    await db.expenses.add({
      id: newId(),
      expense_no: "TX-20260904-0001",
      business: "Turf",
      category: "Maintenance",
      description: "Net repair",
      note: null,
      amount: 500,
      spent_at: "2026-09-04",
      receipt_path: receiptPath,
      created_at: nowIso(),
    });
    // uploadReceipt now mirrors every photo into db.receipts on every
    // platform (see its doc comment in expenses.ts) — this is that copy.
    const fakeJpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await db.receipts.put({
      path: receiptPath,
      blob: new Blob([fakeJpegBytes]),
      created_at: nowIso(),
    });

    const backup = await buildBackup();

    expect(backup.version).toBe(2);
    expect(backup.tables["receipts"]).toBeUndefined();
    expect(Object.keys(backup.tables)).not.toContain("receipts");
    expect(backup.tables["expenses"]?.[0]?.["receipt_path"]).toBe(receiptPath);

    expect(backup.photos).toHaveLength(1);
    expect(backup.photos?.[0]?.path).toBe(receiptPath);
    expect(backup.photos?.[0]?.data).toBe(
      btoa(String.fromCharCode(...fakeJpegBytes)),
    );
  });

  it("produces an empty photos array when no receipts exist", async () => {
    const backup = await buildBackup();
    expect(backup.photos).toEqual([]);
  });
});

describe("restoreBackup() — photos", () => {
  beforeEach(async () => {
    await db.expenses.clear();
    await db.receipts.clear();
  });

  const makeBackup = (path: string, byte: number): BackupFile => ({
    format: "turf-snack-ledger",
    version: 2,
    exported_at: nowIso(),
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
    photos: [
      { path, data: btoa(String.fromCharCode(byte)), created_at: nowIso() },
    ],
  });

  it("writes photos back into db.receipts on replace", async () => {
    const path = `Receipts/2026-09-04/${newId()}.jpg`;
    await restoreBackup(makeBackup(path, 42), "replace");
    const row = await db.receipts.get(path);
    expect(row).toBeDefined();
    expect(new Uint8Array(await row!.blob.arrayBuffer())).toEqual(
      new Uint8Array([42]),
    );
  });

  it("replace clears photos that aren't in the new backup", async () => {
    const stalePath = `Receipts/2026-01-01/${newId()}.jpg`;
    await db.receipts.put({
      path: stalePath,
      blob: new Blob([new Uint8Array([1])]),
      created_at: nowIso(),
    });
    const freshPath = `Receipts/2026-09-04/${newId()}.jpg`;
    await restoreBackup(makeBackup(freshPath, 99), "replace");
    expect(await db.receipts.get(stalePath)).toBeUndefined();
    expect(await db.receipts.get(freshPath)).toBeDefined();
  });

  it("merge never overwrites an existing photo at the same path", async () => {
    const path = `Receipts/2026-09-04/${newId()}.jpg`;
    await db.receipts.put({
      path,
      blob: new Blob([new Uint8Array([7])]),
      created_at: nowIso(),
    });
    await restoreBackup(makeBackup(path, 200), "merge");
    const row = await db.receipts.get(path);
    expect(new Uint8Array(await row!.blob.arrayBuffer())).toEqual(
      new Uint8Array([7]),
    );
  });

  it("a version-1 backup with no photos field restores cleanly with zero photos", async () => {
    const legacy: BackupFile = {
      format: "turf-snack-ledger",
      version: 1,
      exported_at: nowIso(),
      tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
    };
    await expect(restoreBackup(legacy, "replace")).resolves.toBe(0);
    expect(await db.receipts.toArray()).toEqual([]);
  });
});

describe("restoreBackup() — row validation", () => {
  beforeEach(async () => {
    await db.customers.clear();
    await db.expenses.clear();
  });

  it("rejects a backup with a malformed row and restores nothing from it", async () => {
    const backup: BackupFile = {
      format: "turf-snack-ledger",
      version: 1,
      exported_at: nowIso(),
      tables: {
        ...Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
        customers: [{ name: "Missing an id" }], // no `id` — the primary key
      },
    };
    await expect(restoreBackup(backup, "replace")).rejects.toThrow(
      /don't look right/i,
    );
    expect(await db.customers.toArray()).toEqual([]);
  });

  it("does not clear existing data when the incoming backup fails validation", async () => {
    // The real risk this guards: `mode: "replace"` clears each table before
    // inserting — if validation ran too late (or not at all), a corrupted
    // backup could wipe good local data and insert nothing in its place.
    await db.customers.add({
      id: "keep-me",
      name: "Existing customer",
      phone: null,
      created_at: nowIso(),
    });
    const badBackup: BackupFile = {
      format: "turf-snack-ledger",
      version: 1,
      exported_at: nowIso(),
      tables: {
        ...Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
        expenses: [
          { id: "e1", business: "Turf" /* missing category/amount/spent_at */ },
        ],
      },
    };
    await expect(restoreBackup(badBackup, "replace")).rejects.toThrow();
    expect(await db.customers.get("keep-me")).toBeDefined();
  });

  it("rejects a backup whose photos array has a corrupted entry", async () => {
    const backup: BackupFile = {
      format: "turf-snack-ledger",
      version: 2,
      exported_at: nowIso(),
      tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
      photos: [
        {
          path: "Receipts/x.jpg",
          data: 12345 as unknown as string,
          created_at: nowIso(),
        },
      ],
    };
    await expect(restoreBackup(backup, "replace")).rejects.toThrow(
      /corrupted receipt photo/i,
    );
    expect(await db.receipts.toArray()).toEqual([]);
  });

  it("still restores a valid backup normally (validation doesn't false-positive on good data)", async () => {
    const backup: BackupFile = {
      format: "turf-snack-ledger",
      version: 1,
      exported_at: nowIso(),
      tables: {
        ...Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
        customers: [
          { id: newId(), name: "Fine", phone: null, created_at: nowIso() },
        ],
      },
    };
    await expect(restoreBackup(backup, "replace")).resolves.toBe(1);
  });
});

/**
 * `findHashMismatchedPhotos` (backup.ts) is what a `.db` restore has instead
 * of `restoreFullBackup`'s zip-manifest checksum check — see its doc comment
 * for why a `.db` backup carries `receipt_hashes` alongside `photos` rather
 * than a separate manifest. These tests exercise it the way
 * `telegram-backup.test.ts` already exercises the zip-manifest equivalent.
 */
describe("restoreBackup() — receipt hash cross-check", () => {
  beforeEach(async () => {
    await db.receipts.clear();
    await db.receipt_hashes.clear();
  });

  const backupWithPhoto = (
    path: string,
    bytes: Uint8Array,
    hash?: string,
  ): BackupFile => ({
    format: "turf-snack-ledger",
    version: 2,
    exported_at: nowIso(),
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
    photos: [{ path, data: bytesToBase64(bytes), created_at: nowIso() }],
    receipt_hashes: hash ? [{ path, sha256: hash, created_at: nowIso() }] : [],
  });

  it("restores a photo whose bytes match its captured hash", async () => {
    const path = `Receipts/2026-09-04/${newId()}.jpg`;
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const hash = await sha256Hex(bytes);
    await expect(
      restoreBackup(backupWithPhoto(path, bytes, hash), "replace"),
    ).resolves.toBe(0);
    const row = await db.receipts.get(path);
    expect(new Uint8Array(await row!.blob.arrayBuffer())).toEqual(bytes);
    expect((await db.receipt_hashes.get(path))?.sha256).toBe(hash);
  });

  it("rejects a photo whose bytes don't match its captured hash, and restores nothing", async () => {
    const path = `Receipts/2026-09-04/${newId()}.jpg`;
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const wrongHash = await sha256Hex(new Uint8Array([9, 9, 9]));
    await expect(
      restoreBackup(backupWithPhoto(path, bytes, wrongHash), "replace"),
    ).rejects.toThrow(/checksum/i);
    expect(await db.receipts.get(path)).toBeUndefined();
    expect(await db.receipt_hashes.get(path)).toBeUndefined();
  });

  it("treats a photo with no matching hash row as unverifiable, not corrupt", async () => {
    const path = `Receipts/2026-09-04/${newId()}.jpg`;
    const bytes = new Uint8Array([7, 8, 9]);
    // No `receipt_hashes` entry for this path at all — most backups made
    // before that field existed will look exactly like this.
    await expect(
      restoreBackup(backupWithPhoto(path, bytes), "replace"),
    ).resolves.toBe(0);
    expect(await db.receipts.get(path)).toBeDefined();
  });
});

/**
 * `downloadBackup` encrypts before writing (backup-crypto.ts's
 * `encryptFullBackupBytes`) and `decodeBackupBytes` is its inverse on the
 * restore side (`pickBackupFile` reads the same bytes back). The passphrase
 * itself is exercised thoroughly in backup-crypto.test.ts; these tests check
 * the two functions actually wire into that pipeline the way backup.ts's own
 * doc comments describe. `./backup-passphrase` is mocked (see top of file)
 * since its real storage falls back to `window.localStorage`, unavailable
 * under this project's DOM-less test run.
 */
describe("downloadBackup() / decodeBackupBytes() — encryption", () => {
  beforeEach(async () => {
    await writeBackupPassphrase(""); // start each test with no passphrase set
    await db.customers.clear();
  });

  const emptyBackup = (): BackupFile => ({
    format: "turf-snack-ledger",
    version: 2,
    exported_at: nowIso(),
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])),
    photos: [],
  });

  it("refuses to produce a backup file when no passphrase has been set", async () => {
    await expect(downloadBackup(emptyBackup(), "test.db")).rejects.toThrow(
      /passphrase/i,
    );
  });

  it("round-trips a built backup through encryption exactly as downloadBackup/decodeBackupBytes do", async () => {
    await writeBackupPassphrase("correct horse battery staple");
    await db.customers.add({
      id: newId(),
      name: "Ada",
      phone: "123",
      created_at: nowIso(),
    });
    const backup = await buildBackup();

    // Same two steps downloadBackup takes (backup.ts:120-121), stopping
    // short of the platform-specific save (native dialog / Android plugin /
    // browser Blob download) that needs a real OS or DOM to exercise.
    const text = JSON.stringify(backup, null, 2);
    const bytes = await encryptFullBackupBytes(new TextEncoder().encode(text));
    expect(isEncryptedBackup(bytes)).toBe(true); // never a plaintext fallback

    // Same step pickBackupFile's caller takes with the bytes it reads back.
    const decodedText = await decodeBackupBytes(bytes);
    const restored = parseBackup(decodedText);
    expect(restored.tables["customers"]).toEqual(backup.tables["customers"]);
  });

  it("decodeBackupBytes passes a legacy plaintext backup through unchanged", async () => {
    // Backups made before encryption was added are plain UTF-8 JSON — no
    // passphrase needed to read them back (backup-crypto.ts's
    // decryptFullBackupBytes doc comment).
    const backup = emptyBackup();
    const plainBytes = new TextEncoder().encode(JSON.stringify(backup));
    const decodedText = await decodeBackupBytes(plainBytes);
    expect(parseBackup(decodedText).format).toBe("turf-snack-ledger");
  });

  it("throws NoPassphraseSetError for an encrypted file when nothing is stored and no override is given", async () => {
    // Encrypt under some passphrase, but leave the device passphrase empty
    // (beforeEach already clears it) and pass no override either — this is
    // what a picked file hits before BackupCard has anything to try.
    // encryptFullBackupBytes can't be used here — it refuses to run when no
    // passphrase is stored — so encrypt directly, as the sibling test does.
    const bytes = await encryptBackup(
      new TextEncoder().encode(JSON.stringify(emptyBackup())),
      "some-file-passphrase",
    );
    await expect(decodeBackupBytes(bytes)).rejects.toBeInstanceOf(
      NoPassphraseSetError,
    );
  });

  it("decodeBackupBytes's passphraseOverride opens a file made under a different passphrase", async () => {
    // Simulates restoring a file from another device (or from before this
    // device's passphrase was last changed): the stored passphrase here
    // never matches the one the file was actually encrypted with, so only
    // the override works. Uses encryptBackup directly (not
    // encryptFullBackupBytes, which always encrypts under the stored
    // passphrase) so the file's passphrase and the device's can differ.
    await writeBackupPassphrase("this-devices-current-passphrase");
    await db.customers.add({
      id: newId(),
      name: "Grace",
      phone: "456",
      created_at: nowIso(),
    });
    const built = await buildBackup();
    const bytes = await encryptBackup(
      new TextEncoder().encode(JSON.stringify(built)),
      "the-original-file-passphrase",
    );

    await expect(decodeBackupBytes(bytes)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    ); // the device's own passphrase doesn't open a file made under another one

    const decodedText = await decodeBackupBytes(
      bytes,
      "the-original-file-passphrase",
    );
    expect(parseBackup(decodedText).tables["customers"]).toEqual(
      built.tables["customers"],
    );
  });
});
