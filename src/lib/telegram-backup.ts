import JSZip from "jszip";
import {
  db,
  table,
  DATA_TABLES,
  nowIso,
  type ExpenseRow,
  type ReceiptHashRow,
} from "./localdb";
import {
  previewRestore,
  restoreBackup,
  type BackupFile,
  type RestorePreview,
} from "./backup";
import { findInvalidReceiptHashRows } from "./backup-validate";
import { resolveImportAction, sha256Hex } from "./receipts-share";
import {
  appDocumentExists,
  isAndroid,
  isDesktop,
  readAppDocument,
  saveExportFile,
  saveToAppDocuments,
} from "./desktop";
import { secureDelete, secureGet, secureSet } from "./android-secure-store";
import {
  decryptFullBackupBytes,
  encryptFullBackupBytes,
} from "./backup-crypto";

/**
 * Telegram full backup — ONE archive, ONE destination, ONE restore action.
 *
 * Before this module there were two half-backups: `backup.ts` exported every
 * table except `receipts` (photo bytes are too big for a diffable JSON
 * snapshot — see `DATA_TABLES` in localdb.ts) and `receipts-share.ts`
 * exported a separate `.zip` of just the photo files. Restoring meant doing
 * both, in order, by hand — and forgetting the second step looked exactly
 * like "the photos are gone".
 *
 * Here both halves are packed into a single zip (`manifest.json` holding
 * every table's rows *and* the per-file checksums, plus each receipt photo
 * at its usual `Receipts/<date>/<id>.<ext>` path) and that one zip is sent
 * to a private Telegram chat through a bot the person owns.
 *
 * Telegram's Bot API caps a bot upload at 50 MB and `getFile` downloads at
 * 20 MB, so anything past ~19 MB is split into parts. Delivery order is not
 * guaranteed across rate-limit retries, so every part carries the same
 * session timestamp plus its own `part N of M` in BOTH its filename and its
 * caption; restore groups by that timestamp instead of trusting order.
 *
 * The zip-building and checksum logic is deliberately shared with
 * `receipts-share.ts` (`sha256Hex`, `resolveImportAction`) rather than
 * duplicated, and the table restore goes through `backup.ts`'s
 * `restoreBackup` so replace/merge behaves identically to the local import.
 */

/* ------------------------------------------------------------------ *
 * Archive format
 * ------------------------------------------------------------------ */

export const FULL_BACKUP_FORMAT = "turf-snack-ledger-full";
export const MANIFEST_NAME = "manifest.json";

export type FullBackupFileEntry = {
  /** `Receipts/<date>/<id>.<ext>` — same convention the app already stores. */
  path: string;
  expense_id: string;
  sha256: string;
};

export type FullBackup = {
  format: typeof FULL_BACKUP_FORMAT;
  version: 1;
  created_at: string;
  /** "Windows" / "Android" / a name the person set — tells backups apart in the chat. */
  device_label: string;
  /** Every DATA_TABLES table, plus `receipts` row metadata (bytes travel as files). */
  tables: Record<string, Record<string, unknown>[]>;
  files: FullBackupFileEntry[];
};

/** Pure — one `files[]` row for an expense known to have a receipt photo. */
export function buildFileEntry(
  expense: Pick<ExpenseRow, "id"> & { receipt_path: string },
  sha256: string,
): FullBackupFileEntry {
  return { path: expense.receipt_path, expense_id: expense.id, sha256 };
}

export function defaultDeviceLabel(): string {
  if (isAndroid()) return "Android";
  if (isDesktop()) return "Windows";
  return "Browser";
}

/** Pure — validates and narrows a parsed `manifest.json`. */
export function parseFullBackupManifest(text: string): FullBackup {
  const parsed = JSON.parse(text) as FullBackup;
  if (parsed?.format !== FULL_BACKUP_FORMAT || !parsed.tables)
    throw new Error("Not a valid full backup archive");
  return { ...parsed, files: parsed.files ?? [] };
}

/** The same row counts summary the local `.db` backup shows. */
export function fullBackupSummary(backup: FullBackup): string {
  const rows = DATA_TABLES.reduce(
    (n, t) => n + (backup.tables[t]?.length ?? 0),
    0,
  );
  return `${rows} records · ${backup.files.length} receipt photo${
    backup.files.length === 1 ? "" : "s"
  }`;
}

async function readReceiptBytes(path: string): Promise<Uint8Array> {
  if (isDesktop()) {
    if (!(await appDocumentExists(path)))
      throw new Error(`Missing on disk: ${path}`);
    return readAppDocument(path);
  }
  const row = await db.receipts.get(path);
  if (!row) throw new Error(`Missing in this browser: ${path}`);
  return new Uint8Array(await row.blob.arrayBuffer());
}

export type BuildFullBackupResult = {
  backup: FullBackup;
  /** The packed zip's raw bytes — the one payload both destinations send. */
  bytes: Uint8Array;
  /** `receipt_path`s an expense claims but whose photo isn't on this device. */
  missingFiles: string[];
};

/**
 * Reads every table AND every receipt photo into one zip. Missing photos are
 * reported, never fatal — a partially-restored device should still be able
 * to back up what it does have.
 */
