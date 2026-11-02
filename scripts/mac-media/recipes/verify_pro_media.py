#!/usr/bin/env python3
"""Additive, synthetic-only pro-codec proof for the future v5 Mac media payload.

No build, download, app/device control, or fallback executables. Generates only
four 320x180 frames and short audio. This does not claim all app profiles or
physical camera fidelity: app-level export verification is a separate check.
"""
from __future__ import annotations

import argparse
import array
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import struct
import sys
import time
import zlib


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("lean_media_verifier", HERE / "verify_lean_media.py")
lean = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lean)
W, H, COUNT, FPS = lean.WIDTH, lean.HEIGHT, lean.FRAMES, lean.FPS


def source_inventory(root):
    return {str(p.relative_to(root)): lean.file_sha(p) for p in sorted(root.rglob("*")) if p.is_file()}


def float_fixture(folder):
    """Known floating point samples, including values not exactly representable as half."""
    path = folder / "source-float.gbrpf32le"
    raw, half = bytearray(), bytearray()
    for frame in range(COUNT):
        for channel in (1, 2, 0):  # FFmpeg planar GBR order, independently generated.
            for y in range(H):
                for x in range(W):
                    value = ((x * 3 + y * 7 + frame * 23 + channel * 47) % 991 + 1) / 1000
                    value = struct.unpack("<f", struct.pack("<f", value))[0]
                    raw.extend(struct.pack("<f", value))
                    half.extend(struct.pack("<f", struct.unpack("<e", struct.pack("<e", value))[0]))
    path.write_bytes(raw)
    return path, bytes(raw), bytes(half)


LINEAR_FILTER = ("format=gbrp,zscale=transferin=iec61966-2-1:transfer=linear:"
                 "primariesin=bt709:primaries=bt709:matrixin=gbr:matrix=gbr:"
                 "rangein=full:range=full:agamma=0,format=gbrpf32le")


def srgb_to_linear(code):
    x = code / 255
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def pinned_zimg_srgb_to_linear(code):
    # Pinned zimg gamma.cpp uses the continuous/tangent variant of sRGB, whose
    # constants differ slightly from the conventional rounded IEC formula.
    x, alpha, beta = code / 255, 1.055010718947587, 0.003041282560128
    return x / 12.92 if x < 12.92 * beta else ((x + alpha - 1) / alpha) ** 2.4


def gray_calibration(folder):
    """Canvas-like sRGB8 gray ramp with independently calculated linear samples."""
    directory = folder / "srgb-gray8"
    directory.mkdir()
    row = bytes(component for x in range(W) for component in [min(x, 255)] * 3)
    raw_scanlines = (b"\0" + row) * H
    header = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + lean.png_chunk(b"IHDR", header)
           + lean.png_chunk(b"IDAT", zlib.compress(raw_scanlines, 6)) + lean.png_chunk(b"IEND", b""))
    for frame in range(COUNT):
        (directory / f"source-{frame + 1:04d}.png").write_bytes(png)
    plane = b"".join(struct.pack("<f", pinned_zimg_srgb_to_linear(min(x, 255))) for y in range(H) for x in range(W))
    return plane * 3 * COUNT


