"use strict";
// GPL-3.0-or-later. Manual Mac development-engine proof; never runs in *.test.cjs.
// node scripts/mac-native8k-proof.cjs --run
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const crc = require("buffer-crc32");
const { ProjectStore, hashFile, atomicWrite } = require("../desktop/store.cjs");
const { ExportManager, run } = require("../desktop/export.cjs");
const { pngInfo } = require("../desktop/security.cjs");
const { canonicalTarget } = require("../desktop/targets.cjs");

const root = path.resolve(__dirname, ".."), width = 7680, height = 4320, fps = 24, count = 2;
const frameBytes = width * height * 4;
const mediaDir = path.join(root, "resources", "media", "darwin-arm64");
const ffmpeg = path.join(mediaDir, "ffmpeg"), ffprobe = path.join(mediaDir, "ffprobe");
const receiptPath = path.join(root, "docs", "validation", "native8k-macos-arm64.json");
const sourceNames = ["scripts/mac-native8k-proof.cjs", "package.json", "package-lock.json", "desktop/export.cjs", "desktop/store.cjs", "desktop/security.cjs", "desktop/formats.cjs", "desktop/targets.cjs", "desktop/archive.cjs", "assets/export-profiles.json"];
const pins = {
  ffmpeg: { bytes: 40152272, sha256: "85d7dca060f19d6f27ff4b6f91c8862df838998c4b646eb56101fc0f5a67bf0d" },
  ffprobe: { bytes: 39978192, sha256: "401c5826763abc40497549f80a73f2aec1b70006d410cc13077011c50f88cca7" }
};
function assert(value, message) { if (!value) throw new Error(message); }
function sha(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function sanitize(value, work) {
  return String(value).split(work).join("<owned-work>").split(mediaDir).join("<bundled-media>").split(root).join("<source-root>").split(os.homedir()).join("<home>");
}
async function fileRecord(file) { return { bytes: (await fs.stat(file)).size, sha256: await hashFile(file) }; }
async function sourceHashes() {
  const result = [];
  for (const name of sourceNames) result.push({ name, sha256: await hashFile(path.join(root, name)) });
  return result;
}
function revision() { return execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
function bounded(action, milliseconds, name) {
  let timer;
  return Promise.race([action, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} exceeded ${milliseconds / 1000}s`)), milliseconds); })]).finally(() => clearTimeout(timer));
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  return Buffer.concat([size, name, data, crc(Buffer.concat([name, data]))]);
}
function procedural(index, aggregate) {
  const header = Buffer.alloc(13), rowBytes = width * 4 + 1;
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(rowBytes * height), frameHash = crypto.createHash("sha256");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * rowBytes + 1 + x * 4;
      raw[offset] = (x + y % 17 + index * 17) % 256;
      raw[offset + 1] = ((x >> 3) + (y >> 1) + index * 53) % 256;
      raw[offset + 2] = ((x ^ y) + index * 97) % 256;
      raw[offset + 3] = x % 113 === 0 ? (index ? 192 : 128) : 255;
    }
    const samples = raw.subarray(y * rowBytes + 1, (y + 1) * rowBytes);
    aggregate.update(samples); frameHash.update(samples);
  }
  return {
    png: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]),
    expectedRGBA: { bytes: frameBytes, sha256: frameHash.digest("hex") }
  };
}
function frame(asset) {
  return { id: crypto.randomUUID(), assetId: asset.id, hold: 1, note: "Procedural sample only", cue: "", capturedAt: new Date().toISOString(), source: { type: "demo", width, height }, enabled: true,
    edits: { exposure: 0, contrast: 1, saturation: 1, temperature: 0, flipX: false, flipY: false, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, keyColor: null, keyTolerance: 0.15, maskStrokes: [], drawings: [] } };
}
function independentRGBA(file) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-xerror", "-nostdin", "-threads", "2", "-i", file, "-map", "0:v:0", "-an", "-pix_fmt", "rgba", "-fps_mode", "passthrough", "-c:v", "rawvideo", "-threads", "1", "-f", "rawvideo", "pipe:1"];
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const aggregate = crypto.createHash("sha256"), frames = [];
    let bytes = 0, frameOffset = 0, current = crypto.createHash("sha256"), diagnostic = "", expired = false;
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 180000);
    child.stderr.on("data", data => { diagnostic = (diagnostic + data.toString()).slice(-4000); });
    child.stdout.on("data", data => {
      aggregate.update(data); bytes += data.length;
      for (let offset = 0; offset < data.length;) {
        const amount = Math.min(frameBytes - frameOffset, data.length - offset);
        current.update(data.subarray(offset, offset + amount)); offset += amount; frameOffset += amount;
        if (frameOffset === frameBytes) { frames.push(current.digest("hex")); current = crypto.createHash("sha256"); frameOffset = 0; }
      }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || expired) return reject(new Error(`Independent owned RGBA decode failed: ${expired ? "timeout" : signal || code}; ${diagnostic}`));
      if (frameOffset !== 0) return reject(new Error("Independent raw decode ended within a frame"));
      resolve({ decoder: "bundled FFmpeg in a separate read-back process", canonicalPixelFormat: "rgba", bytes, frames: frames.length, frameSHA256: frames, sha256: aggregate.digest("hex") });
    });
  });
}

async function main() {
  if (!process.argv.includes("--run")) { console.log("Manual-only: node scripts/mac-native8k-proof.cjs --run"); return; }
  assert(process.platform === "darwin" && process.arch === "arm64", "This proof requires native macOS ARM64");
  try { await fs.access(receiptPath); throw new Error("Mac proof receipt already exists; preserve it before an intentional rerun"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  // Only this process and its future children receive this environment policy.
  for (const key of Object.keys(process.env)) if (/^(DYLD_|PYTHONHOME$|PYTHONPATH$)/.test(key)) delete process.env[key];
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  await fs.mkdir(path.join(root, "out", "validation"), { recursive: true });
  const work = await fs.mkdtemp(path.join(root, "out", "validation", "mac-native8k-"));
  const checkpoint = path.join(work, "receipt.json"), started = performance.now();
  const record = {
    schemaVersion: 1, app: "Stop Motion for Humanity", version: require("../package.json").version,
    status: "running", kind: "macos-arm64-development-export-engine-proof", testedAt: new Date().toISOString(),
    platform: process.platform, architecture: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model,
    sourceRevision: revision(), sourceFiles: await sourceHashes(), cases: [],
    input: { source: "Two deterministic native-raster procedural RGBA8 PNGs; no human camera images", width, height, fps, generatedFrames: count, alpha: "Periodic alpha=128/192 plus opaque pixels exercise all four stored channels" },
    runtime: { expectedPins: pins, components: {}, processEnvironment: "System-only PATH; no inherited DYLD/PYTHONHOME/PYTHONPATH overrides", hardwareEncoderRequired: false },
    scope: ["Application ExportManager/ProjectStore engine invoked directly with verify:true; no installed GUI or camera proof", "Two native 7680×4320 frames, with independent full RGBA byte and sample hashing", "Short offline correctness proof only; no sustained/realtime 8K or GPU-render performance claim", "RGBA8 source/render contract only; no higher-precision sensor acquisition claim", "No audio; audio behavior is covered by separate tests", "Fresh owned project/output only; no existing app profiles, services or user media accessed"]
  };
  let manager, store, failure;
  const saveCheckpoint = () => atomicWrite(checkpoint, JSON.stringify(record, null, 2));
  try {
    for (const name of ["ffmpeg", "ffprobe"]) {
      record.runtime.components[name] = await fileRecord(path.join(mediaDir, name));
      assert(JSON.stringify(record.runtime.components[name]) === JSON.stringify(pins[name]), `Bundled ${name} differs from frozen v5 pin`);
    }
    record.runtime.ffmpegVersion = (await run(ffmpeg, ["-hide_banner", "-version"])).split(/\r?\n/)[0];
    record.runtime.manifestSHA256 = await hashFile(path.join(mediaDir, "runtime-manifest.json"));
    await saveCheckpoint();
    store = new ProjectStore({ dataDir: path.join(work, "native-state"), imageInfo: async file => pngInfo(await fs.readFile(file)), audioInfo: file => manager.audioInfo(file) });
    manager = new ExportManager({ store, mediaDir, hardware: false, onProgress: p => console.log(JSON.stringify({ phase: p.phase, frames: p.frames, totalFrames: p.totalFrames })) });
    await store.init();
    const { project } = await store.create(work, "Mac native 8K procedural engine proof");
    project.width = width; project.height = height; project.fps = fps;
    const expected = crypto.createHash("sha256"), expectedFrames = [];
    for (let index = 0; index < count; index++) {
      console.log(`Generating procedural 8K frame ${index + 1}/${count}`);
      const sample = procedural(index, expected), asset = await store.addBytes(project.id, sample.png, "image", "image/png", { type: "demo", width, height }, `procedural-${index + 1}.png`);
      expectedFrames.push(sample.expectedRGBA.sha256); project.assets.push(asset); project.scenes[0].frames.push(frame(asset));
    }
    record.input.expectedRGBA = { bytes: count * frameBytes, frameSHA256: expectedFrames, sha256: expected.digest("hex") };
    record.input.assets = project.assets.map(asset => ({ name: asset.originalName, width: asset.width, height: asset.height, bitDepth: asset.bitDepth, bytes: asset.byteLength, sha256: asset.sha256 }));
    await store.save(project); await saveCheckpoint();
    const output = path.join(work, "ffv1-native8k.mkv"), begin = performance.now();
    const options = { profile: "ffv1", width, height, fps, totalFrames: count, sceneId: null, audio: false, verify: true, preserveTiming: true };
    const session = await bounded(manager.begin(project, options, output), 60000, "Export begin");
    for (const item of project.scenes[0].frames) await bounded(manager.frame(session.id, { png: await fs.readFile(await store.assetPath(project.id, item.assetId, { verify: true })), repeat: 1 }), 90000, "Frame submission");
    const result = await bounded(manager.finish(session.id), 240000, "Export and engine verification");
    assert(result.verified === true && result.frames === count && result.width === width && result.height === height, "Application engine returned unexpected verification/result fields");
    const outputRecord = await fileRecord(output);
    const metadata = JSON.parse(await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-show_entries", "stream=codec_name,pix_fmt,width,height,time_base:frame=best_effort_timestamp,width,height", "-of", "json", output], { timeout: 180000 }));
    const video = metadata.streams?.[0], frames = metadata.frames || [];
    assert(video?.codec_name === "ffv1" && video.width === width && video.height === height && frames.length === count, "Independent full frame metadata mismatch");
    const [numerator, denominator] = video.time_base.split("/").map(Number), tick = numerator / denominator;
    const timestamps = frames.map((item, index) => {
      assert(item.width === width && item.height === height, "A decoded frame changed dimensions");
      const actual = Number(item.best_effort_timestamp) * tick;
      assert(Math.abs(actual - index / fps) <= tick / 2 + 0.000001, "Decoded frame PTS differs from 24fps grid"); return actual;
    });
    const decoded = await independentRGBA(output);
    assert(decoded.bytes === count * frameBytes && decoded.frames === count, "Full RGBA decode byte/frame count mismatch");
    assert(decoded.sha256 === record.input.expectedRGBA.sha256 && JSON.stringify(decoded.frameSHA256) === JSON.stringify(expectedFrames), "Decoded RGBA differs from independently generated procedural samples");
    assert(JSON.stringify(await fileRecord(output)) === JSON.stringify(outputRecord), "Output changed during independent read-back");
    record.cases.push({ profile: "ffv1", status: "passed", options, applicationEngineVerified: result.verified, target: canonicalTarget("ffv1").label,
      width, height, frames: count, output: { name: "ffv1-native8k.mkv", ...outputRecord }, video: { codec: video.codec_name, pixelFormat: video.pix_fmt, timeBase: video.time_base, timestampsSeconds: timestamps },
      independentRGBA: decoded, expectedSamplesMatch: true, secondsIncludingAllVerification: Number(((performance.now() - begin) / 1000).toFixed(3)), notes: result.notes.map(note => sanitize(note, work)) });
    for (const asset of project.assets) await store.assetPath(project.id, asset.id, { verify: true });
    record.input.originalsUnchanged = true;
    record.noOwnedExportSessionsRemain = manager.sessions.size === 0;
    record.noOwnedMediaWorkersRemain = manager.children.size === 0;
    assert(record.noOwnedExportSessionsRemain && record.noOwnedMediaWorkersRemain, "Owned engine worker/session remained");
    record.status = "passed";
  } catch (error) {
    failure = error; record.status = "failed"; record.failure = { message: sanitize(error.message, work) };
  } finally {
    await manager?.close(); await store?.close();
    record.sourceFilesAfter = await sourceHashes();
    record.sourceFilesUnchangedDuringRun = JSON.stringify(record.sourceFiles) === JSON.stringify(record.sourceFilesAfter);
    record.sourceRevisionAtFinish = revision();
    record.runtime.componentsAfter = {};
    for (const name of ["ffmpeg", "ffprobe"]) record.runtime.componentsAfter[name] = await fileRecord(path.join(mediaDir, name));
    record.runtime.binariesUnchanged = JSON.stringify(record.runtime.components) === JSON.stringify(record.runtime.componentsAfter);
    if (!record.sourceFilesUnchangedDuringRun || !record.runtime.binariesUnchanged) { record.status = "failed"; record.failure = { message: "Source files or media executables changed during proof" }; }
    record.completedAt = new Date().toISOString(); record.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
    await saveCheckpoint(); await fs.mkdir(path.dirname(receiptPath), { recursive: true }); await atomicWrite(receiptPath, JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ status: record.status, receipt: "docs/validation/native8k-macos-arm64.json", sha256: await hashFile(receiptPath) }));
  }
  if (failure || record.status !== "passed") process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
