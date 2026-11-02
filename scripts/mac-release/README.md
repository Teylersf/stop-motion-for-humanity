# Mac application packaging

Use the Mac wrapper after the frontend and audited media resources are ready:

```sh
npm run build
./node_modules/.bin/electron-builder \
  --config scripts/mac-electron-builder.cjs \
  --mac dmg --arm64 --publish never
```

An owned output directory can be selected with
`--config.directories.output=out/mac-candidate`. The actual app name comes from
the builder context's product filename. Do not override the wrapper hooks,
minimum version or media signing exclusion.

The wrapper inherits the desktop configuration and its hooks. It sets the
macOS deployment declaration to 14.0 and narrowly excludes only
`/Contents/Resources/media/(ffmpeg|ffprobe)$` from Electron's signing pass.
Electron-builder otherwise re-signs these already-signed executables, changing
their whole-file bytes and invalidating the exact hashes in their bundled
runtime manifest. The app, frameworks and helpers still receive the normal
base signing policy; the wrapper performs no signing itself.

Before packaging, the base hook runs first. The wrapper then requires a
passed darwin/arm64 source runtime manifest, exact ffmpeg/ffprobe file size and
SHA256 pins, executable permissions and valid strict signatures. It records
the verified manifest digest for this packaging context.

After signing, the base hook runs first. The wrapper checks that the source
and bundled manifests still match that digest, verifies both bundled tools
against the exact source pins and checks their strict signatures. It also
checks the final Info.plist minimum and the outer app's deep/strict signature.
Any discrepancy fails the build before distributable creation. A missing
ffprobe or a silently re-signed media tool therefore cannot pass packaging.

The recorded local build uses ad hoc signatures. This does not assert
Developer ID signing, notarization or Gatekeeper acceptance. A declared
macOS 14.0 floor and load-command audit do not substitute for executing the app
on an older macOS system. The final app still needs its separate lifecycle,
save-on-close, media and permission checks before release approval.

Native media reproduction and corresponding-source integration are described
in `scripts/mac-media/README.md`. A build recipe/provenance commit can follow
the product-code commit; final receipts must identify those scopes accurately.

Audit the complete final app after signing, using a fresh report path:

```sh
python3 scripts/mac-audit-app.py \
  --app 'out/mac-candidate/mac-arm64/Stop Motion for Humanity.app' \
  --output out/validation/mac-final-app-audit.json \
  --max-macos 14.0
```

This read-only audit imports the frozen native media audit recipe. It checks
every Mach-O architecture, deployment floor, dependency and strict signature;
contained symlinks; framework and outer-app deep/strict signatures; and exact
source/bundled manifest and media-tool hashes. Parenthesized helper filenames
are inspected through a read-only file descriptor to avoid `otool`'s archive
member syntax. It never launches the app or media tools and refuses an existing
report path. The declaration and signature limitations above still apply.

Bind the final installed ASAR to the frozen product code and current cold-build
renderer artifacts with a separate fresh report:

```sh
node scripts/mac-audit-asar.cjs \
  --app '/Applications/Stop Motion for Humanity.app' \
  --core-revision PRODUCT_COMMIT \
  --build-log out/validation/mac-final-build.log \
  --output out/validation/mac-installed-asar-audit.json
```

This read-only audit checks packed native runtime files, the export catalog,
the exact production transformation of package metadata, the complete renderer
artifact set, and first-party JavaScript source-map content against the chosen
product commit. It checks that inspected files remain unchanged. It does not
rebuild, launch the app, access projects or devices, or replace installed UI
and save/quit/reopen verification.
