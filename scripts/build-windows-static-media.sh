#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Offline, standalone FFmpeg CLI; no coupling to PyAV or the previous shared runtime.
set -euo pipefail
repo="$(realpath "${1:?Pass the WSL path to the Stop Motion for Humanity checkout}")"
work="${BUILD_ROOT:-/tmp/humanity-ffmpeg-win-v1}"
case "$work" in /tmp/humanity-ffmpeg-win-*) ;; *) echo 'BUILD_ROOT must be a dedicated /tmp/humanity-ffmpeg-win-* directory' >&2; exit 2;; esac
mkdir -p "$work" "$work/logs" "$work/stamps" "$work/src" "$work/build" "$repo/out/static-media-win"
work="$(realpath "$work")"
prefix="$work/prefix"
jobs="${JOBS:-12}"
cross=x86_64-w64-mingw32
mkdir -p "$prefix/include" "$prefix/lib/pkgconfig" "$work/evidence"
exec > >(tee -a "$work/logs/build.log") 2>&1
echo "START $(date -u +%FT%TZ) $work"
export LC_ALL=C TZ=UTC SOURCE_DATE_EPOCH=1760000000
export CC="$cross-gcc" CXX="$cross-g++" AR="$cross-ar" RANLIB="$cross-ranlib" STRIP="$cross-strip"
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig" PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export CFLAGS='-O2 -g0' CXXFLAGS='-O2 -g0' LDFLAGS='-static -static-libgcc -static-libstdc++'
{
  "$CC" --version; "$CXX" --version; cmake --version; ninja --version; meson --version;
  nasm -v; pkg-config --version; autoreconf --version; python3 --version; uname -a;
  dpkg-query -W -f='${Package} ${Version}\n' gcc-mingw-w64-base gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix mingw-w64-x86-64-dev mingw-w64-common;
} > "$work/evidence/toolchain.txt" 2>&1
cp "$repo/out/native-inputs/static-media-inputs.json" "$work/evidence/source-inputs.json"
# Verify once more inside the actual build environment, then extract through Python's safe data filter.
python3 - "$repo/out/native-inputs" "$work/src" <<'PY'
import hashlib,json,pathlib,tarfile,sys
base=pathlib.Path(sys.argv[1]); destination=pathlib.Path(sys.argv[2])
record=json.loads((base/'static-media-inputs.json').read_text())
for row in record['source_inputs']:
    source=base/row['file']; h=hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    if h.hexdigest()!=row['sha256'] or source.stat().st_size!=row['bytes']: raise ValueError('Build input mismatch: '+str(source))
    root=destination/row['component']; root.mkdir(exist_ok=True)
    marker=root/'.verified-input-sha256'
    if marker.exists():
        if marker.read_text().strip()!=row['sha256']: raise ValueError('Existing extracted source has a different input hash')
        continue
    with tarfile.open(source,'r:gz') as archive:
        members=archive.getmembers()
        parts={pathlib.PurePosixPath(m.name).parts[0] for m in members if pathlib.PurePosixPath(m.name).parts}
        if len(parts)!=1: raise ValueError('Expected single source root: '+str(source))
        for member in members:
            pieces=pathlib.PurePosixPath(member.name).parts
            if len(pieces)<2: continue
            member.name=str(pathlib.PurePosixPath(*pieces[1:]))
            if member.issym() or member.islnk():
                # Source symlinks are handled by the safe extraction filter, never followed outside root.
                pass
            archive.extract(member,path=root,filter='data')
    marker.write_text(row['sha256']+'\n')
    print('EXTRACTED verified '+row['component'],flush=True)
