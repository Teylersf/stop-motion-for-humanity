#!/usr/bin/env python3
"""Prepare a fresh, offline Mac media build from verified archives and recipes.

Does not download, build, sign, install globally, or modify app resources.
The CMake archive is a private build tool and is never copied into the runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PROVENANCE = REPO / 'docs/validation/mac-native-media-build.json'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def verify(path, record):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected a regular archive: ' + path.name)
    if path.stat().st_size != record['bytes'] or digest(path) != record['sha256']:
        raise ValueError('Archive size or SHA256 mismatch: ' + path.name)


def unpack(archive_path, destination, expected_root):
    with tarfile.open(archive_path) as archive:
        roots = set()
        for member in archive.getmembers():
            name = member.name.removeprefix('./')
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name:
                raise ValueError('Unsafe archive entry: ' + member.name)
            if path.parts:
                roots.add(path.parts[0])
        if roots != {expected_root}:
            raise ValueError('Unexpected archive root: ' + archive_path.name)
        archive.extractall(destination, filter='data')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root', type=Path, required=True, help='Flat directory containing all ten pinned source archives')
    parser.add_argument('--cmake-tool-archive', type=Path, required=True, help='Verified upstream universal CMake build-tool tar.gz')
    parser.add_argument('--work-root', type=Path, required=True, help='New private directory; existing paths are refused')
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        parser.error('Use Python3.12 or newer for safe tar extraction')
    inputs = args.input_root.resolve(strict=True)
    tool = args.cmake_tool_archive.absolute()
    work = args.work_root.absolute()
    if work.exists() or work.is_symlink():
        parser.error('--work-root must be new; no existing projects are overwritten')
    provenance = json.loads(PROVENANCE.read_text())
    sources = provenance['source_inputs']
    for row in sources:
        if Path(row['archive']).name != row['archive']:
            raise ValueError('Source archive must be a flat basename')
        verify(inputs / row['archive'], row)
    tool_record = provenance['private_build_tool']['cmake']
    verify(tool, tool_record)
    for row in provenance['recipes']:
        path = REPO / row['file']
        verify(path, row)
    work.mkdir(parents=True)
    receipt = {'schema_version': 1, 'status': 'preparing', 'scope': 'Offline preparation only; no compiler, media binary, app or camera is executed.', 'source_inputs': [], 'recipes': []}
    receipt_path = work / 'preparation-receipt.json'
    try:
        for directory in ['sources', 'recipes', 'build', 'prefix', 'evidence', 'tools']:
            (work / directory).mkdir()
        for row in sources:
            dst = work / 'sources' / row['archive']
            shutil.copyfile(inputs / row['archive'], dst)
            verify(dst, row)
            unpack(dst, work / 'sources', row['unpack_directory'])
            receipt['source_inputs'].append({'archive': row['archive'], 'sha256': row['sha256']})
        for row in provenance['recipes']:
            dst = work / 'recipes' / Path(row['file']).name
            shutil.copyfile(REPO / row['file'], dst)
            verify(dst, row)
            receipt['recipes'].append({'file': 'recipes/' + dst.name, 'sha256': row['sha256']})
        copied_tool = work / 'tools' / tool_record['archive']
        shutil.copyfile(tool, copied_tool)
        verify(copied_tool, tool_record)
        unpack(copied_tool, work / 'tools', 'cmake-4.4.5-macos-universal')
        (work / 'evidence/source-inputs.json').write_text(json.dumps({'schema_version': 1, 'sources': sources}, indent=2) + '\n')
        (work / 'evidence/build-tools.json').write_text(json.dumps({'schema_version': 1, 'cmake': tool_record}, indent=2) + '\n')
        receipt.update(status='prepared', target='darwin-arm64', minimum_macos='14.0', cmake_role='build-tool-only-never-shipped')
    except BaseException as error:
        receipt.update(status='failed', error=str(error))
        raise
    finally:
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': 'prepared', 'source_archives': len(sources), 'recipes': len(provenance['recipes']), 'next_command': 'python3 recipes/build_media.py'}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
