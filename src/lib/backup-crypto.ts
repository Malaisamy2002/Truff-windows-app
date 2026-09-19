/**
 * AES-256-GCM encryption for backup payloads.
 *
 * `telegram-backup.ts` packages the whole ledger (customers, bills,
 * expenses, receipt photos) into one archive and hands it to a third party
 * — a Telegram chat, or the local filesystem if it's later shared/copied.
 * Neither Telegram nor an on-disk copy needs to be able to read that archive
 * for the backup/restore flow to work, so it's encrypted client-side before
 * it leaves the device and decrypted client-side after it comes back. This
 * module is that encrypt/decrypt step; it knows nothing about Telegram or
 * the archive's internal shape (zip vs. JSON) — callers pass it raw bytes.
 *
 * Container format (all multi-byte integers big-endian):
 *   4 bytes   magic "TSLE" (Turf Snack Ledger Encrypted)
 *   1 byte    format version (currently 1)
 *   4 bytes   PBKDF2 iteration count
 *   16 bytes  PBKDF2 salt
 *   12 bytes  AES-GCM IV
 *   N bytes   AES-256-GCM ciphertext (the last 16 bytes are GCM's own
 *             authentication tag — Web Crypto appends it automatically and
 *             `decrypt` verifies it, which is what turns "wrong passphrase"
 *             and "corrupted/tampered file" into a clean rejection instead
 *             of silently returning garbage plaintext)
 *
 * The passphrase itself never travels in the container or anywhere near
 * Telegram — only the derived key is used, and only in memory.
 */

import { readBackupPassphrase } from "./backup-passphrase";

const MAGIC = [0x54, 0x53, 0x4c, 0x45]; // "TSLE"
const VERSION = 1;
const PBKDF2_ITERATIONS = 600_000; // OWASP Password Storage Cheat Sheet's PBKDF2-HMAC-SHA256 recommendation
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = MAGIC.length + 1 + 4; // magic + version + iteration count

/** Thrown when decryption fails — either the passphrase is wrong, or the file is corrupt/tampered. GCM's auth tag can't tell those apart, and neither can we. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase, or this backup file is damaged.");
    this.name = "WrongPassphraseError";
  }
}

/**
 * Thrown by `decryptFullBackupBytes` when the file is an encrypted `TSLE`
 * container but there's no passphrase to try it with — nothing typed in for
 * this restore, and nothing saved on this device either. Kept distinct from
 * `WrongPassphraseError` (a passphrase was tried and failed) so a caller can
 * offer "type the passphrase this file was made with" for both cases
 * without conflating "you have the wrong one" with "you have none at all".
 */
export class NoPassphraseSetError extends Error {
  constructor() {
    super(
      "This backup is encrypted. Enter the passphrase it was created with.",
    );
    this.name = "NoPassphraseSetError";
  }
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** True when `bytes` looks like a container this module produced (any version). */
export function isEncryptedBackup(bytes: Uint8Array): boolean {
  return bytes.length > HEADER_BYTES && MAGIC.every((b, i) => bytes[i] === b);
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts `plaintext` under `passphrase`. A fresh random salt and IV are
 * generated per call, so encrypting the same bytes twice never produces the
 * same ciphertext (important here since consecutive backups of a mostly
 * unchanged ledger would otherwise leak that fact to whoever holds the
 * chat/repo).
 */
export async function encryptBackup(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  if (!passphrase) throw new Error("Set a backup encryption passphrase first.");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      plaintext as BufferSource,
    ),
  );

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  header[MAGIC.length] = VERSION;
  new DataView(header.buffer).setUint32(
    MAGIC.length + 1,
    PBKDF2_ITERATIONS,
    false,
  );

  return concatBytes(header, salt, iv, ciphertext);
}

/**
 * Decrypts a container produced by `encryptBackup`. Throws
 * `WrongPassphraseError` when the passphrase is wrong or the bytes are
 * corrupt/tampered (GCM's authentication check is what catches this — there
 * is no separate "is this right" check to run first).
 */
export async function decryptBackup(
  container: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  if (!isEncryptedBackup(container))
    throw new Error(
      "This file isn't an encrypted backup produced by this app.",
    );
  if (!passphrase)
    throw new Error("Enter the backup passphrase to restore this file.");

  const view = new DataView(
    container.buffer,
    container.byteOffset,
    container.byteLength,
  );
  const iterations = view.getUint32(MAGIC.length + 1, false);
  let offset = HEADER_BYTES;
  const salt = container.slice(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = container.slice(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const ciphertext = container.slice(offset);

  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new WrongPassphraseError();
  }
}

/**
 * Encrypts `bytes` — a built backup's serialized bytes, whatever the
 * underlying shape (zip archive, or plain JSON text as `downloadBackup`'s
 * single-file `.db` export produces) — with this device's stored backup
 * passphrase (see `backup-passphrase.ts`). Every path that sends a backup
 * somewhere it doesn't fully control (Telegram) or writes it to a shared
 * location (a local `.db`/`.zip`/year-archive save, which can end up
 * copied/shared like any other file) calls this before handing bytes off,
 * so nothing that leaves the device is ever plaintext. Throws a plain,
 * actionable error if no passphrase has been set yet, rather than silently
 * falling back to plaintext.
 */
export async function encryptFullBackupBytes(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const passphrase = await readBackupPassphrase();
  if (!passphrase)
    throw new Error(
      "Set a backup encryption passphrase (Settings → Backup encryption) before backing up.",
    );
  return encryptBackup(bytes, passphrase);
}

/**
 * Inverse of `encryptFullBackupBytes`, for a restore path reading `bytes`
 * fresh off disk or a picked file. Archives/`.db` files made after
 * encryption was added come back through here as `TSLE` containers; older
 * ones made before it are plain bytes and are passed through unchanged —
 * detecting and handling both is what keeps a backup someone already has
 * saved/sent from becoming unrestorable.
 *
 * `passphraseOverride`, when given, is tried instead of this device's
 * stored passphrase — for restoring a file made under a different
 * passphrase (another device, or this device's passphrase changed since).
 * Callers that don't have one to offer yet should omit it: that keeps the
 * original "just works with the stored passphrase" behavior, and lets the
 * caller catch `WrongPassphraseError`/`NoPassphraseSetError` to ask for one
 * only when the stored passphrase actually didn't work.
 */
export async function decryptFullBackupBytes(
  bytes: Uint8Array,
  passphraseOverride?: string,
): Promise<Uint8Array> {
  if (!isEncryptedBackup(bytes)) return bytes;
  const passphrase = passphraseOverride || (await readBackupPassphrase());
  if (!passphrase) throw new NoPassphraseSetError();
  return decryptBackup(bytes, passphrase);
}