export async function buildFullBackup(
  deviceLabel = defaultDeviceLabel(),
): Promise<BuildFullBackupResult> {
  const tables: FullBackup["tables"] = {};
  for (const t of DATA_TABLES) {
    tables[t] = (await table(t).toArray()) as Record<string, unknown>[];
  }
  // `receipts` row metadata travels too (so a restore knows what existed),
  // but never the Blob itself — those bytes are packed as real zip files.
  tables["receipts"] = (await db.receipts.toArray()).map((r) => ({
    path: r.path,
    created_at: r.created_at,
  }));
  tables["receipt_hashes"] =
    (await db.receipt_hashes.toArray()) as unknown as Record<string, unknown>[];

  const expenses = await db.expenses.toArray();
  const withReceipts = expenses.filter(
    (e): e is ExpenseRow & { receipt_path: string } => !!e.receipt_path,
  );

  const zip = new JSZip();
  const files: FullBackupFileEntry[] = [];
  const missingFiles: string[] = [];

  for (const expense of withReceipts) {
    let bytes: Uint8Array;
    try {
      bytes = await readReceiptBytes(expense.receipt_path);
    } catch {
      missingFiles.push(expense.receipt_path);
      continue;
    }
    zip.file(expense.receipt_path, bytes);
    files.push(buildFileEntry(expense, await sha256Hex(bytes)));
  }

  const backup: FullBackup = {
    format: FULL_BACKUP_FORMAT,
    version: 1,
    created_at: new Date().toISOString(),
    device_label: deviceLabel,
    tables,
    files,
  };

  zip.file(MANIFEST_NAME, JSON.stringify(backup, null, 2));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { backup, bytes, missingFiles };
}

export type RestoreFullBackupResult = {
  rowsRestored: number;
  filesRestored: number;
  filesSkippedExisting: number;
  /** Photos whose extracted bytes failed the manifest checksum — never written. */
  filesCorrupted: string[];
  /** Photos in the zip that no current expense row points at. */
  filesSkippedUnmatched: number;
};

/**
 * Restores rows and photos from one archive, in one pass, and reports one
 * combined result so the UI shows a single toast.
 *
 * Rows go through `backup.ts`'s `restoreBackup` (identical replace/merge
 * semantics to the local import). Photos are checksum-checked first and
 * never overwrite a file already on this device — exactly the
 * `resolveImportAction` rules the receipts import already used.
 */
export async function restoreFullBackup(
  archiveBytes: Uint8Array | ArrayBuffer,
  mode: "replace" | "merge" = "replace",
  passphraseOverride?: string,
): Promise<RestoreFullBackupResult> {
  let bytes =
    archiveBytes instanceof Uint8Array
      ? archiveBytes
      : new Uint8Array(archiveBytes);
  // Archives made after encryption was added are encrypted (see
  // `encryptFullBackupBytes`); older archives made before it are plain
  // zips. `decryptFullBackupBytes` detects and handles both so a backup
  // someone already has saved/sent doesn't become unrestorable.
  // `passphraseOverride` (from TelegramBackupCard, after a first attempt
  // with the stored passphrase throws) lets a session made under a
  // different passphrase still restore.
  bytes = await decryptFullBackupBytes(bytes, passphraseOverride);
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.files[MANIFEST_NAME];
  if (!manifestEntry || manifestEntry.dir)
    throw new Error("This archive has no manifest.json");
  const backup = parseFullBackupManifest(await manifestEntry.async("string"));

  // `receipt_hashes` isn't in BACKUP_TABLES (see DATA_TABLES in localdb.ts),
  // so restoreBackup()'s own row validation below never sees these rows —
  // check them here, before restoreBackup touches anything, so a corrupted
  // receipt-hashes block can't let the main tables get restored (and, in
  // replace mode, cleared) while this half of the archive is left broken.
  const hashRows = (backup.tables["receipt_hashes"] ??
    []) as unknown as ReceiptHashRow[];
  const hashProblems = findInvalidReceiptHashRows(hashRows);
  if (hashProblems.length > 0)
    throw new Error(
      `This backup's receipt-hash records look corrupted (${hashProblems.length} bad row${
        hashProblems.length === 1 ? "" : "s"
      }) — nothing was restored.`,
    );

  const legacy: BackupFile = {
    format: "turf-snack-ledger",
    version: 1,
    exported_at: backup.created_at,
    tables: backup.tables,
  };
  const rowsRestored = await restoreBackup(legacy, mode);

  // `receipts` isn't in BACKUP_TABLES either, so it's rebuilt below from the
  // zip's actual file bytes (using its captured `created_at`, not "now").
  // `receipt_hashes` (validated above) is restored here with the same
  // replace/merge semantics as everything else: replace wipes and reinserts
  // every hash the archive carried, merge only adds hashes for paths this
  // device doesn't already have one for.
  if (hashRows.length > 0) {
    if (mode === "replace") {
      await db.receipt_hashes.clear();
      await db.receipt_hashes.bulkPut(hashRows);
    } else {
      const existingHashPaths = new Set(
        (await db.receipt_hashes.toArray()).map((r) => r.path),
      );
      const freshHashes = hashRows.filter(
        (r) => !existingHashPaths.has(r.path),
      );
      if (freshHashes.length > 0) await db.receipt_hashes.bulkPut(freshHashes);
    }
  }
  const receiptRows = (backup.tables["receipts"] ?? []) as unknown as {
    path: string;
    created_at: string;
  }[];
  const createdAtByPath = new Map(
    receiptRows.map((r) => [r.path, r.created_at]),
  );

  const expenses = await db.expenses.toArray();
  const knownReceiptPaths = new Set(
    expenses.map((e) => e.receipt_path).filter((p): p is string => !!p),
  );
  const shaByPath = new Map(backup.files.map((f) => [f.path, f.sha256]));

  let filesRestored = 0;
  let filesSkippedExisting = 0;
  let filesSkippedUnmatched = 0;
  const filesCorrupted: string[] = [];

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (
      !entry ||
      entry.dir ||
      path === MANIFEST_NAME ||
      !path.startsWith("Receipts/")
    )
      continue;

    const alreadyExists = isDesktop()
      ? await appDocumentExists(path)
      : (await db.receipts.get(path)) != null;
    const action = resolveImportAction(path, knownReceiptPaths, alreadyExists);
    if (action === "skip-unmatched") {
      filesSkippedUnmatched++;
      continue;
    }
    if (action === "skip-existing") {
      filesSkippedExisting++;
      continue;
    }

    const fileBytes = await entry.async("uint8array");
    const expected = shaByPath.get(path);
    if (expected && (await sha256Hex(fileBytes)) !== expected) {
      filesCorrupted.push(path);
      continue; // never write bytes that failed their checksum
    }

    if (isDesktop()) {
      await saveToAppDocuments(path, fileBytes);
    } else {
      await db.receipts.put({
        path,
        blob: new Blob([fileBytes.slice().buffer as ArrayBuffer]),
        created_at: createdAtByPath.get(path) ?? nowIso(),
      });
    }
    filesRestored++;
  }

  return {
    rowsRestored,
    filesRestored,
    filesSkippedExisting,
    filesCorrupted,
    filesSkippedUnmatched,
  };
}

