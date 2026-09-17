import {
  db,
  table,
  DATA_TABLES,
  type DataTable,
  type Row,
  type ReceiptHashRow,
} from "./localdb";
import {
  isAndroid,
  isDesktop,
  saveExportFile,
  saveToAppDocuments,
  bytesToBase64,
  base64ToBytes,
} from "./desktop";
import {
  findInvalidRows,
  findInvalidPhotoRows,
  findInvalidReceiptHashRows,
  describeInvalidRows,
} from "./backup-validate";
import {
  encryptFullBackupBytes,
  decryptFullBackupBytes,
} from "./backup-crypto";
import { sha256Hex } from "./receipts-share";

export const BACKUP_TABLES = DATA_TABLES;

export type BackupTable = DataTable;

/** One receipt photo, base64-encoded, as carried inline in a version-2+ backup. */
export type BackupPhoto = { path: string; data: string; created_at: string };

export type BackupFile = {
  format: "turf-snack-ledger";
  /**
   * Version 1 was table rows only — receipt photos travelled separately via
   * the `.zip` export in receipts-share.ts. Version 2 adds `photos` below,
   * so a single `.db` file is fully self-contained (data + receipt photos)
   * and can be copied straight to another device (Windows ⇄ Android) with
   * nothing else to transfer. `restoreBackup` reads both versions the same
   * way — `photos` simply comes back empty for a version-1 file.
   */
  version: 1 | 2;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
  photos?: BackupPhoto[];
  /**
   * Capture-time hashes for `photos[]`, same table `buildFullBackup`
   * (telegram-backup.ts) already carries. Not part of `tables` — like
   * `receipts`, `receipt_hashes` isn't in `DATA_TABLES` — so it's its own
   * optional field, absent from anything built before this field existed.
   */
  receipt_hashes?: ReceiptHashRow[];
};

/**
 * Reads every local table, plus every receipt photo, into one portable
 * snapshot. Photos come from `db.receipts` — `uploadReceipt` (expenses.ts)
 * mirrors every photo there on every platform (not just the browser/PWA
 * build), so this one Dexie table is always the complete set regardless of
 * whether the device also keeps an on-disk copy under `Documents/TurfApp`.
 */
export async function buildBackup(): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = (await table(t).toArray()) as Record<string, unknown>[];
  }
  const receiptRows = await db.receipts.toArray();
  const photos: BackupPhoto[] = await Promise.all(
    receiptRows.map(async (r) => ({
      path: r.path,
      data: bytesToBase64(new Uint8Array(await r.blob.arrayBuffer())),
      created_at: r.created_at,
    })),
  );
  const receiptHashes = await db.receipt_hashes.toArray();
  return {
    format: "turf-snack-ledger",
    version: 2,
    exported_at: new Date().toISOString(),
    tables,
    photos,
    receipt_hashes: receiptHashes,
  };
}

export function backupFileName() {
  return `turf-ledger-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.db`;
}

/**
 * Saves a backup to disk. In the browser/PWA this is a Blob + `<a download>`
 * click (fire-and-forget, no result). In the desktop shell it opens a native
 * Save dialog via `tauri-plugin-dialog` + `tauri-plugin-fs`; returns the path
 * the user chose, or `null` if they cancelled the dialog.
 *
 * Android is matched before the generic desktop branch and does NOT use that
 * Save dialog: `tauri-plugin-dialog`'s `save()` hands back a `content://`
 * URI on Android that `tauri-plugin-fs`'s `writeFile()` cannot write to — it
 * does not throw, it just silently produces a 0-byte file (see
 * `saveExportFile`'s doc comment in desktop.ts). That's a real correctness
 * risk here specifically, since `archiveYear` in archive.ts (which shares
 * this same dialog+fs pattern) deletes local rows once its own download
 * reports success — a silently-empty backup would mean deleted data with no
 * usable copy anywhere. Android instead writes through the bundled
 * `android-save` plugin straight into the public Downloads folder, with no
 * dialog and thus no "cancelled" outcome — just saved or not.
 *
 * The file this writes is encrypted (see `encryptFullBackupBytes` in
 * backup-crypto.ts) — this is the single-file `.db` export people are most
 * likely to copy to a USB drive, email, or drop in a shared cloud folder, so
 * it gets the same AES-256-GCM treatment the Telegram full backup and year
 * archive already had; there's no plaintext branch left. `encryptFullBackupBytes`
 * throws a clear, actionable error if no backup passphrase has been set yet
 * (Settings → Backup encryption) rather than silently falling back to
 * plaintext.
 *
 * Kept async (the browser branch always did the work synchronously, so
 * existing unawaited call sites keep working unchanged) so BackupCard/
 * ArchiveCard can `await` it to know whether a desktop save was cancelled
 * (or an Android save failed).
 */
