#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Package pinned sources/recipes after explicit final proof and fixture-policy checks.

Never copies runtime binaries or the private vendor CMake tool. Original upstream
archives are preserved, including explicitly approved, hash-pinned test fixtures.
No build, download, upload, device or service actions.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
EVIDENCE = ROOT / "evidence"
RELEASE = ROOT / "release-source"
RUNTIME_LICENSES = ROOT / "stage/darwin-arm64/licenses"
FIXED_DATE = (2026, 11, 2, 0, 0, 0)
ARCHIVE_SUFFIXES = (".tar", ".tar.gz", ".tgz", ".tar.xz", ".tar.bz2", ".tar.zst", ".zip", ".7z", ".gz", ".xz", ".bz2", ".tbz", ".rar", ".cab")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def safe_name(name: str, allow_upstream_git_fixture: bool = False) -> None:
    p = PurePosixPath(name)
    assert not p.is_absolute() and ".." not in p.parts and "\\" not in name, name
    assert ".venv" not in p.parts and "node_modules" not in p.parts, name
    if not allow_upstream_git_fixture:
        assert ".git" not in p.parts, name


def sanitize(value: object) -> object:
    if isinstance(value, str):
        aliases = {str(ROOT), str(ROOT.resolve()), "/tmp/smfh-native-media14-20261102"}
        for alias in sorted(aliases, key=len, reverse=True):
            value = value.replace(alias, "<BUILD_ROOT>")
        return re.sub(r"/(?:private/)?var/folders/[^\s\"']+", "<PRIVATE_TMP>", value)
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    return value


def compiled_kind(data: bytes) -> str | None:
    if data.startswith(b"\x7fELF"):
        return "ELF"
    if data[:4] in [bytes.fromhex(h) for h in [
        "feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
    ]]:
        return "Mach-O-or-fat"
    if data.startswith(b"!<arch>\n"):
        return "ar-static-library"
    if data.startswith(b"MZ") and len(data) >= 64:
        offset = struct.unpack("<I", data[60:64])[0]
        if data[offset:offset + 4] == b"PE\0\0":
            return "PE"
    return None


def inspect_nested_fixture(data: bytes, name: str) -> dict:
    """Read a known upstream fixture in memory without extraction/execution."""
    result = {"path": name, "bytes": len(data), "sha256": sha(data), "members": [], "compiled_findings": []}
    try:
        if zipfile.is_zipfile(io.BytesIO(data)):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                assert archive.testzip() is None
                entries = []
                for item in archive.infolist():
                    assert item.file_size <= 10_000_000
                    entries.append((item.filename, not item.is_dir(), archive.read(item) if not item.is_dir() else b""))
        else:
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                entries = []
                for item in archive:
                    assert item.size <= 10_000_000
                    entries.append((item.name, item.isfile(), archive.extractfile(item).read() if item.isfile() else b""))
        assert sum(len(body) for _, _, body in entries) <= 50_000_000
        for member, regular, body in entries:
            safe_name(member, allow_upstream_git_fixture=True)
            item = {"path": member, "regular": regular, "bytes": len(body)}
            if regular:
                item["sha256"] = sha(body)
                kind = compiled_kind(body)
                if kind:
                    result["compiled_findings"].append({**item, "format": kind})
                assert not member.lower().endswith(ARCHIVE_SUFFIXES), ("Unexpected deeper fixture archive", member)
            result["members"].append(item)
        result["status"] = "parsed"
    except (tarfile.ReadError, zipfile.BadZipFile) as error:
        result.update(status="unparseable-upstream-fuzz-fixture", error=str(error))
    return result


def verify_commands(receipt: dict) -> None:
    if "status" in receipt:
        assert receipt["status"] == "passed"
    assert receipt.get("commands"), "Missing build commands"
    for command in receipt["commands"]:
        assert command.get("exit_code", command.get("returncode")) == 0, command.get("name")
        if "status" in command:
            assert command["status"] == "passed"


def summarize_checks(checks: dict) -> dict:
    keys = {
        "status", "codec", "encoded_pixel_format", "width", "height", "frames", "canonical_samples",
        "relative_cfr_verified", "exact_generated_samples", "scope", "sample_rate", "channels",
        "samples_per_channel", "relative_audio_timing_verified", "expected_active_samples_per_channel",
        "encoder", "allow_sw", "hardware_only_required", "software_fallback_allowed", "notes", "bit_depth_scope",
        "selected_software_av1_encoder", "actual_file_bits_per_sample", "actual_dpx_image_elements", "actual_exr_channel_types",
        "stored_pixel_format", "canonical_format", "max_absolute_float_error", "float_expected_samples_identical",
        "float_expected_bytes_identical", "srgb_calibration",
    }
    def compact(value):
        if not isinstance(value, dict):
            return value
        result = {k: v for k, v in value.items() if k in keys}
        if "srgb_calibration" in result:
            result["srgb_calibration"] = {k: v for k, v in result["srgb_calibration"].items() if k != "samples"}
        for name in ["video", "audio", "independent_video", "independent_audio"]:
            if name in value:
                result[name] = compact(value[name])
        return result
    return {name: compact(check) for name, check in checks.items()}


