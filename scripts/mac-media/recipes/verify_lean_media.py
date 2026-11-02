"""Small synthetic, device-free verification of the new lean FFmpeg payload.

Python is a verification driver only. Encoding and fresh full decoding use the
supplied FFmpeg programs; no Python runtime is proposed for the shipped app.
No builds, downloads, services, hardware capture, or existing editor media.
"""
from __future__ import annotations

import argparse
import array
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shlex
import struct
import subprocess
import sys
import time
import wave
import zlib

WIDTH, HEIGHT, FRAMES, FPS, RATE, CHANNELS = 320, 180, 4, 12, 48000, 2
SAMPLES = FRAMES * RATE // FPS
BASE = Path(__file__).resolve().parent
NETWORK_PROTOCOLS = set("http https httpproxy tcp udp udplite tls rtp rtsp rtmp rtmps rtmpt rtmpts rtmpe rtmpte srt srtp ftp ftps gopher gophers icecast mmsh mmst rist smb libssh sctp amqp ipfs ipns unix zmq prompeg sap rtmpsrt".split())
LOCAL_PROTOCOLS = set("async cache concat concatf crypto data fd file md5 pipe subfile tee".split())


def require(ok, message):
    if not ok:
        raise AssertionError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def json_write(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


def make_png(path, index, depth):
    rows, canonical = bytearray(), bytearray()
    for y in range(HEIGHT):
        rows.append(0)  # PNG filter: none; actual RGB samples follow.
        for x in range(WIDTH):
            rgb = [32 + x * 191 // (WIDTH - 1), 32 + y * 191 // (HEIGHT - 1), 48 + index * 33]
            if 20 + index * 35 <= x < 65 + index * 35 and 50 <= y < 110:
                rgb = [220, 45, 70 + index * 25]
            for channel, value in enumerate(rgb):
                if depth == 8:
                    rows.append(value)
                    canonical.append(value)
                else:
                    value = value * 257 + ((x + y * 3 + index + channel) % 7 - 3)
                    if y < 8:
                        value = (10000 if channel == 0 else 30000 if channel == 1 else 5300) + ((x + index) & 1)
                    rows.extend(struct.pack(">H", value))
                    canonical.extend(struct.pack("<H", value))
    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, depth, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(rows, 6)) + png_chunk(b"IEND", b""))
    return bytes(canonical)


def make_sources(folder):
    rgb8, rgb16 = [], []
    for depth, target in ((8, rgb8), (16, rgb16)):
        directory = folder / ("rgb" + str(depth))
        directory.mkdir()
        for index in range(FRAMES):
            target.append(make_png(directory / f"source-{index + 1:04d}.png", index, depth))
    pcm = bytearray()
    for index in range(SAMPLES):
        pcm.extend(struct.pack("<hh", round(12000 * math.sin(2 * math.pi * 440 * index / RATE)),
                               round(10000 * math.sin(2 * math.pi * 660 * index / RATE))))
    with wave.open(str(folder / "source.wav"), "wb") as audio:
        audio.setnchannels(CHANNELS); audio.setsampwidth(2); audio.setframerate(RATE)
        audio.writeframes(pcm)
    return rgb8, rgb16, bytes(pcm)


class Runner:
    def __init__(self, ffmpeg, ffprobe, output):
        self.ffmpeg, self.ffprobe, self.output, self.number = ffmpeg, ffprobe, output, 0
        self.environment = {key: value for key, value in os.environ.items()
                            if not key.startswith(("DYLD_", "PYTHON"))}
        self.environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"

    def command(self, arguments, timeout=120):
        self.number += 1
        name = f"command-{self.number:03d}"
        started = time.monotonic()
        result = subprocess.run([str(arg) for arg in arguments], stdin=subprocess.DEVNULL,
                                capture_output=True, env=self.environment, cwd=self.output,
                                timeout=timeout, check=False)
        (self.output / "logs" / (name + ".stderr.log")).write_bytes(result.stderr)
        # Do not duplicate decoded raw buffers into the command log.
        metadata = dict(arguments=[str(arg).replace(str(self.output), "<smoke-output>") for arg in arguments],
                        returncode=result.returncode, elapsed_seconds=round(time.monotonic() - started, 3),
                        stdout_bytes=len(result.stdout), stdout_sha256=sha(result.stdout))
        json_write(self.output / "logs" / (name + ".json"), metadata)
        require(result.returncode == 0, f"{name} failed: {result.stderr.decode(errors='replace')[-2500:]}")
        return result.stdout

    def ff(self, arguments):
        return self.command([self.ffmpeg, "-hide_banner", "-loglevel", "error", "-xerror", "-nostdin", "-n",
                             "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", *arguments])

    def probe(self, source, sequence=False, audio=False):
        input_options = ["-framerate", str(FPS), "-start_number", "1"] if sequence else []
        return json.loads(self.command([self.ffprobe, "-v", "error", *input_options, "-select_streams", "a:0" if audio else "v:0",
              "-show_streams", "-show_frames", "-show_entries",
              "stream=codec_name,pix_fmt,width,height,time_base,sample_rate,channels,duration_ts,duration,bits_per_raw_sample:frame=best_effort_timestamp,pts,width,height,nb_samples",
              "-of", "json", source]))


