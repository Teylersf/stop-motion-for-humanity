"use strict";
// GPL-3.0-or-later. Synthetic ProjectStore/ExportManager archive proof; no GUI/device access.
// node scripts/mac-portable-project-proof.cjs --run
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const crc = require("buffer-crc32");
const { ProjectStore, hashFile, atomicWrite } = require("../desktop/store.cjs");
const { ExportManager } = require("../desktop/export.cjs");
const { pngInfo } = require("../desktop/security.cjs");
const root = path.resolve(__dirname, ".."), mediaDir = path.join(root, "resources/media/darwin-arm64");
const receiptPath = path.join(root, "docs/validation/mac-portable-project-engine.json");
const sourceNames = ["scripts/mac-portable-project-proof.cjs", "desktop/store.cjs", "desktop/export.cjs", "desktop/archive.cjs", "desktop/formats.cjs", "desktop/targets.cjs", "desktop/security.cjs", "assets/export-profiles.json"];
function assert(value, message) { if (!value) throw new Error(message); }
async function fileRecord(file) { return { bytes: (await fs.stat(file)).size, sha256: await hashFile(file) }; }
async function sources() { const result = []; for (const name of sourceNames) result.push({ name, sha256: await hashFile(path.join(root, name)) }); return result; }
function chunk(name, data) { const type = Buffer.from(name), size = Buffer.alloc(4); size.writeUInt32BE(data.length); return Buffer.concat([size, type, data, crc(Buffer.concat([type, data]))]); }
function png(index) {
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(24, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((32 * 4 + 1) * 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) { const p = y * 129 + 1 + x * 4; raw[p] = (x * 7 + index * 31) % 256; raw[p + 1] = (y * 9 + index * 59) % 256; raw[p + 2] = (x ^ y ^ index) * 3; raw[p + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function wav() {
  const samples = 4800, header = Buffer.alloc(44), pcm = Buffer.alloc(samples * 4);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  for (let i = 0; i < samples; i++) { pcm.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 440 * i / 48000)), i * 4); pcm.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * 660 * i / 48000)), i * 4 + 2); }
  return Buffer.concat([header, pcm]);
}
function frame(asset, hold, enabled, exposure) {
  return { id: crypto.randomUUID(), assetId: asset.id, hold, enabled, note: "Synthetic non-destructive metadata", cue: "cue", capturedAt: new Date().toISOString(), source: { type: "demo", width: 32, height: 24 },
    edits: { exposure, contrast: 1.1, saturation: 0.9, temperature: 0.1, flipX: true, flipY: false, rotation: 90, crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, keyColor: null, keyTolerance: 0.15, maskStrokes: [], drawings: [] } };
}
const auditAndExtract = String.raw`
import copy,hashlib,json,os,stat,sys,zipfile
from pathlib import Path,PurePosixPath
archive,source,destination=map(Path,sys.argv[1:4]);verify=sys.argv[4]=='true'
assert not destination.exists(),'Extraction destination must be NEW'
p=json.loads(source.read_text())
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
def sha(v):return hashlib.sha256(v).hexdigest()
with zipfile.ZipFile(archive) as z:
 infos=z.infolist();names=[i.filename for i in infos]
 assert len(names)==len(set(names)) and len(names)<100
 assert sum(i.file_size for i in infos)<16*1024*1024
 for i in infos:
  part=PurePosixPath(i.filename);mode=i.external_attr>>16
  assert not part.is_absolute() and str(part)==i.filename and '..' not in part.parts and chr(92) not in i.filename and ':' not in i.filename
  assert stat.S_IFMT(mode) in (0,stat.S_IFREG) and not i.is_dir() and not i.flag_bits&1
 assert z.testzip() is None,'ZIP CRC mismatch'
 m=json.loads(z.read('manifest.json'));q=json.loads(z.read('project.humanity.json'))
 assert m['profile']=='originals' and m['scope']=='full-project' and m['sourceProjectId']==p['id'] and m['verificationRequested']==verify
 assert q['id']==m['projectId'] and q['id']!=p['id']
 assert q['fps']==m['fps']==m['sourceFps']==p['fps']==12 and m['preserveTiming'] is False
 assert (q['width'],q['height'])==(32,24) and (m['width'],m['height'])==(640,360)
 normalized=copy.deepcopy(q);normalized['id']=p['id']
 for a in normalized['assets']:a['url']='humanity://app/asset/'+p['id']+'/'+a['id']
 assert canonical(normalized)==canonical(p),'Project metadata changed beyond new ID/URLs'
 expected={'manifest.json','project.humanity.json','README.txt'}|{'assets/'+a['fileName'] for a in p['assets']}
 assert set(names)==expected and len(m['files'])==len(p['assets'])==4
 assets=[]
 for a,item in zip(p['assets'],m['files']):
  name='assets/'+a['fileName'];data=z.read(name);digest=sha(data)
  assert item['name']==name and item['assetId']==a['id'] and item['kind']==a['kind'] and item['editsApplied'] is False
  assert digest==a['sha256']==sha((source.parent/name).read_bytes()) and len(data)==a['byteLength']
  assert item['sha256' if verify else 'recordedSourceSha256']==digest
  assets.append({'kind':a['kind'],'name':name,'bytes':len(data),'sha256':digest})
 frames=[f for scene in p['scenes'] for f in scene['frames'] if f['enabled']]
 assert len(m['sequence'])==len(frames)==2 and m['frames']==sum(f['hold'] for f in frames)==6
 assert all(a['assetId']==b['assetId'] and a['hold']==b['hold'] for a,b in zip(m['sequence'],frames))
 assert len(q['scenes'])==2 and len(q['audio'])==1 and [f['hold'] for s in q['scenes'] for f in s['frames']]==[2,3,4]
 assert [f['enabled'] for s in q['scenes'] for f in s['frames']]==[True,False,True]
 destination.mkdir(mode=0o700)
 for i in infos:
  target=destination.joinpath(*PurePosixPath(i.filename).parts)
  assert target.resolve().is_relative_to(destination.resolve())
  target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with target.open('xb') as out:
   os.chmod(target,0o600);out.write(z.read(i.filename));out.flush();os.fsync(out.fileno())
 for a in assets:assert sha((destination/a['name']).read_bytes())==a['sha256']
 print(json.dumps({'status':'passed','newProjectId':q['id'],'sourceProjectId':p['id'],'members':len(names),'crcVerified':True,'allSourceAssetsIncludedExactlyOnce':True,'allScenesFramesHoldsEnabledStatusesEditsAudioAndSourceFpsPreserved':True,'noRetimingOrSourceScaling':True,'safeNewExtraction':True,'assets':assets}))
`;

