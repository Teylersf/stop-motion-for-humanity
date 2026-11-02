"""Audit standalone Windows media binaries, smoke real codecs and collect notices.

Writes only the candidate/output tree. It never installs the runtime into resources/.
"""
from pathlib import Path, PurePosixPath
import argparse
import datetime
import hashlib
import json
import os
import re
import struct
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_DLLS = {
    'advapi32.dll', 'bcrypt.dll', 'cfgmgr32.dll', 'comdlg32.dll', 'crypt32.dll',
    'd3d11.dll', 'd3d12.dll', 'd3d9.dll', 'dxgi.dll', 'dxva2.dll', 'gdi32.dll',
    'kernel32.dll', 'mf.dll', 'mfplat.dll', 'mfreadwrite.dll', 'mfuuid.dll',
    'msvcrt.dll', 'ntdll.dll', 'ole32.dll', 'oleaut32.dll', 'psapi.dll',
    'secur32.dll', 'setupapi.dll', 'shell32.dll', 'shlwapi.dll', 'strmiids.dll',
    'user32.dll', 'userenv.dll', 'uuid.dll', 'version.dll', 'winmm.dll', 'ws2_32.dll',
}

def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def pe_imports(path):
    data = path.read_bytes()
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if data[:2] != b'MZ' or data[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Not a PE executable: ' + str(path))
    machine, sections = struct.unpack_from('<HH', data, pe + 4)
    optional_size = struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    if machine != 0x8664 or struct.unpack_from('<H', data, optional)[0] != 0x20b:
        raise ValueError('Expected PE32+ x64 executable')
    section_table = optional + optional_size
    records = []
    for i in range(sections):
        offset = section_table + i * 40
        virtual_size, virtual_address, raw_size, raw_address = struct.unpack_from('<IIII', data, offset + 8)
        records.append((virtual_address, max(virtual_size, raw_size), raw_address))
    def offset_for(rva):
        for start, size, raw in records:
            if start <= rva < start + size:
                return raw + rva - start
        raise ValueError('PE import RVA outside sections')
    import_rva = struct.unpack_from('<I', data, optional + 120)[0]
    if not import_rva:
        return []
    cursor = offset_for(import_rva)
    result = []
    for _ in range(256):
        entry = struct.unpack_from('<IIIII', data, cursor)
        if not any(entry):
            return sorted(set(result), key=str.lower)
        name_offset = offset_for(entry[3])
        result.append(data[name_offset:data.index(b'\0', name_offset)].decode('ascii'))
        cursor += 20
    raise ValueError('Excessive PE import count')

def run(command, log, *, timeout=180, binary=False):
    env = os.environ.copy()
    if os.name == 'nt':
        system_root = Path(env.get('SystemRoot', r'C:\Windows'))
        env['PATH'] = str(system_root / 'System32')
    result = subprocess.run([str(arg) for arg in command], capture_output=True, timeout=timeout, env=env)
    log.write_bytes(b'COMMAND ' + json.dumps([str(arg) for arg in command]).encode() + b'\nSTDOUT\n' + result.stdout + b'\nSTDERR\n' + result.stderr)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}); see {log}: ' + result.stderr[-3000:].decode('utf-8', 'replace'))
    return result.stdout if binary else result.stdout.decode('utf-8', 'replace')

