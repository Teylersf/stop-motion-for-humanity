"use strict";
// GPL-3.0-or-later. Owned, bounded FFmpeg workers and atomic, verified outputs.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const { bytes, geometry, pngInfo, pngHeaderInfo, finite, assertId, boundedJSON } = require("./security.cjs");
const { validateProject, syncWrite, hashFile, assetURL } = require("./store.cjs");
const {verifyArchive}=require("./archive.cjs");
const {createHash}=require("node:crypto");
const { canonicalTarget, precisionNotes, LINEAR_EXR_FILTER, colorPolicy } = require("./targets.cjs");
const {profiles,getProfile,validateProfileGeometry,encoderPlan,planTiming,canonicalFrameRate}=require("./formats.cjs");
const PROFILES=new Set(profiles.map(profile=>profile.id));
const INPUT_POLICY = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,mp3,wav,flac,ogg,matroska,webm,aiff,aac,png_pipe,jpeg_pipe,jpegls_pipe,jpeg2000_pipe,jxl_pipe,webp_pipe,bmp_pipe,tiff_pipe,dpx_pipe,exr_pipe,gif,image2,image2pipe,nut,mxf,avi"];
const EXTENSIONS=Object.fromEntries(profiles.map(profile=>[profile.id,profile.extension]));
function boundedTail(value, next, max = 10000) { return (value + next).slice(-max); }
function worker(executable, args, { stdoutLimit = 2 * 1024 * 1024, timeout = 120000, children, owner = null } = {}) {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    children?.add(child);
    child.humanityOwner = owner;
    let out = "", err = "", finished = false;
    child.stdin.on("error", () => { });
    const done = new Promise(resolve => {
        const timer = setTimeout(() => { err = boundedTail(err, "\nMedia operation reached its time limit"); child.kill("SIGKILL"); }, timeout);
        timer.unref?.();
        child.stdout.on("data", chunk => { if (out.length + chunk.length > stdoutLimit) {
            err = boundedTail(err, "\nMedia diagnostic output exceeded its limit");
            child.kill("SIGKILL");
        }
        else
            out += chunk; });
        child.stderr.on("data", chunk => { err = boundedTail(err, chunk.toString()); });
        const settle = (result) => { if (finished)
            return; finished = true; clearTimeout(timer); children?.delete(child); resolve({ ...result, stdout: out, stderr: err }); };
        child.on("error", error => settle({ code: -1, error: error.message }));
        child.on("close", (code, signal) => settle({ code, signal }));
    });
    return { child, done };
}
async function run(executable, args, options = {}) { const w = worker(executable, args, options); w.child.stdin.end(); const r = await w.done; if (r.code !== 0)
    throw new Error((r.error || r.stderr || `Media worker exited ${r.code}`).slice(-10000)); return r.stdout; }
async function writePipe(child, buffer) { if (child.exitCode !== null || child.killed || child.stdin.destroyed)
    throw new Error("The media encoder stopped; see export details"); await new Promise((resolve, reject) => child.stdin.write(buffer, error => error ? reject(error) : resolve())); }
