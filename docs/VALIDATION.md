# Validation evidence and limits

Evidence is recorded by scope. Source tests, fake-camera fixtures, real Canvas rendering, physical camera capture, native codec output and installed application testing establish different things. A catalog entry, a compiled encoder name or a passing unavailable-encoder test is not a successful hardware/format run.

## Public evidence currently recorded

| Evidence | Result | What it establishes | Limit |
| --- | --- | --- | --- |
| [Windows development Canvas receipt](validation/canvas-windows-development.json) | **13/13 actual Canvas assertions passed** | Real Electron/Chromium Canvas transforms, PNG repeatability/decoding, crop/flips/rotation, chroma key, clean-plate cleanup, drawing erase, title, comparisons, guide isolation, 24 procedural animation frames and a native 7680×4320 PNG/sample-hash round trip | Procedural fixtures; not a physical 8K camera, all video codecs, installed app or Mac result |
| [Canvas screenshot](images/canvas-verification.png) | Visible final 13/13 result | Procedural-only screenshot of the isolated test application | Supplementary visual evidence; JSON contains the checks and source/runtime hashes |
| [Physical Windows webcam metadata](validation/physical-webcam-windows-development.json) | EMEET SmartCam C960 4K, negotiated 3840×2160 at reported 30 fps; persisted PNG8 dimensions and asset SHA matched | Actual physical USB camera connection, delivered raster and saved-original persistence in the development app; existing HD frames retained | One short capture check, not all devices, every driver control, camera endurance or installer verification |
| [Native Windows 8K export receipt](validation/native8k-windows-development.json) | **Four short 7680×4320 native export cases passed**, including RTX 3090 HEVC codec-lossless | Actual FFV1 RGBA8, converted RGB16 FFV1, DPX16 sequence and converted P010 NVENC outputs with explicit full verification, source immutability and runtime/code hashes | Offline procedural development engine, no audio; not a camera/installed-app/realtime result or proof for the new static runtime |
| [Static Windows runtime 8K receipt](validation/static-runtime-windows.json) | **The same four native 7680×4320 targets passed with the new static binary set** | Actual short native-engine output/target hashes, source immutability and an RTX 3090 8K NVENC probe/encode using the promoted runtime hashes | Offline procedural development engine, no audio; not all profiles at 8K, installed GUI, Mac or realtime evidence |
| [Static Windows runtime profile matrix](validation/static-runtime-windows-matrix.json) | **All 28 profiles produced output and passed their requested verification; no unavailable cases** | Actual short native-engine outputs with the new static FFmpeg payload, including real NVENC probes/encodes, converted sequences and portable Originals | Stated small/HD rasters and rates; not all profiles at 8K, installed-app or Mac evidence |
| [Static Windows runtime provenance and smoke checks](provenance/windows-media-runtime.json) | **16 media smoke checks passed**; two static CLI binaries, 10 source inputs and 39 notice records | Pinned binary/source/configuration/license records, representative encode/decode checks and an exact decoded FFV1 round trip | Runtime/build evidence; separate from application installation and exhaustive profile/raster testing |
| [Default-off export dialog](images/export-fast-default.png) | Verify export is visibly unchecked in the FFV1 demo export setup | The native development UI presents the optional fast path as the default | This screenshot is the setup dialog, not a completed-export or independent file-verification receipt |
| [Installed Windows application QA](validation/installed-windows.json) | **Actual per-user EXE installation, immediate quit/reopen and both export paths passed** for source `cc2741929cd7e28b1b839382969924889a827c19` | Installed ASAR and static media hashes match; latest pasted title saved before 650 ms autosave; 24 frames/assets retained; fast and opt-in FFV1 outputs have equal complete decoded RGBA hashes | Procedural 1280×720 demo; unsigned beta; physical camera and native 8K checks remain separately scoped |
| [Installed Windows studio screenshot](images/studio-windows-installed.png) | Actual installed UI with the original procedural demo | Local packaged app presentation and 24-frame project | Supplementary image, not a codec/hash or physical-camera proof by itself |
| [Installed Apple silicon Mac QA](validation/installed-macos.json) | **Actual DMG installation, exports, native 4K EMEET capture and normal Quit/reopen passed** | Exact installed inventory/source binding; 24-frame procedural export equality; new 3840×2160 PNG8 fully decoded without scaling, ten earlier originals/records retained, 11 frames reopened with camera off | Named-device short capture; rapid-typing quit checks were on the signed unpacked app, not repeated after DMG installation; ad hoc, not notarized |
| [Mac Canvas receipt](validation/canvas-macos-arm64.json) | **13/13 actual Canvas assertions passed** on arm64 | The same renderer/PNG/cleanup/drawing/guide suite, including native 7680×4320 RGBA round trip | Development harness, not installed capture or all codecs |
| [Mac native 8K engine receipt](validation/native8k-macos-arm64.json) | **One FFV1 RGBA8 case passed: two 7680×4320 frames at 24 fps** | Explicit opt-in engine verification plus independent complete RGBA readback equal to expected source samples | Short offline software-engine proof, no audio/camera/installed GUI or realtime claim |
| [Mac physical-camera preflight](validation/physical-webcam-macos-preflight.json) | Two cameras captured 10 PNG8 originals: 2 HD and 8 UHD 4K | Historical packaged preflight capture, explicit Save/Open and complete local decode; mixed-source 4K FFV1 export checked | Earlier packaged app; does not establish a new capture from the final installed DMG |
| [CI run 41506753516](https://github.com/Teylersf/stop-motion-for-humanity/actions/runs/41506753516) | Ubuntu and Windows jobs passed for source snapshot `4ebaf7b` | That workflow's source/build checks and explicitly configured integration scope | Does not certify later source changes, installed apps, the bundled runtime or Mac hardware |

The Canvas 8K case creates a **real 7680×4320 procedural source**, renders it, PNG-encodes it, independently decodes it and compares the complete RGBA sample SHA-256. It is not a low-resolution image enlarged to satisfy an output header. The recorded sample hash is `7bc521d208e937c3fa02fec17e21e269a3da3682301279e0a3a1b9c15c5cb87d`.

The Canvas harness is a purpose-built hidden offscreen Electron BrowserWindow with sandboxing, no Node integration, background throttling disabled, all camera/microphone/device permissions denied and requests confined to the loopback fixture. It reads a bounded fixture console protocol, records progress/crashes/timeouts and exits nonzero on failure. It does not automate the user's Chrome or inspect the user's editing window. Public images are procedural; private camera pixels and identifying media paths are not published.

## Recorded native 8K exports

The [earlier shared-runtime receipt](validation/native8k-windows-development.json) and [new static-runtime receipt](validation/static-runtime-windows.json), both dated 2026-11-02, record these actual **7680×4320, 24 fps** cases. Input was two deterministic native-size RGBA8 PNG patterns, including non-opaque samples; no webcam or personal footage was used. Verification was **explicitly enabled for both proofs**. Normal application exports still default to verification off.

| Profile | Output exposures | Verified preservation target | Earlier shared runtime, including verification | New static runtime, including verification |
| --- | --- | --- | --- | --- |
| `ffv1` | 2 | Independently decoded RGBA8 sample hash | 63.337 s | 13.057 s |
| `lossless` | 2 | Independently decoded converted RGB16 sample hash | 111.019 s | 37.695 s |
| `dpx-sequence` | 1 | Converted RGB16 DPX samples and independent ZIP CRC/SHA audit | 13.304 s | 9.916 s |
| `nvenc-lossless` | 2 | Canonical BT.709 limited-range 10-bit 4:2:0 YUV/P010 sample hash; actual 8K hardware probe passed | 19.821 s | 18.621 s |

The hardware cases used an **NVIDIA GeForce RTX 3090, driver 621.01**, and performed the requested encode after the geometry probe. P010 verification is equality with the converted YUV target, not identity with original RGB. RGB16 targets derive from RGBA8 inputs and do not establish 16-bit camera acquisition. Input original hashes remained unchanged in both runs, and each run's recorded code hashes matched before and after. Output hashes, sizes, runtime component hashes and detailed notes are in the respective receipts. The source hashes identify those run snapshots, not a blanket certificate for later source changes.

These are very short offline export checks with full verification included in their times, not controlled comparative performance benchmarks. They do not measure sustained/realtime 8K throughput, audio, browser capture or the installed GUI. The earlier proof identifies its audited shared media libraries; the new proof identifies the two standalone static GPL executables matching the promoted Windows resources. Both proofs retain their own source/runtime hashes and scopes; one is not relabeled as the other.

## New static Windows runtime: 28-profile matrix and 16 smoke checks

The [2026-11-02 static-runtime matrix](validation/static-runtime-windows-matrix.json) completed actual output for **every one of the 28 catalog profiles**, all with `verified:true`, and no unavailable or failed case. Most cases used two exposures at 256×144 and 12 fps; DNxHD and MPEG-2 MXF used 1920×1080 at 24000/1001 fps, and MXF DNxHR used its listed legal rate. The receipt records each exact raster, rate, encoder, pixel format, duration and output hash. H.264 NVENC, HEVC NVENC and codec-lossless P010 each passed a real requested-geometry hardware probe and encode. AV1 and VP9 used their software encoders in this run.

This matrix verifies the selected lossless target samples where defined and structural/decode correctness for lossy profiles. It does not turn ProRes, delivery codecs or other lossy profiles into sample-lossless outputs. The processed 16-bit/float targets still derive from RGBA8. The companion tests recorded in the receipt also cover genuinely skipped optional checks on the fast path, no movie PNG spool when verification is off, corrupted-ZIP detection, duration conform, PNG16 precision/original-byte retention through portable-project reopening, and exact scene-audio placement.

The [runtime provenance](provenance/windows-media-runtime.json) records **16 `smoke_tests`**: H.264, HEVC10, AV1, VP9, FFV1, ProRes, DNxHR, CineForm, JPEG 2000, PNG16, TIFF16, DPX16 and linear EXR picture encode/decode checks; AAC and Opus at 48 kHz; and an exact FFV1 decoded-data round trip comparing **294,912 bytes**. These are representative smoke checks, separate from the application's 28-profile export matrix. It also records ten source inputs, 39 notices, component/toolchain configuration and the static CLI binary hashes.

The exact tested Windows binaries have been promoted to the app's `resources/media/win32-x64` payload. Both live hashes matched the matrix and provenance at promotion review: `ffmpeg.exe` SHA-256 `276831b465b76ac57374afeefed97dc256a98dd380cc3543f546e5ff326f076e`, and `ffprobe.exe` SHA-256 `da2c0749dd7af44386833c1d20a40ba63242b26b65f6d7f5c8521925c1653af1`. These are also the binaries named in the new four-target 8K proof. Together the two executables are about 99 MB, before app/UI/notices. The full source/notices material must accompany the distribution under its stated licenses. Promotion and these short runtime tests do not establish successful Windows installation, Mac compatibility or sustained 8K performance.

## Installed Windows application

The [sanitized installed-app receipt](validation/installed-windows.json) records actual Windows x64 QA of `StopMotionForHumanity-0.1.0-beta.1-win-x64.exe`, built from source `cc2741929cd7e28b1b839382969924889a827c19`. The silent per-user NSIS install exited **0**. Installed registry Publisher and executable Company are **Taylor Kalin**; this is an **unsigned beta**, not an Authenticode-signed publisher claim. The installed ASAR hash matches the packaged archive, and both installed static media binaries match the recorded manifest hashes.

After cold launch and reopening the 24-frame procedural project, QA pasted a new project title through the real native UI and pressed Alt+F4. Paste through quit took **233 ms**, before the **650 ms** autosave delay. The latest title persisted, all application processes exited, the title appeared after relaunch, and reopening showed the correct title plus all **24 frames and 24 assets**. All original file SHA-256 values still matched their durable records. This checks the normal close/save barrier rather than relying on the delayed autosave.

The installed application then exported the two-second, 24-exposure, 1280×720, 12 fps FFV1 demo with verification **off** and **on**. The UI reported **Export ready** for the normal path and **Export verified** for the opt-in path. The checkbox was unchecked on first opening and reset to unchecked in a new export dialog after the opt-in run. One-time release QA independently decoded both complete outputs to RGBA; both hashes were `6afb510f155fd51241b9a15cc9ab1d15dfe772057017b8ea92a89be6e0fbb01c`.

That comparison establishes matching complete picture samples between the two export paths; it is not an external compositing reference. The files' container hashes are separately recorded in the receipt. The full decode/hash comparison here was an explicit QA operation, **not work added back to the normal default export**. No private footage or personal file paths are published. Installed physical-camera capture, installed 8K GUI export, other machines and Mac distribution are not implied by this procedural installed-app check.

## Installed Apple silicon Mac application

The [Mac installed-app summary](validation/installed-macos.json) records an Apple M4 running macOS 26.6.2, core revision `cc2741929cd7e28b1b839382969924889a827c19` and build checkout `1a99c8c`. The actual `StopMotionForHumanity-0.1.0-beta.1-mac-arm64.dmg` passed `hdiutil` verification and was mounted read-only; the app was copied from that disk and launched responsively. All **348 regular files and 14 symlinks** matched across built, mounted and installed inventories. The [package audit](validation/mac-installed-app-audit.json) and [ASAR/source audit](validation/mac-installed-asar-audit.json) separately bind the installed native code, renderer, catalog, media tools and signatures to their recorded inputs.

The installed GUI reopened the 24-frame procedural demo, accepted real-keyboard rename/explicit Save, and exported FFV1 with verification off and on. UI states showed **Export ready**, **Export verified**, and verification reset to off after reopening the dialog. The [independent export readback](validation/mac-installed-exports.json) completely decoded each 24-frame, 1280×720, 12 fps, two-second output and compared it to all 24 original unedited PNGs. Source and both outputs shared the complete RGBA hash `1d891c3c816a30f9275ede938de77532b54334810bebecfc6f948e4bb3c057ad`; original assets remained unchanged. These one-time QA checks do not add full decoding back to normal export. The different Mac/Windows procedural hashes are not an assertion of cross-platform font/raster identity.

The Mac [quick-quit regression receipt](validation/mac-quit-save-regression.json) is explicitly a **cold rebuilt, signed unpacked app** check before final DMG installation. Real-keyboard edit→Command-Q took **117 ms**, and edit→Command-W took **113 ms**; both retained the latest edit and exited the main process, with GUI reopen confirming the title and 24 frames. Empty-home quit also passed. The final installed inventory contains the matching close-fix code, but **an installed rapid-quit rerun is not claimed**. The Mac summary records **56 core/UI and 73 desktop checks passed**, zero failed/skipped, for that source snapshot; these are not a new aggregate claim for all later revisions.

After human macOS permission, the **unchanged final installed app** captured a new EMEET SmartCam C960 4K frame at **3840×2160**. The saved original PNG fully decoded at **8 bits per channel** and matched the delivered raster without scaling. All ten earlier originals and their frame records were preserved. **Normal Quit/relaunch reopened all 11 frames with the camera disconnected.** This installed normal-quit/capture check is not an installed rapid-typing quit rerun. The separate [historical packaged preflight](validation/physical-webcam-macos-preflight.json) records Live Streamer CAM313 at 1920×1080 (2 frames) and EMEET SmartCam C960 4K at 3840×2160 (8 frames), plus checked mixed-source 4K export. Camera pixels and identifying private paths remain local; the [installed summary](validation/installed-macos.json) records the final installed scope.

The app declares **macOS 14.0 minimum** and the package audit found a maximum Mach-O deployment floor of 14.0.0. Runtime execution on older macOS was not tested. Signing is **ad hoc**, the DMG/app is **not notarized**, and Developer ID signing or Gatekeeper acceptance is not claimed. Installation, exports and the named-device final installed capture/normal-reopen checks are completed scopes; these results do not remove the signing, older-OS or camera-coverage limits.

Mac development proofs add [13 actual Canvas checks](validation/canvas-macos-arm64.json), including the same full 8K sample hash as Windows, and [one native 8K FFV1 case](validation/native8k-macos-arm64.json): two native 7680×4320 RGBA8 frames at 24 fps with expected independent sample equality, **12.326 s including all verification**. A [two-case portable-project engine proof](validation/mac-portable-project-engine.json) exercises Originals with verification off/on, two scenes, disabled frames, holds, edits, three images including a retained unused original, and original audio; both extracted archives reopened through ProjectStore with unchanged source assets and source timing. These are development-engine/harness checks, not installed 8K export, a Mac 28-profile successful-encode matrix or sustained performance evidence.

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

The close/save source coverage includes **9 native regressions** in [close.test.cjs](../desktop/test/close.test.cjs) and **5 UI/coordinator regressions** in [close-save.test.ts](../src/components/close-save.test.ts). They cover a final save behind an older autosave, accepted capture/recording drain, failed-save retry, stale acknowledgements, timeout/crash handling, explicit failure-only quit without the latest save, accepted watched-file delivery, listener readiness/replay and a stale debounce firing after the final flush. These source checks complement the actual 233 ms installed quit/reopen result; they do not simulate every storage or OS failure.

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

The promoted static GPL Windows runtime now has the complete short 28-profile matrix, 16 smoke checks and its own four-target 8K receipt. Actual Windows and Mac installed-app QA, the new final installed Mac 4K capture/normal-reopen result, and separately scoped Mac Canvas/native8K/portable-engine results are linked above. Canvas, native runtime, physical capture and installed application evidence remain separate; none establishes long-form reliability for every profile.

## Optional verification during an ordinary export

**Verify export (slower) defaults to off.** A normal successful export reports **Export ready**, with `verified:false`. It still performs required input/bounds/hold checks and checks encoder/archive completion, but skips the extra complete decode/count/sample comparisons, full source-hash rereads and independent archive pass. Normal encoding and ZIP writing have their own costs; “verification off” does not mean no processing or no integrity checks anywhere in the app.

Manual Windows development UI QA also completed a normal FFV1 export of the 24-frame procedural demo with the checkbox off and the **Export ready** result. The local movie is not published as a public proof asset. The linked setup screenshot shows the unchecked default; it is not presented as an independent decode/hash check or a screenshot of completion.

When explicitly enabled, verification can add:

- Source hash checks around export.
- Independent video dimensions, held-frame count and complete decode checks.
- Canonical decoded sample hashes for RGBA8, converted RGB16, P010 codec-lossless and linear float32 targets, as appropriate.
- Processed audio decode and float32/24-bit target comparisons where supported.
- Sequence file precision/dimensions and converted-sample comparisons.
- Independent streaming archive CRC/file SHA checks against expected manifests, including original files and project metadata.

A successful opt-in result reports **Export verified**. A lossy export passing a complete decode is still lossy. A converted RGB16/EXR/P010 hash establishes the selected conversion target, not recovery of camera precision. [Format support](FORMAT_SUPPORT.md) defines these distinctions.

## Remaining platform and release limits

Windows development-camera, native runtime and installed GUI receipts retain their distinct scopes. Mac final DMG installation, package/source binding, installed exports and a native 4K EMEET capture followed by normal Quit/relaunch are recorded. The timed Mac rapid-typing close result still belongs to the signed unpacked app; an installed timed rerun is not claimed. Neither Windows unsigned beta metadata nor Mac ad hoc signatures establish a trusted signed/notarized distribution. Older macOS execution, sustained throughput and universal camera/codec geometry support are not inferred from these checks. A build artifact or source test alone is not substituted for installation, camera or codec evidence.

For a release, record exact binary/source hashes, OS/architecture, clean install/open/save/reopen, permission handling, a real captured/imported source, short exports with verification both off and on, cancellation/failure cleanup, and available hardware encoder probes. Keep unavailable/skipped cases visible. Update this document with links to actual receipts as they are produced, and preserve the development evidence's original scope.