def inventory(runner):
    version = runner.command([runner.ffmpeg, "-hide_banner", "-version"]).decode()
    probe_version = runner.command([runner.ffprobe, "-hide_banner", "-version"]).decode()
    require(version.startswith("ffmpeg version 9.0.2"), "Expected selected FFmpeg 9.0.2 build")
    require(probe_version.startswith("ffprobe version 9.0.2"), "Expected companion FFprobe 9.0.2 build")
    configuration = next(line.split("configuration:", 1)[1].strip() for line in version.splitlines() if "configuration:" in line)
    flags = set(shlex.split(configuration))
    for flag in ("--disable-autodetect", "--disable-network", "--disable-shared", "--enable-libx264", "--enable-libvpx"):
        require(flag in flags, "Missing required build configuration " + flag)
    require("--enable-network" not in flags and "--enable-shared" not in flags, "Conflicting build configuration")
    listing = runner.command([runner.ffmpeg, "-hide_banner", "-protocols"]).decode()
    protocols, active = set(), False
    for line in listing.splitlines():
        if line.strip() in ("Input:", "Output:"):
            active = True
        elif active and re.fullmatch(r"[a-zA-Z0-9_+-]+", line.strip()):
            protocols.add(line.strip())
    require("file" in protocols and "pipe" in protocols, "Missing local file/pipe protocols")
    require(not protocols & NETWORK_PROTOCOLS, "Network protocols remain: " + ", ".join(sorted(protocols & NETWORK_PROTOCOLS)))
    require(protocols <= LOCAL_PROTOCOLS, "Unexpected non-local protocol registration: " + ", ".join(sorted(protocols - LOCAL_PROTOCOLS)))
    text = runner.command([runner.ffmpeg, "-hide_banner", "-encoders"]).decode()
    encoders = set()
    for line in text.splitlines():
        parts = line.split()
        if len(parts) > 1 and len(parts[0]) == 6 and parts[0][0] in "VAS" and parts[1] != "=":
            encoders.add(parts[1])
    required = {"libx264", "libvpx-vp9", "ffv1", "prores_ks", "gif", "png", "aac", "flac", "pcm_s16le", "rawvideo", "h264_videotoolbox", "aac_at"}
    require(required <= encoders, "Missing expected encoders: " + ", ".join(sorted(required - encoders)))
    return dict(ffmpeg=version.splitlines()[0], ffprobe=probe_version.splitlines()[0], configuration=configuration,
                protocols=sorted(protocols), known_network_protocols_present=[], required_encoders_present=sorted(required),
                libopus_available="libopus" in encoders,
                apple_framework_encoders_registered=sorted(encoders & {"h264_videotoolbox", "hevc_videotoolbox", "aac_at", "alac_at"}),
                hardware_session_scope="Registration only; this driver exercises software codecs and never opens capture hardware")


