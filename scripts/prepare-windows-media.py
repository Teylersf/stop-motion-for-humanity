"""Copy only the already-audited shared media runtime; record actual hashes.

No downloads, installed-runtime changes or source-tree cleanup are performed.
Usage: python scripts/prepare-windows-media.py --editor /path/to/8k-editor
       --sources /path/to/verified/source-package/contents
"""
from pathlib import Path
import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(part)
    return digest.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--editor', required=True, type=Path)
    parser.add_argument('--sources', required=True, type=Path)
    args = parser.parse_args()
    native = args.editor / 'build/backend/win32/_internal'
    source_root = args.sources.resolve(strict=True)
    source_manifest = json.loads((source_root / 'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
    destination = ROOT / 'resources/media/win32-x64'
    destination.mkdir(parents=True, exist_ok=True)
    required_dlls = ('avcodec-62.dll', 'avdevice-62.dll', 'avfilter-11.dll',
                     'avformat-62.dll', 'avutil-60.dll', 'swresample-6.dll', 'swscale-9.dll')
    binary_inputs = [(native / 'bin' / name) for name in ('ffmpeg.exe', 'ffprobe.exe')]
    binary_inputs += [native / 'av.libs' / name for name in required_dlls]
    audited_binaries = json.loads((native / 'licenses/native/ffmpeg/runtime-provenance.json').read_text(encoding='utf-8'))['cli_files']
    for source in binary_inputs:
        target = destination / source.name
        if not source.is_file():
            raise RuntimeError(f'Missing audited runtime input: {source}')
        if sha(source) != audited_binaries.get(source.name):
            raise RuntimeError(f'Audited binary digest did not match: {source.name}')
        if not target.exists() or sha(source) != sha(target):
            shutil.copyfile(source, target)
        if sha(source) != sha(target):
            raise RuntimeError(f'Copy verification failed: {source.name}')
    notices = destination / 'licenses'
    notices.mkdir(exist_ok=True)
    for folder in (native / 'licenses/native/ffmpeg', native / 'licenses/release-notices/ffmpeg-windows',
                   native / 'licenses/release-notices/llvm-mingw-20261020'):
        if folder.is_dir():
            shutil.copytree(folder, notices / folder.name, dirs_exist_ok=True)
    binaries = []
    handle = os.add_dll_directory(str(destination)) if os.name == 'nt' else None
    try:
        for source in binary_inputs:
            target = destination / source.name
            row = dict(file=target.name, bytes=target.stat().st_size, sha256=sha(target))
            if target.suffix == '.dll':
                library = ctypes.CDLL(str(target))
                component = target.name.split('-')[0]
                for suffix, key in (('license', 'license'), ('configuration', 'configuration')):
                    function = getattr(library, f'{component}_{suffix}')
                    function.restype = ctypes.c_char_p
                    row[key] = function().decode('utf-8')
                if not row['license'].startswith('LGPL') or '--enable-nonfree' in row['configuration']:
                    raise RuntimeError(f'Unexpected native license/configuration: {target.name}')
                if '--enable-gpl' in row['configuration']:
                    raise RuntimeError(f'Unexpected GPL-enabled replacement: {target.name}')
            binaries.append(row)
    finally:
        if handle:
            handle.close()
    sources = []
    for original in source_manifest['sources']:
        # PyAV source is included only as provenance of original vendor libraries;
        # neither PyAV nor Python is bundled in this application.
        source = (source_root / original['file']).resolve(strict=True)
        if source_root not in source.parents or sha(source) != original['sha256']:
            raise RuntimeError(f'Corresponding source integrity failed: {original["file"]}')
        sources.append({key: original.get(key) for key in
                       ('component', 'revision', 'license', 'file', 'url', 'sha256', 'bytes')})
    buildconf = subprocess.check_output([str(destination / 'ffmpeg.exe'), '-hide_banner', '-buildconf'],
                                       stderr=subprocess.STDOUT, text=True)
    (destination / 'ffmpeg-original-buildconf.txt').write_text(buildconf, encoding='utf-8')
    record = dict(schema_version=1, platform='win32-x64',
                  ffmpeg_revision=source_manifest['windows_ffmpeg_revision'],
                  binaries=binaries, source_inputs=sources,
                  native_source_build_overrides=source_manifest['native_source_build_overrides'],
                  scope='Only standalone shared media tools; no Python, Torch, CUDA SDK or user media.',
                  source_distribution='Matching sources and build recipes are published beside native releases.')
    (destination / 'runtime-manifest.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    provenance = ROOT / 'docs/provenance'
    provenance.mkdir(exist_ok=True)
    (provenance / 'windows-media-runtime.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps(dict(binaries=len(binaries), source_inputs=len(sources),
                          runtime_bytes=sum(row['bytes'] for row in binaries))))

if __name__ == '__main__':
    main()
