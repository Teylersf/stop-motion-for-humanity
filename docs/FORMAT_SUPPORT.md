# Formats, precision and export choices

Stop Motion for Humanity exposes **28 export profiles**. The same [catalog](../assets/export-profiles.json) drives the format menu and native encoder planner. Every profile remains selectable; preflight explains missing encoders, required dimensions and hardware requirements before a file can be made.

An export profile is a defined codec/container/pixel-format combination. It does not mean every possible codec, camera RAW format, broadcast specification or container variant is implemented. Successful export at one size also does not prove every size on every GPU. See [validation evidence](VALIDATION.md).

## Choose what you want to preserve

| Goal | Starting choice | What is preserved |
| --- | --- | --- |
| Preserve the picture after edits | **FFV1 · lossless RGBA8 master** | The rendered 8-bit RGBA samples, with no delivery-codec loss |
| Share a smaller movie | **H.264 / AVC · MP4 delivery** | A broadly usable, lossy delivery copy |
| Keep native imported precision and continue editing | **Originals · portable project archive** | Every scene, editable project metadata, original images and original audio |
| Hand rendered frames to another application | PNG8, PNG16, TIFF16, DPX16 or EXR sequence | Numbered processed frames, timing manifest and an optional separate audio mix |
| Fit an editorial or broadcast pipeline | ProRes, DNxHR, DNxHD, CineForm or MXF | The stated intermediate/delivery target, with its compression and raster/rate constraints |

The suggested canvas matches a real stored source raster. For mixed sources, the recommendation uses the largest-area stored raster within rendering limits. It preserves that raster's aspect ratio rather than combining the maximum width of one image with the height of another. You can override the format, size and rate. Upscaling and downsizing are disclosed; a larger canvas does not create captured detail.

## What “lossless” means here

The effects pipeline renders through **RGBA8 Canvas: 8 bits per channel**. Camera snapshots are PNG8 frames made from the actual delivered video raster. Imported PNG16 and other supported higher-precision originals retain their original files and reported precision, but their processed previews and exports pass through RGBA8.

Higher-bit-depth exports are intentionally allowed. RGB16, 10/12-bit intermediates and float EXR can be useful compatibility targets; they expand or convert the rendered values and do not recover extra source precision, sensor dynamic range or HDR information. Choose the **Originals portable project archive** to retain higher-precision imported bytes.

There are different preservation contracts:

| Contract | Meaning |
| --- | --- |
| RGBA samples | FFV1 RGBA8 and PNG8 retain rendered RGBA8 samples |
| Converted RGB samples | RGB16 FFV1, reversible JPEG 2000, uncompressed RGB16 and RGB16 sequences retain the defined RGB16 conversion |
| Codec target | NVIDIA lossless HEVC preserves its **converted P010, BT.709 limited-range, 10-bit 4:2:0 target**; this is not identity with the incoming RGB picture |
| Converted float | EXR stores the explicit sRGB-to-linear float32 RGB conversion |
| Original bytes | The portable project archive copies stored original files without rendering them |
| Lossy | H.264, ordinary HEVC/AV1/WebM, ProRes, DNx, CineForm, MPEG-2 and GIF use their stated lossy picture encoding |

The current renderer composites frames onto the project background. RGBA storage in FFV1/PNG8 does not imply an uncomposited transparent-layer export. In particular, the current ProRes 4444/XQ profiles use 10-bit 4:4:4 YUV without alpha; their names do not imply 12-bit source precision or exported transparency.

## The 28 profiles

Audio below applies when a soundtrack is included. `PCM f32` means the processed 48 kHz float32 mix; `PCM24` and `FLAC24` are converted 24-bit targets. None of these claims that the filtered mix is byte-identical to the original recording.

