# Implementation contract

App: Stop Motion for Humanity. Author: Taylor Kalin. New GPL-3.0-or-later project.
The stable renderer/native ABI lives in src/core/types.ts. Do not rename ABI
fields without coordinating with root and the other implementation agents.

Native backend owns all filesystem paths. The renderer gets only project IDs,
asset IDs and trusted humanity:// asset URLs. All native IPC is sender-checked.
New projects are portable folders with project.humanity.json and assets/.
Keep original frames and prior autosaves; deletion/replacement affects the
manifest, never destructively changes originals. Save through temporary file,
fsync and atomic rename, with a previous-good backup and recovery on open.

Renderer exports one processed PNG at a time, with repeat=frame hold. Native
exportBegin chooses output via a Save dialog and freezes the project/options.
exportFrame handles bounded backpressure. exportFinish validates output and
publishes only after success. Original frame sequence bypasses processed PNG
rendering and retains the actual imported/captured originals with a manifest.

No runtime cloud calls, remote fonts, analytics, Vercel, account or subscription.
Camera API: Chromium getUserMedia, actual getSettings(), capability-aware locks,
serial capture, last-operation generation protection, explicit connect/retry.
OS-visible webcams, compatible capture cards/vendor/OBS virtual webcams are
supported paths; arbitrary USB/PTP devices are not automatically webcams.
Never claim every camera or sensor RAW. Keep preview/onion/guides out of saved
camera pixels. Use image-sequence import/folder watch for external still capture.

Advanced artistic tools should operate on real non-destructive frame edits.
Unsupported DMX/motion-control/PTP SDKs must not have pretend working controls.
The guided first workflow is New -> Camera/import -> Capture -> Play -> Export.

Media tools are a lean, audited native FFmpeg runtime in
resources/media/win32-x64 or resources/media/darwin-arm64 (ignored by Git),
packaged into the native app. The existing 8K editor runtime has a clean
OpenH264/FFV1 CLI with seven shared Windows DLLs and matching sources.
Do not copy the host GPL Gyan build or the 8K Python/Torch payload.

Root owns package.json, scripts/, assets/, docs/, publication and integration.
Backend agent owns desktop/ (including builder, main, preload, store, export,
tests). Core agent owns src/core/ except root's shared types.ts; it can add
optional types with coordination. UI agent owns src/App.tsx, src/App.css,
src/main.tsx and src/components/. Keep changes within ownership until agreed.
