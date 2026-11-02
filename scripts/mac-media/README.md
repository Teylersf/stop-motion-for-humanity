# macOS ARM64 media reproduction

This directory preserves the exact native recipes used for the audited
FFmpeg 9.0.2 `smfh-macos14-pro-v1` runtime. The nine files in `recipes/` match
the final v3 corresponding-source recipe capture byte for byte. Their hashes and all ten source
inputs are recorded in `docs/validation/mac-native-media-build.json`.

The recipes build FFmpeg, x264, multilib x265 (8/10/12 bit), libaom's AV1 encoder
and decoder, libvpx, Opus and generic C++ zimg with its pinned graphengine.
pkgconf and CMake are private build tools. Only the resulting `ffmpeg` and
`ffprobe`, plus separately collected notices/provenance, belong in the app's
media runtime. No Homebrew libraries, Python runtime or CMake application are
runtime dependencies.

## Offline preparation

Use an Apple Silicon Mac with Xcode Command Line Tools and Python 3.12 or
newer. Supply the ten exact source archives listed in the provenance file in
a flat directory. Git-based archives are the corresponding-source package's
pinned `git archive` outputs, rather than newly downloaded tag tarballs.
Also supply the recorded upstream universal CMake archive as a private build
tool. Its matching source archive is one of the ten source inputs.

From the application repository:

```sh
python3 scripts/mac-media/prepare_worktree.py \
  --input-root /path/to/verified-source-archives \
  --cmake-tool-archive /path/to/cmake-4.4.5-macos-universal.tar.gz \
  --work-root /tmp/humanity-macos14-rebuild
```

Preparation verifies sizes and SHA256 values before extraction, refuses an
existing work directory, copies the exact recipes and writes a preparation
receipt. It performs no downloads or compilation. The vendored CMake tool is
extracted only inside the new private work directory.

## Build and inspect

Change to the new work directory before running the recipes:

```sh
cd /tmp/humanity-macos14-rebuild
python3 recipes/build_media.py
python3 recipes/audit_runtime.py \
  --root stage/darwin-arm64 --max-macos 14.0 \
  --output evidence/runtime-audit.json
```

`build_media.py` builds the prerequisite static libraries and invokes the
separate pro-codec and zimg helpers. It records compiler/SDK/argv details,
strips and signs the two staged executables ad hoc, then verifies their
signatures. Parallelism is four jobs, with zimg capped at three. Fresh build
outputs are expected. Preserve prior evidence before using its incremental
`--only-ffmpeg` option. The source-fetch recipes are retained as historical
reproduction inputs; offline preparation does not invoke them.

The zimg wrapper compiles the unconditional upstream `Makefile.am` C++ source
list with SIMD disabled, embeds graphengine under the upstream namespace and
does not patch either source tree. Its smoke check compares a real sRGB to
linear float conversion with the analytic transfer function and verifies a C
consumer's static pkg-config linkage through libc++.

The runtime audit reads every Mach-O, deployment command, dependency and
symlink, verifies strict signatures, and checks binary hashes before and
after inspection. It permits only Apple `/System/Library` and `/usr/lib`
external loads and enforces the macOS 14.0 deployment floor. It never executes
the audited media binaries. Functional codec, container, audio and precision
tests are separate. Declared deployment targets do not prove execution on an
older macOS system; the recorded build host used a newer SDK.

## Corresponding-source integration

Commit this complete directory and the provenance JSON before invoking
`scripts/collect-release-sources.py`. Its committed application snapshot then
includes the exact Mac recipes automatically. The runtime manifest's
`native_source_build_overrides` should use the relative paths listed in the
provenance JSON, and its `source_inputs` should identify the same ten native
source archives. Keep all source licenses and graphengine's license with the
source package. The source collector owner handles final source archives,
runtime manifest publication and release digests.

This receipt describes the native media build. It makes no installed-app,
physical-camera, Developer ID, notarization or Gatekeeper acceptance claim.
