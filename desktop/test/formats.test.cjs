/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {profiles,getProfile,validateProfileGeometry,encoderPlan,planTiming,frameRateString}=require('../formats.cjs');
const allEncoders=[...new Set(profiles.flatMap(p=>p.encoderCandidates).concat(['pcm_f32le','pcm_s24le','aac','flac','libopus','opus']))];
const options=(extra={})=>({width:1920,height:1080,fps:24,audio:false,...extra});

test('one shared catalog covers all 28 stable ExportProfile ABI identifiers exactly once',()=>{
  const types=fs.readFileSync(path.join(__dirname,'../../src/core/types.ts'),'utf8');const union=types.match(/export type ExportProfile\s*=([^;]+);/)[1];const ids=[...union.matchAll(/'([^']+)'/g)].map(match=>match[1]).sort();
  assert.equal(profiles.length,28);assert.equal(new Set(profiles.map(p=>p.id)).size,28);assert.deepEqual(profiles.map(p=>p.id).sort(),ids);
  for(const p of profiles){assert.ok(p.label&&p.description);assert.ok(Array.isArray(p.warnings));assert.ok(['movie','sequence','originals'].includes(p.kind));assert.ok(p.extension.startsWith('.'));}
});
test('lossless contracts distinguish processed RGBA8, RGB16, P010 and original bytes',()=>{
  assert.equal(getProfile('ffv1').verificationPixelFormat,'rgba');assert.equal(getProfile('ffv1').precision.upconverted,false);
  for(const id of ['lossless','jpeg2000','uncompressed','png16-sequence','tiff-sequence','dpx-sequence']){const p=getProfile(id);assert.equal(p.verificationPixelFormat,'rgb48le');assert.equal(p.precision.upconverted,true);assert.ok(p.warnings.some(w=>w.includes('does not recover')));}
  assert.equal(getProfile('nvenc-lossless').losslessKind,'codec-target');assert.equal(getProfile('nvenc-lossless').verificationPixelFormat,'p010le');
  assert.equal(getProfile('originals').losslessKind,'original-bytes');assert.equal(getProfile('originals').precision.representation,'original');
});
test('every CPU-capable catalog entry has a fixed executable plan; direct archives need no video encoder',()=>{
  for(const p of profiles.filter(p=>!p.requiresHardware)){
    const preset=p.conformPresets?.[0]??options();const plan=encoderPlan(p.id,options({...preset,hardware:false}),allEncoders,'win32');
    assert.equal(plan.mustProbe,false);assert.equal(plan.kind,p.kind);assert.equal(plan.hardwareVerified,false);
    if(p.requiresEncoder===false||p.kind==='originals'){assert.equal(plan.encoder,null);assert.deepEqual(plan.videoArgs,[]);}else{assert.ok(plan.encoder);assert.equal(plan.videoArgs[0],'-c:v');assert.equal(plan.videoArgs[1],plan.encoder);}
    assert.equal(plan.videoArgs.includes('-f'),false);assert.equal(plan.videoArgs.includes('-movflags'),false);
  }
});
test('8K MP4 remains H.264 and selects an actual H.264 software fallback',()=>{
  const plan=encoderPlan('mp4',options({width:7680,height:4320,hardware:false}),['libx264','hevc_nvenc'],'win32');
  assert.equal(plan.encoder,'libx264');assert.equal(plan.codec,'h264');assert.equal(plan.videoArgs.includes('hevc_nvenc'),false);
  assert.throws(()=>encoderPlan('mp4',options(),['hevc_nvenc'],'win32'),/needs/);
});
test('installed hardware is only a probe candidate and software alternatives stay explicit',()=>{
  const plan=encoderPlan('mp4',options(),['h264_nvenc','libx264','libopenh264'],'win32');assert.equal(plan.encoder,'h264_nvenc');assert.equal(plan.mustProbe,true);assert.equal(plan.hardwareVerified,false);
  assert.deepEqual(plan.fallbackPlans.map(p=>p.encoder),['libx264','libopenh264']);assert.ok(plan.notes.some(note=>note.includes('probe must pass')));
});
test('VideoToolbox candidates are platform-scoped and HEVC uses an explicit 10-bit target',()=>{
  assert.equal(encoderPlan('hevc',options(),['hevc_videotoolbox','libx265'],'win32').encoder,'libx265');
  const mac=encoderPlan('hevc',options(),['hevc_videotoolbox','libx265'],'darwin');assert.equal(mac.encoder,'hevc_videotoolbox');assert.equal(mac.pixelFormat,'p010le');assert.equal(mac.mustProbe,true);assert.ok(mac.videoArgs.includes('-allow_sw'));
});
test('NVIDIA codec-lossless never substitutes a lossy or software codec',()=>{
  const plan=encoderPlan('nvenc-lossless',options(),['hevc_nvenc'],'win32');assert.equal(plan.pixelFormat,'p010le');assert.equal(plan.verificationPixelFormat,'p010le');assert.equal(plan.mustProbe,true);assert.equal(plan.fallbackPlans.length,0);assert.ok(plan.videoArgs.includes('lossless'));
  assert.throws(()=>encoderPlan('nvenc-lossless',options({hardware:false}),['hevc_nvenc','libx265'],'win32'),/successful NVIDIA hardware probe/);
});
test('DNxHD rate/raster constraints and rate-dependent bitrates are explicit',()=>{
  for(const [fps,bitrate] of [[23.976,'175000000'],[24,'175000000'],[25,'185000000'],[29.97,'220000000'],[30,'220000000']]){const plan=encoderPlan('dnxhd',options({fps}),['dnxhd'],'win32');assert.ok(plan.videoArgs.includes(bitrate));}
  assert.throws(()=>validateProfileGeometry('dnxhd',options({fps:12})),/requires.*fps/);assert.throws(()=>validateProfileGeometry('dnxhd',options({width:7680,height:4320})),/1920×1080/);
  assert.equal(frameRateString(23.976),'24000/1001');assert.equal(frameRateString(29.97),'30000/1001');
});
test('HD MPEG-2 MXF validates raster/rate pairs rather than independent unions',()=>{
  assert.doesNotThrow(()=>validateProfileGeometry('mxf-mpeg2',options({width:1280,height:720,fps:60})));
  assert.throws(()=>validateProfileGeometry('mxf-mpeg2',options({width:1920,height:1080,fps:60})),/does not support/);
  assert.throws(()=>validateProfileGeometry('mxf-mpeg2',options({width:7680,height:4320})),/1920×1080 or 1280×720/);
});
test('RGB masters permit odd rasters while chroma, CineForm and GIF limits remain visible',()=>{
  assert.doesNotThrow(()=>validateProfileGeometry('ffv1',options({width:641,height:481})));
  assert.throws(()=>validateProfileGeometry('mp4',options({width:641,height:481})),/even/);
  assert.throws(()=>validateProfileGeometry('cineform',options({width:1922})),/multiples of 16/);
  assert.throws(()=>validateProfileGeometry('gif',options({width:4096,height:3000})),/size limit/);
  assert.throws(()=>validateProfileGeometry('lossless',options({width:8192,height:8192})),/35,651,584/);
});
test('audio plans disclose conversion and require the codec only when audio is requested',()=>{
  const flac=encoderPlan('av1',options({audio:true}),['libsvtav1','flac'],'win32');assert.equal(flac.audioCodec,'flac');assert.ok(flac.audioArgs.includes('24'));
  const nativeOpus=encoderPlan('webm',options({audio:true}),['libsvtav1','opus'],'win32');assert.equal(nativeOpus.audioCodec,'opus');assert.ok(nativeOpus.audioArgs.includes('-strict:a'));
  assert.throws(()=>encoderPlan('mp4',options({audio:true}),['libx264'],'win32'),/Uncheck soundtrack/);
  assert.deepEqual(encoderPlan('mp4',options(),['libx264'],'win32').audioArgs,[]);
});
test('unknown profiles and requested encoder injection are rejected; metadata is immutable',()=>{
  assert.throws(()=>getProfile('invented'),/Unknown/);assert.throws(()=>encoderPlan('mp4',options({encoder:'-f concat -i https://evil'}),['libx264'],'win32'),/not available/);
  assert.throws(()=>getProfile('ffv1').videoOptions.push('-bad'),TypeError);
});
test('EXR leaves its explicit transfer conversion to the worker and exposes the float verification target',()=>{
  const plan=encoderPlan('exr-sequence',options(),['exr'],'win32');assert.equal(plan.verificationPixelFormat,'gbrpf32le');assert.equal(plan.videoArgs.includes('-vf'),false);assert.equal(plan.sequenceExtension,'.exr');assert.equal(plan.profile.precision.representation,'float32');
});
test('retime planner preserves duration with compressed holds and bounded IPC repeats',()=>{
  const frames=[{id:'a',enabled:true,hold:1},{id:'b',enabled:true,hold:2},{id:'c',enabled:true,hold:1},{id:'d',enabled:true,hold:3}];
  const p=planTiming(frames,12,25);assert.deepEqual(p.entries.map(e=>e.hold),[2,4,2,7]);assert.equal(p.totalFrames,15);
  const long=planTiming([{id:'one',enabled:true,hold:2000}],1,24);assert.equal(long.entries.length,5);assert.equal(long.totalFrames,48000);assert.ok(long.entries.every(entry=>entry.repeat<=10000));
});
