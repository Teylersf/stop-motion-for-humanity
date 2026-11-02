#!/usr/bin/env python3
"""Read-only Mach-O, dependency, deployment, hash, and signature audit.

Never executes audited binaries and never changes their signatures or bytes.
Only the requested JSON report is written. Apple shared-cache libraries are
allowed by absolute load path, without claiming their on-disk presence.
"""
import argparse
import hashlib
import json
import os
import stat
import struct
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

THIN = {b'\xcf\xfa\xed\xfe': ('<', 32), b'\xfe\xed\xfa\xcf': ('>', 32), b'\xce\xfa\xed\xfe': ('<', 28), b'\xfe\xed\xfa\xce': ('>', 28)}
FAT = {b'\xca\xfe\xba\xbe': ('>', False), b'\xbe\xba\xfe\xca': ('<', False), b'\xca\xfe\xba\xbf': ('>', True), b'\xbf\xba\xfe\xca': ('<', True)}
LOADS = {0xC: 'LC_LOAD_DYLIB', 0x80000018: 'LC_LOAD_WEAK_DYLIB', 0x8000001F: 'LC_REEXPORT_DYLIB', 0x20: 'LC_LAZY_LOAD_DYLIB', 0x80000023: 'LC_LOAD_UPWARD_DYLIB'}
TOOLS = {'otool': '/usr/bin/otool', 'lipo': '/usr/bin/lipo', 'codesign': '/usr/bin/codesign'}


def utc():
    return datetime.now(timezone.utc).isoformat()


def version(n):
    return '%d.%d.%d' % (n >> 16, (n >> 8) & 255, n & 255)


def vkey(value):
    parts = tuple(int(x) for x in value.split('.'))
    return parts + (0,) * (3 - len(parts))


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def system_path(value):
    return value.startswith('/System/Library/') or value.startswith('/usr/lib/')


def command(argv, timeout=30):
    started = time.monotonic()
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False, env=dict(os.environ, LC_ALL='C'))
        return {'argv': argv, 'returncode': result.returncode, 'stdout': result.stdout.decode('utf-8', 'replace'), 'stderr': result.stderr.decode('utf-8', 'replace'), 'elapsed_seconds': round(time.monotonic() - started, 6)}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'argv': argv, 'returncode': None, 'error': str(exc), 'elapsed_seconds': round(time.monotonic() - started, 6)}


def lc_string(data, pos, size, endian):
    offset = struct.unpack_from(endian + 'I', data, pos + 8)[0]
    if offset < 12 or offset >= size:
        raise ValueError('invalid load-command string offset')
    raw = data[pos + offset:pos + size]
    if b'\0' not in raw:
        raise ValueError('unterminated load-command string')
    return raw.split(b'\0', 1)[0].decode('utf-8', 'strict')