def video_check(runner, source, expected_codec, expected, *, exact=False, depth=8, sequence=False):
    metadata = runner.probe(source, sequence=sequence)
    require(len(metadata.get("streams", [])) == 1, "Expected one decoded video stream")
    stream = metadata["streams"][0]
    frames = metadata.get("frames", [])
    require(stream["codec_name"] == expected_codec, "Unexpected video codec")
    require((stream["width"], stream["height"], len(frames)) == (WIDTH, HEIGHT, FRAMES), "Decoded video geometry/frame count differs")
    base = Fraction(stream["time_base"])
    times = [Fraction(int(frame.get("best_effort_timestamp", frame.get("pts")))) * base for frame in frames]
    tolerance = base / 2 + Fraction(1, 1_000_000)
    require(abs(times[0]) <= Fraction(1, FPS), "Unexpectedly large presentation-time origin")
    for index, (frame, timestamp) in enumerate(zip(frames, times)):
        require((frame["width"], frame["height"]) == (WIDTH, HEIGHT), "A decoded frame changed geometry")
        require(abs(timestamp - times[0] - Fraction(index, FPS)) <= tolerance, "Decoded cadence exceeds half time-base tick plus 1us")
    input_options = ["-framerate", str(FPS), "-start_number", "1"] if sequence else []
    pixel = "rgb48le" if depth == 16 else "rgb24"
    raw = runner.ff([*input_options, "-i", source, "-map", "0:v:0", "-an", "-pix_fmt", pixel,
                     "-fps_mode", "passthrough", "-threads", "1", "-f", "rawvideo", "pipe:1"])
    frame_bytes = WIDTH * HEIGHT * (6 if depth == 16 else 3)
    require(len(raw) == FRAMES * frame_bytes, "Full independently decoded active byte count differs")
    ground_truth = b"".join(expected)
    if exact:
        require(raw == ground_truth, "Lossless decoded samples differ from original generated samples")
        quality = dict(exact_generated_samples=True)
    else:
        errors = [sum(abs(a - b) for a, b in zip(raw[i * frame_bytes:(i + 1) * frame_bytes], expected[i])) / frame_bytes
                  for i in range(FRAMES)]
        require(max(errors) < 35, "Lossy decoded fixture no longer resembles its source")
        quality = dict(exact_generated_samples=False, mean_absolute_rgb8_errors=errors,
                       scope="Lossy image check only; no lossless or encoder-input hash equality claimed")
    return dict(codec=expected_codec, encoded_pixel_format=stream.get("pix_fmt"), width=WIDTH, height=HEIGHT, frames=FRAMES, canonical_samples=pixel,
                decoded_sample_sha256=sha(raw), frame_sha256=[sha(raw[i * frame_bytes:(i + 1) * frame_bytes]) for i in range(FRAMES)],
                time_base=str(base), presentation_timestamps=[str(value) for value in times],
                relative_cfr_verified=True, presentation_origin=str(times[0]),
                timing_scope="Sequence timestamps use the explicitly supplied 12fps input grid; PNG files have no embedded timestamps" if sequence else "Relative CFR within half container time-base tick plus 1us; origin and container quantization recorded",
                **quality)