export type FullBackupPreview = {
  mode: "replace" | "merge";
  /** Row-level breakdown, identical to the local `.db` backup's preview. */
  tables: RestorePreview;
  /** Receipt photos this restore would actually write to disk/Dexie. */
  filesToAdd: number;
  /** Already saved at that path on this device — never overwritten. */
  filesSkippedExisting: number;
  /** In the archive but no current expense row's `receipt_path` claims them. */
  filesSkippedUnmatched: number;
};

/**
 * Read-only "what will actually happen" preview for a full (Telegram or
 * local-file) archive, mirrored after `backup.ts`'s `previewRestore` — same
 * idea, extended to also cover the receipt-photo half that only this format
 * carries. Never decrypts into a write path and never touches `db`/disk.
 *
 * Row counts come straight from `previewRestore` by handing it the same
 * `legacy` shape `restoreFullBackup` builds for `restoreBackup`, so the two
 * can't drift apart. Photo counts replicate `restoreFullBackup`'s own
 * zip-file loop and `resolveImportAction` call one-for-one, just without the
 * final `saveToAppDocuments`/`db.receipts.put` write — `resolveImportAction`
 * doesn't take a mode, so these three numbers are the same for merge and
 * replace, exactly as the actual restore behaves (see that function's own
 * comment on why photos aren't cleared in replace mode).
 */
export async function previewFullBackup(
  archiveBytes: Uint8Array | ArrayBuffer,
  mode: "replace" | "merge" = "replace",
  passphraseOverride?: string,
): Promise<FullBackupPreview> {
  let bytes =
    archiveBytes instanceof Uint8Array
      ? archiveBytes
      : new Uint8Array(archiveBytes);
  bytes = await decryptFullBackupBytes(bytes, passphraseOverride);
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.files[MANIFEST_NAME];
  if (!manifestEntry || manifestEntry.dir)
    throw new Error("This archive has no manifest.json");
  const backup = parseFullBackupManifest(await manifestEntry.async("string"));

  const legacy: BackupFile = {
    format: "turf-snack-ledger",
    version: 1,
    exported_at: backup.created_at,
    tables: backup.tables,
  };
  const tables = await previewRestore(legacy, mode);

  const expenses = await db.expenses.toArray();
  const knownReceiptPaths = new Set(
    expenses.map((e) => e.receipt_path).filter((p): p is string => !!p),
  );

  let filesToAdd = 0;
  let filesSkippedExisting = 0;
  let filesSkippedUnmatched = 0;

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (
      !entry ||
      entry.dir ||
      path === MANIFEST_NAME ||
      !path.startsWith("Receipts/")
    )
      continue;

    const alreadyExists = isDesktop()
      ? await appDocumentExists(path)
      : (await db.receipts.get(path)) != null;
    const action = resolveImportAction(path, knownReceiptPaths, alreadyExists);
    if (action === "skip-unmatched") filesSkippedUnmatched++;
    else if (action === "skip-existing") filesSkippedExisting++;
    else filesToAdd++;
  }

  return {
    mode,
    tables,
    filesToAdd,
    filesSkippedExisting,
    filesSkippedUnmatched,
  };
}

/* ------------------------------------------------------------------ *
 * Local file fallback (no account, no network)
 * ------------------------------------------------------------------ */

export function fullBackupFileName(created = new Date()): string {
  return `turf-ledger-full-${created.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;
}

/**
 * Saves the combined archive to the device — the no-setup fallback. Same
 * dual path as `backup.ts`'s `downloadBackup`: the Android plugin writes
 * straight to public Downloads (the native Save dialog's `content://` URI
 * silently produces a 0-byte file there), a native dialog on real desktop,
 * a Blob download in the browser. `null` means the person cancelled.
 */