| Profile ID | Output | Picture target and compression | Audio |
| --- | --- | --- | --- |
| `ffv1` | Matroska `.mkv` | FFV1 v3, 8-bit BGRA/RGBA; sample lossless | PCM f32 |
| `lossless` | Matroska `.mkv` | FFV1 v3, RGB16 (`gbrp16le`); converted RGB sample lossless | PCM f32 |
| `nvenc-lossless` | Matroska `.mkv` | HEVC NVENC, P010 10-bit 4:2:0; codec lossless after conversion | PCM f32 |
| `uncompressed` | NUT `.nut` | Raw RGB16 (`rgb48le`), uncompressed | PCM f32 |
| `jpeg2000` | QuickTime `.mov` | Reversible JPEG 2000 RGB16 (`rgb48le`) | PCM f32 |
| `mp4` | MP4 `.mp4` | H.264/AVC, 8-bit 4:2:0; lossy | AAC |
| `hevc` | MP4 `.mp4` | HEVC/H.265, 10-bit 4:2:0; lossy | AAC |
| `av1` | Matroska `.mkv` | AV1, 10-bit 4:2:0; lossy | FLAC24 |
| `webm` | WebM `.webm` | VP9 8-bit 4:2:0, or AV1 10-bit fallback; lossy | Opus |
| `prores-proxy` | QuickTime `.mov` | ProRes Proxy, 10-bit 4:2:2; lossy intermediate | PCM24 |
| `prores-lt` | QuickTime `.mov` | ProRes 422 LT, 10-bit 4:2:2; lossy intermediate | PCM24 |
| `prores-422` | QuickTime `.mov` | ProRes 422, 10-bit 4:2:2; lossy intermediate | PCM24 |
| `prores` | QuickTime `.mov` | ProRes 422 HQ, 10-bit 4:2:2; lossy intermediate | PCM24 |
| `prores-4444` | QuickTime `.mov` | ProRes 4444, 10-bit 4:4:4 YUV, no alpha; lossy | PCM24 |
| `prores-xq` | QuickTime `.mov` | ProRes 4444 XQ, 10-bit 4:4:4 YUV, no alpha; lossy | PCM24 |
| `dnxhr` | QuickTime `.mov` | DNxHR HQX, 10-bit 4:2:2; lossy intermediate | PCM24 |
| `dnxhr-444` | QuickTime `.mov` | DNxHR 444, 10-bit planar RGB; lossy intermediate | PCM24 |
| `dnxhd` | QuickTime `.mov` | DNxHD 1080p, 10-bit 4:2:2; lossy broadcast intermediate | PCM24 |
| `mxf` | MXF OP1a `.mxf` | DNxHR HQX, 10-bit 4:2:2; lossy intermediate | PCM24 |
| `mxf-mpeg2` | MXF `.mxf` | MPEG-2 4:2:2, 8-bit, 50 Mb/s; lossy broadcast delivery | PCM24 |
| `cineform` | QuickTime `.mov` | CineForm, 12-bit planar RGB; lossy intermediate | PCM24 |
| `gif` | Animated `.gif` | Indexed palette; color quantization is lossy | None |
| `png-sequence` | ZIP of `.png` | Direct processed RGBA8 PNGs; sample lossless | Optional `mix.wav`, PCM f32 |
| `png16-sequence` | ZIP of `.png` | Converted RGB16 (`rgb48be`); sample lossless | Optional `mix.wav`, PCM f32 |
| `tiff-sequence` | ZIP of `.tiff` | Converted RGB16, deflate compression; sample lossless | Optional `mix.wav`, PCM f32 |
| `dpx-sequence` | ZIP of `.dpx` | Converted RGB16 (`rgb48be`); sample lossless | Optional `mix.wav`, PCM f32 |
| `exr-sequence` | ZIP of `.exr` | Linear float32 planar RGB, ZIP1 compression | Optional `mix.wav`, PCM f32 |
| `originals` | Portable project `.zip` | Original image/audio files, native bytes and editable metadata; no rendering | Original audio files, always included |

Processed sequence ZIPs expand holds into numbered frames, so a pose held for three exposures appears three times in the sequence. **Originals archives do not duplicate source assets for holds:** all stored assets are included once, and holds remain metadata. Originals always includes the whole project, all scenes, stored image/audio assets and required viewing previews, including retained assets no longer on the timeline. It preserves source project timing; scene-only scope, resizing, effects and output-rate conform do not alter its original files. Extract the ZIP and open `project.humanity.json` to continue editing. Previous autosave history is not part of this export.

## Raster and frame-rate requirements

General processed-output limits are **16–8192 pixels per side**, at most **35,651,584 pixels** total, **1–120 fps**, and at most **100,000 output exposures**. UHD 8K is 7680×4320; DCI 8K is 8192×4320. The 8K preset is UHD. These are renderer/project limits, not a promise that each codec or physical camera supports the entire range.

| Profile family | Additional requirement |
| --- | --- |
| YUV delivery/intermediates and NVENC lossless | Even width and height |
| DNxHR HQX / DNxHR 444 / MXF DNxHR | At least 256×120; even dimensions |
| DNxHD | Exactly 1920×1080 at 24000/1001, 24, 25, 30000/1001 or 30 fps |
| MXF DNxHR | 24000/1001, 24, 25, 30000/1001, 30, 50, 60000/1001 or 60 fps |
| MPEG-2 MXF | 1920×1080 at 24000/1001, 24, 25, 30000/1001 or 30 fps; **or** 1280×720 at 50, 60000/1001 or 60 fps |
| CineForm | Width divisible by 16; height divisible by 8 |
| GIF | At most 4096 pixels per side and 8,388,608 pixels total; palette and GIF timing limitations apply |