def load_final_inputs(config_path: Path) -> tuple[dict, dict, dict, dict]:
    config = json.loads(config_path.read_bytes())
    assert config["schema_version"] == 1 and config["status"] == "final-ready"
    assert re.fullmatch(r"stop-motion-for-humanity-media-sources-macos-arm64-v[3-9][0-9]*", config["package_name"])
    assert (EVIDENCE / config["completed_build_log"]).read_text().rstrip().endswith("BUILD_COMPLETE")
    source_raw = (EVIDENCE / "source-inputs.json").read_bytes()
    assert sha(source_raw) == config["source_inputs_sha256"]
    sources = json.loads(source_raw)
    names = [item["name"] for item in sources["sources"]]
    assert names and len(names) == len(set(names))
    licenses = json.loads((EVIDENCE / "source-license-map-expanded.json").read_bytes())
    assert {item["name"] for item in licenses["components"]} == set(names)
    assert set(config["binary_sha256"]) == {"ffmpeg", "ffprobe"}
    for name, expected in config["binary_sha256"].items():
        assert sha((ROOT / "stage/darwin-arm64" / name).read_bytes()) == expected
    proofs = {}
    assert {p["id"] for p in config["proofs"]} >= {"software", "pro", "native"}
    for item in config["proofs"]:
        raw = (EVIDENCE / item["file"]).read_bytes()
        assert sha(raw) == item["sha256"], item["id"]
        value = json.loads(raw)
        assert value["status"] == "passed", item["id"]
        if "checks" in value:
            assert set(value["checks"]) == set(item["required_checks"])
            assert all(not isinstance(c, dict) or c.get("status", "passed") == "passed" for c in value["checks"].values())
        assert not value.get("omissions"), item["id"]
        for key in ["binary_sha256_before", "binary_sha256_after"]:
            if key in value:
                assert value[key] == config["binary_sha256"], (item["id"], key)
        for key in ["sources_unchanged", "binaries_unchanged", "source_trees_unchanged"]:
            if key in value:
                assert value[key] is True
        if "driver_sha256" in value:
            current_driver = value.get("verification_driver_sha256_current", value["driver_sha256"])
            assert sha((ROOT / "recipes" / item["driver"]).read_bytes()) == current_driver
        if "verification_helper_sha256" in value:
            assert sha((ROOT / "recipes/verify_lean_media.py").read_bytes()) == value["verification_helper_sha256"]
        if "base_driver_sha256" in value:
            assert sha((ROOT / "recipes/verify_lean_media.py").read_bytes()) == value["base_driver_sha256"]
        if "binary_pins" in value:
            assert {k: v["sha256"] for k, v in value["binary_pins"].items()} == config["binary_sha256"]
        if "binary" in value:
            assert value["binary"]["sha256"] == config["binary_sha256"]["ffmpeg"]
        for constituent in value.get("evidence_receipts", []) + value.get("receipts", []):
            assert sha((EVIDENCE / constituent["relative_path"]).read_bytes()) == constituent["sha256"]
        if "mach_o" in value:
            assert value["mach_o_count"] == 2 and not value["errors"]
            assert value["internal_edge_count"] == 0 and value["max_observed_macos_floor"] == "14.0.0"
            for name, expected in config["binary_sha256"].items():
                assert next(m for m in value["mach_o"] if m["path"] == name)["sha256"] == expected
            assert sha((ROOT / "recipes/audit_runtime.py").read_bytes()) == value["audit_script_sha256"]
        proofs[item["id"]] = {"definition": item, "bytes": len(raw), "value": value}
    return config, sources, licenses, proofs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--final-config", type=Path, required=True, help="Explicit hash-pinned final-ready proof configuration; never inferred from stale evidence")
    args = parser.parse_args()
    config, source_inputs, license_map, proofs = load_final_inputs(args.final_config)
    fixture_policy = json.loads((EVIDENCE / "cmake-upstream-fixture-policy.json").read_bytes())
    assert fixture_policy["status"] == "approved-exact-upstream-fixtures", "CMake fixture decision is pending"
    approved_compiled = {v["path"]: v for v in fixture_policy["compiled_fixture_files"]}
    approved_nested = {v["path"]: v for v in fixture_policy["nested_test_archives"]}
    name = config["package_name"]
    package = RELEASE / name
    package.mkdir(parents=True, exist_ok=True)
    assert not any(package.iterdir()), "Preserve existing package output before retrying"
    RUNTIME_LICENSES.mkdir(parents=True, exist_ok=True)

    def write(relative: str, data: bytes, executable: bool = False) -> None:
        safe_name(relative)
        output = package / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        output.chmod(0o755 if executable else 0o644)

    archive_members = []
    nested_reports = []
    found_compiled = []
    found_nested = []
    license_index = []
    git_verification = []
    total_regular = total_unpacked = 0
    for source in source_inputs["sources"]:
        data = (SOURCES / source["archive"]).read_bytes()
        assert source["verified"] and len(data) == source["bytes"] and sha(data) == source["sha256"]
        if "expected_sha256" in source:
            assert source["sha256"] == source["expected_sha256"]
        definition = next(v for v in license_map["components"] if v["name"] == source["name"])
        assert definition["archive"] == source["archive"] and definition["archive_sha256"] == source["sha256"]
        if source["name"] == "cmake":
            assert source["sha256"] == fixture_policy["original_source_archive_sha256"]
        write("sources/" + source["archive"], data)
        members = []
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            roots = set()
            for member in archive:
                safe_name(member.name)
                roots.add(PurePosixPath(member.name).parts[0])
                item = {"path": member.name, "type": member.type.decode(), "bytes": member.size}
                if member.isfile():
                    body = archive.extractfile(member).read()
                    assert len(body) == member.size
                    item["sha256"] = sha(body)
                    total_regular += 1
                    total_unpacked += len(body)
                    kind = compiled_kind(body)
                    if kind:
                        allowed = approved_compiled.get(member.name)
                        assert source["name"] == "cmake" and allowed, (member.name, kind)
                        assert allowed["sha256"] == sha(body) and allowed["bytes"] == len(body)
                        item["upstream_test_fixture_format"] = kind
                        found_compiled.append(member.name)
                    if member.name.lower().endswith(ARCHIVE_SUFFIXES):
                        allowed = approved_nested.get(member.name)
                        assert source["name"] == "cmake" and allowed, member.name
                        assert allowed["sha256"] == sha(body) and allowed["bytes"] == len(body)
                        report = inspect_nested_fixture(body, member.name)
                        assert not report["compiled_findings"], member.name
                        if report["status"] != "parsed":
                            assert member.name in fixture_policy["unparseable_fuzz_fixture_paths"]
                        nested_reports.append(report)
                        found_nested.append(member.name)
                elif member.issym() or member.islnk():
                    item["link_target"] = member.linkname
                    assert not PurePosixPath(member.linkname).is_absolute()
                else:
                    assert member.isdir(), member.name
                members.append(item)
            assert len(roots) == 1
            source_root = next(iter(roots))
            for relative in definition["license_files"]:
                original_member = source_root + "/" + relative
                body = archive.extractfile(original_member).read()
                target = source["name"] + "/" + relative
                write("licenses/" + target, body)
                runtime = RUNTIME_LICENSES / target
                runtime.parent.mkdir(parents=True, exist_ok=True)
                runtime.write_bytes(body)
                license_index.append({"component": source["name"], "role": definition["role"], "path": target, "original_archive_member": original_member, "bytes": len(body), "sha256": sha(body)})
        archive_members.append({"archive": source["archive"], "archive_bytes": len(data), "archive_sha256": sha(data), "members": members})
        if "git_commit" in source:
            git = SOURCES / (source["name"] + "-git")
            commit = subprocess.check_output(["git", "-C", str(git), "rev-parse", "HEAD"], text=True).strip()
            assert commit == source["git_commit"]
            check = subprocess.run(["git", "-C", str(git), "fsck", "--full"], capture_output=True, check=True)
            raw_tar = subprocess.check_output(["git", "-C", str(git), "archive", "--format=tar", "--prefix=" + source_root + "/", commit])
            assert gzip.decompress(data) == raw_tar
            tree = subprocess.check_output(["git", "-C", str(git), "rev-parse", "HEAD^{tree}"], text=True).strip()
            if source.get("git_tree"):
                assert source["git_tree"] == tree
            git_verification.append({"component": source["name"], "pinned_commit": commit, "actual_HEAD": commit, "git_tree": tree, "git_fsck_full_exit_code": check.returncode, "git_fsck_stdout": sanitize(check.stdout.decode()), "git_fsck_stderr": sanitize(check.stderr.decode()), "archive_tar_equals_git_archive": True, "uncompressed_git_archive_sha256": sha(raw_tar), "gzip_mtime": 0, "archive_sha256": sha(data)})
    assert set(found_compiled) == set(approved_compiled)
    assert set(found_nested) == set(approved_nested)

    write("provenance/source-inputs.json", json_bytes(source_inputs))
    write("provenance/source-license-map.json", json_bytes(license_map))
    write("provenance/source-member-manifest.json", json_bytes({"schema_version": 1, "sources": archive_members}))
    write("provenance/git-object-verification.json", json_bytes(git_verification))
    write("provenance/cmake-upstream-test-fixtures.json", json_bytes(fixture_policy))
    write("provenance/cmake-nested-test-fixture-audit.json", json_bytes(nested_reports))
    write("provenance/final-proof-configuration.json", json_bytes(sanitize(config)))
    build_receipts = []
    for filename in ["build-commands.json", "pro-codecs-build-commands.json", "zimg-build-commands.json"]:
        raw = (EVIDENCE / filename).read_bytes()
        receipt = json.loads(raw)
        verify_commands(receipt)
        public = json_bytes(sanitize(receipt))
        write("provenance/" + filename.replace(".json", ".sanitized.json"), public)
        build_receipts.append({"original_file": filename, "original_sha256": sha(raw), "sanitized_sha256": sha(public)})
    write("provenance/build-tools.sanitized.json", json_bytes(sanitize(json.loads((EVIDENCE / "build-tools.json").read_bytes()))))
    write("provenance/ffmpeg-configure-summary.sanitized.txt", str(sanitize((EVIDENCE / "ffmpeg-configure.log").read_text())).encode())
    capabilities_raw = (EVIDENCE / "runtime-capabilities-v5.json").read_bytes()
    capabilities = json.loads(capabilities_raw)
    assert capabilities["status"] == "passed" and not capabilities["errors"]
    assert capabilities["binary"]["sha256"] == config["binary_sha256"]["ffmpeg"]
    assert all(c["returncode"] == 0 for c in capabilities["commands"])
    write("provenance/runtime-capabilities.sanitized.json", json_bytes(sanitize(capabilities)))

    generated = []
    for relative in ["build/zimg/wrapper/CMakeLists.txt", "build/zimg/wrapper/zimg.pc.in", "build/zimg/smoke.cpp", "build/zimg/smoke.c"]:
        raw = (ROOT / relative).read_bytes()
        public = str(sanitize(raw.decode())).encode()
        filename = PurePosixPath(relative).name + (".normalized" if raw != public else "")
        write("provenance/generated-zimg-wrapper/" + filename, public)
        generated.append({"original_file": relative, "original_bytes": len(raw), "original_sha256": sha(raw), "public_file": filename, "public_sha256": sha(public), "normalization": "Private build-root and temporary-directory substitutions only" if raw != public else "none"})
    write("provenance/generated-zimg-wrapper/manifest.json", json_bytes(generated))
    proof_summary = {"schema_version": 1, "status": "passed", "build_iteration": config["build_iteration"], "binary_sha256": config["binary_sha256"], "build_receipts": build_receipts, "proofs": {}}
    for key, item in proofs.items():
        value = item["value"]
        proof_summary["proofs"][key] = {
            "original_evidence_file": item["definition"]["file"], "original_sha256": item["definition"]["sha256"], "original_bytes": item["bytes"],
            **{k: value[k] for k in ["status", "scope", "fixture", "geometry", "frames", "default_fps", "selected_software_av1_encoder", "limits", "expected_architecture", "max_observed_macos_floor", "mach_o_count", "mach_o_bytes", "internal_edge_count", "system_edge_count", "unique_system_loads", "errors", "driver_sha256", "verification_driver_sha256_current", "initial_expectation_corrections", "no_binary_changes_required", "evidence_receipts"] if k in value},
            "checks": summarize_checks(value.get("checks", {})),
        }
    proof_summary["scope_limit"] = "Standalone synthetic media and native linkage proofs only; application/device coverage and older-OS runtime testing are separate."
    summary_bytes = json_bytes(sanitize(proof_summary))
    write("provenance/verified-runtime-summary.json", summary_bytes)

    for recipe in sorted((ROOT / "recipes").glob("*.py")):
        write("recipes/" + recipe.name, recipe.read_bytes(), executable=True)
    extractor = '''#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Verify/extract bundled archives; no network or Git checkout required."""
from pathlib import Path
import hashlib, json, tarfile
root = Path(__file__).resolve().parents[1]
inputs = json.loads((root / "provenance/source-inputs.json").read_text())
for item in inputs["sources"]:
    path = root / "sources" / item["archive"]
    assert path.stat().st_size == item["bytes"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]
    with tarfile.open(path) as archive:
        archive.extractall(root / "sources", filter="data")
evidence = root / "evidence"
evidence.mkdir(exist_ok=True)
(evidence / "source-inputs.json").write_bytes((root / "provenance/source-inputs.json").read_bytes())
print(str(len(inputs["sources"])) + " exact source archives verified and extracted.")
'''
    write("recipes/extract_archives.py", extractor.encode(), executable=True)
    bootstrap = '''#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Optional offline CMake bootstrap into the private layout used by the recipes."""
from pathlib import Path
import hashlib, json, os, subprocess
root = Path(__file__).resolve().parents[1]
source = next(s for s in json.loads((root / "provenance/source-inputs.json").read_text())["sources"] if s["name"] == "cmake")
archive = root / "sources" / source["archive"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == source["sha256"]
src = root / "sources" / ("cmake-" + source["version"])
build = root / "build/cmake-bootstrap"
build.mkdir(parents=True, exist_ok=False)
prefix = root / "tools" / ("cmake-" + source["version"] + "-macos-universal/CMake.app/Contents")
assert not (prefix / "bin/cmake").exists()
env = dict(os.environ, PATH="/usr/bin:/bin:/usr/sbin:/sbin", MACOSX_DEPLOYMENT_TARGET="14.0")
subprocess.run([str(src / "bootstrap"), "--parallel=4", "--prefix=" + str(prefix), "--no-qt-gui", "--", "-DCMAKE_USE_OPENSSL=OFF", "-DCMAKE_OSX_ARCHITECTURES=arm64", "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0"], cwd=build, env=env, check=True)
subprocess.run(["/usr/bin/make", "-j4"], cwd=build, env=env, check=True)
subprocess.run(["/usr/bin/make", "install"], cwd=build, env=env, check=True)
print("Private source-built CMake is ready. This optional bootstrap was not the vendor executable used by the original build.")
'''
    write("recipes/bootstrap_cmake.py", bootstrap.encode(), executable=True)
    gpl = (package / "licenses/ffmpeg/COPYING.GPLv3").read_bytes()
    integration_notice = ("Integration recipes for Stop Motion for Humanity\nCopyright (C) 2026 Taylor Kalin\n\n"
        "The original integration recipes in this package are free software: you may redistribute and/or modify them under the GNU General Public License as published by the Free Software Foundation, either version 3, or (at your option) any later version. They are distributed without any warranty; see COPYING.GPLv3.\n\n"
        "The generated zimg CMake wrapper and smoke sources are original integration code covered by the same terms. Upstream FFmpeg, x264, x265, libvpx, AOM, Opus, zimg, graphengine, pkgconf and CMake sources retain their own copyrights and license terms; their original archives and notices are preserved separately without modification.\n\n"
        "The optional bootstrap_cmake.py reproduces the private tool layout from supplied CMake source. Its sequence is supplied for source rebuilding; it was not executed for the original recorded build, which used the separately pinned official vendor CMake tool.\n").encode()
    for filename, body in [("COPYING.GPLv3", gpl), ("NOTICE.txt", integration_notice)]:
        write("licenses/integration/" + filename, body)
        output = RUNTIME_LICENSES / "integration" / filename
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(body)
    index = {"schema_version": 1, "upstream_license_author_patent_text_files": len(license_index), "integration_license_and_notice_files": 2, "license_and_notice_files_total": len(license_index) + 2, "files": license_index + [{"component": "integration-recipes", "role": "build-integration-source", "path": "integration/" + n, "bytes": len(b), "sha256": sha(b)} for n, b in [("COPYING.GPLv3", gpl), ("NOTICE.txt", integration_notice)]]}
    write("licenses/license-index.json", json_bytes(index))
    (RUNTIME_LICENSES / "license-index.json").write_bytes(json_bytes(index))
    license_readme = ("Stop Motion for Humanity media tools — notices\n\n"
        "FFmpeg is configured with --enable-gpl and --enable-version3. Its static third-party codec/conversion sources and notices are included here. Source headers retain additional copyright information. pkgconf and CMake are build tools only; their compiled programs are not part of the runtime payload or source archive. Apple system frameworks and system zlib are dynamically referenced rather than redistributed. Python is a build driver only.\n\n"
        "The original CMake source archive contains hash-pinned upstream ELF and nested-archive test fixtures. They are not the vendor CMake application or resulting FFmpeg executables. See the precise declaration in the source package. Original integration recipes are GPL version 3 or later. source-manifest.json identifies the matching source package.\n").encode()
    write("licenses/README.txt", license_readme)
    (RUNTIME_LICENSES / "README.txt").write_bytes(license_readme)
    readme = f'''# Stop Motion for Humanity — macOS media source package

This package preserves {len(source_inputs["sources"])} exact upstream source archives,
exact integration recipes, successful build receipts and a digest-bound summary
of final {config["build_iteration"]} standalone media proofs. It does not contain
resulting runtime binaries, the 89.45 MB vendor CMake tool, dependency bottles,
Python runtimes, virtual environments, or our Git checkouts.

The original CMake source tar contains {len(found_compiled)} ELF test/fuzz fixtures
({sum(v["bytes"] for v in approved_compiled.values())} bytes), confined to CMake
Tests/. It also contains {len(found_nested)} nested test archives, including
malformed fuzz data and tiny upstream repository fixtures. These original bytes
are preserved deliberately and listed by exact path/hash in
provenance/cmake-upstream-test-fixtures.json. Nested archives were inspected in
memory without extraction/execution; their readback results and malformed-input
limitations are in the adjacent audit. No other compiled-format payload is allowed.

Original archive hashes are in provenance/source-inputs.json. Full upstream member
hashes and sizes are in provenance/source-member-manifest.json. Every Git-derived
archive was compared against git archive and git fsck --full passed. No .git checkout
is bundled; tiny upstream CMake repository fixtures remain encapsulated inside its
unchanged source archive. Original source and license bytes are unmodified.

Prerequisites: Apple Silicon macOS, Apple Command Line Tools (clang/make), Python
3.12 or later with its standard library. Python is never shipped in the product.
Source-package generation additionally used Python 3.14 for its standard-library
zstd reader when inspecting original CMake test fixtures. Use a working directory
without spaces. The recipes use /tmp/smfh-native-media14-20261102 only if that
optional symlink points to their own root.

To rebuild without downloading upstream inputs:

```
python3 recipes/extract_archives.py
python3 recipes/bootstrap_cmake.py
python3 recipes/build_media.py
python3 recipes/audit_runtime.py --root stage/darwin-arm64 --output evidence/rebuilt-runtime-audit.json --max-macos 14.0
python3 recipes/verify_lean_media.py --ffmpeg stage/darwin-arm64/ffmpeg --ffprobe stage/darwin-arm64/ffprobe --output evidence/rebuilt-codec-smoke --require-opus
python3 recipes/verify_pro_media.py --ffmpeg stage/darwin-arm64/ffmpeg --ffprobe stage/darwin-arm64/ffprobe --output evidence/rebuilt-pro-smoke --require-libaom
```

The optional CMake bootstrap uses supplied source and the private tool layout. It
was not executed for the original build, which used the pinned official vendor
CMake executable in provenance/build-tools.sanitized.json. Alternatively place
that exact vendor tool in its documented private layout. That build tool is
intentionally excluded from this source ZIP.

The full build driver invokes the pro-codec and zimg helpers. --only-ffmpeg is an
incremental convenience. The zimg helper derives its generic source list from
upstream Makefile.am, includes pinned graphengine, and generates a private CMake
wrapper without changing upstream sources. Wrapper/smoke source normalization
declares original/public hashes; rebuilding regenerates paths for the new root.

FFmpeg builds its native encoders/decoders with explicit static x264, multilib
x265, libaom, libvpx, Opus and zimg. Dependency autodetection and network protocols
are disabled; Apple VideoToolbox/AudioToolbox and system zlib are enabled. Exact
successful global/pro-codec/zimg receipts are in provenance/. <BUILD_ROOT> and
<PRIVATE_TMP> replace private paths only; original/normalized hashes are recorded.
Configure intent is distinct from profiles actually exercised by the proofs.

Native deployment load commands target macOS 14.0 ARM64. Older-OS execution has
not been tested; the app minimum also depends on Electron. Ad-hoc signing is not
Apple notarization. Media proofs use tiny synthetic fixtures and do not establish
app UI, camera or physical-source fidelity. Lossy codecs/conversions do not add
source bit depth or recover detail. Read provenance/verified-runtime-summary.json.

Original upstream notices are byte-preserved in licenses/; build-tool-only and
runtime-source roles are explicit. Integration scripts and generated wrapper code
are GPL version 3 or later; see licenses/integration/.

manifest.json hashes every other outer file. Its hash and ZIP hash are in the
sidecar manifest, avoiding self-reference. Metadata is normalized; two generated
ZIPs must be byte-identical, with every member hash and CRC read back. Historical
v1/v2 packages are preserved.
'''
    write("README.md", readme.encode())

    files = []
    for path in sorted(package.rglob("*")):
        if not path.is_file():
            continue
        body = path.read_bytes()
        relative = path.relative_to(package)
        if relative.parts[0] != "sources":
            private_prefixes = (b"/" + b"Users/", b"/" + b"home/" + Path.home().name.encode() + b"/")
            assert not any(p in body for p in private_prefixes), str(relative)
            assert compiled_kind(body) is None, str(relative)
        files.append({"path": relative.as_posix(), "bytes": len(body), "sha256": sha(body)})
    manifest = {"schema_version": 1, "package": name, "package_kind": "source-build-recipes-and-unmodified-upstream-test-fixtures", "new_runtime_or_vendor_tool_binary_included": False, "files_excluding_this_manifest": files, "original_source_archive_count": len(source_inputs["sources"]), "nested_regular_source_files": total_regular, "nested_regular_source_bytes": total_unpacked, "declared_upstream_compiled_test_fixture_count": len(found_compiled), "declared_upstream_nested_test_archive_count": len(found_nested), "unexpected_compiled_payload_findings": [], "third_party_notice_files": len(license_index), "integration_license_and_notice_files": 2}
    manifest_raw = json_bytes(manifest)
    write("manifest.json", manifest_raw)

    def make_zip(destination: Path) -> None:
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
            for path in sorted(package.rglob("*")):
                if not path.is_file():
                    continue
                info = zipfile.ZipInfo(path.relative_to(RELEASE).as_posix(), FIXED_DATE)
                info.create_system = 3
                info.external_attr = ((0o100755 if path.parent.name == "recipes" else 0o100644) << 16)
                info.compress_type = zipfile.ZIP_STORED if path.parent.name == "sources" else zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes(), compresslevel=9)

    output = RELEASE / (name + ".zip")
    assert not output.exists()
    make_zip(output)
    repeat = output.with_suffix(".reproducibility-check.zip")
    make_zip(repeat)
    assert output.read_bytes() == repeat.read_bytes()
    repeat.unlink()
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())) == len(files) + 1
        for item in files:
            body = archive.read(name + "/" + item["path"])
            assert len(body) == item["bytes"] and sha(body) == item["sha256"]
        assert archive.read(name + "/manifest.json") == manifest_raw
    summary = {"schema_version": 1, "status": "passed", "archive": output.name, "bytes": output.stat().st_size, "sha256": sha(output.read_bytes()), "manifest_sha256": sha(manifest_raw), "outer_regular_files": len(files) + 1, "source_archives": source_inputs["sources"], "source_archive_count": len(source_inputs["sources"]), "source_regular_files_scanned": total_regular, "source_uncompressed_bytes_scanned": total_unpacked, "declared_upstream_elf_test_fixtures": len(found_compiled), "declared_nested_test_archives": len(found_nested), "unexpected_compiled_payload_findings": [], "runtime_upstream_notice_files": len(license_index), "integration_license_and_notice_files": 2, "runtime_license_index_sha256": sha(json_bytes(index)), "original_source_and_license_bytes_preserved": True, "all_member_hashes_and_zip_crc": "passed", "double_generation_byte_comparison": "passed", "build_recipe_sha256": sha((ROOT / "recipes/build_media.py").read_bytes()), "verified_runtime_summary_sha256": sha(summary_bytes), "verified_runtime_binary_sha256": config["binary_sha256"], "verified_runtime_build_iteration": config["build_iteration"], "private_paths_in_generated_public_metadata": []}
    output.with_suffix(".manifest.json").write_bytes(json_bytes(summary))
    output.with_suffix(".sha256").write_text(summary["sha256"] + "  " + output.name + "\n")
    (RUNTIME_LICENSES / "source-manifest.json").write_bytes(json_bytes(summary))
    (EVIDENCE / "source-package-audit-v3.json").write_bytes(json_bytes(summary))
    write_runtime_manifest(config, source_inputs, proofs, summary, index, capabilities)
    for binary, expected in config["binary_sha256"].items():
        assert sha((ROOT / "stage/darwin-arm64" / binary).read_bytes()) == expected
    print(json.dumps({"archive": str(output), **summary}, indent=2))