export async function saveFullBackupLocally(
  bytes: Uint8Array,
  name = fullBackupFileName(),
): Promise<string | null> {
  if (isAndroid()) {
    const result = await saveExportFile(bytes, name, "application/zip");
    if (!result.saved)
      throw new Error(
        `Couldn't save the backup: ${result.error ?? "unknown reason"}`,
      );
    return result.path ?? name;
  }
  if (isDesktop()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Full backup", extensions: ["zip"] }],
    });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  }
  const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], {
    type: "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

/** Desktop-only native open dialog for a saved full backup. `null` = cancelled. */
export async function pickFullBackupFile(): Promise<Uint8Array | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({
    multiple: false,
    filters: [{ name: "Full backup", extensions: ["zip"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return readFile(path);
}

/* ------------------------------------------------------------------ *
 * Config & credential storage
 * ------------------------------------------------------------------ */

export type TelegramConfig = {
  botToken: string;
  chatId: string;
  /** Optional extra bots, round-robined per chunk to spread rate limits. */
  extraBotTokens: string[];
  deviceLabel: string;
};

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: "",
  chatId: "",
  extraBotTokens: [],
  deviceLabel: "",
};

// Non-secret fields only — safe in localStorage on both builds.
const META_KEY = "ks:telegram-backup";
// Fallback token store used ONLY in the browser/PWA build, where there is no
// OS credential store to move it into. On real desktop the token lives in
// the OS credential store (`keyring_*`, `#[cfg(not(target_os =
// "android"))]`-gated in `src-tauri/src/lib.rs`). On Android it lives in the
// `android-save` plugin's Keystore-backed `EncryptedSharedPreferences` store
// (`secureGet`/`secureSet` — see `android-secure-store.ts`) — audit item 1.3.
const WEB_TOKEN_KEY = "ks:telegram-backup-token";
// `keyring_*` on desktop hardcodes its own service name and validates
// `account` against a fixed allowlist (see `src-tauri/src/lib.rs`), so
// there's no `service` constant to pass from here — only the account name,
// which must match one of the allowlisted slots.
const KEYRING_ACCOUNT = "telegram-backup-token";
const SECURE_STORE_KEY = "telegram-backup-token";

// The round-robin extra bot tokens used to travel inside `Meta`/`META_KEY`,
// which meant they sat in plain `localStorage` on EVERY platform, including
// real desktop — a wider gap than the audit's 1.3 (which only flagged the
// primary `botToken`). They now go through the same tiered secret storage
// as the primary token, JSON-encoded, under their own key.
const WEB_EXTRA_TOKENS_KEY = "ks:telegram-backup-extra-tokens";
const KEYRING_EXTRA_ACCOUNT = "telegram-backup-extra-tokens";
const SECURE_STORE_EXTRA_KEY = "telegram-backup-extra-tokens";

type Meta = Omit<TelegramConfig, "botToken" | "extraBotTokens">;

function metaDefaults(): Meta {
  const { botToken: _t, extraBotTokens: _e, ...rest } = DEFAULT_TELEGRAM_CONFIG;
  return rest;
}

function readMeta(): Meta {
  if (typeof window === "undefined") return metaDefaults();
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw
      ? { ...metaDefaults(), ...(JSON.parse(raw) as Partial<Meta>) }
      : metaDefaults();
  } catch {
    return metaDefaults();
  }
}

function writeMeta(meta: Meta) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// readSecret()/writeSecret() below can both hit the keyring in the same
// tick (writeTelegramConfig() writes the primary token and the extra
// tokens concurrently via Promise.all). A fresh `await import(...)` per
// call is safe in the real bundled app (dynamic import of the same
// specifier always resolves to one cached module instance there), but
// under Vitest's module mocking, two *first* dynamic imports of the same
// mocked specifier racing in the same tick can resolve inconsistently —
// one gets the mock, the other the real (untransformed) module. Caching
// the import in one module-level promise means only one dynamic import
// ever actually executes, sidestepping that race entirely.
let tauriCorePromise: Promise<typeof import("@tauri-apps/api/core")> | null =
  null;
function tauriCore() {
  if (!tauriCorePromise) tauriCorePromise = import("@tauri-apps/api/core");
  return tauriCorePromise;
}

async function readSecret(
  webKey: string,
  keyringAccount: string,
  secureStoreKey: string,
): Promise<string> {
  if (isAndroid()) {
    const secure = await secureGet(secureStoreKey);
    if (secure !== null) return secure;
    // secureGet() returns null both for "nothing stored" and for "the
    // secure store rejected/failed the read" (see android-secure-store.ts).
    // writeSecret()'s Android branch falls back to localStorage on a
    // rejected/failed write, so the read path has to check the same
    // fallback location — otherwise a value that *was* saved (just not
    // into the secure store) silently reads back as empty forever.
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(webKey) ?? "";
    } catch {
      return "";
    }
  }
  if (isDesktop()) {
    const { invoke } = await tauriCore();
    try {
      return (
        (await invoke<string | null>("keyring_get_token", {
          account: keyringAccount,
        })) ?? ""
      );
    } catch {
      return "";
    }
  }
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(webKey) ?? "";
  } catch {
    return "";
  }
}

async function writeSecret(
  webKey: string,
  keyringAccount: string,
  secureStoreKey: string,
  value: string,
): Promise<void> {
  if (isAndroid()) {
    try {
      if (value) await secureSet(secureStoreKey, value);
      else await secureDelete(secureStoreKey);
    } catch {
      // Keystore/EncryptedSharedPreferences refused the write — fall back
      // rather than leaving "Save" permanently broken.
      if (typeof window === "undefined") return;
      if (value) window.localStorage.setItem(webKey, value);
      else window.localStorage.removeItem(webKey);
    }
    return;
  }
  if (isDesktop()) {
    const { invoke } = await tauriCore();
    try {
      if (value) {
        await invoke("keyring_set_token", {
          account: keyringAccount,
          token: value,
        });
      } else {
        await invoke("keyring_delete_token", {
          account: keyringAccount,
        }).catch(() => undefined);
      }
    } catch {
      // Credential store locked/unavailable — fall back rather than leaving
      // "Save" permanently broken.
      if (typeof window === "undefined") return;
      if (value) window.localStorage.setItem(webKey, value);
      else window.localStorage.removeItem(webKey);
    }
    return;
  }
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(webKey, value);
  else window.localStorage.removeItem(webKey);
}

async function readToken(): Promise<string> {
  return readSecret(WEB_TOKEN_KEY, KEYRING_ACCOUNT, SECURE_STORE_KEY);
}

async function writeToken(token: string): Promise<void> {
  return writeSecret(WEB_TOKEN_KEY, KEYRING_ACCOUNT, SECURE_STORE_KEY, token);
}

async function readExtraTokens(): Promise<string[]> {
  const raw = await readSecret(
    WEB_EXTRA_TOKENS_KEY,
    KEYRING_EXTRA_ACCOUNT,
    SECURE_STORE_EXTRA_KEY,
  );
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function writeExtraTokens(tokens: string[]): Promise<void> {
  const cleaned = tokens.filter(Boolean);
  const raw = cleaned.length ? JSON.stringify(cleaned) : "";
  return writeSecret(
    WEB_EXTRA_TOKENS_KEY,
    KEYRING_EXTRA_ACCOUNT,
    SECURE_STORE_EXTRA_KEY,
    raw,
  );
}

export async function readTelegramConfig(): Promise<TelegramConfig> {
  const [meta, botToken, extraBotTokens] = await Promise.all([
    readMeta(),
    readToken(),
    readExtraTokens(),
  ]);
  return { ...meta, extraBotTokens, botToken };
}

export async function writeTelegramConfig(cfg: TelegramConfig): Promise<void> {
  const { botToken, extraBotTokens, ...meta } = cfg;
  writeMeta(meta);
  await Promise.all([
    writeToken(botToken),
    writeExtraTokens(extraBotTokens ?? []),
  ]);
}

export function isTelegramConfigured(cfg: TelegramConfig): boolean {
  return !!cfg.botToken && !!cfg.chatId;
}

/* ------------------------------------------------------------------ *
 * QR pairing
 * ------------------------------------------------------------------ */

export type PairingPayload = {
  botToken: string;
  chatId: string;
  extraBotTokens?: string[];
};

export function encodePairingPayload(cfg: TelegramConfig): string {
  return JSON.stringify({
    v: 1,
    botToken: cfg.botToken,
    chatId: cfg.chatId,
    extraBotTokens: cfg.extraBotTokens,
  });
}

/** Pure — reads a scanned QR's text back into credentials, or throws. */
export function decodePairingPayload(text: string): PairingPayload {
  let parsed: Partial<PairingPayload>;
  try {
    parsed = JSON.parse(text) as Partial<PairingPayload>;
  } catch {
    throw new Error("That QR code isn't a Telegram backup setup code");
  }
  if (!parsed.botToken || !parsed.chatId)
    throw new Error("That QR code is missing the bot token or chat ID");
  return {
    botToken: String(parsed.botToken),
    chatId: String(parsed.chatId),
    extraBotTokens: Array.isArray(parsed.extraBotTokens)
      ? parsed.extraBotTokens.map(String)
      : [],
  };
}

/* ------------------------------------------------------------------ *
 * Chunking
 * ------------------------------------------------------------------ */

/** 19 MB — under both the bot upload limit and `getFile`'s 20 MB download cap. */
export const CHUNK_BYTES = 19 * 1024 * 1024;
export const MAX_CHUNK_ATTEMPTS = 5;

/** Pure — how many parts a payload of this size needs. */
export function chunkCount(
  totalBytes: number,
  chunkBytes = CHUNK_BYTES,
): number {
  if (totalBytes <= 0) return 1;
  return Math.ceil(totalBytes / chunkBytes);
}

/** Pure — splits payload bytes into ordered parts. */
export function splitIntoChunks(
  bytes: Uint8Array,
  chunkBytes = CHUNK_BYTES,
): Uint8Array[] {
  if (bytes.length <= chunkBytes) return [bytes];
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    parts.push(
      bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length)),
    );
  }
  return parts;
}

