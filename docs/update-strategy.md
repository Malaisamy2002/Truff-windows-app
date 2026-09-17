# Update strategy — Windows

Status: not implemented. This is a decision-and-setup guide, not code —
same posture as `docs/release-signing.md`: nothing here has been run
against a real build, and no distribution channel (a host for update
manifests, a CDN, a domain) has been chosen yet, so wiring actual update
code against a guessed URL would just be a different kind of unverified
scaffolding. This doc lays out the real options so that choice can be made
deliberately instead of by default.

## The standard route: Tauri's updater plugin

Tauri ships an official updater (`tauri-plugin-updater`, not currently a
dependency in this repo) built for exactly this: the app checks a small
JSON manifest at a URL you host, compares the manifest's version against
its own, and if newer, downloads and installs the update — either
silently in the background or after prompting the user, your choice.

What it needs before it can be turned on:

1. **A keypair**, generated once via the Tauri CLI (`tauri signer
   generate`). The public key goes in `tauri.conf.json`; the private key
   signs every release build and must never be committed — treat it like
   the code-signing certificate in `release-signing.md`.
2. **A place to host the manifest and the installer files.** The manifest
   is just a JSON file (`{"version": "...", "url": "...", "signature":
   "..."}` per platform) — a GitHub Release's asset URLs work fine for
   this, as does any static host. This repo doesn't currently have one
   picked; the R2 URL already referenced in `__root.tsx`/the CSP is a
   leftover default og-image from the project's Lovable scaffold, not
   infrastructure set up for this, so it isn't a ready-made answer.
3. **`tauri.conf.json` config** — a `plugins.updater` block with the
   manifest URL and the public key, plus `bundle.createUpdaterArtifacts:
   true` so `tauri build` produces the signed update packages alongside
   the normal installer.
4. **A release process** that actually publishes a new manifest each time
   a version ships — manual (edit and re-upload the JSON) or scripted
   (a CI step) both work; nothing about the plugin requires CI.

None of this is hard, but steps 2 and 4 are process/infrastructure
decisions (where releases live, who publishes them) rather than something
resolvable inside a sandbox with no real host to point at.

## Why nothing was wired up now

Every other scaffolded-but-unconfigured piece in this project so far
(Windows code-signing, Android signing, the cross-repo CI parity check)
had a config surface that's inert until filled in — a `null`
`certificateThumbprint`, an unset `SIBLING_REPO` variable — so scaffolding
it couldn't accidentally point anywhere wrong. An updater manifest URL
doesn't have a safe placeholder version of that: pointing it at a URL
nobody owns (or a guessed one) would make `tauri build` produce update
artifacts that either fail silently or, worse, point somewhere real but
unintended. So this stayed a doc rather than a `tauri.conf.json` edit.

## For Android

Tauri's updater plugin only targets desktop platforms — it doesn't cover
Android or iOS at all. See `docs/update-strategy.md` in the Android repo
for that side.