def check_video(runner, source, codec, expected, *, pixel="rgb24", exact=False,
                sequence=False, fps=FPS, float_expected=None, decoder=None,
                calibration=False):
    input_flags = ["-framerate", str(fps), "-start_number", "1"] if sequence else []
    metadata = json.loads(runner.command([runner.ffprobe, "-v", "error", *input_flags,
        "-select_streams", "v:0", "-show_streams", "-show_frames", "-show_entries",
        "stream=codec_name,profile,pix_fmt,width,height,time_base,bits_per_raw_sample:frame=best_effort_timestamp,pts,width,height",
        "-of", "json", source]))
    lean.require(len(metadata.get("streams", [])) == 1, "Expected one picture stream")
    stream, frames = metadata["streams"][0], metadata.get("frames", [])
    lean.require(stream["codec_name"] == codec, "Unexpected decoded codec")
    lean.require((stream["width"], stream["height"], len(frames)) == (W, H, COUNT), "Full decoded frame count/geometry mismatch")
    tick = Fraction(stream["time_base"])
    timestamps = [Fraction(int(f.get("best_effort_timestamp", f.get("pts")))) * tick for f in frames]
    for index, (frame, stamp) in enumerate(zip(frames, timestamps)):
        lean.require((frame["width"], frame["height"]) == (W, H), "Decoded frame geometry changed")
        lean.require(abs(stamp - timestamps[0] - Fraction(index, fps)) <= tick / 2 + Fraction(1, 1000000), "Relative CFR exceeds half container tick")
    decoder_flags = ["-c:v", decoder] if decoder else []
    raw = runner.ff([*input_flags, *decoder_flags, "-i", source, "-map", "0:v:0", "-an", "-fps_mode", "passthrough",
                     "-pix_fmt", pixel, "-c:v", "rawvideo", "-threads", "1", "-f", "rawvideo", "pipe:1"])
    bytes_per_frame = W * H * {"rgb24": 3, "rgb48le": 6, "gbrpf16le": 6, "gbrpf32le": 12}[pixel]
    lean.require(len(raw) == COUNT * bytes_per_frame, "Full canonical decode byte count mismatch")
    result = {"codec": stream["codec_name"], "profile": stream.get("profile"), "stored_pixel_format": stream.get("pix_fmt"),
              "bits_per_raw_sample": stream.get("bits_per_raw_sample"), "width": W, "height": H, "frames": len(frames),
              "canonical_format": pixel, "decoded_sha256": lean.sha(raw),
              "frame_sha256": [lean.sha(raw[i * bytes_per_frame:(i + 1) * bytes_per_frame]) for i in range(COUNT)],
              "time_base": str(tick), "presentation_origin": str(timestamps[0]), "relative_timestamps": [str(t - timestamps[0]) for t in timestamps],
              "fps": fps, "relative_cfr_verified": True}
    if decoder:
        result["explicit_software_decoder"] = decoder
    if float_expected is not None:
        actual = array.array("f")
        if pixel == "gbrpf16le":
            # Read native half planes directly; do not introduce a second scaler
            # conversion into the stored-half verification.
            actual.extend(value[0] for value in struct.iter_unpack("<e", raw))
        else:
            actual.frombytes(raw)
        wanted = array.array("f"); wanted.frombytes(float_expected)
        if sys.byteorder != "little":
            if pixel != "gbrpf16le":
                actual.byteswap()
            wanted.byteswap()
        lean.require(all(math.isfinite(value) for value in actual), "Non-finite decoded EXR sample")
        error = max(abs(a - b) for a, b in zip(actual, wanted))
        lean.require(error <= (0.000003 if calibration else 0.000001), "Decoded float samples differ from independently generated float/half-rounding expectation")
        result.update({"max_absolute_float_error": error, "expected_float_sha256": lean.sha(float_expected),
                       "float_expected_samples_identical": actual == wanted,
                       "scope": "Synthetic native float samples only; half samples compared to IEEE-754 binary16 rounding. No extra source/camera detail claim."})
        if calibration:
            codes = [0, 1, 2, 10, 11, 32, 64, 128, 192, 254, 255]
            max_standard_error = max(abs(actual[plane * W * H + y * W + x] - srgb_to_linear(min(x, 255)))
                                     for plane in range(3) for y in range(H) for x in range(W))
            lean.require(max_standard_error <= 0.000006, "Decoded linear ramp differs excessively from conventional IEC sRGB formula")
            result["srgb_calibration"] = {
                "formula": "x=code8/255; x/12.92 for x<=0.04045, else ((x+0.055)/1.055)^2.4",
                "pinned_zimg_formula": "x=code8/255; alpha=1.055010718947587; beta=0.003041282560128; x/12.92 if x<12.92*beta, else ((x+alpha-1)/alpha)^2.4",
                "formula_scope": "Pinned zimg uses continuous/tangent sRGB constants; both its curve and the conventional rounded IEC formula are independently checked",
                "input": "Full-range IEC 61966-2-1 sRGB8 synthetic grayscale PNGs",
                "output": "Decoded linear-light RGB binary32 samples in BT.709/sRGB primaries",
                "filter": LINEAR_FILTER, "approximate_gamma_allowed": False, "maximum_allowed_absolute_error": 0.000003,
                "maximum_error_vs_conventional_formula": max_standard_error,
                "allowed_error_vs_conventional_formula": 0.000006,
                "samples": [{"code8": code, "expected_linear": srgb_to_linear(code),
                             "pinned_zimg_expected_linear": pinned_zimg_srgb_to_linear(code),
                             "actual_linear_rgb": [actual[plane * W * H + code] for plane in (2, 0, 1)]} for code in codes],
                "no_recovered_sensor_detail_claim": True}
            result["scope"] = "8-bit sRGB values converted to linear float; storage precision and transfer conversion do not restore sensor detail or increase source bit depth."
    elif exact:
        lean.require(raw == b"".join(expected), "Lossless pro-codec samples differ from independently generated originals")
        result["exact_generated_samples"] = True
    else:
        ground_truth = b"".join(expected)
        error = sum(abs(a - b) for a, b in zip(raw, ground_truth)) / len(raw)
        lean.require(pixel == "rgb24" and error < 35, "Lossy output no longer resembles the synthetic source")
        result.update({"mean_absolute_rgb8_error": error, "exact_generated_samples": False,
                       "scope": "Lossy/chroma-subsampled synthetic image check; no input sample equality claim"})
    if sequence:
        result["timing_scope"] = "Image files have no embedded CFR timeline; explicitly supplied sequence rate is recorded"
    return result