/** Pure — joins parts back in the order given. */
export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Filename-safe form of the session's ISO timestamp. */
export function sessionId(created = new Date()): string {
  return created.toISOString().replace(/[:.]/g, "-");
}

export const BACKUP_NAME_PREFIX = "turf-ledger-full-backup";

/** Pure — the filename for one part. Single-part backups get no part suffix. */
export function chunkFileName(
  session: string,
  part: number,
  total: number,
): string {
  return total === 1
    ? `${BACKUP_NAME_PREFIX}-${session}.zip`
    : `${BACKUP_NAME_PREFIX}-${session}.zip.part${part}of${total}`;
}

/** Pure — the caption every part carries, so the chat history is readable. */
export function chunkCaption(
  session: string,
  part: number,
  total: number,
  deviceLabel: string,
): string {
  const who = deviceLabel ? ` from ${deviceLabel}` : "";
  return total === 1
    ? `${BACKUP_NAME_PREFIX} ${session}${who}`
    : `${BACKUP_NAME_PREFIX} ${session}${who} part ${part}/${total}`;
}

export type ParsedChunkName = { session: string; part: number; total: number };

/**
 * Pure — reads session/part/total back out of a filename. Order of arrival
 * is never trusted; this is what regroups parts after a retry reshuffles
 * them (or a restart interleaves two backup runs).
 */
export function parseChunkName(name: string): ParsedChunkName | null {
  const match =
    /^turf-ledger-full-backup-(.+?)\.zip(?:\.part(\d+)of(\d+))?$/.exec(name);
  if (!match) return null;
  const session = match[1] ?? "";
  const part = match[2];
  const total = match[3];
  if (!part || !total) return { session, part: 1, total: 1 };
  return { session, part: Number(part), total: Number(total) };
}

