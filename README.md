# Stop Motion for Humanity

**Small movements. Big stories. Free for everyone.**

An open-source stop-motion studio for Windows and Mac, created by
[Taylor Kalin](https://www.taylorkalin.com/). Make a first film without an
account, subscription, advertisements or uploading your footage.

This new application is under active development. Native installers and
verified release notes will be linked here when the actual builds pass testing.
The feature research below is a product specification, not a claim that every
competitor feature or requested hardware integration is already implemented.

## The filmmaking workflow

1. Create a portable project and connect a camera, import photographs, or try
   the original built-in animation sample.
2. Move your subject. Capture a frame with Space or the large capture button.
3. Use onion skin, reference overlays and frame holds to shape the movement.
4. Add sound, cues, color and cleanup, then export a film or image sequence.

The design keeps capture, playback and timing visible, with advanced controls
available when you need them. Original captures remain intact.

## Cameras

The capture path uses the cameras your operating system exposes as video
inputs: built-in cameras, standard UVC webcams, compatible HDMI/SDI capture
devices, OBS virtual cameras and supported vendor webcam utilities.

Camera mode, driver, OS permissions and actual negotiated capabilities matter.
Connecting a USB camera does not establish support for its PTP shutter, RAW
files, full sensor resolution or proprietary camera settings. A folder-watch
and image-sequence workflow can receive still photographs from other software.
See [camera support and diagnostics](docs/CAMERAS.md).

## Built from animator needs

The research covers Dragonframe, Stop Motion Studio, qStopMotion, Boats
Animator, Tahoma2D, OpenToonz and Linux Stopmotion, plus concrete requests and
production problems posted by animators and educators.

[Read the feature comparison and dated wishlist](docs/RESEARCH.md).

## Development

Node.js 22.12 or newer is needed only for building from source.

```sh
npm ci
npm run build
npm start
```

Movie exports require the pinned native media payload in
`resources/media/<platform>-<arch>/`. The native installers will bundle it;
end users will not need Node, Python or a separately installed FFmpeg.

```sh
npm test
npm run dist:win
npm run dist:mac
```

The default app runs locally through a sandboxed Electron shell. There is no
Vercel deployment, cloud-media relay, remote font or analytics integration.

## Free software, preserved originals

Application code is [GPL-3.0-or-later](LICENSE). Third-party components retain
their own licenses. Native media tools ship with notices, build information
and matching source materials. See [NOTICE](NOTICE.md).

Copyright © 2026 Taylor Kalin. Contributions, improvements and translations
are welcome. No one should need a subscription to bring a small idea to life.
