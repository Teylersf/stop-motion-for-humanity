# Stop-motion feature research

Research checked November 2, 2026. Official documentation establishes advertised
capabilities; user reports establish requests or reported problems, not independently
reproduced bugs. Product choices below are our interpretation of that evidence.

## Existing tools and useful capabilities

| Tool | Distribution | Capabilities to learn from | Camera boundary |
| --- | --- | --- | --- |
| Dragonframe | Paid; Windows, Mac, Linux | Detailed timeline, onion skin/live toggle, X-sheet, audio/dialogue, recoverable reshoots, references, multiple exposures, supported lighting/motion hardware | Model-specific DSLR support and capture devices; preview and saved still resolution differ |
| Stop Motion Studio | Proprietary desktop/mobile | Accessible capture/edit/sound/share flow, frame timing, drawing, masks, greenscreen, effects, titles, voice and remote camera | Built-in/USB inputs and explicitly supported desktop DSLR models |
| qStopMotion | Free/open source; established Windows/Linux; current Mac availability needs verification | Scene/take hierarchy, five onion frames, difference view, configurable camera controls, imported images, time-lapse | Backend and model dependent |
| Boats Animator | Free/open source; Windows/Mac/Linux | Minimal capture workflow, onion skin, grids, aspect masks, instant playback, sequence/video export | WebRTC/webcam devices; current main rewrite differs from released version |
| Tahoma2D | Free/open source; Windows/Mac/Linux | X-sheet, stop-motion capture, camera calibration, image work, audio, compositing, interval capture | libgphoto2 and DSLR support have platform/model requirements |
| OpenToonz | Free/open source; Windows/Mac and other builds | X-sheet/timeline, drawing, compositing and camera workflows | Canon integration is an optional SDK-dependent build feature |
| Linux Stopmotion | Free/open source; Linux | Scene organization, onion/difference views, frame-linked sound and exports | Linux webcam/image workflow; not evidence of Windows/Mac availability |

Official sources:

