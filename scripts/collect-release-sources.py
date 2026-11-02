"""Create and independently read back a deterministic corresponding-source archive.

Inputs must already be downloaded and identified by the platform provenance.
The app snapshot uses committed tracked files only. Native binaries, private
projects, node_modules, caches and user footage never enter the archive.
"""
from pathlib import Path, PurePosixPath
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[1]

def sha_file(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            digest.update(chunk)
    return digest.hexdigest()

def safe_relative(value):
    path=PurePosixPath(value)
    if path.is_absolute() or any(part in ('..','.') for part in path.parts) or '\\' in value:
        raise ValueError('Unsafe source path: '+value)
    return path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--platform',required=True,choices=['win32-x64','darwin-arm64'])
    parser.add_argument('--input-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'out/corresponding-source')
    args=parser.parse_args()
    source_root=args.input_root.resolve(strict=True)
    output=args.output.resolve()
    output.mkdir(parents=True,exist_ok=True)
    provenance=ROOT/'resources/media'/args.platform/'runtime-manifest.json'
    record=json.loads(provenance.read_text(encoding='utf-8'))
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    entries=[]
    for relative in filter(None,tracked):
        rel=safe_relative(relative)
        if rel.parts[0] in ('node_modules','out','dist','media','exports') or relative.startswith('resources/media/'):
            continue
        path=ROOT/relative
        if path.is_symlink() or not path.is_file():
            raise ValueError('Application source must be a regular file: '+relative)
        committed=subprocess.check_output(['git','show',revision+':'+relative],cwd=ROOT)
        if hashlib.sha256(committed).hexdigest()!=sha_file(path):
            raise ValueError('Tracked application source differs from release commit: '+relative)
        entries.append(('application/'+str(rel),path,sha_file(path)))
    source_rows=record.get('source_inputs')
    if not isinstance(source_rows,list) or not source_rows:
        raise ValueError('Platform runtime must identify source_inputs')
    for row in source_rows:
        rel=safe_relative(row['file'])
        path=(source_root/str(rel)).resolve(strict=True)
        if source_root not in path.parents or not path.is_file() or path.is_symlink():
            raise ValueError('Source input must remain inside input-root')
        if sha_file(path)!=row['sha256']:
            raise ValueError('Source input digest mismatch: '+str(rel))
        entries.append(('native-sources/'+str(rel),path,row['sha256']))
    for folder in (ROOT/'assets/licenses',ROOT/'resources/media'/args.platform/'licenses'):
        if folder.exists():
            prefix='notices/'+('application' if folder.parent.name=='assets' else args.platform)
            for file in folder.rglob('*'):
                if file.is_file() and not file.is_symlink():
                    entries.append((prefix+'/'+file.relative_to(folder).as_posix(),file,sha_file(file)))
    entries.append(('media-runtime-manifest.json',provenance,sha_file(provenance)))
    names=[name for name,_,_ in entries]
    if len(names)!=len(set(names)):
        raise ValueError('Duplicate archive path')
    manifest=dict(schema_version=1,application_revision=revision,platform=args.platform,
                  media_binaries=record.get('binaries'),source_inputs=source_rows,
                  native_source_build_overrides=record.get('native_source_build_overrides',[]),
                  files=[dict(file=name,bytes=file.stat().st_size,sha256=digest) for name,file,digest in sorted(entries)],
                  scope='Committed application and matching native media sources; no user footage or native binaries.')
    manifest_bytes=(json.dumps(manifest,indent=2)+'\n').encode()
    archive=output/f'StopMotionForHumanity-{args.platform}-corresponding-source.tar.gz'
    temporary=archive.with_suffix(archive.suffix+'.partial')
    with temporary.open('wb') as raw:
        with gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='') as compressed:
            with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as package:
                for name,file,digest in sorted(entries):
                    info=tarfile.TarInfo(name);info.size=file.stat().st_size;info.mode=0o644;info.mtime=0
                    with file.open('rb') as stream:
                        package.addfile(info,stream)
                info=tarfile.TarInfo('SOURCE-MANIFEST.json');info.size=len(manifest_bytes);info.mode=0o644;info.mtime=0
                package.addfile(info,io.BytesIO(manifest_bytes))
        raw.flush()
        import os
        os.fsync(raw.fileno())
    expected={name:digest for name,_,digest in entries}
    expected['SOURCE-MANIFEST.json']=hashlib.sha256(manifest_bytes).hexdigest()
    seen=set()
    with tarfile.open(temporary,'r|gz') as package:
        for member in package:
            safe_relative(member.name)
            if not member.isfile() or member.name in seen or member.name not in expected:
                raise ValueError('Unexpected source archive entry: '+member.name)
            stream=package.extractfile(member);digest=hashlib.sha256()
            for chunk in iter(lambda:stream.read(1024*1024),b''):
                digest.update(chunk)
            if digest.hexdigest()!=expected[member.name]:
                raise ValueError('Archive readback mismatch: '+member.name)
            seen.add(member.name)
    if seen!=set(expected):
        raise ValueError('Source archive inventory mismatch')
    # Reading through EOF forces gzip footer/CRC verification independently.
    with gzip.open(temporary,'rb') as stream:
        while stream.read(4*1024*1024):
            pass
    temporary.replace(archive)
    receipt=dict(file=archive.name,bytes=archive.stat().st_size,sha256=sha_file(archive),
                 application_revision=revision,entries_verified=len(seen),source_inputs=len(source_rows),
                 full_readback=True,gzip_crc_verified=True)
    (output/(archive.name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt))

if __name__=='__main__':
    main()
