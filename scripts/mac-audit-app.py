#!/usr/bin/env python3
"""Read-only whole Electron app audit; never executes or changes app contents.

Imports the frozen media audit without changing it. Apple's otool-classic
interprets trailing '(GPU)' style helper names as archive member syntax, so
those inspection calls read the exact original file through stdin /dev/fd/0.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import time


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def main():
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-media', type=Path, default=project / 'resources/media/darwin-arm64')
    parser.add_argument('--audit-recipe', type=Path, default=project / 'scripts/mac-media/recipes/audit_runtime.py')
    parser.add_argument('--max-macos', default='14.0')
    args = parser.parse_args()
    app = args.app.resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        parser.error('output must be fresh')
    if app.suffix != '.app' or not app.is_dir():
        parser.error('--app must be an existing .app directory')
    source_media = args.source_media.resolve(strict=True)
    if output.is_relative_to(app) or output.is_relative_to(source_media):
        parser.error('--output must stay outside the audited app and source media payload')
    recipe = args.audit_recipe.resolve(strict=True)
    spec = importlib.util.spec_from_file_location('frozen_media_audit', recipe)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    recipe_sha = sha(recipe)
    original_command = module.command
    adaptations = []

    def command(argv, timeout=30):
        if argv[0] != '/usr/bin/otool' or not argv[-1].endswith(')'):
            return original_command(argv, timeout)
        started = time.monotonic()
        actual = argv[:-1] + ['/dev/fd/0']
        record = {'argv': argv, 'actual_argv': actual, 'stdin_source': argv[-1],
                  'method': 'Original file opened read-only; fd avoids otool archive-member filename interpretation'}
        try:
            with Path(argv[-1]).open('rb') as source:
                result = subprocess.run(actual, stdin=source, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=timeout,
                                        check=False, env=dict(os.environ, LC_ALL='C'))
            record.update(returncode=result.returncode,
                          stdout=result.stdout.decode('utf-8', 'replace'),
                          stderr=result.stderr.decode('utf-8', 'replace'))
        except (OSError, subprocess.TimeoutExpired) as exc:
            record.update(returncode=None, error=str(exc))
        record['elapsed_seconds'] = round(time.monotonic() - started, 6)
        adaptations.append({'argv': argv, 'actual_argv': actual, 'returncode': record['returncode']})
        return record

    module.command = command
    required = ['Contents/Resources/media/ffmpeg', 'Contents/Resources/media/ffprobe']
    audit = module.Audit(app, args.max_macos, required)
    started = time.monotonic()
    try:
        source_manifest = source_media / 'runtime-manifest.json'
        source_digest_before = sha(source_manifest)
        manifest = json.loads(source_manifest.read_bytes())
        audit.scan()
        audit.dependencies()
        audit.finish()
        if sha(recipe) != recipe_sha:
            audit.error('frozen audit recipe changed while auditing')
        bundled_media = app / 'Contents/Resources/media'
        bundled_digest = sha(bundled_media / 'runtime-manifest.json')
        if source_digest_before != bundled_digest or sha(source_manifest) != source_digest_before:
            audit.error('source and bundled manifest bytes differ or source changed during audit')
        if (manifest.get('status'), manifest.get('platform'), manifest.get('architecture')) != ('passed', 'darwin', 'arm64'):
            audit.error('source runtime manifest is not passed darwin arm64')
        if set(manifest.get('binaries', {})) != {'ffmpeg', 'ffprobe'}:
            audit.error('manifest must pin exactly ffmpeg and ffprobe')
        pin_results = []
        for name in ['ffmpeg', 'ffprobe']:
            pin = manifest['binaries'][name]
            record = {'name': name, 'manifest_pin': pin}
            for key, directory in [('source', source_media), ('bundled', bundled_media)]:
                path = directory / name
                record[key] = {'bytes': path.stat().st_size, 'sha256': sha(path),
                               'regular_not_symlink': path.is_file() and not path.is_symlink(),
                               'executable': bool(path.stat().st_mode & 0o111)}
                value = record[key]
                if (value['bytes'], value['sha256']) != (pin['bytes'], pin['sha256']) or not value['regular_not_symlink'] or not value['executable']:
                    audit.error('tool does not match regular executable manifest pin', tool=name, location=key)
            pin_results.append(record)
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        declared_minimum = info.get('LSMinimumSystemVersion')
        if not isinstance(declared_minimum, str) or module.vkey(declared_minimum) != module.vkey(args.max_macos):
            audit.error('app minimum does not match requested floor', value=declared_minimum)
        observed = audit.report.get('max_observed_macos_floor')
        if observed is None or module.vkey(observed) > module.vkey(declared_minimum):
            audit.error('app minimum does not cover all Mach-O deployment floors')
        audit.report['media_provenance'] = {
            'source_manifest_sha256': source_digest_before,
            'bundled_manifest_sha256': bundled_digest,
            'exact_manifest_bytes_equal': source_digest_before == bundled_digest,
            'tools': pin_results}
        audit.report['app_declaration'] = {'bundle_identifier': info.get('CFBundleIdentifier'),
            'bundle_version': info.get('CFBundleVersion'), 'minimum_macos': declared_minimum,
            'covers_observed_macho_floors': observed is not None and module.vkey(observed) <= module.vkey(declared_minimum)}
    except Exception as exc:
        audit.error('app audit interrupted by unexpected exception', detail=repr(exc))
    audit.report['status'] = 'passed' if not audit.report['errors'] else 'failed'
    audit.report['finished_utc'] = module.utc()
    audit.report['elapsed_seconds'] = round(time.monotonic() - started, 6)
    audit.report['audit_script_sha256'] = recipe_sha
    audit.report['app_audit_driver_sha256'] = sha(Path(__file__).resolve())
    audit.report['otool_filename_adaptations'] = adaptations
    audit.report['limits'].append('Ad hoc strict signatures and declared macOS 14.0 floors do not establish notarization, Gatekeeper acceptance, or runtime operation on older macOS.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        json.dump(audit.report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'status': audit.report['status'], 'mach_o_count': audit.report.get('mach_o_count'),
        'max_observed_macos_floor': audit.report.get('max_observed_macos_floor'),
        'internal_edges': audit.report.get('internal_edge_count'), 'system_edges': audit.report.get('system_edge_count'),
        'symlinks': audit.report.get('symlink_count'), 'errors': audit.report['errors'],
        'report_sha256': sha(output), 'output': str(output)}))
    return 0 if audit.report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