def pcm_values(data):
    values = array.array("h"); values.frombytes(data)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def audio_check(runner, source, codec, expected, exact):
    metadata = runner.probe(source, audio=True)
    require(len(metadata.get("streams", [])) == 1, "Expected one decoded audio stream")
    stream = metadata["streams"][0]
    require((stream["codec_name"], int(stream["sample_rate"]), stream["channels"]) == (codec, RATE, CHANNELS), "Audio codec/rate/channels differ")
    decoded_frames = metadata.get("frames", [])
    require(sum(int(frame.get("nb_samples", 0)) for frame in decoded_frames) >= SAMPLES, "Full audio frame decode is too short")
    base = Fraction(stream["time_base"])
    stamps = [Fraction(int(frame.get("best_effort_timestamp", frame.get("pts")))) * base for frame in decoded_frames]
    require(bool(stamps) and abs(stamps[0]) <= Fraction(1, FPS), "Unexpectedly large audio presentation origin")
    elapsed = Fraction(0)
    for frame, stamp in zip(decoded_frames, stamps):
        require(abs(stamp - stamps[0] - elapsed) <= base / 2 + Fraction(1, 1_000_000), "Audio sample cadence exceeds half time-base tick plus 1us")
        elapsed += Fraction(int(frame["nb_samples"]), RATE)
    raw = runner.ff(["-i", source, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "-ar", str(RATE), "-ac", str(CHANNELS), "-f", "s16le", "pipe:1"])
    require(len(raw) % 4 == 0, "Incomplete stereo sample")
    samples = len(raw) // 4
    if exact:
        require(raw == expected, "Lossless audio does not exactly match generated S16 samples")
        quality = dict(exact_generated_samples=True)
    else:
        require(SAMPLES <= samples <= SAMPLES + 1024, "Lossy audio padding exceeds one codec frame")
        actual, original = pcm_values(raw), pcm_values(expected)
        best = -1.0
        for offset in range(-32, 33):
            start_a, start_b = max(offset, 0) * 2, max(-offset, 0) * 2
            size = min(len(actual) - start_a, len(original) - start_b)
            aa, bb = actual[start_a:start_a + size], original[start_b:start_b + size]
            denom = math.sqrt(sum(x * x for x in aa) * sum(x * x for x in bb))
            best = max(best, sum(x * y for x, y in zip(aa, bb)) / denom if denom else -1)
        require(best > .9, "Lossy decoded stereo tone did not correlate with generated audio")
        quality = dict(exact_generated_samples=False, best_source_correlation_within_32_samples=best,
                       scope="Codec delay/padding and lossy encoding are recorded; no exact PCM claim")
    return dict(codec=codec, sample_rate=RATE, channels=CHANNELS, samples_per_channel=samples,
                expected_active_samples_per_channel=SAMPLES, decoded_s16le_sha256=sha(raw), relative_audio_timing_verified=True,
                time_base=str(base), presentation_origin=str(stamps[0]), audio_frame_timestamps=[str(value) for value in stamps], **quality)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", type=Path, required=True, help="New lean payload executable; no Homebrew fallback")
    parser.add_argument("--ffprobe", type=Path, required=True, help="Companion 9.0.2 verification executable; need not be shipped")
    parser.add_argument("--output", type=Path, help="Fresh owned result directory; an existing directory is refused")
    parser.add_argument("--require-opus", action="store_true", help="Fail if optional libopus/WebM coverage is unavailable")
    args = parser.parse_args()
    ffmpeg, ffprobe = args.ffmpeg.resolve(strict=True), args.ffprobe.resolve(strict=True)
    require(ffmpeg.is_file() and ffprobe.is_file(), "Supply actual executable files")
    output = (args.output or BASE / ("lean-media-smoke-" + secrets.token_hex(5))).resolve()
    output.mkdir(parents=True, exist_ok=False)
    for name in ("sources", "exports", "logs"):
        (output / name).mkdir()
    receipt = dict(status="running", started_utc=datetime.now(timezone.utc).isoformat(), driver_sha256=file_sha(Path(__file__)),
                   scope="Four synthetic 320x180 frames at 12fps and one-third second of stereo 48kHz S16 audio; software media codecs only, no camera/app/services/8K",
                   fixture=dict(width=WIDTH, height=HEIGHT, frames=FRAMES, fps_exact=str(FPS) + "/1", audio_samples_per_channel=SAMPLES,
                                audio_rate=RATE, audio_channels=CHANNELS, rgb16_lowbit_probes=["10000/10001", "30000/30001", "5300/5301"]),
                   binary_sha256_before=dict(ffmpeg=file_sha(ffmpeg), ffprobe=file_sha(ffprobe)), checks={}, omissions=[],
                   external_native_audit="Linked dependencies, signatures, architecture and minimum OS are owned by the separate native-payload audit, not inferred from codec smoke tests")
    started = time.monotonic()
    def progress(stage):
        receipt.update(stage=stage, elapsed_seconds=round(time.monotonic() - started, 3))
        json_write(output / "receipt.json", receipt)
        print(stage, flush=True)
    runner = Runner(ffmpeg, ffprobe, output)
    try:
        progress("Inspecting new payload configuration, protocols and codecs")
        receipt["inventory"] = inventory(runner)
        progress("Generating four small original PNG8/PNG16 frames and S16 stereo audio")
        rgb8, rgb16, pcm = make_sources(output / "sources")
        before = {str(p.relative_to(output)): file_sha(p) for p in (output / "sources").rglob("*") if p.is_file()}
        receipt["source_sha256_before"] = before
        def inputs(depth=8):
            return ["-framerate", str(FPS), "-start_number", "1", "-i", output / f"sources/rgb{depth}/source-%04d.png", "-i", output / "sources/source.wav"]
        profiles = [
            ("software-h264-aac", "h264", "aac", "mp4", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-bf", "0", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"], 8, False, False),
            ("ffv1-rgb8", "ffv1", "flac", "mkv", ["-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgr0", "-c:a", "flac", "-sample_fmt", "s16"], 8, True, True),
            ("ffv1-rgb16", "ffv1", "pcm_s16le", "mkv", ["-c:v", "ffv1", "-level", "3", "-pix_fmt", "gbrp16le", "-c:a", "pcm_s16le"], 16, True, True),
            ("prores-pcm", "prores", "pcm_s16le", "mov", ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"], 8, False, True),
        ]
        if receipt["inventory"]["libopus_available"]:
            profiles.append(("vp9-opus-webm", "vp9", "opus", "webm", ["-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "4", "-crf", "24", "-b:v", "0", "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "128k"], 8, False, False))
        else:
            receipt["omissions"].append("VP9+Opus WebM not tested: optional libopus encoder is absent; no substitute codec used")
            require(not args.require_opus, "Required libopus/WebM positive cannot be verified")
        for name, codec, audio_codec, suffix, flags, depth, exact_video, exact_audio in profiles:
            progress("Encoding and fully independently decoding " + name)
            target = output / "exports" / (name + "." + suffix)
            runner.ff([*inputs(depth), "-map", "0:v:0", "-map", "1:a:0", "-frames:v", str(FRAMES), "-t", f"{FRAMES / FPS:.12f}", *flags, "-threads", "1", target])
            receipt["checks"][name] = dict(file_sha256=file_sha(target), bytes=target.stat().st_size,
                  video=video_check(runner, target, codec, rgb16 if depth == 16 else rgb8, exact=exact_video, depth=depth),
                  audio=audio_check(runner, target, audio_codec, pcm, exact_audio))
        progress("Encoding and independently decoding GIF palette workflow")
        gif = output / "exports/palette.gif"
        graph = "[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3[v]"
        runner.ff([*inputs()[:6], "-filter_complex", graph, "-map", "[v]", "-an", "-frames:v", str(FRAMES), "-loop", "0", gif])
        receipt["checks"]["gif-palette"] = dict(file_sha256=file_sha(gif), bytes=gif.stat().st_size, video=video_check(runner, gif, "gif", rgb8))
        progress("Encoding and independently checking every PNG16 sequence frame")
        sequence = output / "exports/png16"; sequence.mkdir()
        pattern = sequence / "frame-%04d.png"
        runner.ff([*inputs(16)[:6], "-map", "0:v:0", "-an", "-frames:v", str(FRAMES), "-c:v", "png", "-pix_fmt", "rgb48be", "-threads", "1", "-start_number", "1", pattern])
        members = sorted(sequence.glob("*.png")); require(len(members) == FRAMES, "PNG sequence member count differs")
        receipt["checks"]["png16-sequence"] = dict(member_sha256={p.name: file_sha(p) for p in members},
                 video=video_check(runner, pattern, "png", rgb16, exact=True, depth=16, sequence=True))
        for name, codec, suffix, flags, exact in [("aac-audio", "aac", "m4a", ["-c:a", "aac", "-b:a", "128k"], False),
                                                  ("flac-audio", "flac", "flac", ["-c:a", "flac", "-sample_fmt", "s16"], True)]:
            progress("Encoding and fully independently decoding " + name)
            target = output / "exports" / (name + "." + suffix)
            runner.ff(["-i", output / "sources/source.wav", "-vn", *flags, target])
            receipt["checks"][name] = dict(file_sha256=file_sha(target), bytes=target.stat().st_size, audio=audio_check(runner, target, codec, pcm, exact))
        receipt["status"] = "passed_with_optional_omission" if receipt["omissions"] else "passed"
    except BaseException as error:
        receipt.update(status="failed", error=type(error).__name__ + ": " + str(error))
    finally:
        if "source_sha256_before" in receipt:
            receipt["source_sha256_after"] = {str(p.relative_to(output)): file_sha(p) for p in (output / "sources").rglob("*") if p.is_file()}
            receipt["sources_unchanged"] = receipt["source_sha256_before"] == receipt["source_sha256_after"]
            if not receipt["sources_unchanged"]:
                receipt["status"] = "failed"
        receipt["binary_sha256_after"] = dict(ffmpeg=file_sha(ffmpeg), ffprobe=file_sha(ffprobe))
        receipt["binaries_unchanged"] = receipt["binary_sha256_before"] == receipt["binary_sha256_after"]
        if not receipt["binaries_unchanged"]:
            receipt["status"] = "failed"
        progress("Lean media smoke " + receipt["status"])
        print("Receipt: " + str(output / "receipt.json"), flush=True)
    return 0 if receipt["status"] == "passed" else 2 if receipt["status"] == "passed_with_optional_omission" else 1


if __name__ == "__main__":
    raise SystemExit(main())
