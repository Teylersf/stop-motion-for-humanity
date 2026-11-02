"""Stage verified, local-only source inputs for the standalone Windows media CLI."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil

ROOT = Path(__file__).resolve().parents[1]
INPUTS = [
    ('ffmpeg', 'ffmpeg-windows-27b8d1a017de62b51c0f3a039327b5cc2d7ea13f.tar.gz', 'GPL-3.0-or-later'),
    ('x264', 'mac-homebrew-x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz', 'GPL-2.0-or-later'),
    ('x265', 'mac-homebrew-x265-4.3.tar.gz', 'GPL-2.0-or-later'),
    ('libvpx', 'mac-homebrew-libvpx-1.17.0.tar.gz', 'BSD-3-Clause'),
    ('opus', 'mac-homebrew-opus-1.6.1.tar.gz', 'BSD-3-Clause'),
    ('svtav1', 'svtav1-4ae9272b588a05ee6e77a43e8dfdac05f54c4ff0.tar.gz', 'BSD-3-Clause-Clear'),
    ('zlib', 'zlib-9f25df2c80c2b26c8b050fba880f0851d9d243ea.tar.gz', 'Zlib'),
    # The development snapshot omits its graphengine submodule. This complete
    # release has no production submodule dependency and satisfies FFmpeg >=2.7.
    ('zimg-3.0.6', 'mac-homebrew-zimg-3.0.6.tar.gz', 'WTFPL-2.0'),
    ('nv-codec-headers', 'nv-codec-headers-876af32a202d0de83bd1d36fe74ee0f7fcf86b0d.tar.gz', 'MIT'),
]

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(part)
    return value.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path(r'E:\Desktop Apps\8k-lossless-video-editor\out\release-sources\cache'))
    parser.add_argument('--output', type=Path, default=ROOT / 'out/native-inputs')
    args = parser.parse_args()
    target = args.output.resolve()
    (target / 'third-party').mkdir(parents=True, exist_ok=True)
    rows = []
    for component, filename, license_name in INPUTS:
        source = args.cache / filename
        receipt_path = args.cache / (filename + '.receipt.json')
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        expected = receipt['sha256']
        if len(expected) != 64 or source.stat().st_size != receipt['bytes'] or digest(source) != expected:
            raise ValueError(f'Unverified source archive: {source}')
        destination = target / 'third-party' / filename
        if not destination.exists() or destination.stat().st_size != receipt['bytes'] or digest(destination) != expected:
            partial = destination.with_name(destination.name + '.partial')
            with source.open('rb') as incoming, partial.open('wb') as outgoing:
                shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            if digest(partial) != expected:
                raise ValueError(f'Copy readback mismatch: {partial}')
            partial.replace(destination)
        row = dict(component=component, file='third-party/' + filename, url=receipt['url'],
                   sha256=expected, bytes=receipt['bytes'], license=license_name)
        rows.append(row)
        print(component + ': verified ' + expected, flush=True)
    manifest = dict(schema_version=1, platform='win32-x64', source_inputs=rows,
                    network_used=False, scope='Exact cached source archives, verified before copy and on destination readback.')
    (target / 'static-media-inputs.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(inputs=len(rows), bytes=sum(row['bytes'] for row in rows), manifest=str(target / 'static-media-inputs.json'))))

if __name__ == '__main__':
    main()