def collect_licenses(rows, input_root, destination):
    found = []
    pattern = re.compile(r'^(copying|license|notice|patents|copyright)(?:[._-].*)?$', re.I)
    for row in rows:
        archive_path = input_root / row['file']
        if archive_path.stat().st_size != row['bytes'] or sha_file(archive_path) != row['sha256']:
            raise ValueError('Collection input mismatch: ' + str(archive_path))
        with tarfile.open(archive_path, 'r:gz') as archive:
            component_count = 0
            for member in archive:
                if not member.isfile() or member.size > 2_000_000:
                    continue
                parts = PurePosixPath(member.name).parts
                if len(parts) < 2 or not pattern.match(parts[-1]):
                    continue
                relative = PurePosixPath(row['component'], *parts[1:])
                if '..' in relative.parts or relative.is_absolute():
                    raise ValueError('Unsafe license archive entry')
                target = destination / str(relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                content = archive.extractfile(member).read()
                target.write_bytes(content)
                found.append(dict(component=row['component'], file=target.relative_to(destination.parent).as_posix(), sha256=hashlib.sha256(content).hexdigest(), bytes=len(content)))
                component_count += 1
            if not component_count and row['component'] == 'nv-codec-headers':
                for member in archive.getmembers():
                    if not member.isfile() or not member.name.endswith('.h'):
                        continue
                    content = archive.extractfile(member).read(20000)
                    if content.startswith(b'/*') and b'Permission is hereby granted' in content[:content.find(b'*/') + 2]:
                        notice = content[:content.index(b'*/') + 2] + b'\n'
                        target = destination / row['component'] / (PurePosixPath(member.name).name + '-license.txt')
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(notice)
                        found.append(dict(component=row['component'], file=target.relative_to(destination.parent).as_posix(), sha256=hashlib.sha256(notice).hexdigest(), bytes=len(notice), source_header=member.name))
                        component_count += 1
            if not component_count:
                raise ValueError('No upstream license text found: ' + row['component'])
    # Runtime notices from the exact installed cross-compiler packages. GCC's runtime exception
    # and mingw-w64/winpthreads terms are carried verbatim, rather than inferred from filenames.
    if os.name == 'nt':
        for package in ['gcc-mingw-w64-base', 'gcc-mingw-w64-x86-64-posix', 'g++-mingw-w64-x86-64-posix', 'mingw-w64-x86-64-dev', 'mingw-w64-common']:
            result = subprocess.run(['wsl.exe', '-d', 'Ubuntu', '--', 'cat', '/usr/share/doc/' + package + '/copyright'], capture_output=True)
            if result.returncode == 0 and result.stdout:
                target = destination / 'toolchain' / (package + '-copyright.txt')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(result.stdout)
                found.append(dict(component=package, file=target.relative_to(destination.parent).as_posix(), sha256=hashlib.sha256(result.stdout).hexdigest(), bytes=len(result.stdout)))
    return found

def smoke(candidate, output):
    ffmpeg, ffprobe = candidate / 'ffmpeg.exe', candidate / 'ffprobe.exe'
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    cases = [
        ('h264', 'mp4', ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p'], None),
        ('hevc10', 'mkv', ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=2:frame-threads=1:log-level=error', '-crf', '18', '-pix_fmt', 'yuv420p10le'], 'yuv420p10le'),
        ('av1', 'mkv', ['-c:v', 'libsvtav1', '-preset', '12', '-crf', '35', '-svtav1-params', 'lp=2', '-pix_fmt', 'yuv420p10le'], 'yuv420p10le'),
        ('vp9', 'webm', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '35', '-b:v', '0', '-pix_fmt', 'yuv420p10le'], 'yuv420p10le'),
        ('ffv1', 'mkv', ['-c:v', 'ffv1', '-level', '3', '-g', '1', '-slicecrc', '1', '-pix_fmt', 'bgra'], 'bgra'),
        ('prores', 'mov', ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], 'yuv422p10le'),
        ('dnxhr', 'mov', ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx', '-pix_fmt', 'yuv422p10le'], 'yuv422p10le'),
        ('cineform', 'mov', ['-c:v', 'cfhd', '-pix_fmt', 'gbrp12le'], 'gbrp12le'),
        ('jpeg2000', 'mkv', ['-c:v', 'jpeg2000', '-pred', '1', '-pix_fmt', 'rgb48le'], 'rgb48le'),
        ('png16', 'png', ['-c:v', 'png', '-pix_fmt', 'rgb48be', '-frames:v', '1', '-update', '1'], 'rgb48be'),
        ('tiff16', 'tiff', ['-c:v', 'tiff', '-pix_fmt', 'rgb48le', '-frames:v', '1', '-update', '1'], 'rgb48le'),
        ('dpx16', 'dpx', ['-c:v', 'dpx', '-pix_fmt', 'rgb48be', '-frames:v', '1', '-update', '1'], 'rgb48be'),
        ('exr-linear', 'exr', ['-vf', 'format=gbrpf32le,zscale=transferin=iec61966-2-1:transfer=linear:matrixin=gbr:matrix=gbr:primariesin=bt709:primaries=bt709:rangein=full:range=full', '-c:v', 'exr', '-pix_fmt', 'gbrpf32le', '-frames:v', '1', '-update', '1'], 'gbrpf32le'),
    ]
    for name, extension, options, expected_format in cases:
        path = output / (name + '.' + extension)
        command = [ffmpeg, '-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=24', '-frames:v', '2', '-an', '-threads', '2', *options, path]
        run(command, output / (name + '-encode.log'))
        probe = json.loads(run([ffprobe, '-v', 'error', '-show_streams', '-of', 'json', path], output / (name + '-probe.log')))
        video = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
        if (video['width'], video['height']) != (256, 144):
            raise ValueError('Smoke output raster mismatch: ' + name)
        if expected_format and video['pix_fmt'] != expected_format:
            raise ValueError(f'{name} pixel format {video["pix_fmt"]} != {expected_format}')
        run([ffmpeg, '-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-f', 'null', '-'], output / (name + '-decode.log'))
        rows.append(dict(case=name, codec=video['codec_name'], pixel_format=video['pix_fmt'], width=video['width'], height=video['height'], bytes=path.stat().st_size, sha256=sha_file(path), encoded_and_decoded=True))
        print('SMOKE PASS ' + name, flush=True)
    for name, codec, extension in [('aac', 'aac', 'm4a'), ('opus', 'libopus', 'opus')]:
        path = output / (name + '.' + extension)
        run([ffmpeg, '-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.2', '-c:a', codec, '-b:a', '128k', path], output / (name + '-encode.log'))
        probe = json.loads(run([ffprobe, '-v', 'error', '-show_streams', '-of', 'json', path], output / (name + '-probe.log')))
        stream = next(stream for stream in probe['streams'] if stream['codec_type'] == 'audio')
        run([ffmpeg, '-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-f', 'null', '-'], output / (name + '-decode.log'))
        rows.append(dict(case=name, codec=stream['codec_name'], sample_rate=stream['sample_rate'], encoded_and_decoded=True, bytes=path.stat().st_size, sha256=sha_file(path)))
        print('SMOKE PASS ' + name, flush=True)
    reference = run([ffmpeg, '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=24', '-frames:v', '2', '-pix_fmt', 'bgra', '-f', 'rawvideo', '-'], output / 'ffv1-reference.log', binary=True)
    decoded = run([ffmpeg, '-hide_banner', '-v', 'error', '-i', output / 'ffv1.mkv', '-pix_fmt', 'bgra', '-f', 'rawvideo', '-'], output / 'ffv1-roundtrip.log', binary=True)
    if reference != decoded:
        raise ValueError('FFV1 RGBA8 decoded samples differ from the reference')
    rows.append(dict(case='ffv1-exact-roundtrip', bytes_compared=len(reference), sha256=hashlib.sha256(reference).hexdigest(), exact=True))
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'out/static-media-win')
    parser.add_argument('--input-root', type=Path, default=ROOT / 'out/native-inputs')
    parser.add_argument('--skip-smoke', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve(); candidate = output / 'candidate'; evidence = output / 'evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    inputs = json.loads((args.input_root / 'static-media-inputs.json').read_text(encoding='utf-8'))
    binaries = []
    for filename in ['ffmpeg.exe', 'ffprobe.exe']:
        path = candidate / filename
        imports = pe_imports(path)
        unexpected = [name for name in imports if name.lower() not in SYSTEM_DLLS and not name.lower().startswith(('api-ms-win-', 'ext-ms-win-'))]
        if unexpected:
            raise ValueError('Non-system PE imports in ' + filename + ': ' + ', '.join(unexpected))
        binaries.append(dict(file=filename, bytes=path.stat().st_size, sha256=sha_file(path), imports=imports, license='GPL-3.0-or-later'))
    version = run([candidate / 'ffmpeg.exe', '-hide_banner', '-version'], evidence / 'ffmpeg-version.txt')
    configuration = run([candidate / 'ffmpeg.exe', '-hide_banner', '-buildconf'], evidence / 'ffmpeg-buildconf.txt')
    if '--enable-gpl' not in configuration or '--disable-shared' not in configuration or '--disable-network' not in configuration:
        raise ValueError('Candidate does not match the intended standalone GPL/offline configuration')
    encoders = run([candidate / 'ffmpeg.exe', '-hide_banner', '-encoders'], evidence / 'ffmpeg-encoders.txt')
    encoder_names = re.findall(r'^\s*[VAS][A-Z.]{5}\s+(\S+)', encoders, re.M)
    protocols = run([candidate / 'ffmpeg.exe', '-hide_banner', '-protocols'], evidence / 'ffmpeg-protocols.txt')
    if re.search(r'^\s+(?:https?|tcp|udp|tls|rtmp|rtsp)\s*$', protocols, re.M):
        raise ValueError('Unexpected network protocol in offline media runtime')
    notices = collect_licenses(inputs['source_inputs'], args.input_root, candidate / 'licenses')
    rows = [] if args.skip_smoke else smoke(candidate, output / 'smoke')
    configs = {}
    for name in ['toolchain.txt', 'x264-config.mak', 'x265-CMakeCache.txt', 'svtav1-CMakeCache.txt', 'dav1d-buildoptions.json', 'libvpx-config.mk', 'opus-CMakeCache.txt', 'zimg-config.log']:
        path = evidence / name
        if not path.is_file():
            raise ValueError('Missing build evidence: ' + str(path))
        configs[name] = dict(bytes=path.stat().st_size, sha256=sha_file(path), text=path.read_text(encoding='utf-8', errors='replace'))
    if os.name == 'nt':
        packages = subprocess.run(['wsl.exe', '-d', 'Ubuntu', '--exec', 'dpkg-query', '-W', '-f=${Package} ${Version}\n', 'gcc-mingw-w64-base', 'gcc-mingw-w64-x86-64-posix', 'g++-mingw-w64-x86-64-posix', 'mingw-w64-x86-64-dev', 'mingw-w64-common'], capture_output=True, text=True, check=True)
        configs['cross-toolchain-package-versions'] = packages.stdout
    manifest = dict(schema_version=1, platform='win32-x64',
                    ffmpeg_revision='27b8d1a017de62b51c0f3a039327b5cc2d7ea13f',
                    build_kind='standalone-static-gpl-cli', license='GPL-3.0-or-later', binaries=binaries,
                    toolchain_and_component_configs=configs,
                    source_inputs=inputs['source_inputs'], encoders=encoder_names, configuration=configuration,
                    version=version, built_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    native_source_build_overrides=[dict(file='scripts/build-windows-static-media.sh', purpose='Exact offline standalone MinGW static CLI recipe'), dict(file='scripts/prepare-static-media-inputs.py', purpose='Source hash verification and staging'), dict(file='scripts/collect-static-media.py', purpose='PE audit, notices and real codec roundtrip verification')],
                    notices=notices, smoke_tests=rows,
                    notes=['Standalone native CLI only; no PyAV/FFmpeg ABI coupling and no reused DLL payload.',
                           'Windows system DLL imports only; compiler, C++ and winpthreads runtimes linked statically.',
                           'NVIDIA encoder support is optional at runtime and requires compatible installed GPU drivers; software HEVC10 uses x265.',
                           'All source archive hashes verified before extraction and again before notice collection. No network used for inputs.',
                           'x265 is a 10-bit build; x264 supports its all-depth build and VP9/SVT-AV1 support high-bit-depth output. AV1 software decode uses statically linked dav1d.',
                           'This candidate has not been installed into resources/media; root integration review is required.'])
    (candidate / 'runtime-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (output / 'smoke-results.json').write_text(json.dumps(dict(schema_version=1, tests=rows, all_passed=not args.skip_smoke, binaries=binaries), indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(candidate=str(candidate), binaries=binaries, source_inputs=len(inputs['source_inputs']), license_files=len(notices), smoke_checks=len(rows))))

if __name__ == '__main__':
    main()