DNxHD 1080p60 and MPEG-2 MXF 720p24 are not accepted by these profiles. Use the legal conform buttons rather than treating raster and rate lists as independent choices. The UI uses familiar rounded labels such as 23.976; the encoder uses the corresponding rational rate.

With **Preserve the film’s duration** enabled, cumulative exposure boundaries are rounded at the output rate. A 12 fps shot exported at 24 fps repeats its exposures. A lower rate can omit poses with zero output exposures; the UI reports this. No interpolated motion is invented. Turning duration preservation off retains hold counts, changes playback speed and adjusts soundtrack placement/tempo for the new speed.

## Color and sound

Processed RGB retains the Canvas sRGB transfer and BT.709/sRGB primaries, full range. YUV targets explicitly convert to BT.709 transfer/matrix and limited range. EXR explicitly converts sRGB display values to linear float32 RGB with the same primaries. This is not a camera RAW, log, ACES, scene-referred HDR or end-to-end high-bit-depth grading pipeline.

The soundtrack supports placement, trimming, gain, mute and fades. Exports resample/mix at 48 kHz; project originals remain untouched. Full verification can compare decoded float32 or 24-bit preservation targets where supported. AAC and Opus are lossy. GIF has no soundtrack. Processed sequences can carry a separate `mix.wav`; the whole-project Originals archive carries original audio rather than a baked mix.

## Encoders, hardware and verification

H.264 tries compatible NVENC/VideoToolbox/software H.264 candidates; it does not silently become HEVC. HEVC has NVENC/VideoToolbox/x265 candidates. AV1 has SVT-AV1/AOM/NVENC candidates; WebM has VP9/AV1 candidates. Actual choices depend on the bundled runtime and OS. An installed hardware encoder is only a candidate: a real geometry probe must pass before it is used. Failed hardware probes can fall back to an encoder for the same requested format. NVIDIA codec-lossless has no lossy substitute.

**Verify export (slower) is optional and off by default.** A normal successful export reports **Export ready**. The extra complete decode, frame counting and full sample/file hash passes are opt-in; checking the box does not change the format's precision or make lossy codecs lossless. See [validation scope](VALIDATION.md) for what each check establishes.

[Recorded native Windows 8K evidence](validation/native8k-windows-development.json) includes short 7680×4320 exports of FFV1 RGBA8, converted RGB16 FFV1, a DPX16 sequence and RTX 3090 HEVC codec-lossless P010, all with independent target checks and verification explicitly enabled. These procedural, offline development-engine results use the receipt's earlier shared runtime; they establish those targets, not realtime performance, 16-bit camera acquisition, every profile, installed Mac/Windows apps or the new static runtime.

The [new standalone static Windows runtime's own 8K receipt](validation/static-runtime-windows.json) now records those four targets passing with its exact binary hashes as well. It retains the same short procedural/offline scope, explicitly enabled verification and RGBA8-derived precision limits; installed applications, Mac hardware and sustained 8K performance are separate checks.

The **new static GPL Windows FFmpeg runtime has passed actual output/verification for all 28 profiles**, with no unavailable cases, in the [recorded profile matrix](validation/static-runtime-windows-matrix.json). These short cases use their stated small/HD rasters; they include real NVENC hardware probes and do not establish every format at 8K. The [runtime manifest](provenance/windows-media-runtime.json) separately records 16 media smoke checks, two static CLI binaries, ten source inputs and 39 notices. The exact tested binary hashes have been promoted into Windows app resources and have the separate four-target 8K proof above. [Actual Windows installed-app QA](validation/installed-windows.json) confirms normal and opt-in verified FFV1 demo exports with equal complete decoded RGBA samples.

On Apple silicon, [actual installed Mac exports](validation/mac-installed-exports.json) verify both FFV1 paths against all 24 original procedural PNG frames. A separate [Mac native 8K engine case](validation/native8k-macos-arm64.json) passed two 7680×4320 FFV1 RGBA8 frames, and [two Mac Originals engine cases](validation/mac-portable-project-engine.json) preserved/reopened whole projects with verification off/on. These do not establish all 28 profiles at all sizes on Mac. [Mac installation/signing details](validation/installed-macos.json) document ad hoc signing, no notarization, and the still-pending final installed-camera consent. Release assets must include matching source/notices materials and platform evidence. Missing/unsupported codec or hardware paths on another machine remain explicit.