export type RemoteChunk = {
  fileName: string;
  fileId: string;
  messageId?: number;
};
export type ChunkGroup = {
  session: string;
  total: number;
  chunks: RemoteChunk[];
};

/**
 * Pure — groups documents seen in the chat by session and returns the newest
 * COMPLETE group (session ids sort lexicographically in time order, since
 * they're ISO timestamps). A half-uploaded run is skipped rather than
 * restored as a truncated zip.
 */
export function latestCompleteGroup(
  documents: RemoteChunk[],
): ChunkGroup | null {
  const bySession = new Map<string, ChunkGroup>();
  for (const doc of documents) {
    const parsed = parseChunkName(doc.fileName);
    if (!parsed) continue;
    const group = bySession.get(parsed.session) ?? {
      session: parsed.session,
      total: parsed.total,
      chunks: [],
    };
    // De-dupe: a retried part can appear twice in the chat.
    if (!group.chunks.some((c) => c.fileName === doc.fileName))
      group.chunks.push(doc);
    group.total = parsed.total;
    bySession.set(parsed.session, group);
  }

  const complete = [...bySession.values()]
    .filter((g) => g.chunks.length === g.total)
    .sort((a, b) =>
      a.session < b.session ? 1 : a.session > b.session ? -1 : 0,
    );
  const newest = complete[0];
  if (!newest) return null;
  return {
    ...newest,
    chunks: [...newest.chunks].sort(
      (a, b) =>
        (parseChunkName(a.fileName)?.part ?? 0) -
        (parseChunkName(b.fileName)?.part ?? 0),
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Telegram Bot API
 * ------------------------------------------------------------------ */

const API_ROOT = "https://api.telegram.org";

/** Pure — the token used for a given chunk when several bots are configured. */
export function botTokenForChunk(cfg: TelegramConfig, index: number): string {
  const pool = [cfg.botToken, ...(cfg.extraBotTokens ?? []).filter(Boolean)];
  return pool[index % pool.length] ?? cfg.botToken;
}

/** Pure — how long to wait after a 429, from Telegram's own `retry_after`. */
export function retryAfterMs(body: unknown, attempt: number): number {
  const retryAfter = (body as { parameters?: { retry_after?: number } } | null)
    ?.parameters?.retry_after;
  if (typeof retryAfter === "number" && retryAfter > 0)
    return retryAfter * 1000;
  return Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt - 1));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function telegramFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      "Couldn't reach Telegram — check the internet connection and try again.",
    );
  }
}

/** Turns a failed Telegram response body into a sentence a person can act on. */
export function telegramErrorMessage(status: number, body: unknown): string {
  const description =
    (body as { description?: string } | null)?.description ?? `HTTP ${status}`;
  if (status === 401)
    return "Telegram rejected the bot token — check it and paste it in again.";
  if (status === 403)
    return "The bot can't post in that chat. Add it to the channel/group and make it an admin that can post messages.";
  if (status === 400 && /chat not found/i.test(description))
    return "Telegram couldn't find that chat ID. Check the chat ID in the setup fields.";
  return `Telegram refused the request: ${description}`;
}

export type UploadProgress = { part: number; total: number };

export type UploadResult = {
  session: string;
  parts: number;
  messageIds: number[];
};

/**
 * Sends one archive as one logical backup: a single `sendDocument` when it
 * fits, otherwise one `sendDocument` per ~19 MB part, each tagged with the
 * same session id in its filename and caption. 429s wait for Telegram's own
 * `retry_after`; extra bots are round-robined per part to spread the limit.
 */
/**
 * Shared send loop: splits `bytes` into ~19 MB parts and posts each with
 * `sendDocument`, retrying 429/5xx per Telegram's own backoff. Callers
 * supply their own filename/caption naming (`uploadFullBackup` and
 * `uploadYearArchive` each use a different, non-colliding name prefix) so
 * the two archive kinds never get grouped together when restoring. This
 * function only sends — remembering "last upload" pointers is the caller's
 * job, since full backups and year archives keep separate pointers.
 */