def tiff_bits(path):
    data = path.read_bytes()
    lean.require(data[:2] in (b"II", b"MM"), "Not a TIFF byte-order marker")
    order = "<" if data[:2] == b"II" else ">"
    lean.require(struct.unpack_from(order + "H", data, 2)[0] == 42, "Expected classic TIFF")
    offset = struct.unpack_from(order + "I", data, 4)[0]
    count = struct.unpack_from(order + "H", data, offset)[0]
    for index in range(count):
        pos = offset + 2 + index * 12
        tag, typ, size = struct.unpack_from(order + "HHI", data, pos)
        if tag == 258:
            lean.require(typ == 3 and 1 <= size <= 4, "Invalid TIFF BitsPerSample tag")
            start = pos + 8 if size * 2 <= 4 else struct.unpack_from(order + "I", data, pos + 8)[0]
            return list(struct.unpack_from(order + str(size) + "H", data, start))
    raise AssertionError("Missing TIFF BitsPerSample tag")


def dpx_bits(path):
    data = path.read_bytes()[:1664]
    lean.require(data[:4] in (b"SDPX", b"XPDS"), "Not a DPX header")
    order = ">" if data[:4] == b"SDPX" else "<"
    return {"width": struct.unpack_from(order + "I", data, 772)[0],
            "height": struct.unpack_from(order + "I", data, 776)[0],
            "element_descriptor": data[800], "bits_per_component": data[803]}