def parse_thin(stream, offset, size):
    stream.seek(offset)
    magic = stream.read(4)
    if magic not in THIN:
        raise ValueError('fat slice is not Mach-O')
    endian, header_size = THIN[magic]
    stream.seek(offset)
    header = stream.read(header_size)
    if len(header) != header_size:
        raise ValueError('truncated Mach-O header')
    cpu, subtype, filetype, ncmds, sizeofcmds = struct.unpack_from(endian + 'IIIII', header, 4)
    if sizeofcmds > 64 * 1024 * 1024 or header_size + sizeofcmds > size:
        raise ValueError('invalid Mach-O load-command extent')
    data = stream.read(sizeofcmds)
    if len(data) != sizeofcmds:
        raise ValueError('truncated load commands')
    record = {'architecture': {0x100000C: 'arm64', 0x1000007: 'x86_64', 7: 'i386'}.get(cpu, hex(cpu)), 'cpu_type': hex(cpu), 'cpu_subtype': hex(subtype), 'file_type': filetype, 'offset': offset, 'bytes': size, 'deployment': [], 'dependencies': [], 'rpaths': [], 'dylib_id': None}
    pos = 0
    for _ in range(ncmds):
        if pos + 8 > len(data):
            raise ValueError('truncated load-command header')
        cmd, cmdsize = struct.unpack_from(endian + 'II', data, pos)
        if cmdsize < 8 or pos + cmdsize > len(data):
            raise ValueError('invalid load-command size')
        if cmd == 0x32:
            if cmdsize < 24:
                raise ValueError('truncated LC_BUILD_VERSION')
            platform, minimum, sdk, ntools = struct.unpack_from(endian + 'IIII', data, pos + 8)
            if 24 + 8 * ntools > cmdsize:
                raise ValueError('truncated build-tool entries')
            record['deployment'].append({'command': 'LC_BUILD_VERSION', 'platform': platform, 'minimum': version(minimum), 'sdk': version(sdk)})
        elif cmd == 0x24:
            if cmdsize < 16:
                raise ValueError('truncated LC_VERSION_MIN_MACOSX')
            minimum, sdk = struct.unpack_from(endian + 'II', data, pos + 8)
            record['deployment'].append({'command': 'LC_VERSION_MIN_MACOSX', 'platform': 1, 'minimum': version(minimum), 'sdk': version(sdk)})
        elif cmd in LOADS:
            if cmdsize < 24:
                raise ValueError('truncated dylib load command')
            record['dependencies'].append({'command': LOADS[cmd], 'path': lc_string(data, pos, cmdsize, endian)})
        elif cmd == 0xD:
            record['dylib_id'] = lc_string(data, pos, cmdsize, endian)
        elif cmd == 0x8000001C:
            record['rpaths'].append(lc_string(data, pos, cmdsize, endian))
        pos += cmdsize
    if pos != sizeofcmds:
        raise ValueError('load-command byte total mismatch')
    return record


def parse_macho(path):
    file_size = path.stat().st_size
    with path.open('rb') as stream:
        magic = stream.read(4)
        if magic in THIN:
            return [parse_thin(stream, 0, file_size)]
        if magic not in FAT:
            return None
        endian, is64 = FAT[magic]
        count_data = stream.read(4)
        if len(count_data) != 4:
            raise ValueError('truncated fat header')
        count = struct.unpack(endian + 'I', count_data)[0]
        entry_size = 32 if is64 else 20
        if not 1 <= count <= 64:
            raise ValueError('invalid fat slice count')
        table = stream.read(count * entry_size)
        if len(table) != count * entry_size:
            raise ValueError('truncated fat architecture table')
        entries = [struct.unpack_from(endian + ('IIQQII' if is64 else 'IIIII'), table, i * entry_size) for i in range(count)]
        result = []
        for entry in entries:
            cpu, subtype, offset, size = entry[:4]
            if offset < 8 + count * entry_size or size < 28 or offset + size > file_size:
                raise ValueError('invalid fat slice extent')
            item = parse_thin(stream, offset, size)
            if item['cpu_type'] != hex(cpu) or item['cpu_subtype'] != hex(subtype):
                raise ValueError('fat architecture header disagrees with slice')
            result.append(item)
        return result