export async function downloadBackup(
  backup: BackupFile,
  name = backupFileName(),
): Promise<string | null> {
  const text = JSON.stringify(backup, null, 2);
  const bytes = await encryptFullBackupBytes(new TextEncoder().encode(text));

  if (isAndroid()) {
    const result = await saveExportFile(
      bytes,
      name,
      "application/octet-stream",
    );
    // A failed Android save throws with the device's own reason so the
    // caller's catch can show it, instead of returning null — which the
    // caller can't tell apart from "the person cancelled".
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
      filters: [{ name: "Ledger backup", extensions: ["db", "json"] }],
    });
    if (!path) return null; // user cancelled — caller should not claim success
    await writeFile(path, bytes);
    return path;
  }

  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

/**
 * Opens a native file-open dialog and reads the chosen backup's raw bytes.
 * Desktop-only — the browser build keeps using the `<input type="file">`
 * element already in BackupCard.tsx (`file.arrayBuffer()`), since a plain
 * `<input>` has no native-dialog equivalent to call from here. Returns
 * `null` if the user cancelled.
 *
 * Reads bytes, not text (`readFile`, not `readTextFile`) — since
 * `downloadBackup` started encrypting this file, its on-disk form is a
 * binary `TSLE` container, not UTF-8 JSON. `decodeBackupBytes` below turns
 * whatever comes back here into the JSON text `parseBackup` expects.
 */
