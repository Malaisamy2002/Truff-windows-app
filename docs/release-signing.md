# Release signing — Windows

Status: scaffolding only. Nothing here has been run against a real
certificate or a real Rust/Tauri toolchain — this sandbox has neither. The
`tauri.conf.json` block is ready to use once you have a code-signing
certificate; the rest of this doc says what to do with it.

## What's already in place

`src-tauri/tauri.conf.json` → `bundle.windows` now has:

```json
"certificateThumbprint": null,
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com",
"tsp": true,
```

`certificateThumbprint: null` means Tauri will **not** attempt to sign
anything as-is — the NSIS build still produces an unsigned installer,
exactly as before. Nothing changes until you fill in a real thumbprint.

## To actually sign a build

1. Get an Authenticode code-signing certificate (a CA like DigiCert,
   Sectigo, or a cheaper OV cert reseller; EV certs get you the
   SmartScreen reputation faster but cost more and require a hardware
   token).
2. Import it into the signing machine's certificate store:
   ```powershell
   Import-PfxCertificate -FilePath certificate.pfx `
     -CertStoreLocation Cert:\CurrentUser\My `
     -Password (ConvertTo-SecureString -String $PFX_PASSWORD -Force -AsPlainText)
   ```
3. Find its thumbprint: `certmgr.msc` → Personal → Certificates → double-click
   the cert → Details tab → scroll to "Thumbprint".
4. Paste that value into `certificateThumbprint` in `tauri.conf.json`
   (**do not commit the .pfx file itself** — `.gitignore` now blocks
   `*.pfx`/`*.p12`/`*.jks`/`*.keystore` for exactly this reason).
5. Run `tauri build` on a real Windows machine with the Windows SDK
   (`signtool.exe`) installed. Tauri signs both the `.exe` and the NSIS
   installer automatically once `certificateThumbprint` is set.

If you're signing from CI instead of a dev machine, keep the `.pfx`
base64-encoded in a CI secret, decode + `Import-PfxCertificate` it as a
build step, then run the same `tauri build`.

## What's still unverified

- Whether `tsp: true` + the DigiCert timestamp URL works with whatever CA
  actually issues your certificate — different CAs' timestamp servers vary
  (Sectigo, GlobalSign etc. all publish their own). Swap `timestampUrl` if
  yours differs.
- The signed installer has never run on a real Windows machine — this
  sandbox has no Windows SDK, no `signtool.exe`, and no Rust toolchain at
  all, so `tauri build` itself has never been attempted here, only
  `vite build` (the frontend half).
