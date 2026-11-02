# Make your first film

Stop Motion for Humanity is a local desktop studio by Taylor Kalin. Your film is a folder on your computer: original images, original sound and editable project metadata stay together. There is no required account, subscription or cloud upload.

For current download availability, use the project README. The **Windows x64 per-user EXE installer has been tested through installation, launch, save/quit/reopen and both export modes**; see the [installed Windows receipt](validation/installed-windows.json). The tested `0.1.0-beta.1` installer records **Taylor Kalin** as Publisher/Company and is an **unsigned beta**. Its installed application and media files matched the packaged hashes.

On Windows, run the release's `StopMotionForHumanity-…-win-x64.exe`, choose the per-user installation location in the wizard, then launch **Stop Motion for Humanity** from its shortcut.

On an Apple silicon Mac, open `StopMotionForHumanity-…-mac-arm64.dmg`, drag the app into Applications, then launch it. [Actual final-DMG installation and exports were tested](validation/installed-macos.json) on an Apple M4 running macOS 26.6.2, with every installed file/symlink matching the built app. The declared minimum is macOS 14.0; older-version runtime execution has not been tested. This beta is **ad hoc signed and not notarized**; Gatekeeper acceptance is not claimed. Both installed export modes and project reopening passed. A new capture in the final installed Mac app still awaits human camera consent, so that remaining step is separate from completed installation/export evidence. [Validation](VALIDATION.md) gives the exact scopes.

## Start or reopen

Choose **Start a new film**, then select the parent folder where the app should create your project. The app creates a new named subfolder. A new project starts at 1920×1080 and 12 fps; both are editable in **Project settings**. Twelve frames per second is a convenient place to start animating.

Use **Open project** to select `project.humanity.json`, or use a recent-project card. **Explore a little sample film** creates an original procedural paper-cut robot animation in a folder you choose; its 24 PNG frames are generated locally and can be edited like other frames. **Show me how** opens the five-step walkthrough.

The Simple/Advanced switch is in the inspector. Start in Simple for capture, timing and basic guides. Advanced reveals camera controls, interval capture, references, crop/color, cleanup, drawings, titles and detailed audio trims/fades.

## Connect a camera

1. Mount the camera securely and light the set consistently.
2. Open the inspector's **Camera** tab, choose a **Video source** and a requested preview size, then choose **Connect camera**.
3. Grant the OS camera permission. Check **Actual capture**, not only the requested size.
4. Make a small move and press **Space** or the capture button. Move again and capture another frame.

The app uses OS-visible webcam/video inputs: built-in and USB UVC webcams, compatible HDMI/SDI capture devices, and compatible vendor/OBS virtual cameras. A professional camera must provide one of those paths. A USB-connected DSLR in PTP/storage mode does not automatically become a webcam, and the app does not implement vendor remote-shutter SDKs.

The default request is 3840×2160, but the driver may negotiate a different size. The app shows the delivered dimensions and preview rate. A snapshot saves a fresh video frame at those dimensions as PNG8; it does not upscale a lower-resolution feed to satisfy a requested size. Preview rate is not animation playback rate. Requesting an 8K preview cannot make a 1080p camera capture 8K.

The selected camera, requested size, countdown and append/insert/replace preference are remembered locally. Connection is always an explicit action. In Advanced, exposure/focus/white-balance modes and numerical controls appear only when the driver reports them. The app checks actual settings after a change and reports a driver that ignores a requested control. Manual controls can help reduce automatic focus or exposure changes, but unsupported locks are not invented.

**Windows development evidence:** an EMEET SmartCam C960 4K negotiated 3840×2160 at a reported 30 fps and saved a verified 3840×2160 PNG8 original. This is one short physical-device check, not a claim about all webcams, all controls or long takes. [Camera details](CAMERAS.md) and the [public metadata receipt](validation/physical-webcam-windows-development.json) describe its scope.

**Mac packaged preflight evidence:** [two physical webcams captured PNG8 originals](validation/physical-webcam-macos-preflight.json): Live Streamer CAM313 at 1920×1080 and EMEET SmartCam C960 4K at 3840×2160. That earlier packaged test is distinct from the final DMG-installed app, whose new camera capture is still awaiting human macOS permission. When the OS asks, grant camera access yourself; connecting the app does not grant microphone access.

## Bring your own stills

Choose **Import images** to copy stills into the project. The image chooser accepts PNG, JPEG, WebP, BMP, GIF, TIFF, DPX, EXR, JPEG 2000 and JPEG XL extensions. Actual decoding depends on the bundled media runtime; specialized formats can receive a separate viewing preview while their original files remain intact. The app imports still frames, not a general video-clip editing timeline. Camera RAW files such as CR2/NEF are not an exposed import path.