export async function pickBackupFile(): Promise<Uint8Array | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({
    multiple: false,
    filters: [{ name: "Ledger backup", extensions: ["db", "json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return readFile(path);
}

/**
 * Turns raw bytes read from a `.db` file (`pickBackupFile`, or a picked
 * `<input type="file">`) into the JSON text `parseBackup` expects.
 * Decrypts first if the bytes look like a `TSLE` container (see
 * `decryptFullBackupBytes`); older backups made before encryption was
 * added are plain UTF-8 JSON already and pass through unchanged, so they
 * keep restoring normally.
 */
export async function decodeBackupBytes(bytes: Uint8Array): Promise<string> {
  const plain = await decryptFullBackupBytes(bytes);
  return new TextDecoder().decode(plain);
}

export function parseBackup(text: string): BackupFile {
  const parsed = JSON.parse(text) as BackupFile;
  if (parsed?.format !== "turf-snack-ledger" || !parsed.tables)
    throw new Error("Not a valid ledger backup file");
  return parsed;
}

export function backupSummary(backup: BackupFile) {
  const base = BACKUP_TABLES.map(
    (t) => `${t}: ${backup.tables[t]?.length ?? 0}`,
  ).join(" · ");
  const photoCount = backup.photos?.length ?? 0;
  return photoCount > 0 ? `${base} · photos: ${photoCount}` : base;
}

/**
 * Read-only "what will actually happen" preview for the confirmation dialog
 * in front of a restore — plan item: "Preview a restore before applying it.
 * Show what will be added, replaced, or skipped." Mirrors `restoreBackup`'s
 * own per-table logic exactly (same primary-key dedup for merge, same
 * clear-then-write for replace) but never writes anything, so it's safe to
 * call before the person has committed to anything.
 *
 * Doesn't re-run `findInvalidRows`/etc — `restoreBackup` still does that
 * validation immediately before it writes, so a corrupted file still can't
 * reach local data; it just means a corrupted file's preview numbers are
 * shown before that check runs, same as any other read of the file's raw
 * contents.
 */
export type RestorePreviewRow =
  | { table: BackupTable; mode: "merge"; added: number; alreadyPresent: number }
  | {
      table: BackupTable;
      mode: "replace";
      willAdd: number;
      willRemove: number;
    };

export type RestorePreview = {
  mode: "replace" | "merge";
  perTable: RestorePreviewRow[];
  /** Rows from the backup that will end up in the local database. */
  totalAdded: number;
  /** merge: rows already present locally, left untouched. replace: rows
   *  currently on this device that get deleted before the backup is written. */
  totalUnchangedOrRemoved: number;
  photoCount: number;
};

export async function previewRestore(
  backup: BackupFile,
  mode: "replace" | "merge",
): Promise<RestorePreview> {
  const perTable: RestorePreviewRow[] = [];
  let totalAdded = 0;
  let totalUnchangedOrRemoved = 0;

  for (const t of BACKUP_TABLES) {
    const rows = (backup.tables[t] ?? []) as Row[];
    if (mode === "merge") {
      const target = table(t);
      const primKey = target.schema.primKey.name as string;
      const existingIds = new Set(
        (await target.toArray()).map((r) => String((r as Row)[primKey])),
      );
      const added = rows.filter(
        (r) => !existingIds.has(String(r[primKey])),
      ).length;
      const alreadyPresent = rows.length - added;
      perTable.push({ table: t, mode: "merge", added, alreadyPresent });
      totalAdded += added;
      totalUnchangedOrRemoved += alreadyPresent;
    } else {
      const willRemove = await table(t).count();
      perTable.push({
        table: t,
        mode: "replace",
        willAdd: rows.length,
        willRemove,
      });
      totalAdded += rows.length;
      totalUnchangedOrRemoved += willRemove;
    }
  }

  return {
    mode,
    perTable,
    totalAdded,
    totalUnchangedOrRemoved,
    photoCount: backup.photos?.length ?? 0,
  };
}

/**
 * Cross-checks each photo's actual bytes against its capture-time
 * `receipt_hashes` entry, when one exists. A `.db` backup has no separate
 * checksum manifest the way a Telegram full-backup zip does (see
 * `findInvalidReceiptHashRows`'s use in `restoreFullBackup`) — its receipt
 * hashes travel alongside the photos in the same JSON, which is why this
 * checks photo bytes against `receipt_hashes` directly rather than reusing
 * that zip-manifest flow. A path with no matching hash row is
 * "unverifiable", not corrupt (see the `receipt_hashes` store's own doc
 * comment in localdb.ts) — most backups taken before this field existed
 * will have none at all, and that's expected, not a problem to report.
 */
async function findHashMismatchedPhotos(
  photos: BackupPhoto[],
  hashes: ReceiptHashRow[],
): Promise<string[]> {
  if (hashes.length === 0) return [];
  const byPath = new Map(hashes.map((h) => [h.path, h.sha256]));
  const mismatched: string[] = [];
  for (const photo of photos) {
    const expected = byPath.get(photo.path);
    if (!expected) continue; // no captured hash for this path — unverifiable, not corrupt
    const actual = await sha256Hex(base64ToBytes(photo.data));
    if (actual !== expected) mismatched.push(photo.path);
  }
  return mismatched;
}

/**
 * Restores a snapshot. `mode: "replace"` wipes current rows first;
 * `mode: "merge"` keeps existing rows and adds only the ones missing.
 * Returns the number of table rows inserted — photos and receipt hashes
 * are restored too (see the loops below), but aren't counted in this
 * return value.
 */
export async function restoreBackup(
  backup: BackupFile,
  mode: "replace" | "merge" = "replace",
) {
  // Validate every row BEFORE anything is cleared or written — a `mode:
  // "replace"` restore clears each table first, so a shape problem
  // discovered mid-transaction would leave the ledger emptier than before
  // the restore was attempted, not just unrestored. See backup-validate.ts.
  const rowProblems = findInvalidRows(backup.tables);
  if (rowProblems.length > 0) throw new Error(describeInvalidRows(rowProblems));

  const photoProblems = findInvalidPhotoRows(backup.photos ?? []);
  if (photoProblems.length > 0)
    throw new Error(
      `This backup has ${photoProblems.length} corrupted receipt photo record${
        photoProblems.length === 1 ? "" : "s"
      } — nothing was restored.`,
    );

  const receiptHashes = backup.receipt_hashes ?? [];
  const hashProblems = findInvalidReceiptHashRows(receiptHashes);
  if (hashProblems.length > 0)
    throw new Error(
      `This backup's receipt-hash records look corrupted (${hashProblems.length} bad row${
        hashProblems.length === 1 ? "" : "s"
      }) — nothing was restored.`,
    );

  const mismatchedPhotos = await findHashMismatchedPhotos(
    backup.photos ?? [],
    receiptHashes,
  );
  if (mismatchedPhotos.length > 0)
    throw new Error(
      `${mismatchedPhotos.length} receipt photo${
        mismatchedPhotos.length === 1 ? "" : "s"
      } failed the capture-time checksum check — nothing was restored.`,
    );

  let inserted = 0;

  await db.transaction(
    "rw",
    [...BACKUP_TABLES.map((t) => table(t)), db.receipts, db.receipt_hashes],
    async () => {
      if (mode === "replace") {
        for (const t of [...BACKUP_TABLES].reverse()) {
          await table(t).clear();
        }
        // Photos are keyed by `receipt_path`, so a "replace" that wipes the
        // expense rows but leaves old photos behind would strand them —
        // clear them together so the two stay in sync. Hashes are keyed the
        // same way and cleared alongside for the same reason.
        await db.receipts.clear();
        await db.receipt_hashes.clear();
      }

      for (const t of BACKUP_TABLES) {
        const rows = (backup.tables[t] ?? []) as Row[];
        if (rows.length === 0) continue;
        const target = table(t);
        if (mode === "merge") {
          // Dedup on each table's OWN primary key, not a hardcoded "id" —
          // most DATA_TABLES use "id", but app_settings is keyed by "key"
          // (see localdb.ts). Hardcoding "id" made every app_settings row
          // (existing and incoming) collapse to the same "undefined" bucket,
          // so a merge restore silently kept whichever settings the target
          // device already had and dropped the incoming ones with no error.
          const primKey = target.schema.primKey.name as string;
          const existing = new Set(
            (await target.toArray()).map((r) => String(r[primKey])),
          );
          const fresh = rows.filter((r) => !existing.has(String(r[primKey])));
          if (fresh.length === 0) continue;
          await target.bulkAdd(fresh);
          inserted += fresh.length;
        } else {
          await target.bulkPut(rows);
          inserted += rows.length;
        }
      }

      for (const photo of backup.photos ?? []) {
        if (mode === "merge" && (await db.receipts.get(photo.path))) continue; // never overwrite
        await db.receipts.put({
          path: photo.path,
          blob: new Blob([base64ToBytes(photo.data).buffer as ArrayBuffer]),
          created_at: photo.created_at,
        });
      }

      if (receiptHashes.length > 0) {
        if (mode === "merge") {
          const existingHashPaths = new Set(
            (await db.receipt_hashes.toArray()).map((r) => r.path),
          );
          const freshHashes = receiptHashes.filter(
            (h) => !existingHashPaths.has(h.path),
          );
          if (freshHashes.length > 0)
            await db.receipt_hashes.bulkPut(freshHashes);
        } else {
          await db.receipt_hashes.bulkPut(receiptHashes);
        }
      }
    },
  );

  // Best-effort, outside the transaction (real filesystem I/O, not
  // IndexedDB): also write each restored photo to disk on desktop/Android,
  // so "View receipt" works immediately without falling back to the Dexie
  // copy just written above. If any of these fail, that Dexie copy is
  // still there as a fallback (see openReceipt in expenses.ts).
  if (isDesktop() && backup.photos?.length) {
    for (const photo of backup.photos) {
      try {
        await saveToAppDocuments(photo.path, base64ToBytes(photo.data));
      } catch {
        /* best-effort only */
      }
    }
  }

  return inserted;
}