PY
cat > "$work/mingw-toolchain.cmake" <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER $cross-gcc)
set(CMAKE_CXX_COMPILER $cross-g++)
set(CMAKE_RC_COMPILER $cross-windres)
set(CMAKE_FIND_ROOT_PATH "$prefix" /usr/$cross)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
set(CMAKE_INSTALL_PREFIX "$prefix" CACHE PATH "" FORCE)
EOF
cmake_common=(-G Ninja "-DCMAKE_TOOLCHAIN_FILE=$work/mingw-toolchain.cmake" "-DCMAKE_INSTALL_PREFIX=$prefix" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_C_FLAGS_RELEASE='-O2 -DNDEBUG -g0' -DCMAKE_CXX_FLAGS_RELEASE='-O2 -DNDEBUG -g0')
step() {
  local name="$1"; shift
  if test -f "$work/stamps/$name"; then echo "SKIP completed $name"; return; fi
  echo "BUILD $name $(date -u +%FT%TZ)"
  local status
  set +e
  ( set -e; "$@" ) > "$work/logs/$name.log" 2>&1
  status=$?
  set -e
  if test "$status" -ne 0; then echo "FAILED $name"; tail -70 "$work/logs/$name.log"; return "$status"; fi
  date -u +%FT%TZ > "$work/stamps/$name"
  echo "DONE $name $(date -u +%FT%TZ)"
}
build_zlib() {
  cd "$work/src/zlib"
  make -f win32/Makefile.gcc PREFIX="$cross-" -j"$jobs" libz.a
  install -m644 libz.a "$prefix/lib/libz.a"
  install -m644 zlib.h zconf.h "$prefix/include/"
  local version; version="$(sed -n 's/^#define ZLIB_VERSION "\([^"]*\)"/\1/p' zlib.h)"
  cat > "$prefix/lib/pkgconfig/zlib.pc" <<EOF
prefix=$prefix
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: zlib
Description: zlib static compression library
Version: $version
Libs: -L\${libdir} -lz
Cflags: -I\${includedir}
EOF
}
build_x264() {
  mkdir -p "$work/build/x264"; cd "$work/build/x264"
  "$work/src/x264/configure" --prefix="$prefix" --host="$cross" --cross-prefix="$cross-" --enable-static --disable-cli --disable-opencl --bit-depth=all
  make -j"$jobs"; make install
  cp config.mak "$work/evidence/x264-config.mak"
}
build_x265() {
  cmake -S "$work/src/x265/source" -B "$work/build/x265" "${cmake_common[@]}" -DENABLE_SHARED=OFF -DENABLE_CLI=OFF -DHIGH_BIT_DEPTH=ON -DMAIN12=OFF -DEXPORT_C_API=ON -DENABLE_ASSEMBLY=ON -DENABLE_LIBNUMA=OFF -DENABLE_HDR10_PLUS=OFF
  cmake --build "$work/build/x265" --parallel "$jobs"; cmake --install "$work/build/x265"
  cp "$work/build/x265/CMakeCache.txt" "$work/evidence/x265-CMakeCache.txt"
}
build_svtav1() {
  cmake -S "$work/src/svtav1" -B "$work/build/svtav1" "${cmake_common[@]}" -DBUILD_APPS=OFF -DBUILD_TESTING=OFF -DENABLE_LTO=OFF
  cmake --build "$work/build/svtav1" --parallel "$jobs"; cmake --install "$work/build/svtav1"
  cp "$work/build/svtav1/CMakeCache.txt" "$work/evidence/svtav1-CMakeCache.txt"
}
build_vpx() {
  mkdir -p "$work/build/libvpx"; cd "$work/build/libvpx"
  CROSS="$cross-" "$work/src/libvpx/configure" --prefix="$prefix" --target=x86_64-win64-gcc --enable-static --disable-shared --enable-vp9-highbitdepth --enable-runtime-cpu-detect --disable-examples --disable-tools --disable-docs --disable-unit-tests --disable-webm-io --disable-libyuv
  make -j"$jobs"; make install
  cp config.mk "$work/evidence/libvpx-config.mk"
}
build_opus() {
  cmake -S "$work/src/opus" -B "$work/build/opus" "${cmake_common[@]}" -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_INSTALL_PKG_CONFIG_MODULE=ON -DOPUS_INSTALL_CMAKE_CONFIG_MODULE=ON
  cmake --build "$work/build/opus" --parallel "$jobs"; cmake --install "$work/build/opus"
  cp "$work/build/opus/CMakeCache.txt" "$work/evidence/opus-CMakeCache.txt"
}
build_zimg() {
  cd "$work/src/zimg-3.0.6"; if ! test -f configure; then autoreconf -fiv; fi
  mkdir -p "$work/build/zimg"; cd "$work/build/zimg"
  "$work/src/zimg-3.0.6/configure" --prefix="$prefix" --host="$cross" --enable-static --disable-shared
  make -j"$jobs"; make install
  cp config.log "$work/evidence/zimg-config.log"
}
build_nvheaders() { make -C "$work/src/nv-codec-headers" PREFIX="$prefix" install; }
build_ffmpeg() {
  mkdir -p "$work/build/ffmpeg/fftools/resources"; cd "$work/build/ffmpeg"
  if ! test -f ffbuild/config.mak; then
  "$work/src/ffmpeg/configure" --prefix="$prefix" --arch=x86_64 --target-os=mingw32 --enable-cross-compile --cross-prefix="$cross-" --ld="$cross-g++" --enable-gpl --enable-version3 --enable-static --disable-shared --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay --enable-libx264 --enable-libx265 --enable-libsvtav1 --enable-libvpx --enable-libopus --enable-libzimg --enable-zlib --enable-ffnvcodec --enable-nvenc --disable-cuda-llvm --disable-cuvid --disable-nvdec --disable-indevs --enable-indev=lavfi --disable-outdevs --disable-pthreads --enable-w32threads --pkg-config=pkg-config --pkg-config-flags=--static --extra-cflags="-O2 -g0 -I$prefix/include" --extra-cxxflags="-O2 -g0 -I$prefix/include" --extra-ldflags="-L$prefix/lib -static -static-libgcc -static-libstdc++" --extra-libs='-lstdc++ -lwinpthread -lws2_32'
  fi
  cp config.h ffbuild/config.mak ffbuild/config.log "$work/evidence/"
  make -j"$jobs" ffmpeg.exe ffprobe.exe
  "$cross-strip" ffmpeg.exe ffprobe.exe
  mkdir -p "$repo/out/static-media-win/candidate"
  install -m755 ffmpeg.exe ffprobe.exe "$repo/out/static-media-win/candidate/"
  "$cross-objdump" -p ffmpeg.exe > "$work/evidence/ffmpeg-pe-imports.txt"
  "$cross-objdump" -p ffprobe.exe > "$work/evidence/ffprobe-pe-imports.txt"
}
step zlib build_zlib
step x264 build_x264
step x265 build_x265
step svtav1 build_svtav1
step libvpx build_vpx
step opus build_opus
step zimg build_zimg
step nv-codec-headers build_nvheaders
step ffmpeg build_ffmpeg
cp -a "$work/evidence" "$repo/out/static-media-win/"
cp -a "$work/logs" "$repo/out/static-media-win/"
echo "BUILD COMPLETE $(date -u +%FT%TZ) candidate=$repo/out/static-media-win/candidate"