class Audit:
    def __init__(self, root, maximum, required):
        self.root = root
        self.maximum = maximum
        self.required = required
        self.report = {'schema_version': 1, 'status': 'running', 'started_utc': utc(), 'root': str(root), 'maximum_allowed_macos': maximum, 'expected_architecture': 'arm64', 'required_executables': required, 'scope': 'Read-only complete regular Mach-O scan, direct load-command parser plus otool/lipo, dependency and symlink closure, SHA256 and strict codesign verification. Audited binaries are never executed. Ancillary license files may be populated concurrently and are outside the content-hash inventory.', 'limits': ['Apple /System/Library and /usr/lib absolute loads are allowed without proving shared-cache/on-disk availability.', 'Deployment load commands establish declared floors; no older macOS runtime compatibility test is performed.', 'Only named Mach-O load commands are resolved; runtime dlopen/plugin discovery and statically linked code provenance require separate build/source evidence.'], 'symlinks': [], 'mach_o': [], 'edges': [], 'errors': []}
        self.records = {}
        self.relatives = {}
        self.edge_seen = set()
        self.visited = set()
        self.reached = set()

    def error(self, message, **fields):
        self.report['errors'].append(dict(message=message, **fields))

    def relative(self, path):
        return str(path.relative_to(self.root))

    def scan(self):
        regular_count = 0
        for parent, directories, filenames in os.walk(self.root, followlinks=False):
            for name in sorted(directories + filenames):
                path = Path(parent) / name
                mode = path.lstat().st_mode
                relative = self.relative(path)
                if stat.S_ISLNK(mode):
                    link = {'path': relative, 'target': os.readlink(path)}
                    try:
                        resolved = path.resolve(strict=True)
                        link['resolved'] = str(resolved)
                        link['internal'] = inside(resolved, self.root)
                        if not link['internal']:
                            self.error('symlink resolves outside payload', path=relative)
                    except (OSError, RuntimeError) as exc:
                        link['error'] = str(exc)
                        self.error('unresolved symlink', path=relative, detail=str(exc))
                    self.report['symlinks'].append(link)
                elif stat.S_ISREG(mode):
                    regular_count += 1
                    try:
                        slices = parse_macho(path)
                    except (OSError, ValueError, struct.error, UnicodeError) as exc:
                        self.error('Mach-O parsing failed', path=relative, detail=str(exc))
                        continue
                    if slices is None:
                        continue
                    before = path.stat()
                    record = {'path': relative, 'bytes': before.st_size, 'mode': oct(stat.S_IMODE(mode)), 'sha256': digest(path), 'slices': slices, 'tools': {}}
                    after = path.stat()
                    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                        self.error('Mach-O changed while hashing', path=relative)
                    self.records[path] = record
                    self.relatives[relative] = record
                    self.report['mach_o'].append(record)
                    self.validate_record(path, record)
                elif not stat.S_ISDIR(mode):
                    self.error('unsupported special payload entry', path=relative, mode=oct(mode))
        self.report['regular_file_snapshot_count'] = regular_count
        if not self.records:
            self.error('no Mach-O files found')
        for required in self.required:
            path = self.root / required
            try:
                resolved = path.resolve(strict=True)
                if not inside(resolved, self.root) or resolved not in self.records:
                    self.error('required executable is absent or not an internal Mach-O', path=required)
                elif not resolved.stat().st_mode & 0o111:
                    self.error('required Mach-O lacks execute permission', path=required)
                elif not all(s['file_type'] == 2 for s in self.records[resolved]['slices']):
                    self.error('required executable is not MH_EXECUTE', path=required)
            except (OSError, RuntimeError) as exc:
                self.error('required executable is missing', path=required, detail=str(exc))

    def validate_record(self, path, record):
        relative = record['path']
        architectures = sorted(set(s['architecture'] for s in record['slices']))
        if architectures != ['arm64']:
            self.error('runtime must contain only arm64 slices', path=relative, architectures=architectures)
        for item in record['slices']:
            deployment = item['deployment']
            if not deployment:
                self.error('missing macOS deployment load command', path=relative)
            for target in deployment:
                if target['platform'] != 1:
                    self.error('non-macOS deployment platform', path=relative, target=target)
                if vkey(target['minimum']) > vkey(self.maximum):
                    self.error('deployment floor exceeds maximum', path=relative, target=target)
            install_id = item['dylib_id']
            if install_id and not install_id.startswith(('@rpath/', '@loader_path/', '@executable_path/')):
                self.error('nonportable dylib install ID', path=relative, install_id=install_id)
        for name, args in [('otool_load_commands', [TOOLS['otool'], '-l', str(path)]), ('otool_dependencies', [TOOLS['otool'], '-L', str(path)]), ('lipo_architectures', [TOOLS['lipo'], '-archs', str(path)]), ('codesign_verify_strict', [TOOLS['codesign'], '--verify', '--strict', '--verbose=2', str(path)]), ('codesign_details', [TOOLS['codesign'], '-dv', '--verbose=4', str(path)])]:
            result = command(args)
            record['tools'][name] = result
            if result['returncode'] != 0:
                self.error('read-only inspection command failed', path=relative, command=name, returncode=result['returncode'])
        lipo = record['tools']['lipo_architectures']
        if lipo['returncode'] == 0 and sorted(lipo['stdout'].split()) != architectures:
            self.error('lipo and direct parser architecture results disagree', path=relative)

    def token_path(self, value, loader, executable):
        if value.startswith('@loader_path/'):
            return Path(os.path.normpath(str(loader.parent / value[len('@loader_path/'):]))), None
        if value.startswith('@executable_path/'):
            return Path(os.path.normpath(str(executable.parent / value[len('@executable_path/'):]))), None
        if value == '@loader_path':
            return loader.parent, None
        if value == '@executable_path':
            return executable.parent, None
        if value.startswith('/'):
            if system_path(value) and os.path.normpath(value) == value:
                return Path(value), 'system'
            return None, 'nonportable absolute path'
        return None, 'unsupported relative/nested-rpath token'

    def rpaths(self, item, loader, executable):
        paths = []
        for value in item['rpaths']:
            path, kind = self.token_path(value, loader, executable)
            if path is None or (kind != 'system' and not inside(path, self.root)):
                self.error('nonportable or external LC_RPATH', path=self.relative(loader), rpath=value, context=self.relative(executable), detail=kind)
            else:
                paths.append((path, kind))
        return paths

    def resolve(self, value, loader, executable, rpaths):
        if value.startswith('@rpath/'):
            tail = value[len('@rpath/'):]
            candidates = [(Path(os.path.normpath(str(base / tail))), kind) for base, kind in rpaths]
        else:
            path, kind = self.token_path(value, loader, executable)
            if path is None:
                return None, kind, []
            candidates = [(path, kind)]
        found = {}
        attempts = []
        for path, kind in candidates:
            attempts.append(str(path))
            if kind == 'system' and system_path(str(path)):
                found[str(path)] = (path, 'system')
            elif inside(path, self.root):
                try:
                    target = path.resolve(strict=True)
                    if not inside(target, self.root):
                        return None, 'dependency symlink escapes payload', attempts
                    if target.is_file():
                        found[str(target)] = (target, 'internal')
                except (OSError, RuntimeError):
                    pass
            else:
                return None, 'dependency token resolves outside payload', attempts
        if not found:
            return None, 'dependency does not resolve', attempts
        if len(found) != 1:
            return None, 'multiple distinct dependency candidates', attempts
        path, kind = next(iter(found.values()))
        return path, kind, attempts

    def walk_dependencies(self, loader, architecture, executable, inherited=()):
        record = self.records[loader]
        item = next((s for s in record['slices'] if s['architecture'] == architecture), None)
        if item is None:
            self.error('dependency lacks required architecture', path=self.relative(loader), architecture=architecture)
            return
        search = []
        for entry in self.rpaths(item, loader, executable) + list(inherited):
            if entry not in search:
                search.append(entry)
        key = (loader, architecture, executable, tuple(search))
        if key in self.visited:
            return
        self.visited.add(key)
        self.reached.add(loader)
        for dep in item['dependencies']:
            target, kind, attempts = self.resolve(dep['path'], loader, executable, search)
            edge = {'loader': self.relative(loader), 'architecture': architecture, 'executable_context': self.relative(executable), 'command': dep['command'], 'load_path': dep['path'], 'resolution': kind, 'candidates': attempts}
            if target is not None:
                edge['target'] = str(target) if kind == 'system' else self.relative(target)
            edge_key = json.dumps(edge, sort_keys=True)
            if edge_key not in self.edge_seen:
                self.report['edges'].append(edge)
                self.edge_seen.add(edge_key)
            if kind not in ('system', 'internal'):
                self.error('unresolved/nonportable load command', **edge)
            elif kind == 'internal':
                if target not in self.records:
                    self.error('internal dependency is not a scanned Mach-O', **edge)
                else:
                    self.walk_dependencies(target, architecture, executable, search)

    def dependencies(self):
        executables = [(path, item['architecture']) for path, record in self.records.items() for item in record['slices'] if item['file_type'] == 2]
        for executable, architecture in executables:
            self.walk_dependencies(executable, architecture, executable)
        # Unreferenced dylibs are still checked. The file itself supplies a
        # conservative standalone context; context-dependent leftovers fail.
        for path, record in self.records.items():
            if path not in self.reached:
                for item in record['slices']:
                    self.walk_dependencies(path, item['architecture'], path)
        self.report['executable_context_count'] = len(executables)

    def finish(self):
        for path, record in self.records.items():
            try:
                record['sha256_after_audit'] = digest(path)
                if record['sha256_after_audit'] != record['sha256']:
                    self.error('Mach-O bytes changed during audit', path=record['path'])
            except OSError as exc:
                self.error('Mach-O unavailable at final hash', path=record['path'], detail=str(exc))
        framework_paths = sorted((p for p in self.root.rglob('*.framework') if p.is_dir() and not p.is_symlink()), key=lambda p: len(p.parts), reverse=True)
        bundle_paths = framework_paths + ([self.root] if self.root.suffix == '.app' else [])
        self.report['bundle_signature_checks'] = []
        for path in bundle_paths:
            result = command([TOOLS['codesign'], '--verify', '--deep', '--strict', '--verbose=2', str(path)])
            self.report['bundle_signature_checks'].append({'path': str(path), 'result': result})
            if result['returncode'] != 0:
                self.error('bundle deep strict signature verification failed', path=str(path))
        floors = [d['minimum'] for r in self.records.values() for s in r['slices'] for d in s['deployment'] if d['platform'] == 1]
        self.report['max_observed_macos_floor'] = max(floors, key=vkey) if floors else None
        self.report['mach_o_count'] = len(self.records)
        self.report['mach_o_bytes'] = sum(r['bytes'] for r in self.records.values())
        self.report['symlink_count'] = len(self.report['symlinks'])
        self.report['internal_edge_count'] = sum(e['resolution'] == 'internal' for e in self.report['edges'])
        self.report['system_edge_count'] = sum(e['resolution'] == 'system' for e in self.report['edges'])
        self.report['unique_system_loads'] = sorted(set(e['target'] for e in self.report['edges'] if e['resolution'] == 'system'))
        self.report['finished_utc'] = utc()
        self.report['status'] = 'passed' if not self.report['errors'] else 'failed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--max-macos', default='14.0')
    parser.add_argument('--require', action='append', dest='required', help='Required relative executable; default ffmpeg and ffprobe')
    args = parser.parse_args()
    vkey(args.max_macos)
    root = args.root.resolve(strict=True)
    if not root.is_dir():
        parser.error('--root must be a directory')
    output = args.output.resolve()
    if output.exists():
        parser.error('--output must be fresh; refusing to replace prior evidence')
    required = args.required or ['ffmpeg', 'ffprobe']
    for value in required:
        if Path(value).is_absolute() or '..' in Path(value).parts:
            parser.error('--require must stay relative to root')
    audit = Audit(root, args.max_macos, required)
    started = time.monotonic()
    try:
        audit.scan()
        audit.dependencies()
        audit.finish()
    except Exception as exc:
        audit.error('audit interrupted by unexpected exception', detail=repr(exc))
        audit.report['status'] = 'failed'
        audit.report['finished_utc'] = utc()
    audit.report['elapsed_seconds'] = round(time.monotonic() - started, 6)
    audit.report['audit_script_sha256'] = digest(Path(__file__).resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        json.dump(audit.report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'status': audit.report['status'], 'mach_o_count': audit.report.get('mach_o_count'), 'max_observed_macos_floor': audit.report.get('max_observed_macos_floor'), 'error_count': len(audit.report['errors']), 'output': str(output)}))
    return 0 if audit.report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