def write_runtime_manifest(config: dict, source_inputs: dict, proofs: dict, source_package: dict, license_index: dict, capabilities: dict) -> None:
    """Regenerate final stage metadata after the source ZIP hash is known."""
    native = proofs["native"]["value"]
    software = proofs["software"]["value"]
    pro = proofs["pro"]["value"]
    apple = proofs["apple"]["value"]
    caller = proofs["native-caller"]["value"]
    calibration = pro["checks"]["exr-linear-srgb8"]["independent_video"]
    assert apple["checks"]["videotoolbox_h264"]["hardware_only_required"]
    assert apple["checks"]["videotoolbox_h264"]["allow_sw"] == 0
    assert not apple["checks"]["videotoolbox_h264"]["software_fallback_allowed"]
    assert set(capabilities["protocols"]) == {"file", "pipe"}
    clean_lists = {k: sorted(set(capabilities[k]) - {"="}) for k in ["encoders", "decoders", "filters", "muxers", "demuxers", "protocols"]}
    binary_rows = {}
    for item in native["mach_o"]:
        assert item["tools"]["codesign_verify_strict"]["returncode"] == 0
        binary_rows[item["path"]] = {
            "file": item["path"], "bytes": item["bytes"], "sha256": item["sha256"],
            "architecture": "arm64", "minimum_macos": "14.0", "signature": "ad hoc; strict verification passed",
        }
    build = json.loads((EVIDENCE / "build-commands.json").read_bytes())
    flags = next(c["argv"][1:] for c in build["commands"] if c["name"] == "ffmpeg-configure")
    assert "--disable-everything" not in flags and {"--enable-libx265", "--enable-libaom", "--enable-libzimg"} <= set(flags)
    license_rows = []
    for path in sorted(RUNTIME_LICENSES.rglob("*")):
        if path.is_file():
            body = path.read_bytes()
            license_rows.append({"path": "licenses/" + path.relative_to(RUNTIME_LICENSES).as_posix(), "bytes": len(body), "sha256": sha(body)})
    indexed = {v["path"] for v in license_index["files"]}
    assert set(v["path"].removeprefix("licenses/") for v in license_rows) == indexed | {"README.txt", "license-index.json", "source-manifest.json"}
    source_rows = [{
        "name": s["name"], "version": s["version"], "file": "sources/" + s["archive"],
        "bytes": s["bytes"], "sha256": s["sha256"], "role": next(c["role"] for c in json.loads((EVIDENCE / "source-license-map-expanded.json").read_bytes())["components"] if c["name"] == s["name"]),
        **{k: s[k] for k in ["url", "git_commit", "git_tree", "expected_sha256"] if k in s},
    } for s in source_inputs["sources"]]
    proof_rows = {key: {"file": v["definition"]["file"], "sha256": v["definition"]["sha256"], "status": v["value"]["status"]} for key, v in proofs.items()}
    manifest = {
        "schema_version": 2, "status": "passed", "product": "Stop Motion for Humanity",
        "runtime": "static FFmpeg and FFprobe with software AV1/HEVC and zimg", "version": "9.0.2-smfh-macos14-pro-v1",
        "platform": "darwin", "architecture": "arm64", "build_iteration": config["build_iteration"],
        "minimum_macos": "14.0", "tested_macos": config["tested_macos"], "tested_hardware": config["tested_hardware"],
        "sdk_recorded_by_macho": "26.2.0", "license": "GPL-3.0-or-later", "binaries": binary_rows, "tools": binary_rows,
        "private_dylibs": [], "system_dependencies": native["unique_system_loads"],
        "networking_enabled": False, "enabled_protocols": {"input": ["file", "pipe"], "output": ["file", "pipe"]},
        "ffmpeg_configure_argv": sanitize(flags),
        "source_inputs": source_rows,
        "source_inputs_root_convention": "Paths are relative to the original media build workroot; use that directory as collect-release-sources.py --input-root.",
        "source_package": {k: source_package[k] for k in ["archive", "bytes", "sha256", "manifest_sha256", "source_archive_count", "source_regular_files_scanned", "source_uncompressed_bytes_scanned", "declared_upstream_elf_test_fixtures", "declared_nested_test_archives", "verified_runtime_summary_sha256"]},
        "source_package_runtime_binary_payload_included": False,
        "source_package_upstream_fixture_scope": "The unchanged official CMake source tar contains exactly eight ELF-format test/fuzz fixtures (48,336 bytes) and 27 nested test archives. Three deliberately malformed fuzz archives cannot be parsed; all other nested fixtures were read back with no compiled-payload finding. No vendor CMake executable/archive or resulting media binary is included.",
        "source_package_integration": "The independent media ZIP contains exact recipes, normalized build receipts, generated wrapper and proof summaries. The app collector must include the matching tracked Mac recipes or additionally include this media ZIP to retain those build instructions.",
        "native_source_build_overrides": config["native_source_build_overrides"],
        "application_source_revision": config["application_source_revision"],
        "application_revision_scope": "Frozen product sources; source collector separately records its actual committed HEAD, which may add build recipes/provenance without changing product code.",
        "license_files": license_rows,
        "capabilities": {
            "scope": "Actual CLI metadata only; registration does not establish all-profile or hardware execution",
            "counts": {k: len(v) for k, v in clean_lists.items()},
            "required_registered": capabilities["required"],
            "x265_supported_pixel_formats": sorted(set(" ".join(capabilities["x265_supported_pixel_formats"]).split())),
            "metadata_parser_note": "Legend '=' tokens are excluded from encoder/decoder counts; original capability evidence is preserved unchanged.",
        },
        "verification": {
            "status": "passed", "scope": "Standalone synthetic media tools only; app 28-profile/UI/physical-camera QA is separate",
            "software_codec_case_count": len(software["checks"]) + len(pro["checks"]),
            "base_codec_checks": summarize_checks(software["checks"]), "additional_codec_checks": summarize_checks(pro["checks"]),
            "pro_execution_scope": pro["scope"], "pro_expectation_corrections": pro["initial_expectation_corrections"],
            "videotoolbox_h264_hardware_only_passed": True, "audiotoolbox_aac_passed": True,
            "apple_checks": summarize_checks(apple["checks"]), "native_caller_checks": caller["checks"],
            "linear_exr_calibration": {
                "scope": calibration["scope"], "stored_pixel_format": calibration["stored_pixel_format"],
                "maximum_absolute_error_vs_pinned_zimg_curve": calibration["max_absolute_float_error"],
                **{k: v for k, v in calibration["srgb_calibration"].items() if k != "samples"},
            },
            "sources_and_binaries_unchanged": True, "mach_o_files": native["mach_o_count"],
            "strict_signatures_passed": True, "non_system_dependency_edges": native["internal_edge_count"],
            "evidence": proof_rows,
        },
        "limitations": [
            "macOS 14.0 is the audited load-command target; execution was tested on the recorded build host, not an older system.",
            "Codec proofs use four synthetic 320x180 frames and short audio; standalone QA did not open cameras/microphones or exercise the app.",
            "Higher precision storage and sRGB-to-linear conversion do not restore source or sensor detail.",
            "This runtime includes no Python, PyTorch, Homebrew payload, private codec dylibs, or compiled pkgconf/CMake build tool.",
            "Ad-hoc signature verification is not notarization or a Gatekeeper acceptance claim.",
        ],
    }
    (ROOT / "stage/darwin-arm64/runtime-manifest.json").write_bytes(json_bytes(manifest))
    (EVIDENCE / "runtime-manifest-v5-final.json").write_bytes(json_bytes(manifest))


if __name__ == "__main__":
    main()
