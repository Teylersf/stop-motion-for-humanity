# Validation evidence and limits

Evidence is recorded by scope. Source tests, fake-camera fixtures, real Canvas rendering, physical camera capture, native codec output and installed application testing establish different things. A catalog entry, a compiled encoder name or a passing unavailable-encoder test is not a successful hardware/format run.

## Public evidence currently recorded

| Evidence | Result | What it establishes | Limit |
| --- | --- | --- | --- |
| [Windows development Canvas receipt](validation/canvas-windows-development.json) | **13/13 actual Canvas assertions passed** | Real Electron/Chromium Canvas transforms, PNG repeatability/decoding, crop/flips/rotation, chroma key, clean-plate cleanup, drawing erase, title, comparisons, guide isolation, 24 procedural animation frames and a native 7680×4320 PNG/sample-hash round trip | Procedural fixtures; not a physical 8K camera, all video codecs, installed app or Mac result |
| [Canvas screenshot](images/canvas-verification.png) | Visible final 13/13 result | Procedural-only screenshot of the isolated test application | Supplementary visual evidence; JSON contains the checks and source/runtime hashes |
| [Physical Windows webcam metadata](validation/physical-webcam-windows-development.json) | EMEET SmartCam C960 4K, negotiated 3840×2160 at reported 30 fps; persisted PNG8 dimensions and asset SHA matched | Actual physical USB camera connection, delivered raster and saved-original persistence in the development app; existing HD frames retained | One short capture check, not all devices, every driver control, camera endurance or installer verification |

The Canvas 8K case creates a **real 7680×4320 procedural source**, renders it, PNG-encodes it, independently decodes it and compares the complete RGBA sample SHA-256. It is not a low-resolution image enlarged to satisfy an output header. The recorded sample hash is `7bc521d208e937c3fa02fec17e21e269a3da3682301279e0a3a1b9c15c5cb87d`.

The Canvas harness is a purpose-built hidden offscreen Electron BrowserWindow with sandboxing, no Node integration, background throttling disabled, all camera/microphone/device permissions denied and requests confined to the loopback fixture. It reads a bounded fixture console protocol, records progress/crashes/timeouts and exits nonzero on failure. It does not automate the user's Chrome or inspect the user's editing window. Public images are procedural; private camera pixels and identifying media paths are not published.

## Repeatable source checks

From a checkout with the pinned dependencies installed:

```sh
npm run build
npm run test:core
npm run test:ui
npm run test:desktop
```

The core suites cover immutable project edits, JSON validation, timing/holds/order, undo/redo, source-aware recommendations, cross-runtime frame-rate conform, pure color/key processing, waveform/cue logic and camera state ownership. Camera tests use injected MediaDevices/tracks/video/canvas fixtures to check late results, disconnect, enumeration races, permission/busy messages, unsupported or ignored settings, serialized capture and stalled/unplugged streams. **Those camera fixtures are not physical-device proof.**

UI tests cover export preflight, precision disclosures, default-off verification and remembered camera preferences. Native tests cover storage/atomic recovery, safe path/IPC-related validation, manifests, archive and media-worker behavior, format plans and legal raster/rate combinations. Some native suites run actual encoders and require the matching runtime; a CI run that explicitly skips media integration proves only its remaining scope. Use the actual test output rather than a permanently advertised aggregate count while suites evolve.

The configured [CI workflow](../.github/workflows/checks.yml) builds and runs source checks on Ubuntu and Windows. Ubuntu installs its system FFmpeg for media integration; Windows CI explicitly skips native media integration because the distribution payload is not in Git. Neither job is an installed Windows/macOS app test or proof of the bundled release runtime. Workflow configuration also does not establish that a particular remote CI run passed.

For the real Canvas fixture, run Vite in one terminal:

```sh
npm run dev
```

Then run the isolated test application in another:

```sh
node node_modules/electron/cli.js desktop/test/canvas-runner.cjs
```

The local result is `out/canvas-validation.json`. A completed thirteen-test receipt and procedural screenshot are saved to the public documentation paths above. The runner includes runtime versions and source SHA-256 values. It fails on a bad assertion, renderer error, malformed receipt, crash or timeout. Directly launching the Windows GUI executable can detach its output; the Node CLI wrapper keeps the test's exit status/stdout connected.

## Actual native media testing

`desktop/test/professional.test.cjs` exercises the selected FFmpeg payload with real generated PNG/audio inputs. Its matrix either produces/probes the requested profile or records that the required encoder is genuinely unavailable. **A passing matrix that includes unavailable cases must not be described as 28 successful encodes.** Profile, runtime binary, raster, rate, hardware setting, audio and verification mode matter.

`HUMANITY_TEST_MEDIA_DIR` can select an explicit candidate media directory for these tests. `HUMANITY_RUN_HARDWARE_TESTS=1` enables real hardware candidates; otherwise codec tests deliberately use software paths. `HUMANITY_SKIP_MEDIA_TESTS=1` is an explicit integration-test skip and must be disclosed. Do not infer NVIDIA or VideoToolbox support from a CPU-only run.

The new static GPL media candidate, full native profile results, native 8K movie/sequence results and installed-package checks are being integrated. Until their own receipts are present, the Canvas result above is not substituted for those proofs. A single short format fixture also does not establish 8K throughput or long-form reliability for that codec.

## Optional verification during an ordinary export

**Verify export (slower) defaults to off.** A normal successful export reports **Export ready**, with `verified:false`. It still performs required input/bounds/hold checks and checks encoder/archive completion, but skips the extra complete decode/count/sample comparisons, full source-hash rereads and independent archive pass. Normal encoding and ZIP writing have their own costs; “verification off” does not mean no processing or no integrity checks anywhere in the app.

When explicitly enabled, verification can add:

- Source hash checks around export.
- Independent video dimensions, held-frame count and complete decode checks.
- Canonical decoded sample hashes for RGBA8, converted RGB16, P010 codec-lossless and linear float32 targets, as appropriate.
- Processed audio decode and float32/24-bit target comparisons where supported.
- Sequence file precision/dimensions and converted-sample comparisons.
- Independent streaming archive CRC/file SHA checks against expected manifests, including original files and project metadata.

A successful opt-in result reports **Export verified**. A lossy export passing a complete decode is still lossy. A converted RGB16/EXR/P010 hash establishes the selected conversion target, not recovery of camera precision. [Format support](FORMAT_SUPPORT.md) defines these distinctions.

## Pending platform/release work

The present physical-camera receipt is Windows development evidence. Mac hardware/permission checks and installed Windows/macOS application validation remain separate pending work. A build artifact, DMG/EXE configuration, matching source archive or source test does not establish successful installation, signing/notarization, camera capture or every codec on the target machine.

For a release, record exact binary/source hashes, OS/architecture, clean install/open/save/reopen, permission handling, a real captured/imported source, short exports with verification both off and on, cancellation/failure cleanup, and available hardware encoder probes. Keep unavailable/skipped cases visible. Update this document with links to actual receipts as they are produced, and preserve the development evidence's original scope.