Imported files must fit the supported image raster and file-size limits. Import at most 10,000 images in one selection. A retained 16-bit PNG is still a 16-bit original even though edited previews/exports use RGBA8. See [precision choices](FORMAT_SUPPORT.md) before choosing a master format.

For tethered capture, let your camera's own capture software write files into a separate folder, then choose **Watch a folder**. The watcher adds supported new or changed PNG/JPEG/WebP/BMP/TIFF files after their size and modification time stabilize. Files already present when watching starts are not automatically imported; use Import images for those. Do not watch the project's own `assets` folder. Use **Stop folder watch** when the take ends.

## Capture rhythm and alignment

Use the camera **Countdown** to give your hands time to leave the set. **Add each frame** can append at the end, insert after the selected frame or replace the selected frame's timeline image. Replacing resets that frame's picture edits; its previous original remains stored in the project.

Advanced **Interval** capture repeats at the chosen interval. Captures are serialized; a slow operation does not create overlapping captures. **Esc** stops an interval/countdown or playback. Existing saved frames remain available if a camera is unplugged or a capture fails.

In the **Frame** tab, onion skin blends one to five previous frames over live view. Adjust opacity below the viewer; zero opacity hides the overlay. **Difference view** emphasizes changes. Grid choices include thirds, square and center crosshair. Advanced aspect guides include 16:9, 4:3, square and 2.39:1. These are composition/viewer guides, not an automatic exported crop.

For a fixed alignment target, first import or capture the reference image, then choose it under Advanced **Pinned reference** and enable **Show pinned reference**. These overlays, guides and preview mirroring do not contaminate the original camera PNG.

## Timing, scenes and playback

Select a thumbnail to inspect it. Use Ctrl/Cmd-click or Shift-click for multiple selection. Drag a thumbnail before another to change order. Duplicate makes another editable frame referencing the retained source; remove deletes the timeline entry while preserving the source asset. Reverse operates on the selected group, or the whole scene when there is not a multi-frame selection. Undo/redo works on project edits within the current session.

**Hold this pose** controls how many exposures a frame occupies. At 12 fps, a hold of 6 lasts half a second. Holds stay compressed in the editable project. The project supports up to 100,000 frames/exposures and a hold of up to 10,000; very large holds can exceed the total limit.

Press **Enter** to play or pause. The transport offers first/last frame, loop, Advanced ping-pong and whole-scene/last-12/24/48-exposure playback. Playback is a working preview and can be limited by image decoding or the computer; export timing uses the declared frame rate.

Add scenes with the sidebar plus button; click the scene name in the toolbar to rename it. Export can render the current scene or all scenes in order. The frame-notes sheet lists frame number, hold, note and dialogue/sound cue. These cue fields are planning metadata, not synthesized dialogue or an automatic lip-sync system.

## Color, cleanup, drawing and titles

Switch to Advanced, select a frame and use **Frames** preview to edit. Exposure, contrast, saturation and warmth are non-destructive. Flip, 90-degree rotate and normalized percentage crop change the rendered picture; they do not rewrite the source. **Reset frame adjustments** restores default picture edits, including removing that frame's cleanup/drawing edits.

**Remove a background color** applies the selected chroma key and tolerance. The resulting picture composites onto the project background. This is color-based keying, not AI segmentation.

For rig removal:

1. Capture an empty-set background with the camera in the same position.
2. Import/capture that still and select it as **Clean plate for rig removal**.
3. Select the frame containing the rig, choose **Brush clean plate over rig**, and paint over the unwanted support in Frames preview.
4. Inspect the result. Undo an unwanted stroke, or use **Clear drawings & rig-removal strokes** to reset those layers.

The brush reveals your assigned clean plate. It does not invent missing background or automatically track moving objects. A matching camera position and background matter. **Draw on frame** adds a separate colored drawing layer. Cleanup and drawings remain frame-edit metadata; originals stay untouched.

**Title on all frames** adds a global rendered title with size and color controls. The title is baked into processed exports and bypassed by the Originals archive.

## Sound and cues

Choose **Add audio** or Audio → **Import** for WAV, MP3, M4A/AAC, FLAC, OGG, WebM or AIFF, subject to the native decoder. Choose **Record** to explicitly request microphone access and record narration; choose **Stop** to retain it. Connecting a camera does not request its microphone.

Each audio clip has a waveform, volume, mute and **Start at exposure**. Placements use the global project exposure timeline. Advanced shows trim-in/out seconds and fade-in/out. Frame **Dialogue / sound cue** text helps plan timing but does not itself play a sound. Audio is resampled/mixed for export; original recordings remain stored unchanged. Processed sequence exports can include a separate `mix.wav`; Originals always includes original audio assets with the project.

## Save, recover and move the project

