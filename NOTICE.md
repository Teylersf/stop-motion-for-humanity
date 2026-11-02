# Notices and provenance

Stop Motion for Humanity is created by Taylor Kalin. Application code is
GPL-3.0-or-later. Original application icons and the built-in procedural
animation sample are part of the application source. No third-party camera
firmware, private footage or proprietary SDK is included.

Electron retains its MIT license and Chromium/FFmpeg third-party notices.
React, React DOM, Lucide, yazl and their dependencies retain their licenses.
Bundled distribution notices must be retained by the packager.

Native media release payloads are separate, pinned, standalone FFmpeg builds
with GPL/version-3 features enabled. The Windows build statically includes
x264, 10-bit x265, SVT-AV1, dav1d, libvpx, Opus, zimg and zlib, with
nv-codec-headers for runtime NVIDIA encoder access. The Apple Silicon build
uses its own pinned ARM64 sources/configuration and Apple system frameworks.
Each platform manifest identifies its exact codec libraries, source inputs,
toolchain, build options and binary hashes. Their upstream license texts and
applicable toolchain notices travel with the binaries and source archives.

Earlier development receipts may identify a different, audited shared-library
runtime. Those receipts preserve that original scope; the release runtime has
its own independent build, dependency and media-validation evidence. A system
FFmpeg installation is not substituted into packaged releases.

Each native release must include dependency notices and matching corresponding
source materials/build recipes. Binary/source SHA-256 manifests bind the
published media runtime to its exact input set. See the release assets and
platform-specific provenance documents when published.

This program is distributed without warranty. See LICENSE for its terms.