function validateOptions(options) {
 const o=boundedJSON(options,16000);if(!PROFILES.has(o.profile))throw new Error("Unsupported export profile");
 geometry(o.width,o.height);finite(o.fps,1,120,"export frame rate");if(!Number.isInteger(o.totalFrames)||o.totalFrames<1||o.totalFrames>100000)throw new Error("Export requires 1..100,000 output frames");
 if(typeof o.audio!=="boolean")throw new Error("Invalid audio setting");if(o.sceneId!==null)assertId(o.sceneId);if(o.profile==="originals"&&o.sceneId!==null)throw new Error("Originals is a full portable-project archive. Choose all scenes in order; processed sequence formats can export one scene.");if(o.preserveTiming!==undefined&&typeof o.preserveTiming!=="boolean")throw new Error("Invalid duration-preserving conform setting");
 if(o.verify!==undefined&&typeof o.verify!=="boolean")throw new Error("Invalid verification option");const validated=validateProfileGeometry(o.profile,o);return {...o,fps:validated.fps,verify:o.verify===true};
}
class ExportManager {
    constructor({ store, mediaDir, onProgress = () => { }, checkPNG = pngInfo, hardware = true }) { this.store = store; this.mediaDir = mediaDir; this.onProgress = onProgress; this.checkPNG = checkPNG; this.hardware = hardware; this.sessions = new Map(); this.results = new Map(); this.children = new Set(); this.infoPromise = null; this.ffmpeg = path.join(mediaDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"); this.ffprobe = path.join(mediaDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"); }
    async mediaInfo() { if (!this.infoPromise)
        this.infoPromise = (async () => { try {
            const output = await run(this.ffmpeg, ["-hide_banner", "-encoders"], { children: this.children, timeout: 15000 });
            const encoders = output.split(/\r?\n/).map(line => line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/)?.[1]).filter(Boolean);
            return { mediaAvailable: true, encoders };
        }
        catch {
            return { mediaAvailable: false, encoders: [] };
        } })(); return this.infoPromise; }
    async probe(file, owner = null) { const text = await run(this.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", ...INPUT_POLICY, file], { children: this.children, owner, timeout: 30000 }); return JSON.parse(text); }
    async imageInfo(file, nativeImage) {
        const extension=path.extname(file).toLowerCase();
        const png=extension===".png"?pngInfo(await fs.readFile(file)):null;
        const browserCompatible=[".png",".jpg",".jpeg",".webp",".bmp",".gif"].includes(extension);
        let image=nativeImage.createFromPath(file);
        if(browserCompatible&&!image.isEmpty()) {const size=image.getSize();geometry(size.width,size.height);return {...size,bitDepth:png?.bitDepth||8};}
        const metadata=await this.probe(file),video=metadata.streams?.find(stream=>stream.codec_type==="video");
        if(!video)throw new Error("The image has no supported picture stream");geometry(video.width,video.height);
        let bitDepth=Number(video.bits_per_raw_sample)||0;
        if(!bitDepth){const format=video.pix_fmt||"";bitDepth=/f32/.test(format)?32:/rgba64|bgra64|rgb48|bgr48/.test(format)?16:Number(format.match(/(?:p|gray|y)(\d{1,2})(?:le|be)?$/)?.[1])||8;}
        const preview=await this.makePreview(file);image=nativeImage.createFromBuffer(preview);if(image.isEmpty())throw new Error("Image decoder could not produce a viewing preview");
        return {width:video.width,height:video.height,bitDepth,preview};
    }
    async makePreview(file) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "humanity-preview-")), target = path.join(dir, "preview.png"); try {
        await run(this.ffmpeg, ["-v", "error", "-threads", "2", ...INPUT_POLICY, "-i", file, "-frames:v", "1", "-c:v", "png", target], { children: this.children, timeout: 60000 });
        return await fs.readFile(target);
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true });
    } }
    async audioInfo(file) { const p = await this.probe(file), audio = p.streams?.find(s => s.codec_type === "audio"); if (!audio)
        throw new Error("No decodable audio stream in this file"); const duration = Number(audio.duration || p.format?.duration); if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
        throw new Error("Audio duration must be between zero and one day"); return { duration }; }
    progress(s, phase, message) { this.onProgress({ id: s.id, phase, frames: s.frames, totalFrames: s.options.totalFrames, ...(message ? { message } : {}) }); }
    async audioPlan(project,options) {
      if(!options.audio||!getProfile(options.profile).audioCodec)return {args:[],filter:null};
      const args=[],filters=[],labels=[],sourceFps=canonicalFrameRate(project.fps);
      const speed=options.preserveTiming===false?options.fps/sourceFps:1;
      let sceneOffset=0;
      if(options.sceneId!==null){for(const scene of project.scenes){if(scene.id===options.sceneId)break;sceneOffset+=scene.frames.filter(frame=>frame.enabled).reduce((n,frame)=>n+frame.hold,0);}sceneOffset/=sourceFps;}
      let index=1;
      for(const clip of project.audio){
        if(clip.muted||clip.gain===0)continue;
        const asset=project.assets.find(asset=>asset.id===clip.assetId),end=Math.min(clip.outSeconds??asset.duration??86400,asset.duration??86400),length=end-clip.inSeconds;
        const localStart=clip.startFrame/sourceFps-sceneOffset,cut=Math.max(0,-localStart);
        if(length<=cut||localStart/speed>=options.totalFrames/options.fps)continue;
        const file=await this.store.assetPath(project.id,clip.assetId,{verify:options.verify});args.push(...INPUT_POLICY,"-i",file);
        const chain=["aresample=48000",`atrim=start=${clip.inSeconds}:end=${end}`,"asetpts=N/SR/TB",`volume=${clip.gain}`];
        if(clip.fadeInSeconds>0)chain.push(`afade=t=in:st=0:d=${Math.min(length,clip.fadeInSeconds)}`);
        if(clip.fadeOutSeconds>0)chain.push(`afade=t=out:st=${Math.max(0,length-clip.fadeOutSeconds)}:d=${Math.min(length,clip.fadeOutSeconds)}`);
        if(cut>0)chain.push(`atrim=start_sample=${Math.round(cut*48000)}`,"asetpts=N/SR/TB");
        let tempo=speed;while(tempo>2){chain.push("atempo=2");tempo/=2;}while(tempo<0.5){chain.push("atempo=0.5");tempo/=0.5;}if(Math.abs(tempo-1)>0.000000001)chain.push(`atempo=${tempo}`);
        chain.push(`adelay=${Math.round(Math.max(0,localStart)/speed*48000)}S:all=1`);
        const label=`mix${index}`;filters.push(`[${index}:a]${chain.join(",")}[${label}]`);labels.push(`[${label}]`);index++;
      }
      if(!labels.length)return {args:[],filter:null};
      const samples=Math.round(options.totalFrames/options.fps*48000);filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,apad,atrim=end_sample=${samples},asetpts=N/SR/TB[audio]`);
      return {args,filter:filters.join(";")};
    }
    async choosePlan(project,options,encoders,notes) {
      const audio=options.audio&&project.audio.some(clip=>!clip.muted&&clip.gain>0);
      const first=encoderPlan(options.profile,{...options,audio,hardware:this.hardware},encoders,process.platform);
      const errors=[];
      for(const plan of [first,...first.fallbackPlans]) {
        if(plan.mustProbe) {
          try { await run(this.ffmpeg,["-v","error","-f","lavfi","-i",`color=size=${options.width}x${options.height}:rate=${plan.frameRate}`,"-frames:v","1",...plan.videoArgs,"-an","-f","null","-"],{children:this.children,timeout:45000});plan.hardwareVerified=true; }
          catch(error) {errors.push(`${plan.encoder}: ${error.message}`);continue;}
        }
        if(errors.length)notes.push("A hardware encoder failed its real geometry probe; a compatible encoder for the same requested format was selected.");
        notes.push(...plan.notes,...precisionNotes(options.profile));if(plan.hardwareVerified)notes.push(`Hardware encoder ${plan.encoder} passed an actual ${options.width}×${options.height} probe.`);
        return plan;
      }
      throw new Error(`No encoder passed the required hardware probe. ${errors.join("\n").slice(-6000)}`);
    }
    async begin(input, rawOptions, destination) {
        if (this.sessions.size)
            throw new Error("Finish or cancel the current export first");
        const e = this.store.entry(input.id), project = validateProject(input, e.assets), options = validateOptions(rawOptions);if(options.profile==="originals"){options.fps=canonicalFrameRate(project.fps);options.preserveTiming=false;}
        if (options.sceneId !== null && !project.scenes.some(sc => sc.id === options.sceneId))
            throw new Error("Unknown export scene");
        const sourceSelected=project.scenes.filter(sc=>options.sceneId===null||sc.id===options.sceneId).flatMap(sc=>sc.frames).filter(frame=>frame.enabled);
        const timing=planTiming(sourceSelected,project.fps,options.fps,options.preserveTiming!==false),selected=timing.entries.map(entry=>({...entry.frame,hold:entry.hold}));
        if(timing.totalFrames!==options.totalFrames)
            throw new Error("Export frame count does not match the selected project snapshot");
        const output = path.resolve(destination), assetsDir = path.join(e.root, "assets");
        if (output === path.join(e.root, "project.humanity.json") || output === path.join(e.root, "project.humanity.previous.json") || output.startsWith(assetsDir + path.sep))
            throw new Error("Export cannot overwrite project originals or saves");
        try {
            if ((await fs.lstat(output)).isSymbolicLink())
                throw new Error("Export destination cannot be a symbolic link");
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        const id = randomUUID(), spool = await fs.mkdtemp(path.join(os.tmpdir(), "humanity-export-")), temp = path.join(path.dirname(output), `.${path.basename(output)}.${id}.partial${EXTENSIONS[options.profile]}`);
        const s = { id, project, options, output, temp, spool, frames: 0, records: [], selected, sourceSelected, timing, notes: [], chain: Promise.resolve(), cancelled: false, finishing: false };
        try {
            if(options.verify)await this.verifySources(s);
            const info=await this.mediaInfo();s.plan=await this.choosePlan(project,options,info.encoders,s.notes);if(options.preserveTiming===false&&options.fps!==canonicalFrameRate(project.fps)&&options.audio)s.notes.push("Audio placement and tempo follow the reinterpreted frame rate; the tempo conversion preserves pitch.");
            s.target=canonicalTarget(options.profile);s.color=colorPolicy(s.plan);s.notes.push(s.color.interpretation);
            if(s.timing.outputFps!==s.timing.sourceFps)s.notes.push(options.preserveTiming===false?"Output rate reinterprets the held frame count; animation duration changes.":"Held frames were conformed with rounded boundaries to preserve animation duration at the requested output rate.");
            if(s.timing.droppedFrames)s.notes.push(`${s.timing.droppedFrames} source frame(s) have zero output exposure after down-conform. Original project assets remain intact.`);
            if(s.plan.kind==="movie") {
              if(!info.mediaAvailable)throw new Error("Bundled FFmpeg runtime is unavailable");
              const audio=await this.audioPlan(project,options);s.hasAudio=!!audio.filter;
              const args=["-v","error","-nostdin","-y","-threads","2","-f","image2pipe","-framerate",s.plan.frameRate,"-c:v","png","-i","pipe:0",...audio.args];
              if(audio.filter)args.push("-filter_complex",audio.filter);args.push("-map","0:v:0");if(audio.filter)args.push("-map","[audio]",...s.plan.audioArgs);else args.push("-an");
              if(s.color.filter)args.push("-vf",s.color.filter);args.push(...s.plan.videoArgs,...s.color.args,"-threads","4");if(s.plan.container==="mp4"||s.plan.container==="mov")args.push("-movflags","+faststart");
              args.push("-t",String(options.totalFrames/options.fps),"-f",s.plan.container,s.temp);
              s.worker=worker(this.ffmpeg,args,{children:this.children,owner:s.id,timeout:2*60*60*1000});
            }
            this.sessions.set(id, s);
            this.progress(s,s.options.verify?"rendering":"exporting");
            return { id, fileName: path.basename(output), profile: options.profile };
        }
        catch (error) {
            await fs.rm(spool, { recursive: true, force: true });
            throw error;
        }
    }
    async verifySources(s) { const ids = new Set(s.selected.map(frame => frame.assetId)); for (const scene of s.project.scenes.filter(scene => s.options.sceneId === null || scene.id === s.options.sceneId))
        for (const key of ["referenceAssetId", "cleanPlateAssetId"])
            if (scene[key])
                ids.add(scene[key]); for (const id of ids)
        await this.store.assetPath(s.project.id, id, { verify: true }); }
    session(id) { const s = this.sessions.get(assertId(id)); if (!s || s.cancelled)
        throw new Error("Export session is unavailable"); return s; }
    async frame(id,data){
      const s=this.session(id),action=s.chain.then(async()=>{
        if(s.cancelled||s.finishing)throw new Error("Export no longer accepts frames");if(s.plan.kind==="originals")throw new Error("Original project archive uses stored assets directly");
        const png=bytes(data.png),size=s.options.verify?this.checkPNG(png):pngHeaderInfo(png);if(size.width!==s.options.width||size.height!==s.options.height)throw new Error("Processed PNG size differs from export settings");
        if(!Number.isInteger(data.repeat)||data.repeat<1||data.repeat>10000||s.frames+data.repeat>s.options.totalFrames)throw new Error("Invalid frame hold or excess export frames");
        if(s.options.verify||s.plan.kind==="sequence"){
          const file=path.join(s.spool,`${String(s.records.length).padStart(8,"0")}.png`);await syncWrite(file,png);
          let record={file,repeat:data.repeat,...(s.options.verify?{sha256:await hashFile(file)}:{})};if(s.plan.kind==="sequence")record=await this.convertSequenceRecord(s,record);s.records.push(record);
        }
        if(s.worker)for(let index=0;index<data.repeat;index++){if(s.cancelled)throw new Error("Export cancelled");await writePipe(s.worker.child,png);}
        s.frames+=data.repeat;this.progress(s,s.options.verify?"rendering":"exporting");return {frames:s.frames};
      });s.chain=action;return action;
    }
    async expectedHash(s,target=canonicalTarget(s.options.profile)||canonicalTarget("ffv1")) { const args=["-v", "error", "-threads", "2", "-f", "image2pipe", "-framerate", s.plan.frameRate, "-c:v", "png", "-i", "pipe:0", "-an"];if(target.inputFilter)args.push("-vf",target.inputFilter);args.push("-pix_fmt",target.pixelFormat,"-f","hash","-hash","sha256","-");const w = worker(this.ffmpeg,args, { children: this.children, owner: s.id, timeout: 2 * 60 * 60 * 1000 }); try {
        for (const r of s.records) {
            const b = await fs.readFile(r.file);
            for (let i = 0; i < r.repeat; i++)
                await writePipe(w.child, b);
        }
        w.child.stdin.end();
        const result = await w.done;
        if (result.code !== 0)
            throw new Error(result.stderr || "Expected sample verification failed");
        return result.stdout.trim();
    }
    catch (error) {
        w.child.kill("SIGKILL");
        await w.done;
        throw error;
    } }
    async decodedPictureHash(file,target,owner,{input=false,single=false}={}){const args=["-v","error","-threads","2",...INPUT_POLICY,"-i",file,"-map","0:v:0","-an"];if(input&&target.inputFilter)args.push("-vf",target.inputFilter);if(single)args.push("-frames:v","1");args.push("-pix_fmt",target.pixelFormat,"-f","hash","-hash","sha256","-");return (await run(this.ffmpeg,args,{children:this.children,owner,timeout:2*60*60*1000})).trim();}
    async convertSequenceRecord(s,record){
        if(s.options.profile==="png-sequence")return {...record,sequenceFile:record.file,sequenceHash:record.sha256,extension:".png"};
        const profile=s.plan.profile,target=canonicalTarget(s.options.profile);if(!target)throw new Error("This sequence has no explicit sample contract");
        const extension=profile.sequenceExtension,converted=path.join(s.spool,`${path.basename(record.file,".png")}-converted${extension}`),args=["-v","error","-threads","2",...INPUT_POLICY,"-i",record.file];
        if(target.inputFilter)args.push("-vf",target.inputFilter);args.push(...s.plan.videoArgs,...colorPolicy(s.plan).args,"-frames:v","1",converted);
        await run(this.ffmpeg,args,{children:this.children,owner:s.id,timeout:2*60*60*1000});
        let actual;
        if(s.options.verify){
          const expected=await this.decodedPictureHash(record.file,target,s.id,{input:true,single:true});actual=await this.decodedPictureHash(converted,target,s.id,{single:true});if(expected!==actual)throw new Error(`Converted ${target.label} sequence samples did not verify`);
          const metadata=await this.probe(converted,s.id),video=metadata.streams?.find(stream=>stream.codec_type==="video");if(!video||video.width!==s.options.width||video.height!==s.options.height)throw new Error("Converted sequence dimensions did not verify");
          const actualFormat=video.pix_fmt||"";if(s.options.profile==="exr-sequence"&&!/f32/.test(actualFormat))throw new Error("EXR did not retain float32 precision");
          if(["png16-sequence","tiff-sequence","dpx-sequence"].includes(s.options.profile)&&!/48|16/.test(actualFormat))throw new Error("Sequence encoder did not produce a true 16-bit RGB file");
        }
        return {...record,sequenceFile:converted,...(s.options.verify?{sequenceHash:await hashFile(converted),targetHash:actual}:{}),extension};
    }
    async audioArchive(s) { const plan = await this.audioPlan(s.project, s.options); if (!plan.filter)
        return null; const out = path.join(s.spool, "mix.wav"); /* Reserve input zero for consistent audio filter indices; output is duration-bounded. */ await run(this.ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", ...plan.args, "-filter_complex", plan.filter, "-map", "[audio]", "-c:a", "pcm_f32le", "-ar", "48000", "-t", String(s.options.totalFrames / s.options.fps), out ], { children: this.children, owner:s.id, timeout: 2 * 60 * 60 * 1000 }); return out; }
    async archive(s) {
        const yazl = require("yazl"), zip = new yazl.ZipFile();
        s.zip = zip;const expectedHashes=new Map();const addBuffer=(data,name)=>{zip.addBuffer(data,name);if(s.options.verify)expectedHashes.set(name,createHash("sha256").update(data).digest("hex"));};
        const completion = pipeline(zip.outputStream, fsSync.createWriteStream(s.temp, { flags: "wx" }));
        completion.catch(() => { });
        zip.on("error", error => zip.outputStream.destroy(error));
        const manifest = { app: "Stop Motion for Humanity", version: 1, projectId: s.project.id, profile: s.options.profile, width: s.options.width, height: s.options.height, fps: s.options.fps, frames: s.options.totalFrames, verificationRequested:s.options.verify,colorInterpretation:s.color.interpretation,precision:s.plan.precision,losslessKind:s.plan.profile.losslessKind,sourceFps:s.timing.sourceFps,preserveTiming:s.options.preserveTiming!==false,files: [] };
        let ordinal = 0;
        try {
            if(s.options.profile==="originals") {
                const portable=boundedJSON(s.project);portable.id=randomUUID();portable.assets=portable.assets.map(asset=>({...asset,url:assetURL(portable.id,asset.id)}));s.portableProject=portable;
                manifest.sourceProjectId=s.project.id;manifest.projectId=portable.id;manifest.scope="full-project";manifest.sequence=[];manifest.previews=[];
                for(const asset of s.project.assets){
                    const file=await this.store.assetPath(s.project.id,asset.id,{verify:s.options.verify}),name=`assets/${asset.fileName}`;zip.addFile(file,name,{compress:false});manifest.files.push({name,assetId:asset.id,kind:asset.kind,...(s.options.verify?{sha256:asset.sha256}:{recordedSourceSha256:asset.sha256}),originalName:asset.originalName,bitDepth:asset.bitDepth??null,editsApplied:false});
                    if(asset.previewFileName){const preview=await this.store.assetPath(s.project.id,asset.id,{preview:true}),name=`assets/${asset.previewFileName}`,sha256=s.options.verify?await hashFile(preview):undefined;zip.addFile(preview,name,{compress:false});manifest.previews.push({name,sha256});}
                }
                for(const frame of s.selected){const asset=s.project.assets.find(asset=>asset.id===frame.assetId);manifest.sequence.push({index:++ordinal,assetId:asset.id,file:`assets/${asset.fileName}`,hold:frame.hold});s.frames+=frame.hold;this.progress(s,"archiving");}
                addBuffer(Buffer.from("Stop Motion for Humanity — portable project archive\n\nExtract this entire ZIP into a folder, then open project.humanity.json in the app.\nAll original image/audio assets and required viewing previews are included once under assets/. Original media bytes are unchanged.\nThe project retains its source frame rate and non-destructive edits. manifest.json additionally records the requested output frame rate and held-frame sequence.\nProcessed PNG/TIFF/DPX/EXR sequence profiles produce numbered rendered frames; this archive preserves editable project sources.\n"),"README.txt");
            }
            else {
                for (const r of s.records) {
                    if (s.options.verify&&(await hashFile(r.file) !== r.sha256 || await hashFile(r.sequenceFile||r.file)!==(r.sequenceHash||r.sha256)))
                        throw new Error("Processed frame changed before archive");
                    for (let i = 0; i < r.repeat; i++) {
                        const name=`frames/${String(++ordinal).padStart(6,"0")}${r.extension||".png"}`;
                        zip.addFile(r.sequenceFile||r.file,name,{compress:false});
                        manifest.files.push({name,sha256:r.sequenceHash||r.sha256,...(r.targetHash?{decodedTargetHash:r.targetHash}:{})});
                    }
                }
            }
            const audio = s.options.profile==="originals"?null:await this.audioArchive(s);
            if (audio)
                zip.addFile(audio,"mix.wav",{compress:false});
            addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json");
            addBuffer(Buffer.from(JSON.stringify(s.portableProject||s.project, null, 2)), s.portableProject?"project.humanity.json":"render-project.json");
            if(s.options.verify){for(const record of manifest.files)if(record.sha256)expectedHashes.set(record.name,record.sha256);for(const preview of manifest.previews||[])if(preview.sha256)expectedHashes.set(preview.name,preview.sha256);if(audio)expectedHashes.set("mix.wav",await hashFile(audio));}
            zip.end({ forceZip64Format: true });
            await completion;
            if(s.options.verify){s.verifyAbort=new AbortController();const audit=await verifyArchive(s.temp,expectedHashes,s.verifyAbort.signal);s.notes.push(`Independent ZIP audit verified ${audit.entries} entries, every CRC and ${audit.sha256Verified} SHA-256 records.`);}
            if(s.options.verify&&s.options.profile==="originals"){for(const asset of s.project.assets)await this.store.assetPath(s.project.id,asset.id,{verify:true});for(const preview of manifest.previews){const file=path.join(this.store.entry(s.project.id).root,preview.name);if(await hashFile(file)!==preview.sha256)throw new Error("A viewing preview changed while archiving");}}
            s.notes.push(s.options.profile === "originals" ? "Full portable project archive: all original image/audio bytes preserved once. Extract the ZIP and open project.humanity.json; the project retains source timing and editable metadata." : `Processed ${s.plan.profile.label} files preserve the selected target samples; frame holds are expanded in sequence order`);
        }
        catch (error) {
            zip.outputStream.destroy(error);
            await completion.catch(() => { });
            throw error;
        }
    }
    async verifyMovie(s) {
                const metadata = await this.probe(s.temp, s.id), video = metadata.streams?.find(v => v.codec_type === "video");
                if (!video || video.width !== s.options.width || video.height !== s.options.height)
                    throw new Error("Export picture dimensions did not verify");
                const countText = await run(this.ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "json", s.temp], { children: this.children, owner:s.id, timeout: 2 * 60 * 60 * 1000 });
                const count = Number(JSON.parse(countText).streams?.[0]?.nb_read_frames);
                if (count !== s.options.totalFrames)
                    throw new Error(`Export frame count did not verify (${count})`);
                await run(this.ffmpeg, ["-v", "error", "-xerror", "-threads", "2", "-i", s.temp, "-map", "0:v:0", "-an", "-f", "null", "-"], { children: this.children, owner:s.id, timeout: 2 * 60 * 60 * 1000 });
                if(s.target){
                    const expected=await this.expectedHash(s,s.target),actual=await this.decodedPictureHash(s.temp,s.target,s.id);
                    if(expected!==actual)throw new Error(`Lossless ${s.target.label} target sample verification failed`);
                    if(["lossless","jpeg2000","uncompressed"].includes(s.options.profile)&&!/48|16/.test(video.pix_fmt||""))throw new Error("RGB16 master did not retain 16-bit storage precision");
                    if(s.options.profile==="nvenc-lossless"&&!/10|p010/.test(video.pix_fmt||""))throw new Error("Codec-lossless master did not retain its P010 target precision");
                    s.notes.push(`Independent decoded ${s.target.label} sample hash matches every converted processed PNG in held-frame order`);
                }else s.notes.push("Picture dimensions, exact frame count and complete video decoding verified; this delivery/intermediate profile uses its stated compression");
                if (s.hasAudio) {
                    await run(this.ffmpeg, ["-v", "error", "-xerror", "-i", s.temp, "-map", "0:a:0", "-vn", "-f", "null", "-"], { children: this.children, owner: s.id, timeout: 2 * 60 * 60 * 1000 });
                    if (["pcm_f32le","pcm_s24le","flac"].includes(s.plan.audioCodec)) {
                        const audioTarget=s.plan.audioCodec==="pcm_f32le"?"pcm_f32le":"pcm_s24le";
                        const mix = await this.audioArchive(s);
                        const hashArgs = file => ["-v", "error", "-i", file, "-map", "0:a:0", "-vn", "-c:a", audioTarget, "-f", "hash", "-hash", "sha256", "-"];
                        const expected = (await run(this.ffmpeg, hashArgs(mix), { children: this.children, owner: s.id, timeout: 2 * 60 * 60 * 1000 })).trim(), actual = (await run(this.ffmpeg, hashArgs(s.temp), { children: this.children, owner: s.id, timeout: 2 * 60 * 60 * 1000 })).trim();
                        if (expected !== actual)
                            throw new Error("Lossless float32 audio sample verification failed");
                        s.notes.push(`Independent decoded ${audioTarget==="pcm_f32le"?"float32":"24-bit"} audio hash matches the complete processed target mix`);
                    }
                    s.notes.push("Audio is the trimmed, delayed, gain/fade-processed mix; originals remain untouched");
                }

    }
    async finish(id){
      const s=this.session(id);if(s.finishing)throw new Error("Export is already finishing");
      try{
        await s.chain;s.finishing=true;if(s.plan.kind!=="originals"&&s.frames!==s.options.totalFrames)throw new Error("Export is incomplete; expected every held frame");
        this.progress(s,s.options.verify?"verifying":"finalizing");
        if(s.plan.kind==="movie"){
          s.worker.child.stdin.end();const done=await s.worker.done;if(done.code!==0)throw new Error(done.stderr||done.error||"Encoder stopped");
          if(s.options.verify)await this.verifyMovie(s);
        }else await this.archive(s);
        if(s.cancelled)throw new Error("Export cancelled");if(s.options.verify)await this.verifySources(s);
        const stat=await fs.stat(s.temp);if(stat.size<1)throw new Error("Export produced an empty file");
        const handle=await fs.open(s.temp,"r+");await handle.sync();await handle.close();await fs.rename(s.temp,s.output);
        if(!s.options.verify)s.notes.push("Verification not requested; encoder completed and file saved. No independent post-export decode or sample comparison was performed.");
        const result={id:s.id,fileName:path.basename(s.output),filePath:s.output,frames:s.frames,width:s.options.width,height:s.options.height,verified:s.options.verify===true,notes:s.notes};
        this.results.set(id,result);this.progress(s,"complete");return result;
      }catch(error){await this.stopSession(s);throw new Error(`Export failed: ${error.message}`);}
      finally{this.sessions.delete(id);await fs.rm(s.spool,{recursive:true,force:true});await fs.unlink(s.temp).catch(()=>{});}
    }
    async stopSession(s) { s.cancelled = true;s.verifyAbort?.abort(); const transient = [...this.children].filter(child => child.humanityOwner === s.id && child !== s.worker?.child); for (const child of transient)
        child.kill("SIGKILL"); await Promise.allSettled(transient.map(child => child.exitCode === null ? once(child, "close") : Promise.resolve())); s.zip?.outputStream.destroy(new Error("Export cancelled")); if (s.worker) {
        s.worker.child.stdin.destroy();
        if (s.worker.child.exitCode === null)
            s.worker.child.kill("SIGTERM");
        const timeout = setTimeout(() => s.worker.child.kill("SIGKILL"), 1500);
        timeout.unref?.();
        await s.worker.done;
        clearTimeout(timeout);
    } await fs.unlink(s.temp).catch(() => { }); }
    async cancel(id) { const s = this.sessions.get(assertId(id)); if (!s)
        return; await this.stopSession(s); await s.chain.catch(() => { }); this.sessions.delete(id); await fs.rm(s.spool, { recursive: true, force: true }); this.progress(s, "cancelled"); }
    result(id) { const r = this.results.get(assertId(id)); if (!r)
        throw new Error("No completed export with that ID"); return r; }
    async close() { await Promise.allSettled([...this.sessions.keys()].map(id => this.cancel(id))); for (const child of this.children)
        child.kill("SIGKILL"); }
}
module.exports = { ExportManager, validateOptions, worker, run, EXTENSIONS };
