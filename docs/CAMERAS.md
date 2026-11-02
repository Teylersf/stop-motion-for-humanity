# Camera support

Stop Motion for Humanity uses Chromium's Media Capture API inside a native
Electron application. The connection must enumerate as a usable video input
in the operating system and be available to the application.

| Connection | Expected path | Important distinction |
| --- | --- | --- |
| Built-in or USB UVC webcam | Select in the camera list | Actual offered resolutions and controls vary |
| Professional camera in webcam mode | Camera firmware mode or installed vendor utility | Webcam resolution is not necessarily the still sensor resolution |
| HDMI/SDI capture | Compatible capture device exposed as a webcam | Capture-card driver and signal format determine support |
| OBS or vendor virtual camera | Start the virtual camera, then select its named input | Installed virtual camera must be compatible with the OS |
| DSLR/mirrorless USB PTP or storage mode | Import stills or watch a folder written by external capture software | PTP is not webcam mode and does not imply remote shutter/RAW support |

The app must show the actual negotiated raster and frame rate, offer only
controls reported by the driver, and preserve already-saved frames when a
connection fails. Onion skin, grids and reference overlays belong to the
viewer; they must not become part of the original camera capture.

## Connection checks

1. Put the camera in its supported USB webcam mode, or start its installed
   webcam utility/OBS virtual camera. For HDMI, enable the capture device.
2. Connect in the app and grant the operating system's camera permission.
3. Close any program that is holding the same camera exclusively.
4. Check the named device, actual capture resolution and driver-supported
   focus/exposure/white-balance controls before starting a take.
5. If disconnected, stop timed capture and reconnect deliberately; do not
   silently select a different camera.

On macOS, denied camera access may require changing Privacy & Security settings
and restarting the app. Legacy camera plugins may require a vendor update on
recent macOS. Do not disable system protections to enable an old plugin.

## Sources

- [Media Capture and Streams standard](https://www.w3.org/TR/mediacapture-streams/)
- [Image Capture standard](https://w3c.github.io/mediacapture-image/)
- [Microsoft UVC driver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/usb-video-class-driver-overview)
- [Canon Webcam Utility compatibility](https://www.usa.canon.com/digital-cameras/eos-webcam-utility/compatible-cameras)
- [OBS Virtual Camera](https://obsproject.com/kb/virtual-camera-guide)
- [Apple legacy camera compatibility](https://support.apple.com/en-ca/108387)
- [Electron media authorization](https://www.electronjs.org/docs/latest/api/system-preferences)

## Test evidence

Physical-device tests, deterministic fixture tests and unsupported/unavailable
hardware must be reported separately. A fake-camera fixture is useful for
automation but is not proof that a particular USB camera works. Release
validation records will list exact tested devices, OS, raster and results.