Edits autosave after a short idle period; the header shows save status. Use Ctrl/Cmd+S whenever you want an immediate save and before moving a project. Normal window close or Quit also stops new capture work, waits for accepted media writes, cancels an active export and saves the latest project before exiting. If that save cannot be confirmed, the app stays open and offers Keep editing or Retry saving and quit; quitting without the latest save is a separate explicit recovery choice. On Windows, this was tested by pasting a new title and quitting in 233 ms, before the 650 ms autosave delay, then reopening the correct project.

A save writes a temporary file, flushes it and atomically replaces the manifest. The previous readable save is kept as `project.humanity.previous.json`; prior manifests are also retained under `.humanity-autosaves`.

If the main manifest is unreadable, Open project attempts the previous good save and tells you it recovered it. The durable asset registry can recover retained imports that were written before a later manifest save. Missing or changed originals are reported rather than silently recreated. A manifest backup is not an external backup of your footage: keep a separate copy of the whole project folder.

Use **Show project folder** to find it. To transfer an editable film, export **Originals · portable project archive**. It includes every scene, editable manifest, all retained original image/audio assets and necessary viewing previews once each. Holds are metadata, not duplicate asset files. Extract the entire ZIP and open its `project.humanity.json`; copying just that JSON without `assets` does not move the media. This export preserves source timing and bypasses rendered effects. It does not include the project's autosave history.

## Export your film

Choose **Export film**. The three recommendation cards offer a rendered FFV1 lossless master, a shareable H.264 MP4, or the full editable Originals archive. All 28 profiles remain available in the format menu, including higher-bit-depth conversions with their precision explanation.

For a processed export, choose the scene scope, dimensions, rate and soundtrack. **Match recommended source size** uses actual stored source dimensions; mixed projects default to the largest-area supported source. **Use connected camera size** or **Use selected original size** is an explicit alternative. Downsizing and upscaling are disclosed. A 4K capture can be retained even if the project was initially 1080p.

**Preserve the film’s duration when frame rate changes** starts enabled. Exporting a 12 fps animation at 24 fps repeats exposures rather than doubling its speed. A lower rate can omit poses; the dialog reports them. With preservation off, original holds remain and playback speed changes. The native audio mix follows the changed timing with pitch-preserving tempo conversion. Broadcast conform buttons choose legal raster/rate pairs without editing the project.

**Verify export (slower) starts off.** Leave it off for the faster path: the extra full decode, frame count, source hashes and converted-sample/file comparisons are skipped. A successful result says **Export ready**. Turn it on when you want those independent checks; a successful checked export reports **Export verified**. Full verification can take substantial time at 8K and does not make a lossy codec lossless. [Format support](FORMAT_SUPPORT.md) explains the preservation targets.

Choose **Choose location & export**, select a destination and wait for completion. The app renders from a frozen project snapshot and reports encoder/processing notes. **Cancel export** stops the export's own workers and removes partial output. **Show in folder** reveals the completed result. Originals always archives the whole project at source timing; its original assets are unaffected by processed-output options.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Capture one frame |
| Enter | Play / pause |
| Left / right arrow | Previous / next frame |
| Esc | Stop playback, interval or countdown |
| Delete / Backspace | Remove selected timeline frames |
| Ctrl/Cmd+S | Save |
| Ctrl/Cmd+O | Open project |
| Ctrl/Cmd+N | New project |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z | Redo |
| Ctrl/Cmd+E | Export |

Capture/edit shortcuts are suspended while typing in a field or using a modal dialog. Buttons have text labels or accessible names, and dialogs support keyboard focus and Escape dismissal.

## When something needs attention

| Symptom | Next step |
| --- | --- |
| No camera in the list | Check OS webcam mode/driver, cable and power; use Refresh camera list. For PTP still capture, import or watch the external software's output folder. |
| Permission denied | Enable the app in OS camera privacy settings; on macOS a restart can be needed after changing denied permission. Microphone permission is separate. |
| Camera busy | Close conferencing, recording or vendor apps using it, disconnect/reconnect in the studio, and retry. |
| Camera unplugged or feed stalled | Stop timed capture, check power/cable, reconnect deliberately and check the actual reported source. Already saved frames remain in the project. |
| Requested 4K but actual is HD | The driver negotiated HD. Check the camera/capture-card signal and supported modes. Changing export size cannot recover missing detail. |
| Folder watch adds nothing | It ignores the initial folder contents; capture a new supported file or import existing files. Wait for the writer to finish and avoid the project's own assets folder. |
| Format selected but export unavailable | Read preflight for its exact encoder, hardware, raster/rate or block-size requirement. The profile remains selectable; use another available target or the matching media runtime. |
| Export slower than expected | Effects, high resolution, software codecs and opt-in full verification cost time. Start with a short take and inspect processing notes. |
| Saved project reports missing media | Restore the whole project folder or missing `assets` from your backup; do not replace originals with thumbnails. |

Help → **Camera & export diagnostics** shows the app runtime, actual camera settings and last camera error. Report that text and the steps to reproduce; private frames are not required for a useful bug report.