- Dragonframe: [features](https://www.dragonframe.com/dragonframe-software/),
  [camera matrix](https://www.dragonframe.com/camera-support/).
- Stop Motion Studio: [overview](https://www.stopmotionstudio.com/),
  [desktop camera compatibility](https://help.stopmotionstudio.com/help/troubleshooting/en/supported-dslr-cameras.html),
  [release notes](https://www.stopmotionstudio.com/news/).
- qStopMotion: [overview](https://www.qstopmotion.org/),
  [manual](https://www.qstopmotion.org/manual/manual_en.html).
- Boats Animator: [official features/downloads](https://www.charlielee.uk/boats-animator/),
  [repository and rewrite notice](https://github.com/charlielee/boats-animator).
- Tahoma2D: [official site](https://tahoma2d.org/),
  [changelog](https://github.com/tahoma2d/tahoma2d/blob/master/CHANGELOG.md).
- OpenToonz: [official site](https://opentoonz.github.io/e/),
  [Canon build integration](https://github.com/opentoonz/opentoonz/blob/master/doc/how_to_build_win.md).
- Linux Stopmotion: [KDE project listing](https://apps.kde.org/en-gb/stopmotion/).

## What animators ask for

| Report date | Need | User evidence | Product response |
| --- | --- | --- | --- |
| 2026-10-18 | A simpler classroom app without ads | [Stop motion with kids](https://www.reddit.com/r/stopmotion/comments/1x8rhsc/stop_motion_with_kids/) | Large capture/play controls, local projects, progressive advanced settings |
| 2026-09-16 | Less repetitive cleanup, more consistent masks | [Spider-Man production discussion](https://www.reddit.com/r/stopmotion/comments/1we7847/it_took_me_20_hours_to_animate_this_spiderman/) | Reversible clean-plate strokes and reusable frame edits; no promise that generative fill solves rig removal |
| 2026-09-01 | Exposure locks that report what the camera really does | [Exposure drift report](https://www.reddit.com/r/stopmotion/comments/1w4o2a0/help_me_please/) | Capability-aware constraints, recorded settings and brightness comparison |
| 2026-08-29 | An obvious front/external-camera selector | [Selfie-camera request](https://www.reddit.com/r/stopmotion/comments/1w1jjj3/stop_motion_app_with_selfiefacing_camera/) | Named device list and clear actual camera status; partly a discoverability issue in existing software |
| 2026-08-16 | A capable free Windows option | [Stop motion programs](https://www.reddit.com/r/stopmotion/comments/1vpilt4/stop_motion_programs/) | Free native Windows and Mac releases, no paid feature tier |
| 2026-07-31 | Plan action against recorded speech | [Movement and voices](https://www.reddit.com/r/stopmotion/comments/1vbv8w3/how_to_i_match_movement_to_voices/) | Audio import before capture, cues, scrubbing, waveform and exposure timing |
| 2026-07-23 | Camera discovery and easy dependency-free installs | [Open Stop Motion Studio issue 2](https://github.com/RealHartlMax/Open-Stop-Motion-Studio/issues/2) | Connection diagnostics, native packaged runtime and explicit tested-device records |
| 2026-07-04 | Match the framing when returning to a shoot | [Keeping shots consistent](https://www.reddit.com/r/stopmotion/comments/1umxfex/keeping_shots_consistent/) | Persistent reference, opacity/difference comparison and camera-setting metadata |
| 2026-06-18 | Capture, edit, sound and cleanup in one understandable tool | [Is Dragonframe worth it?](https://www.reddit.com/r/stop_motion/comments/1u99ywj/is_dragonframe_worth_it/) | One project and a short first-film walkthrough; image sequences for handoff |
| 2026-05-19 | Understand which layer a mask erases | [Masking problem](https://www.reddit.com/r/stopmotion/comments/1th9cee/problem_with_masking_on_android/) | Explicit clean plate, visible brush, nondestructive strokes and undo |
| 2026-04-14 | Preserve the take through camera-setting failures | [Camera settings crashes](https://www.reddit.com/r/stopmotion/comments/1slcvu3/problems_with_programs/) | Capture serialization, safe autosave and recoverable error states |
| 2026-04-04 | Clear source/export resolution and original sequences | [Export-quality report](https://www.reddit.com/r/stopmotion/comments/1scn7mq/stop_motion_studio_terrible_export_quality/) | Actual capture raster, explicit scaling, original-byte sequence and verified outputs |
| 2026-02-18 | A capture must complete safely after live view succeeds | [Canon capture report](https://www.reddit.com/r/Tahoma2D/comments/1r86cne/having_trouble_using_my_dslr_for_stop_motion_can/) | Save a frame before advancing counts; keep old frames through failure |
| 2026-01-02 | A complete introductory stop-motion workflow | [Documentation request](https://www.reddit.com/r/Tahoma2D/comments/1q1sdnf/why_there_is_zero_documentation_about_stop_motion/) | Built-in help covering connect, capture, onion skin, holds, audio and export |
| 2025-02-02 | Capture with one hand and obvious selection/hold shortcuts | [Boats issue 546](https://github.com/charlielee/boats-animator/issues/546) | Keyboard capture/navigation, large targets, selected-frame state and undo |
| 2024-11-09 | Animate photographs captured away from the computer | [Boats issue 527](https://github.com/charlielee/boats-animator/issues/527) | Ordered sequence import and folder watch |
| 2024-08-10 | Insert or reshoot inside a take | [Boats issue 501](https://github.com/charlielee/boats-animator/issues/501) | Append/insert/replace capture modes with nondestructive undo |
| 2023-07-28 | Compare against an arbitrary imported reference | [Boats issue 465](https://github.com/charlielee/boats-animator/issues/465) | A pinned external reference independent of the previous frame |

An interval-countdown/capture-sound request in
[OpenToonz discussion 6480](https://github.com/opentoonz/opentoonz/discussions/6480)
was implemented in an August 20, 2026 nightly. Treat that as an existing
competitor capability, not a feature nobody offers. Stop Motion Studio's
September/October 2026 updates also address reconnection, safer saving,
audio and export reliability; these are acceptance-test ideas rather than
proof that all current competing releases lack those fixes.

## Product boundary

All-camera compatibility, automatic flicker repair, general AI rig removal,
RAW/PTP shutter control and calibrated motion/DMX hardware require specific
backends and real device testing. They must not be represented by decorative
controls or claims inferred only from a working webcam preview.

The application should prioritize the first-film workflow and reliable,
preserved image sequences. Add specialist hardware only with an explicit
adapter, model/OS evidence and a published test result.