async function uploadChunks(
  cfg: TelegramConfig,
  bytes: Uint8Array,
  makeFileName: (part: number, total: number) => string,
  makeCaption: (part: number, total: number) => string,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ messageIds: number[]; parts: number }> {
  const parts = splitIntoChunks(bytes);
  const messageIds: number[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = i + 1;
    onProgress?.({ part, total: parts.length });
    const fileName = makeFileName(part, parts.length);
    const caption = makeCaption(part, parts.length);
    const token = botTokenForChunk(cfg, i);

    for (let attempt = 1; ; attempt++) {
      const form = new FormData();
      form.append("chat_id", cfg.chatId);
      form.append("caption", caption);
      form.append(
        "document",
        new Blob([(parts[i] as Uint8Array).slice().buffer as ArrayBuffer], {
          type: "application/zip",
        }),
        fileName,
      );
      const res = await telegramFetch(`${API_ROOT}/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: { message_id?: number };
      } | null;

      if (res.ok && body?.ok) {
        if (typeof body.result?.message_id === "number")
          messageIds.push(body.result.message_id);
        break;
      }
      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < MAX_CHUNK_ATTEMPTS
      ) {
        await sleep(retryAfterMs(body, attempt));
        continue;
      }
      throw new Error(telegramErrorMessage(res.status, body));
    }
  }

  return { messageIds, parts: parts.length };
}

export async function uploadFullBackup(
  cfg: TelegramConfig,
  archiveBytes: Uint8Array,
  options: {
    session?: string;
    deviceLabel?: string;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<UploadResult> {
  if (!isTelegramConfigured(cfg))
    throw new Error(
      "Add the bot token and chat ID before backing up to Telegram.",
    );

  const session = options.session ?? sessionId();
  const deviceLabel =
    options.deviceLabel ?? cfg.deviceLabel ?? defaultDeviceLabel();

  const { messageIds, parts } = await uploadChunks(
    cfg,
    archiveBytes,
    (part, total) => chunkFileName(session, part, total),
    (part, total) => chunkCaption(session, part, total, deviceLabel),
    options.onProgress,
  );

  rememberLastUpload({
    session,
    total: parts,
    messageIds,
    at: new Date().toISOString(),
  });
  return { session, parts, messageIds };
}

/* ------------------------------------------------------------------ *
 * Year-archive uploads
 *
 * A year archive is a different artifact from a full backup (only one
 * year's dated rows, no receipt photos) and is restored differently (by
 * year, not "the newest backup"), so it gets its own name prefix and its
 * own "last upload" pointer — keyed per year — rather than reusing
 * `BACKUP_NAME_PREFIX` / `LAST_UPLOAD_KEY`. That keeps a year-archive
 * upload from ever being picked up by `fetchLatestFullBackupArchive`, and
 * vice versa.
 * ------------------------------------------------------------------ */

export const YEAR_ARCHIVE_NAME_PREFIX = "turf-ledger-year-archive";

/** Pure — the filename for one part of one year's archive. */
export function yearArchiveFileName(
  year: number,
  session: string,
  part: number,
  total: number,
): string {
  return total === 1
    ? `${YEAR_ARCHIVE_NAME_PREFIX}-${year}-${session}.zip`
    : `${YEAR_ARCHIVE_NAME_PREFIX}-${year}-${session}.zip.part${part}of${total}`;
}

/** Pure — the caption every part of a year archive carries. */
export function yearArchiveCaption(
  year: number,
  session: string,
  part: number,
  total: number,
  deviceLabel: string,
): string {
  const who = deviceLabel ? ` from ${deviceLabel}` : "";
  return total === 1
    ? `${YEAR_ARCHIVE_NAME_PREFIX} ${year} ${session}${who}`
    : `${YEAR_ARCHIVE_NAME_PREFIX} ${year} ${session}${who} part ${part}/${total}`;
}

export type ParsedYearArchiveName = {
  year: number;
  session: string;
  part: number;
  total: number;
};

/** Pure — reads year/session/part/total back out of a year-archive filename. */
export function parseYearArchiveName(
  name: string,
): ParsedYearArchiveName | null {
  const match = new RegExp(
    `^${YEAR_ARCHIVE_NAME_PREFIX}-(\\d{4})-(.+?)\\.zip(?:\\.part(\\d+)of(\\d+))?$`,
  ).exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const session = match[2] ?? "";
  const part = match[3];
  const total = match[4];
  if (!part || !total) return { year, session, part: 1, total: 1 };
  return { year, session, part: Number(part), total: Number(total) };
}

const YEAR_ARCHIVE_LAST_UPLOAD_PREFIX = "ks:telegram-year-archive-last-";

export type LastYearArchiveUpload = {
  year: number;
  session: string;
  total: number;
  messageIds: number[];
  at: string;
};

function rememberLastYearArchiveUpload(info: LastYearArchiveUpload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${YEAR_ARCHIVE_LAST_UPLOAD_PREFIX}${info.year}`,
      JSON.stringify(info),
    );
  } catch {
    /* a full/blocked localStorage must not fail an otherwise-good upload */
  }
}

/** The remembered pointer for one year's archive upload, if this device made one. */
export function readLastYearArchiveUpload(
  year: number,
): LastYearArchiveUpload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      `${YEAR_ARCHIVE_LAST_UPLOAD_PREFIX}${year}`,
    );
    return raw ? (JSON.parse(raw) as LastYearArchiveUpload) : null;
  } catch {
    return null;
  }
}

export type UploadYearArchiveResult = {
  year: number;
  session: string;
  parts: number;
  messageIds: number[];
};

/**
 * Sends one year's archive to Telegram, chunked the same way as a full
 * backup. Used by `archive.ts` before it deletes that year's rows locally —
 * the upload is the safety net that makes local deletion acceptable, so
 * this throws (rather than failing silently) on any Telegram error.
 */
export async function uploadYearArchive(
  cfg: TelegramConfig,
  year: number,
  archiveBytes: Uint8Array,
  options: {
    session?: string;
    deviceLabel?: string;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<UploadYearArchiveResult> {
  if (!isTelegramConfigured(cfg))
    throw new Error(
      "Add the bot token and chat ID before archiving a year to Telegram.",
    );

  const session = options.session ?? sessionId();
  const deviceLabel =
    options.deviceLabel ?? cfg.deviceLabel ?? defaultDeviceLabel();

  const { messageIds, parts } = await uploadChunks(
    cfg,
    archiveBytes,
    (part, total) => yearArchiveFileName(year, session, part, total),
    (part, total) =>
      yearArchiveCaption(year, session, part, total, deviceLabel),
    options.onProgress,
  );

  rememberLastYearArchiveUpload({
    year,
    session,
    total: parts,
    messageIds,
    at: new Date().toISOString(),
  });
  return { year, session, parts, messageIds };
}

/* ------------------------------------------------------------------ *
 * Restore side: finding and downloading the latest backup
 * ------------------------------------------------------------------ */

const LAST_UPLOAD_KEY = "ks:telegram-backup-last";

export type LastUpload = {
  session: string;
  total: number;
  messageIds: number[];
  at: string;
};

function rememberLastUpload(info: LastUpload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_UPLOAD_KEY, JSON.stringify(info));
  } catch {
    /* a full/blocked localStorage must not fail an otherwise-good upload */
  }
}