def exr_types(path):
    data = path.read_bytes()
    lean.require(struct.unpack_from("<I", data)[0] == 20000630, "Not an OpenEXR header")
    offset = 8
    def cstring(pos):
        end = data.index(0, pos)
        return data[pos:end].decode("ascii"), end + 1
    while data[offset] != 0:
        name, offset = cstring(offset)
        kind, offset = cstring(offset)
        size = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        value = data[offset:offset + size]
        offset += size
        if name == "channels":
            lean.require(kind == "chlist", "Unexpected EXR channel attribute")
            pos, channels = 0, {}
            while value[pos] != 0:
                end = value.index(0, pos)
                label = value[pos:end].decode("ascii")
                pos = end + 1
                channels[label] = struct.unpack_from("<i", value, pos)[0]
                pos += 16
            return channels
    raise AssertionError("Missing EXR channel list")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="NEW synthetic evidence directory")
    parser.add_argument("--cases", help="Optional comma-separated subset; default runs all additive cases")
    parser.add_argument("--require-libaom", action="store_true", help="Require libaom software AV1 encode/decode in the selected payload")
    args = parser.parse_args()
    ffmpeg, ffprobe = args.ffmpeg.resolve(strict=True), args.ffprobe.resolve(strict=True)
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=False)
    for folder in ("sources", "exports", "logs"):
        (out / folder).mkdir()
    runner = lean.Runner(ffmpeg, ffprobe, out)
    start = time.monotonic()
    receipt = {"schema": "smfh-additive-pro-codecs-v1", "status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
               "scope": "Tiny generated synthetic frames/audio only; native file encoders plus software AV1/HEVC. No app, devices, network, fallback tools or physical media.",
               "geometry": [W, H], "frames": COUNT, "default_fps": FPS, "driver_sha256": lean.file_sha(__file__),
               "base_driver_sha256": lean.file_sha(HERE / "verify_lean_media.py"),
               "binary_sha256_before": {"ffmpeg": lean.file_sha(ffmpeg), "ffprobe": lean.file_sha(ffprobe)}, "checks": {}}
    lean.json_write(out / "receipt.json", receipt)
    try:
        receipt["inventory"] = lean.inventory(runner)
        encoder_text = runner.command([ffmpeg, "-hide_banner", "-encoders"]).decode()
        encoders = set(re.findall(r"^\s*[VAS][A-Z.]{5}\s+(\S+)", encoder_text, re.M))
        av1_encoder = "libaom-av1" if "libaom-av1" in encoders else "libsvtav1" if "libsvtav1" in encoders else None
        lean.require(av1_encoder is not None, "No supported software AV1 encoder registered")
        if args.require_libaom:
            lean.require(av1_encoder == "libaom-av1", "This proof requires libaom software AV1")
        av1_flags = (["-c:v", "libaom-av1", "-cpu-used", "8", "-crf", "25", "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p10le"]
                     if av1_encoder == "libaom-av1" else
                     ["-c:v", "libsvtav1", "-preset", "12", "-crf", "25", "-svtav1-params", "lp=2", "-pix_fmt", "yuv420p10le"])
        receipt["selected_software_av1_encoder"] = av1_encoder
        rgb8, rgb16, pcm = lean.make_sources(out / "sources")
        float_path, float_raw, half_raw = float_fixture(out / "sources")
        linear_gray_raw = gray_calibration(out / "sources")
        before = source_inventory(out / "sources")
        # New-native codecs are deliberately exercised, not merely listed.
        cases = [
            dict(name="software-hevc-x265-8bit", codec="hevc", stored_pixel="yuv420p", flags=["-c:v", "libx265", "-preset", "ultrafast", "-crf", "20", "-x265-params", "pools=none:frame-threads=1:log-level=error", "-pix_fmt", "yuv420p"], suffix="mp4"),
            dict(name="software-hevc-x265", codec="hevc", stored_pixel="yuv420p10le", flags=["-c:v", "libx265", "-preset", "ultrafast", "-crf", "20", "-x265-params", "pools=none:frame-threads=1:log-level=error", "-pix_fmt", "yuv420p10le"], suffix="mp4"),
            dict(name="software-hevc-x265-12bit", codec="hevc", stored_pixel="yuv444p12le", flags=["-c:v", "libx265", "-preset", "ultrafast", "-crf", "20", "-x265-params", "pools=none:frame-threads=1:log-level=error", "-pix_fmt", "yuv444p12le"], suffix="mp4",
                 note="Actual 12-bit HEVC storage from synthetic RGB8 input; no added source detail claim"),
            dict(name="software-av1", codec="av1", flags=av1_flags, decoder="libaom-av1" if av1_encoder == "libaom-av1" else None, suffix="webm"),
            dict(name="mpeg2-25fps", codec="mpeg2video", fps=25, flags=["-c:v", "mpeg2video", "-q:v", "2", "-g", "1", "-pix_fmt", "yuv420p"], suffix="mpg",
                 note="25fps legal MPEG-2 cadence; no 12fps app-profile coercion claim"),
            dict(name="dnxhr-hqx", codec="dnxhd", flags=["-c:v", "dnxhd", "-profile:v", "dnxhr_hqx", "-pix_fmt", "yuv422p10le"], suffix="mov",
                 note="DNxHR HQX accepts this tiny raster. This is not the fixed-raster DNxHD profile."),
            dict(name="cineform-10bit", codec="cfhd", flags=["-c:v", "cfhd", "-quality", "film3+", "-pix_fmt", "yuv422p10le"], suffix="mov"),
            dict(name="jpeg2000-lossless-rgb16", codec="jpeg2000", depth=16, pixel="rgb48le", exact=True,
                 flags=["-c:v", "jpeg2000", "-pred", "1", "-pix_fmt", "rgb48le"], suffix="mov"),
            dict(name="tiff-rgb16", codec="tiff", depth=16, pixel="rgb48le", exact=True, sequence=True,
                 flags=["-c:v", "tiff", "-pix_fmt", "rgb48le", "-compression_algo", "deflate"], suffix="tif"),
            dict(name="dpx-rgb16", codec="dpx", depth=16, pixel="rgb48le", exact=True, sequence=True,
                 flags=["-c:v", "dpx", "-pix_fmt", "rgb48le", "-bits_per_raw_sample", "16"], suffix="dpx"),
            dict(name="exr-half", codec="exr", float_input=True, pixel="gbrpf16le", sequence=True,
                 flags=["-c:v", "exr", "-format", "half", "-compression", "zip1", "-pix_fmt", "gbrpf32le"], suffix="exr"),
            dict(name="exr-float", codec="exr", float_input=True, pixel="gbrpf32le", sequence=True,
                 flags=["-c:v", "exr", "-format", "float", "-compression", "zip1", "-pix_fmt", "gbrpf32le"], suffix="exr"),
            dict(name="exr-linear-srgb8", codec="exr", source_folder="srgb-gray8", calibration=True, pixel="gbrpf32le", sequence=True,
                 flags=["-vf", LINEAR_FILTER, "-c:v", "exr", "-format", "float", "-compression", "zip1", "-pix_fmt", "gbrpf32le", "-color_trc", "linear", "-color_primaries", "bt709"], suffix="exr"),
            dict(name="qtrle-rgba8", codec="qtrle", exact=True, flags=["-c:v", "qtrle", "-pix_fmt", "argb"], suffix="mov"),
        ]
        requested = set(args.cases.split(",")) if args.cases else {c["name"] for c in cases}
        lean.require(requested <= {c["name"] for c in cases}, "Unknown requested case")
        for case in cases:
            if case["name"] not in requested:
                continue
            name = case["name"]
            print("Encoding and independently fully decoding " + name, flush=True)
            check = {"status": "running", "notes": [case["note"]] if case.get("note") else []}
            receipt["checks"][name] = check
            try:
                fps = case.get("fps", FPS)
                if case.get("sequence"):
                    directory = out / "exports" / name; directory.mkdir()
                    target = directory / ("frame-%04d." + case["suffix"])
                else:
                    target = out / "exports" / (name + "." + case["suffix"])
                if case.get("float_input"):
                    source_flags = ["-f", "rawvideo", "-pixel_format", "gbrpf32le", "-video_size", f"{W}x{H}", "-framerate", str(fps), "-i", float_path]
                else:
                    folder = case.get("source_folder", f"rgb{case.get('depth', 8)}")
                    source_flags = ["-framerate", str(fps), "-start_number", "1", "-i", out / f"sources/{folder}/source-%04d.png"]
                runner.ff([*source_flags, "-an", *case["flags"], "-strict", "experimental", "-threads", "1", "-frames:v", str(COUNT), target])
                if case.get("sequence"):
                    members = sorted(directory.glob("*." + case["suffix"]))
                    lean.require(len(members) == COUNT, "Wrong published image sequence file count")
                    check["files"] = [{"name": p.name, "bytes": p.stat().st_size, "sha256": lean.file_sha(p)} for p in members]
                else:
                    check["file"] = {"bytes": target.stat().st_size, "sha256": lean.file_sha(target)}
                float_expected = half_raw if name == "exr-half" else float_raw if name == "exr-float" else linear_gray_raw if case.get("calibration") else None
                check["independent_video"] = check_video(runner, target, case["codec"], rgb16 if case.get("depth") == 16 else rgb8,
                    pixel=case.get("pixel", "rgb24"), exact=case.get("exact", False), sequence=case.get("sequence", False), fps=fps, float_expected=float_expected,
                    decoder=case.get("decoder"), calibration=case.get("calibration", False))
                if case.get("stored_pixel"):
                    lean.require(check["independent_video"]["stored_pixel_format"] == case["stored_pixel"], "Encoder silently changed required storage depth/pixel format")
                if name == "tiff-rgb16":
                    fields = [tiff_bits(p) for p in members]
                    lean.require(all(field == [16, 16, 16] for field in fields), "Stored TIFF sample depth differs")
                    check["actual_file_bits_per_sample"] = fields
                elif name == "dpx-rgb16":
                    fields = [dpx_bits(p) for p in members]
                    lean.require(all((field["width"], field["height"], field["bits_per_component"]) == (W, H, 16) for field in fields), "Stored DPX header geometry/depth differs")
                    check["actual_dpx_image_elements"] = fields
                elif name.startswith("exr-"):
                    fields = [exr_types(p) for p in members]
                    expected_type = 1 if name == "exr-half" else 2
                    lean.require(all(set(field) == {"R", "G", "B"} and set(field.values()) == {expected_type} for field in fields), "Stored EXR channel types differ")
                    check["actual_exr_channel_types"] = fields
                    check["bit_depth_scope"] = "Actual file channel types only: 1=binary16 half, 2=binary32 float. No recovered detail claim."
                check["status"] = "passed"
            except Exception as error:
                check["status"] = "failed"
                check["failure"] = {"type": type(error).__name__, "message": str(error)[-4000:]}
            lean.json_write(out / "receipt.json", receipt)
        receipt["source_sha256_before"] = before
        receipt["source_sha256_after"] = source_inventory(out / "sources")
        lean.require(before == receipt["source_sha256_after"], "Synthetic originals changed")
        receipt["sources_unchanged"] = True
        receipt["status"] = "passed" if receipt["checks"] and all(c["status"] == "passed" for c in receipt["checks"].values()) else "failed"
    except Exception as error:
        receipt["status"] = "failed"
        receipt["failure"] = {"type": type(error).__name__, "message": str(error)[-4000:]}
    finally:
        receipt["binary_sha256_after"] = {"ffmpeg": lean.file_sha(ffmpeg), "ffprobe": lean.file_sha(ffprobe)}
        receipt["binaries_unchanged"] = receipt["binary_sha256_before"] == receipt["binary_sha256_after"]
        if not receipt["binaries_unchanged"]:
            receipt["status"] = "failed"
        receipt["elapsed_seconds"] = round(time.monotonic() - start, 3)
        receipt["finished_utc"] = datetime.now(timezone.utc).isoformat()
        lean.json_write(out / "receipt.json", receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(out / "receipt.json"), "receipt_sha256": lean.file_sha(out / "receipt.json"),
                      "checks": {name: value["status"] for name, value in receipt["checks"].items()}}), flush=True)
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
