# Architecture and data guarantees

Stop Motion for Humanity is a GPL-3.0-or-later Electron desktop application by Taylor Kalin. React/TypeScript provides the studio UI and pure/core browser logic; a narrow preload bridge connects it to native project storage and FFmpeg workers. Normal editing/capture/export runs locally without an application cloud service, remote fonts, analytics, an account or a subscription. Opening the source/download link intentionally opens the user's external browser.

## Process and privilege boundaries

The main window loads packaged HTML, JavaScript, CSS and registered project assets through `humanity://app`. A sandboxed, context-isolated renderer has Node integration and webviews disabled. The preload exposes named operations from [the typed ABI](../src/core/types.ts), not a raw filesystem, shell, child-process API or unrestricted IPC sender.

Each native IPC handler checks the owned window, its main frame and the trusted local origin. Native file dialogs grant project/import/export locations; the main process retains their paths. The renderer uses project IDs, asset IDs and trusted asset URLs. Local protocol routing rejects traversal and unsupported hosts, confines UI files to the distribution directory and resolves registered asset paths through the store. Asset files must be regular files rather than symbolic links.

The production Content Security Policy permits the local app and its required blob/data image media, blocks foreign frames/objects and confines connections to self. Untrusted navigation and webview attachment are denied. External links open only as safe HTTPS links. These are defense-in-depth boundaries, not a claim that imported decoders or the entire OS are infallible.

Camera and microphone grants are explicit and separate. A camera connect requests video only; narration requests audio only after Record. Native OS permission state and scoped Electron session handlers guard media access. The app does not expose arbitrary USB/PTP control or proprietary camera SDKs.

## Portable projects and immutable media

A project folder contains:

```text
project.humanity.json             current editable manifest
project.humanity.previous.json    previous readable save, after saving
assets.humanity.json              durable retained-asset registry
assets/                          original images/audio and required viewing previews
.humanity-autosaves/              retained prior manifest snapshots
```

Import streams an original into a unique file, checks that the source is no longer changing, flushes it, and registers byte length and SHA-256. Captures persist a native-raster PNG. Specialized still formats can have a separate decoded PNG viewing preview; that preview does not replace the source. Imports/captures write the durable asset registry independently of a later edit-manifest save.

Deleting/replacing timeline frames or changing edits does not overwrite or delete their original assets. Save serializes operations, validates the manifest against native registered assets, retains the old manifest, writes and flushes a temporary replacement and atomically renames it. Open tries the primary manifest, then the previous readable save, and merges retained registry assets. It reports missing/changed files. These mechanisms protect against specific interrupted saves; they do not replace independent backups or guarantee recovery from storage failure.

The **Originals portable project archive** is a whole-project export. It includes all scenes and metadata, every stored original image/audio asset once, required previews, a sequence manifest and reopening instructions. Holds do not duplicate the original assets. A fresh portable project ID/local asset URLs avoid colliding with the source project when reopened. It preserves source frame rate/holds and bypasses rendered effects and scaling. The archive is not an autosave-history backup.

## Model, capture and rendering

The core timeline stores one frame record plus an exposure hold. Playback lookup and export conform operate on compressed spans rather than an array entry per repeated exposure. Scene order, disabled-frame exclusion and the exclusive end of each span are explicit. Retime uses rounded cumulative boundaries to avoid accumulating a per-frame rounding error, skips zero-width intervals and splits long output holds into bounded IPC records.

`CameraController` owns a selected MediaStream, driver capabilities/settings, a generation counter and serialized setting/capture operations. A late connection, stale device enumeration or interrupted capture cannot replace a newer selected camera. Captures await a fresh delivered video frame, use its actual raster and reject stalls/unplugged feeds. Driver-reported controls are validated and actual settings are checked after applying a change. Supported paths are OS-visible webcam/capture-card/virtual-camera inputs; still-camera tethering can feed image import or a watched folder.

The folder watcher polls an explicitly chosen external directory, ignores its initial contents, waits for stable size/modification time and copies supported new/changed still files. It is not a PTP shutter controller or a cloud synchronization service.

