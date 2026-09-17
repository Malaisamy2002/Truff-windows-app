import { isAndroid, isDesktop } from "./desktop";
import { secureDelete, secureGet, secureSet } from "./android-secure-store";

/**
 * The single passphrase used to encrypt every backup archive that leaves
 * this device — the Telegram full backup (see `backup-crypto.ts` and audit
 * item 1.4). Stored in the same tiered secret store already used for the
 * Telegram bot token (Android Keystore-backed `EncryptedSharedPreferences` /
 * `keyring_*` on desktop / `localStorage` fallback in the plain browser
 * build — see `android-secure-store.ts`, `telegram-backup.ts`) so it's
 * applied automatically on every backup/restore without retyping it each
 * time.
 *
 * `keyring_*` validates `account` against a fixed allowlist on the Rust
 * side (see `src-tauri/src/lib.rs`) rather than trusting whatever string a
 * caller passes — this module can only ever read/write its own
 * `"backup-passphrase"` slot, never an arbitrary named credential.
 *
 * Worth being explicit about what this does and doesn't protect against:
 * it keeps the archive opaque to Telegram itself, and to anyone who gains
 * access to that chat without also having this device. It does NOT protect
 * against a compromised or stolen *unlocked* device — the passphrase lives
 * in the same tier of storage as the tokens it's meant to add a layer of
 * protection beyond. A device lock/passcode covers that case.
 */

const WEB_KEY = "ks:backup-passphrase";
const KEYRING_ACCOUNT = "backup-passphrase";
const SECURE_STORE_KEY = "backup-passphrase";

export async function readBackupPassphrase(): Promise<string> {
  if (isAndroid()) return (await secureGet(SECURE_STORE_KEY)) ?? "";
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return (
        (await invoke<string | null>("keyring_get_token", {
          account: KEYRING_ACCOUNT,
        })) ?? ""
      );
    } catch {
      return "";
    }
  }
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(WEB_KEY) ?? "";
  } catch {
    return "";
  }
}

export async function writeBackupPassphrase(passphrase: string): Promise<void> {
  if (isAndroid()) {
    try {
      if (passphrase) await secureSet(SECURE_STORE_KEY, passphrase);
      else await secureDelete(SECURE_STORE_KEY);
    } catch {
      // Keystore/EncryptedSharedPreferences refused the write — fall back
      // rather than leaving "Save" permanently broken (same recovery as
      // telegram-backup.ts's own secret storage).
      if (typeof window === "undefined") return;
      if (passphrase) window.localStorage.setItem(WEB_KEY, passphrase);
      else window.localStorage.removeItem(WEB_KEY);
    }
    return;
  }
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      if (passphrase) {
        await invoke("keyring_set_token", {
          account: KEYRING_ACCOUNT,
          token: passphrase,
        });
      } else {
        await invoke("keyring_delete_token", {
          account: KEYRING_ACCOUNT,
        }).catch(() => undefined);
      }
    } catch {
      if (typeof window === "undefined") return;
      if (passphrase) window.localStorage.setItem(WEB_KEY, passphrase);
      else window.localStorage.removeItem(WEB_KEY);
    }
    return;
  }
  if (typeof window === "undefined") return;
  if (passphrase) window.localStorage.setItem(WEB_KEY, passphrase);
  else window.localStorage.removeItem(WEB_KEY);
}

export async function hasBackupPassphrase(): Promise<boolean> {
  return (await readBackupPassphrase()).length > 0;
}
