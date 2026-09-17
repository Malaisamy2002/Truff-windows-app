/**
 * Receipt-photo helpers shared by the features that actually move photos
 * across devices: the single-file `.db` backup (`backup.ts`, which embeds
 * every photo inline as of its `photos` field) and the Telegram full backup
 * (`telegram-backup.ts`). There used to be a third, standalone "Receipts
 * sharing" export/import/verify `.zip` flow here as a lighter-weight
 * alternative to those — it's been removed now that both real backup paths
 * are self-contained, so this file is left with just the two primitives
 * they still share.
 */

/**
 * Hex-encoded SHA-256 of a byte array, via Web Crypto's `crypto.subtle`
 * (available in both the Tauri webview and the browser build — no extra
 * dependency needed). Used to fingerprint receipt photos at capture time
 * (`uploadReceipt` in expenses.ts) and again whenever a backup carries them
 * across devices, so a corrupted byte anywhere in that lifecycle is caught
 * instead of silently traveling forward as a "valid" photo.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ImportAction = "restore" | "skip-existing" | "skip-unmatched";

/**
 * Pure decision for one receipt-photo file found in an incoming archive
 * (Telegram restore today):
 * - `skip-unmatched`: no current expense row's `receipt_path` points here —
 *   importing a receipt never creates a new expense row, so there is
 *   nothing to attach this photo to.
 * - `skip-existing`: a file is already saved at this path — never overwrite.
 * - `restore`: write it.
 */
export function resolveImportAction(
  path: string,
  knownReceiptPaths: ReadonlySet<string>,
  alreadyExists: boolean,
): ImportAction {
  if (!knownReceiptPaths.has(path)) return "skip-unmatched";
  if (alreadyExists) return "skip-existing";
  return "restore";
}
