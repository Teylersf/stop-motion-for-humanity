/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
// Pure format/timing plans. An installed hardware encoder is never treated as a successful probe.
const catalog = require('../assets/export-profiles.json');
const { geometry } = require('./security.cjs');
const STANDARD_RATES = [24000/1001,24,25,30000/1001,30,50,60000/1001,60];
const MAX_OUTPUT_FRAMES = 100000, MAX_REPEAT = 10000;
function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
const profiles = deepFreeze(catalog);
function getProfile(id) { const profile = profiles.find(profile => profile.id === id); if (!profile) throw new Error(`Unknown export profile: ${String(id)}`); return profile; }
function canonicalFrameRate(fps) { if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error('Output frame rate must be between 1 and 120 fps'); return STANDARD_RATES.find(rate => Math.abs(rate-fps)<0.0001) ?? fps; }
function frameRateString(fps) { const rate=canonicalFrameRate(fps); for (const [n,d] of [[24000,1001],[30000,1001],[60000,1001]]) if (Math.abs(rate-n/d)<0.000001) return `${n}/${d}`; return String(rate); }
function formatRate(rate) { return Number.isInteger(rate) ? String(rate) : rate.toFixed(3); }
function validateProfileGeometry(id, options) {
  const profile=getProfile(typeof id==='string'?id:id.id); const {width,height}=options; geometry(width,height); const fps=canonicalFrameRate(options.fps);
  if(profile.evenDimensions&&(width%2||height%2))throw new Error(`${profile.label} requires even width and height. Choose an RGB lossless/sequence profile for odd dimensions.`);
  if(profile.minimumRaster&&(width<profile.minimumRaster[0]||height<profile.minimumRaster[1]))throw new Error(`${profile.label} requires at least ${profile.minimumRaster.join('×')} pixels.`);
  if(profile.requiredRaster&&!profile.requiredRaster.some(size=>size[0]===width&&size[1]===height))throw new Error(`${profile.label} requires ${profile.requiredRaster.map(size=>size.join('×')).join(' or ')}. Use DNxHR or a lossless master for other rasters.`);
  if(profile.maxRaster&&(width>profile.maxRaster[0]||height>profile.maxRaster[1])||profile.maxPixels&&width*height>profile.maxPixels)throw new Error(`${profile.label} exceeds its size limit. Choose a smaller raster or another export profile.`);
  if(profile.multiples&&(width%profile.multiples[0]||height%profile.multiples[1]))throw new Error(`${profile.label} requires width in multiples of ${profile.multiples[0]} and height in multiples of ${profile.multiples[1]}.`);
  if(profile.rates&&!profile.rates.some(rate=>Math.abs(rate-fps)<0.0001))throw new Error(`${profile.label} requires ${profile.rates.map(formatRate).join('/')} fps. Enable duration-preserving conform when changing output rate.`);
  if(profile.rasterRates){const pair=profile.rasterRates.find(pair=>pair.width===width&&pair.height===height);if(!pair||!pair.rates.some(rate=>Math.abs(rate-fps)<0.0001))throw new Error(`${profile.label} does not support ${width}×${height} at ${formatRate(fps)} fps. Choose a listed raster/rate preset or another profile.`);}
  return {width,height,fps,frameRate:frameRateString(fps)};
}
function hardwareFor(encoder){return encoder?.endsWith('_nvenc')?'nvidia':encoder?.endsWith('_videotoolbox')?'videotoolbox':null;}
function supportedOnPlatform(encoder,platform){return !encoder.endsWith('_videotoolbox')||platform==='darwin';}
function audioPlan(profile,options,available){
  if(!options.audio||!profile.audioCodec)return {audioCodec:null,audioArgs:[],notes:[]};
  let codec=profile.audioCodec;const notes=[];
  if(codec==='libopus'&&!available.has(codec)&&available.has('opus')){codec='opus';notes.push('Using FFmpeg native Opus audio encoder with explicit experimental-codec permission.');}
  if(!available.has(codec))throw new Error(`${profile.label} needs the ${profile.audioCodec} audio encoder. Uncheck soundtrack or install the matching complete media runtime.`);
  const args=['-c:a',codec,'-ar','48000'];if(codec==='opus')args.push('-strict:a','-2');if(codec==='flac')args.push('-sample_fmt','s32','-bits_per_raw_sample:a','24');
  return {audioCodec:codec,audioArgs:args,notes};
}
function makePlan(profile,options,encoder,available,platform){
  let pixelFormat=profile.pixelFormat,codec=profile.codec;const notes=[...profile.warnings];const hardware=hardwareFor(encoder);const videoArgs=[];
  if(encoder){
    videoArgs.push('-c:v',encoder,...profile.videoOptions);
    if(profile.id==='nvenc-lossless')videoArgs.push('-preset','p3','-tune','lossless','-rc','constqp','-qp','0');
    else if(encoder.endsWith('_nvenc')){videoArgs.push('-preset','p4','-cq','16','-b:v','0');if(codec==='hevc'||codec==='av1')pixelFormat='p010le';}
    else if(encoder.endsWith('_videotoolbox')){videoArgs.push('-allow_sw','0','-b:v',String(Math.min(160000000,Math.max(4000000,Math.round(options.width*options.height*options.fps*0.15)))));if(codec==='hevc'){pixelFormat='p010le';videoArgs.push('-profile:v','main10');}}
    else if(encoder==='libx264')videoArgs.push('-preset','medium','-crf','16');
    else if(encoder==='libopenh264')videoArgs.push('-b:v',String(Math.min(160000000,Math.max(4000000,Math.round(options.width*options.height*options.fps*0.15)))));
    else if(encoder==='libx265')videoArgs.push('-preset','medium','-crf','16','-x265-params','log-level=error:pools=4:frame-threads=2');
    else if(encoder==='libsvtav1'){videoArgs.push('-preset','8','-crf','16','-svtav1-params','lp=4');codec='av1';pixelFormat='yuv420p10le';}
    else if(encoder==='libaom-av1'){videoArgs.push('-crf','16','-b:v','0','-cpu-used','6','-row-mt','1');codec='av1';pixelFormat='yuv420p10le';}
    else if(encoder==='libvpx-vp9')videoArgs.push('-crf','18','-b:v','0','-row-mt','1');
    if(profile.id==='dnxhd'){const fps=canonicalFrameRate(options.fps);const bitrate=Math.abs(fps-25)<0.0001?185000000:fps>29?220000000:175000000;videoArgs.push('-b:v',String(bitrate));}
    if(profile.id==='gif')videoArgs.push('-vf','format=rgb8');
    videoArgs.push('-pix_fmt',pixelFormat);
  }
  const audio=audioPlan(profile,options,available);notes.push(...audio.notes);
  if(hardware)notes.push(`Encoder ${encoder} is installed; a real ${options.width}×${options.height} encode probe must pass before hardware use is claimed.`);
  else if(encoder)notes.push(`Selected ${encoder}; output verification runs only when requested.`);
  if(profile.id==='png-sequence')notes.push('Processed Canvas PNG8 files are archived directly; no conversion to a higher bit depth is implied.');
  if(profile.id==='exr-sequence')notes.push('The export worker must explicitly convert sRGB to linear float before EXR encoding; the planner adds no conflicting transfer filter.');
  const rate=canonicalFrameRate(options.fps);
  return {profile,kind:profile.kind,encoder,codec,pixelFormat,verificationPixelFormat:profile.verificationPixelFormat,
    audioCodec:audio.audioCodec,videoArgs,audioArgs:audio.audioArgs,container:profile.container,extension:profile.extension,
    sequenceExtension:profile.sequenceExtension??null,notes,mustProbe:!!hardware,hardware,hardwareVerified:false,platform,
    frameRate:frameRateString(rate),fps:rate,precision:{...profile.precision,...(pixelFormat==='yuv420p10le'&&profile.precision.storageBits===8?{storageBits:10,upconverted:true}:{})}};
}
function encoderPlan(profileOrId,options,availableEncoders,platform=process.platform){
  const profile=getProfile(typeof profileOrId==='string'?profileOrId:profileOrId.id);const geometry=validateProfileGeometry(profile.id,options);const settings={...options,...geometry};
  const available=new Set(availableEncoders instanceof Set?[...availableEncoders]:Array.isArray(availableEncoders)?availableEncoders:[]);
  if(profile.requiresEncoder===false||profile.kind==='originals')return {...makePlan(profile,settings,null,available,platform),fallbackPlans:[]};
  const candidates=profile.encoderCandidates.filter(encoder=>available.has(encoder)&&supportedOnPlatform(encoder,platform)&&(settings.hardware!==false||!hardwareFor(encoder)));
  if(settings.encoder){if(!candidates.includes(settings.encoder))throw new Error(`Requested encoder ${settings.encoder} is not available for ${profile.label} on this platform.`);candidates.splice(candidates.indexOf(settings.encoder),1);candidates.unshift(settings.encoder);}
  if(!candidates.length)throw new Error(`${profile.label} needs ${profile.encoderCandidates.join(' or ')}${profile.requiresHardware?' and a successful NVIDIA hardware probe':''}. This media runtime cannot encode the requested format; choose another profile or install the matching runtime.`);
  const plan=makePlan(profile,settings,candidates[0],available,platform);plan.fallbackPlans=candidates.slice(1).map(encoder=>makePlan(profile,settings,encoder,available,platform));return plan;
}
/** Same rounded-boundary algorithm as src/core/exportTiming.ts, checked by cross-runtime fixtures. */
function planTiming(frames,sourceFps,outputFps,preserveTiming=true){
  const sourceRate=canonicalFrameRate(sourceFps),targetRate=canonicalFrameRate(outputFps);if(!Array.isArray(frames)||frames.length>100000)throw new Error('Invalid source frame list');
  const selected=[];let sourceFrames=0;
  frames.forEach((frame,sourceIndex)=>{if(frame.enabled===false)return;if(!Number.isInteger(frame.hold)||frame.hold<1||frame.hold>MAX_REPEAT)throw new Error('Invalid source frame hold');const start=sourceFrames;sourceFrames+=frame.hold;if(sourceFrames>MAX_OUTPUT_FRAMES)throw new Error('Source timeline exceeds 100,000 exposures');selected.push({frame,sourceIndex,start,end:sourceFrames});});
  const ratio=preserveTiming?targetRate/sourceRate:1,totalFrames=sourceFrames?Math.max(1,Math.round(sourceFrames*ratio)):0;if(totalFrames>MAX_OUTPUT_FRAMES)throw new Error('Conform exceeds 100,000 output frames');
  const entries=[];let previousBoundary=0,droppedFrames=0;
  selected.forEach((entry,index)=>{const boundary=index===selected.length-1?totalFrames:Math.round(entry.end*ratio);let hold=boundary-previousBoundary;if(!hold)droppedFrames++;for(let startFrame=previousBoundary;hold>0;){const repeat=Math.min(MAX_REPEAT,hold);entries.push({frame:entry.frame,sourceIndex:entry.sourceIndex,sourceStartFrame:entry.start,sourceEndFrame:entry.end,startFrame,endFrame:startFrame+repeat,hold:repeat,repeat});hold-=repeat;startFrame+=repeat;}previousBoundary=boundary;});
  return {entries,totalFrames,sourceFrames,sourceFps:sourceRate,outputFps:targetRate,durationSeconds:totalFrames/targetRate,sourceDurationSeconds:sourceFrames/sourceRate,droppedFrames};
}
module.exports={profiles,getProfile,canonicalFrameRate,frameRateString,validateProfileGeometry,encoderPlan,planTiming};