The renderer loads registered original/viewing images, applies normalized crop, rotation/flip, linear-light color adjustments quantized back to RGBA8, chroma key, clean-plate restoration, separate drawing strokes, project background and optional global title. Transform state is saved/restored before later mask compositing. Clean-plate and drawing erasers act on their own layers. Onion skins, guides, pinned reference and mirror preview are viewer overlays rather than original camera pixels. Repeated processed renders use deterministic state; the original procedural demo requires no borrowed image assets.

The processing raster is **RGBA8**. True stored PNG16/other imported precision is represented in asset metadata and preserved by Originals, but effects and higher-bit-depth output start from RGBA8. RGB16 targets, P010 codec-lossless and explicitly linearized float32 EXR have separate sample contracts. [Format support](FORMAT_SUPPORT.md) defines them.

Audio clips retain original files and describe global timeline placement, trims, gain, mute and fades. Native export constructs a 48 kHz mix, handles scene offsets, and applies pitch-preserving tempo conversion when output rate reinterprets source timing. Processed sequences can archive a separate mix; Originals carries the actual original audio files.

## Export pipeline

The shared JSON catalog supplies profile identity, codec/pixel/audio target, precision disclosures and legal raster/rate requirements to UI and native code. The native planner selects an installed encoder and probes hardware at the requested geometry. Presence in `ffmpeg -encoders` is not a successful GPU/driver test. A fallback preserves the requested format rather than silently changing H.264 to HEVC.

Export freezes the validated project/options. Processed rendering submits one PNG at a time with a bounded hold/repeat count and awaits native backpressure. Movie export streams PNGs to an owned FFmpeg child. Processed sequence conversion writes required spool files and a ZIP64 archive. Originals reads its retained assets directly and bypasses Canvas.

**Verification is explicitly opt-in and false by default.** Normal export still validates identifiers, bounds, PNG dimensions, hold accounting, encoder success and non-empty output. It skips the extra full source SHA reads, post-encode decode/count/hash passes and independent archive inspection, returns `verified:false` and displays Export ready. Opt-in verification retains required reference material, checks source hashes, decodes/counts output, compares defined lossless picture/audio targets and independently checks sequence/archive entries where applicable. Lossy profiles can pass structural/decode validation without becoming sample lossless.

Output is produced under a unique partial name in the selected destination directory, flushed and renamed after the selected export path succeeds. Destination guards protect project manifests/assets. Cancellation terminates only workers owned by that export session, waits for them and removes its spool/partial output. Native children use fixed argument arrays, `shell:false`, bounded diagnostics and time limits.

## Bounds and distribution

Native and renderer enforce 16–8192 pixels per side and at most 35,651,584 pixels per processed frame; 1–120 fps; 100,000 project/output exposures; 10,000 repeat per IPC frame; 512 MiB per stored imported asset; bounded JSON and collection sizes. The original-image cache has both count and decoded-pixel limits. These bounds intentionally prevent “any resolution” from becoming unbounded allocations. Hardware/codec constraints can be narrower.

Windows x64 NSIS and macOS arm64 DMG are configured in electron-builder. Media tools are platform-specific resources outside the app ASAR. Distribution includes the application license, dependency notices and media provenance/corresponding-source materials. Installed-app, signing/notarization and hardware test results must be recorded separately from development/source tests.

Development initially used an audited shared LGPL FFmpeg runtime. The current Windows payload is a **standalone static GPL FFmpeg build** with explicit x264/x265/SVT-AV1/VP9/Opus/zimg inputs and disabled network support. Its [build recipe](../scripts/build-windows-static-media.sh), [current provenance](provenance/windows-media-runtime.json), [28-profile runtime matrix](validation/static-runtime-windows-matrix.json) and [four-target 8K receipt](validation/static-runtime-windows.json) bind the tested binary set to configurations, ten source inputs, 39 notices and actual short format outputs. The exact tested `ffmpeg.exe`/`ffprobe.exe` hashes have been promoted into Windows resources. The earlier shared-runtime 8K proof retains its own binary hashes; it is not relabeled as a static-runtime result. Receipts identify their recorded source snapshots rather than certifying subsequent changes. Installed-package and Mac evidence remain separate until their checks finish. Releases must include matching corresponding-source and notice materials, not just the application repository or build recipe.

Native PTP/vendor camera SDKs, DMX lighting, motorized motion control, AI rig removal, automated tracking, camera RAW development, arbitrary video-clip editing and an end-to-end float/HDR grading pipeline are not implemented. There are no simulated working controls for these systems.
