# Changelog

All notable changes to this consolidation are recorded here, newest first.

## [Unreleased]

### Fixed
- **Year-archiving saved cleartext data to a shared folder:** `archiveYear()`
  now encrypts the `.db` file it writes locally with the same backup
  passphrase as a full backup (`encryptFullBackupBytes` in
  `telegram-backup.ts`), before it lands in the public Downloads/Documents
  location — a whole year of bookings/sales no longer sits there in plain
  JSON. **This does not retroactively re-encrypt anything:** if you already
  have a `Turf bookings and sales - <year>.db` file in Downloads from
  before this fix, that specific file is still plaintext — move it
  somewhere secure or delete it once you've confirmed the archived data
  reached Telegram safely. Archives made after this fix are fine as-is.
- **Credential collision bug:** the backup passphrase and the Telegram bot
  token were silently sharing one OS-keyring entry. `backup-passphrase.ts`
  called `keyring_get_token`/`keyring_set_token` with `{ service, account }`,
  but the Rust commands took no parameters and always read/wrote one
  hardcoded slot — so saving a backup passphrase silently overwrote the
  saved Telegram bot token, and vice versa. `keyring_get_token`/`set`/
  `delete` now accept an `account` parameter (checked against a fixed
  allowlist, never an arbitrary caller-supplied name) so each secret has its
  own entry. See `src-tauri/src/lib.rs`.
- **Extra Telegram bot tokens stored in plaintext:** the round-robin "extra
  bots" feature (already live in `TelegramBackupCard`'s UI) saved its tokens
  in plain `localStorage` via `Meta`/`META_KEY`, even on desktop where the
  OS keyring is otherwise used for the primary bot token. They now go
  through the same tiered secret storage as the primary token (OS keyring
  on desktop, Keystore-backed `EncryptedSharedPreferences` on Android via
  the `android-save` plugin, `localStorage` only as the last-resort browser
  fallback). See `telegram-backup.ts`'s `readExtraTokens`/`writeExtraTokens`.
- Ported the Android secure-credential-store plugin support
  (`secureGet`/`secureSet`/`secureDelete`, Keystore-backed
  `EncryptedSharedPreferences`) into this project's copy of the
  `android-save` plugin — `AndroidSavePlugin.kt`,
  `plugins/android-save/src/lib.rs` — along with the `FileProvider` manifest
  entry and `res/xml/android_save_file_paths.xml` needed for
  `AndroidSavePlugin.openFile()` on API ≤ 28, both previously missing from
  this project's copy of the plugin.

### Added
- Receipt-photo integrity checking end to end:
  - `uploadReceipt()` now rejects a file whose bytes don't sniff as a real
    image (`sniffImageMimeType`/`isLikelyImageFile` in `image.ts`), instead
    of trusting the extension-derived `File.type` a renamed non-image file
    can spoof.
  - `uploadReceipt()` records a SHA-256 of every stored photo at capture
    time (`db.receipt_hashes`, schema v7).
  - `buildReceiptsArchive()` hashes every packed photo, writes the hash into
    `manifest.json`, and self-verifies the generated archive before
    returning it (`verified`/`hashMismatch` in the result).
  - `importReceiptsArchive()` checks each restored file's hash against the
    manifest before writing it; a mismatch is reported as `corrupted`
    (naming the affected `expense_no`) and not written. A manifest with no
    `sha256` field (an older archive) restores as before but is counted
    `unverifiable`, not `corrupted`.
  - New standalone `verifyReceipts()` in `receipts-share.ts` plus a "Verify
    receipts" button in `ReceiptsCard.tsx` — checks every expense's receipt
    photo against its capture-time hash on demand, independent of any
    import/export.
  - "View receipt" on a photo that isn't on this device now names the
    expense's reference number in the toast (`missingReceiptMessage()` in
    `expenses.ts`) instead of a bare "not found" error.
- `backup.test.ts`: regression test asserting `buildBackup()`'s output never
  contains a `receipts` key or any receipt photo bytes.