async function main() {
  if (!process.argv.includes("--run")) { console.log("Manual-only: node scripts/mac-portable-project-proof.cjs --run"); return; }
  assert(process.platform === "darwin" && process.arch === "arm64", "Mac ARM64 proof required");
  try { await fs.access(receiptPath); throw new Error("Preserve existing portable proof receipt before an intentional rerun"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  await fs.mkdir(path.join(root, "out/validation"), { recursive: true });
  const work = await fs.mkdtemp(path.join(root, "out/validation/mac-portable-engine-"));
  const record = { schemaVersion: 1, app: "Stop Motion for Humanity", status: "running", kind: "macos-portable-project-engine-proof", testedAt: new Date().toISOString(), sourceRevision: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sourceFiles: await sources(),
    scope: ["Actual ProjectStore/ExportManager, both default-off and opt-in Originals paths", "Synthetic three 32×24 PNGs plus one short stereo tone only; no camera, app UI or user profile access", "Python standard library is an independent development ZIP auditor/extractor only; no Python is shipped in the app", "This is a development-engine proof, not installed GUI reopen evidence"], cases: [], runtime: {} };
  let manager, store;
  try {
    for (const name of ["ffmpeg", "ffprobe"]) record.runtime[name] = await fileRecord(path.join(mediaDir, name));
    store = new ProjectStore({ dataDir: path.join(work, "state"), imageInfo: async file => pngInfo(await fs.readFile(file)), audioInfo: file => manager.audioInfo(file) });
    manager = new ExportManager({ store, mediaDir, hardware: false }); await store.init();
    const { project } = await store.create(work, "Synthetic portable full-project proof"); project.width = 32; project.height = 24; project.fps = 12;
    for (let index = 0; index < 3; index++) project.assets.push(await store.addBytes(project.id, png(index), "image", "image/png", { type: "demo" }, `synthetic-${index}.png`));
    const audioPath = path.join(work, "source-tone.wav"); await fs.writeFile(audioPath, wav(), { flag: "wx" });
    const audio = await store.addFile(project.id, audioPath, "audio"); project.assets.push(audio);
    project.scenes[0].frames = [frame(project.assets[0], 2, true, 0.25), frame(project.assets[1], 3, false, -0.5)];
    project.scenes.push({ id: crypto.randomUUID(), name: "Scene 2", notes: "A distinct second scene", frames: [frame(project.assets[1], 4, true, 0.75)], referenceAssetId: null, cleanPlateAssetId: null });
    project.audio = [{ id: crypto.randomUUID(), assetId: audio.id, name: "Synthetic stereo tone", startFrame: 1, inSeconds: 0.01, outSeconds: 0.09, gain: 0.7, muted: false, fadeInSeconds: 0.01, fadeOutSeconds: 0.02 }];
    project.settings.title = "Metadata remains editable"; await store.save(project);
    const source = structuredClone(store.entry(project.id).project), sourceFile = path.join(store.entry(project.id).root, "project.humanity.json"), sourceBefore = await fileRecord(sourceFile);
    record.sourceProject = { width: 32, height: 24, fps: 12, scenes: 2, frames: 3, enabledFrames: 2, holds: [2, 3, 4], enabled: [true, false, true], outputExposures: 6, assets: 4, imageAssets: 3, audioAssets: 1, audioClips: 1, retainedUnusedImageAssets: 1, nonDefaultEdits: true };
    const ids = [];
    for (const verify of [false, true]) {
      const label = verify ? "opt-in" : "default-off", output = path.join(work, `${label}.zip`), destination = path.join(work, `extracted-${label}`);
      const requested = { profile: "originals", width: 640, height: 360, fps: 24, totalFrames: 6, sceneId: null, audio: true, preserveTiming: true, verify };
      const session = await manager.begin(source, requested, output), frozen = manager.session(session.id).options;
      assert(frozen.fps === 12 && frozen.preserveTiming === false, "Originals did not preserve source timing");
      const result = await manager.finish(session.id); assert(result.verified === verify && result.frames === 6, "Unexpected native archive result");
      const audit = JSON.parse(execFileSync("/usr/bin/python3", ["-c", auditAndExtract, output, sourceFile, destination, String(verify)], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 }));
      assert(audit.status === "passed", "Independent ZIP audit failed");
      const reopened = await store.open(path.join(destination, "project.humanity.json"));
      assert(reopened.project.id === audit.newProjectId && reopened.project.id !== source.id && !reopened.recovered, "Actual ProjectStore.open did not open the extracted new project");
      assert(JSON.stringify(reopened.project.scenes) === JSON.stringify(source.scenes) && JSON.stringify(reopened.project.audio) === JSON.stringify(source.audio), "Store reopened different scene/audio metadata");
      for (const asset of reopened.project.assets) await store.assetPath(reopened.project.id, asset.id, { verify: true });
      ids.push(reopened.project.id);
      record.cases.push({ verificationRequested: verify, applicationResultVerified: result.verified, status: "passed", requestedOptions: requested, effectiveSourceFps: frozen.fps, effectivePreserveTiming: frozen.preserveTiming,
        archive: { name: `${label}.zip`, ...await fileRecord(output) }, independentZIPAudit: audit, actualProjectStoreOpenPassed: true, allReopenedAssetHashesMatch: true, notes: result.notes });
    }
    assert(new Set(ids).size === 2, "Each portable export must get its own new project ID");
    assert(JSON.stringify(await fileRecord(sourceFile)) === JSON.stringify(sourceBefore), "Source project changed");
    for (const asset of source.assets) await store.assetPath(source.id, asset.id, { verify: true });
    assert(await hashFile(audioPath) === audio.sha256, "Original external audio source changed");
    record.sourceProjectAndAllOriginalsUnchanged = true; record.eachArchiveHasDistinctProjectId = true;
    record.noOwnedSessionsOrMediaWorkersRemain = manager.sessions.size === 0 && manager.children.size === 0;
    assert(record.noOwnedSessionsOrMediaWorkersRemain, "Owned worker/session remained"); record.status = "passed";
  } catch (error) { record.status = "failed"; record.failure = String(error.message).split(work).join("<owned-work>").split(root).join("<source-root>").split(os.homedir()).join("<home>"); }
  finally {
    await manager?.close(); await store?.close(); record.sourceFilesAfter = await sources(); record.sourceFilesUnchanged = JSON.stringify(record.sourceFiles) === JSON.stringify(record.sourceFilesAfter);
    record.runtimeAfter = {}; for (const name of ["ffmpeg", "ffprobe"]) record.runtimeAfter[name] = await fileRecord(path.join(mediaDir, name));
    record.runtimeUnchanged = JSON.stringify(record.runtimeAfter) === JSON.stringify(record.runtime); if (!record.sourceFilesUnchanged || !record.runtimeUnchanged) record.status = "failed";
    record.completedAt = new Date().toISOString(); const text = JSON.stringify(record, null, 2).split(work).join("<owned-work>").split(root).join("<source-root>").split(os.homedir()).join("<home>");
    await atomicWrite(path.join(work, "receipt.json"), text); await fs.mkdir(path.dirname(receiptPath), { recursive: true }); await atomicWrite(receiptPath, text);
    console.log(JSON.stringify({ status: record.status, receipt: "docs/validation/mac-portable-project-engine.json", sha256: await hashFile(receiptPath), failure: record.failure }));
  }
  if (record.status !== "passed") process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
