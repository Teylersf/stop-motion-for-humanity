# Notices and provenance

Stop Motion for Humanity is created by Taylor Kalin. Application code is
GPL-3.0-or-later. Original application icons and the built-in procedural
animation sample are part of the application source. No third-party camera
firmware, private footage or proprietary SDK is included.

Electron retains its MIT license and Chromium/FFmpeg third-party notices.
React, React DOM, Lucide, yazl and their dependencies retain their licenses.
Bundled distribution notices must be retained by the packager.

Native media payloads are separate, pinned builds. The Windows payload reuses
the author's audited FFmpeg n8.0.1-66-g27b8d1a017 CLI and seven shared libraries.
The avcodec/avformat replacements have explicit LGPL-3.0-or-later source/build
receipts and omit the original codec's Chromaprint/FFTW/ZVBI integrations.
The CLI's printed original configure line is not the replacement library's
configuration; both records and exact file hashes are included with releases.
It is not the GPL-enabled Gyan FFmpeg installed on the development machine.

Each native release must include dependency notices and matching corresponding
source materials/build recipes. Binary/source SHA-256 manifests bind the
published media runtime to its exact input set. See the release assets and
platform-specific provenance documents when published.

This program is distributed without warranty. See LICENSE for its terms.