export function readLastUpload(): LastUpload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_UPLOAD_KEY);
    return raw ? (JSON.parse(raw) as LastUpload) : null;
  } catch {
    return null;
  }
}

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    document?: { file_id?: string; file_name?: string };
    message_id?: number;
  };
  channel_post?: {
    chat?: { id?: number | string };
    document?: { file_id?: string; file_name?: string };
    message_id?: number;
  };
};

/** Pure — pulls backup documents for the configured chat out of a getUpdates payload. */
export function chunksFromUpdates(
  updates: TelegramUpdate[],
  chatId: string,
): RemoteChunk[] {
  const found: RemoteChunk[] = [];
  for (const update of updates) {
    const post = update.message ?? update.channel_post;
    const doc = post?.document;
    if (!doc?.file_id || !doc.file_name) continue;
    if (String(post?.chat?.id ?? "") !== String(chatId)) continue;
    if (!parseChunkName(doc.file_name)) continue;
    const chunk: RemoteChunk = { fileName: doc.file_name, fileId: doc.file_id };
    if (typeof post?.message_id === "number") chunk.messageId = post.message_id;
    found.push(chunk);
  }
  return found;
}

async function callApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await telegramFetch(`${API_ROOT}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
    } | null;
    if (res.ok && body?.ok) return body.result as T;
    if (
      (res.status === 429 || res.status >= 500) &&
      attempt < MAX_CHUNK_ATTEMPTS
    ) {
      await sleep(retryAfterMs(body, attempt));
      continue;
    }
    throw new Error(telegramErrorMessage(res.status, body));
  }
}

/** Downloads one document's bytes via `getFile` + the file endpoint. */
export async function downloadChunk(
  token: string,
  fileId: string,
): Promise<Uint8Array> {
  const file = await callApi<{ file_path?: string }>(token, "getFile", {
    file_id: fileId,
  });
  if (!file?.file_path)
    throw new Error("Telegram didn't return a download path for that part.");
  const res = await telegramFetch(
    `${API_ROOT}/file/bot${token}/${file.file_path}`,
  );
  if (!res.ok)
    throw new Error(`Couldn't download a backup part (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Finds the newest complete backup in the chat and returns its reassembled
 * archive bytes.
 *
 * `getUpdates` is the only history a bot can read back, and it only holds
 * recent, un-consumed updates — so the parts sent by THIS device are also
 * remembered locally (`readLastUpload`) and used when the poll comes back
 * empty. Either way the parts are grouped by session id, never by arrival
 * order.
 */
export async function fetchLatestFullBackupArchive(
  cfg: TelegramConfig,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ session: string; bytes: Uint8Array }> {
  if (!isTelegramConfigured(cfg))
    throw new Error(
      "Add the bot token and chat ID before restoring from Telegram.",
    );

  const updates = await callApi<TelegramUpdate[]>(cfg.botToken, "getUpdates", {
    limit: 100,
    allowed_updates: ["message", "channel_post"],
  });
  let group = latestCompleteGroup(chunksFromUpdates(updates ?? [], cfg.chatId));

  if (!group) {
    const last = readLastUpload();
    if (!last || last.messageIds.length !== last.total)
      throw new Error(
        "No complete backup found in that Telegram chat yet. Tap 'Backup now' on the device that has the data, then try again.",
      );
    // Fall back to the pointer this device kept when it uploaded: re-read
    // each remembered message through forwardMessage so we get its file_id
    // back even after getUpdates has aged out.
    const chunks: RemoteChunk[] = [];
    for (let i = 0; i < last.messageIds.length; i++) {
      const forwarded = await callApi<TelegramUpdate["message"]>(
        botTokenForChunk(cfg, i),
        "forwardMessage",
        {
          chat_id: cfg.chatId,
          from_chat_id: cfg.chatId,
          message_id: last.messageIds[i],
        },
      );
      const doc = forwarded?.document;
      if (doc?.file_id && doc.file_name) {
        const chunk: RemoteChunk = {
          fileName: doc.file_name,
          fileId: doc.file_id,
        };
        const mid = last.messageIds[i];
        if (typeof mid === "number") chunk.messageId = mid;
        chunks.push(chunk);
      }
    }
    group = latestCompleteGroup(chunks);
    if (!group)
      throw new Error(
        "Couldn't read the last backup's parts back from Telegram.",
      );
  }

  const parts: Uint8Array[] = [];
  for (let i = 0; i < group.chunks.length; i++) {
    onProgress?.({ part: i + 1, total: group.chunks.length });
    parts.push(
      await downloadChunk(botTokenForChunk(cfg, i), group.chunks[i]!.fileId),
    );
  }
  return { session: group.session, bytes: joinChunks(parts) };
}

/** One-line summary for the single post-restore toast. */
export function restoreSummary(result: RestoreFullBackupResult): string {
  const parts = [
    `${result.rowsRestored} record${result.rowsRestored === 1 ? "" : "s"}`,
    `${result.filesRestored} receipt photo${result.filesRestored === 1 ? "" : "s"}`,
  ];
  if (result.filesSkippedExisting > 0)
    parts.push(
      `${result.filesSkippedExisting} photo(s) already on this device`,
    );
  if (result.filesSkippedUnmatched > 0)
    parts.push(
      `${result.filesSkippedUnmatched} photo(s) didn't match an expense`,
    );
  if (result.filesCorrupted.length > 0)
    parts.push(
      `${result.filesCorrupted.length} photo(s) failed a checksum and were not restored`,
    );
  return parts.join(" · ");
}