- `receipts-share.test.ts` / `image.test.ts` / `expenses.test.ts`: coverage
  for the signature check, hash round-trip, corrupted-file detection, and
  legacy-archive handling above.
- `fake-indexeddb` as a dev dependency, so tests that exercise real `db`
  reads/writes (backup, receipts-share, expenses) run against an actual
  in-memory IndexedDB instead of needing a browser.

### Removed
- GitHub backup/restore entirely: `src/lib/github.ts` and `github.test.ts`,
  the "GitHub backup" card (and the now-empty "Advanced" collapsible around
  it) in `BackupCard.tsx`, and the GitHub push step in year-archiving.
  Archiving a year (`archiveYear()` in `archive.ts`) now only downloads the
  year's file locally before deleting it — it no longer requires GitHub to
  be configured first, and archive-log entries no longer record a GitHub
  path.

### Changed
- `pushSizeCheck()`'s over-100MB message now also suggests local
  export/import as an alternative to archiving old years — wording ported
  over from the `turf-ledger-fixed` branch during the repo-consolidation
  pass (see `docs/android-port-notes.md` §0 note at the top of this file's
  history).

### Added
- Cash/UPI payment-mode picker on every tab-payment collection point: the
  Dues tab collect box, "Settle all", and the customer tab card. The chosen
  mode is saved on the payment record and shown in the ledger.
- `theme.test.ts`: verifies the resolved-CSS theme cache — `applyTheme()`
  caches both light and dark CSS in one call, and `applyCachedMode()`
  restores byte-identical values on every light ⇄ dark toggle instead of
  re-running the color math.
- `expenses.test.ts`: regression coverage for `planRecurringPosts()` — IST
  day-of-month arrival, the plain `YYYY-MM-DD` `spent_at` shape, and the
  31st-clamped-to-month-end rule.
- IST calendar-bucketing test cases appended to `analytics.test.ts` for
  `dayKey()`/`monthKey()`, including cross-midnight UTC/IST cases and
  runtime-timezone independence.

### Fixed
- Four remaining UTC-vs-IST date slices, all following the same rule already
  documented in `docs/calculation-rules.md` (route through `monthKey()`/
  `dayKey()`, never re-slice a UTC timestamp):
  - Excel export filenames (`xlsx.ts`)
  - Layout-preset export filenames (`ArrangeToolbar.tsx`)
  - The print-test receipt date (`PrintSettingsCard.tsx`)
  - Recurring-expense auto-posting (`expenses.ts`) — auto-posted rows now
    store a plain local date like every other expense (previously a UTC
    `toISOString()` that plain-date-equality filters, like the day filter
    and the receipt-upload folder, silently never matched), post on the IST
    calendar day rather than the runtime's local day, and clamp a rule for
    "the 31st" to the last day of a shorter month instead of rolling into
    the next month.

### Changed
- Settings tab reordered to a usage-priority sequence — data-safety tools
  (Backup & restore, Receipts sharing) first, daily operational settings
  next, occasional/advanced tools last — per
  `.lovable/plan/optimize-the-settings-tab-order-2026-09-05.md`. Existing
  saved layouts are migrated to the new order once; later manual
  rearrangements are preserved and not repeatedly overwritten.
- `docs/README-theme-picker.md` rewritten: it previously described an older
  HSL, single-mode version of the theme engine. It now documents the actual
  oklch color space, the independent light/dark color pairs, the
  contrast-safety clamps, and the resolved-CSS cache.
- `docs/calculation-rules.md` updated to list the call sites already audited
  against the UTC/IST date rule.

### Known gaps
- The roadmap line "theme card redesign / resolved-CSS cache verification"
  had two parts. Only the cache-verification half had a concrete, checkable
  spec (now done, see `theme.test.ts`). No design brief for a
  `ThemeCustomizerCard.tsx` visual redesign was found anywhere in the repo
  (`.lovable/plan/`, `roadmap.md`, or elsewhere) — if one was intended, it
  needs its own spec before that work can start.
