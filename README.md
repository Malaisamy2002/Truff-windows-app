# Theme Harmonizer

# Cleaner theme settings



The separate "Appearance" dark-mode card is gone. Light/dark now lives inside the Colours card, where the colours are actually edited. Next steps to make that card feel like one tidy panel.



## 1. One clear header row



Top of the Colours card: the theme name (or "Unsaved") on the left, a Light/Dark segmented switch on the right. The switch does two jobs at once — it flips the app's mode and switches which colour pair you're editing, so there's never a mismatch between what you see and what you edit.



## 2. Simpler body, three steps



- **Presets** — a row of ready-made two-tone pills. One tap sets both the light and dark pair, so a preset always looks right in either mode.

- **Fine tune** — collapsed by default: accent wheel, background wheel, brightness and intensity sliders, hex fields. Keeps the "Generate matching dark/light colours" button so you only hand-pick one mode.

- **Preview** — a small mock of the real app (stat number, primary button, muted chip, bordered row) rendered in the mode being edited.



## 3. My themes, tightened



- Saved themes shown as compact rows: two-tone swatch, name, and a single overflow menu for Rename / Update to current / Delete.

- The active theme is checked; tapping any row applies it instantly.

- "Save current as…" only appears when there are unsaved changes.



## 4. Fix the light/dark round-trip drift



Toggling light → dark → light currently returns a background a few thousandths off, because the pre-paint script restores cached CSS strings while the live toggle recomputes and clamps. Fix: cache the resolved CSS for both modes at save time and have the toggle read the cached string instead of recomputing.



## 5. Polish



- Short colour transition on surfaces, wrapped in `prefers-reduced-motion: no-preference`.

- Throttle live preview to one animation frame while dragging a wheel or slider.

- Invalid hex falls back to the previous value instead of writing black.



## Cloud backup over Telegram

Settings → **Cloud backup (Telegram)** sends one file containing every record
*and* the receipt photos to a private Telegram chat you own.

1. In Telegram, message **@BotFather** and send `/newbot`. Copy the bot token.
2. Create a **private** channel or group and add the bot as an admin that can post.
3. Send any message in it and copy the chat ID (usually starts with `-100`).
4. Paste the token, the chat ID and a name for this device, then **Save details**.
5. Tap **Backup now**. Large backups are split automatically, and extra bot
   tokens (optional, one per line) spread the parts across several bots.
6. On another device, tap **Scan setup QR** and point it at **Show setup QR** on
   the first device, then **Restore latest**. Restoring asks whether to replace
   everything or merge; receipt photos already on the device are never
   overwritten, and tampered photos are rejected.

No Telegram? Use **save a local copy instead** and **Restore from a saved file** —
the exact same file.

The bot token never leaves the device (Windows Credential Manager on desktop).
Anyone in the chat can read the backups, so keep it private.

The receipt `.zip` export/import now lives under **Advanced** inside Receipts
sharing.

## Technical notes



Files: `src/components/app/ThemeCustomizerCard.tsx` (layout, header row, profile rows), `src/lib/theme.ts` (per-mode CSS cache, drift fix), `src/styles.css` (transitions). Everything stays local-device in localStorage; no

I removed the separate Appearance dark-mode card (its toggle now lives in the Colours card), fixed the light/dark round-trip drift by caching resolved CSS for both modes and having the pre-paint script pick the right one, and started the Colours card restructure (new header row with theme name + Light/Dark switch, presets moved to the top).



Remaining from the approved plan:

- Re-add the Fine tune and Preview sections in the new order, plus the "My themes" list with a single overflow menu (Rename / Update / Delete) and "Save current as…" shown only when there are unsaved changes.

- Surface colour transitions in `src/styles.css` under `prefers-reduced-motion: no-preference`, and hex-input fallback to the previous value.

- Typecheck and a browser pass on Settings.



Note: the card file is mid-edit, so the Colours card may render incomplete until that section is finished. data or business-logic changes.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e527d638-c801-4676-88b7-1bdb271fe2dc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
# Truff-Snacks-Bookings-sales-management-Windows-App
