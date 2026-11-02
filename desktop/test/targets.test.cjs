"use strict";
// GPL-3.0-or-later. Actual EXR transfer/precision regression, independent of canvas rendering.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const zlib=require("node:zlib");
const crc=require("buffer-crc32");
const {spawnSync}=require("node:child_process");
const {canonicalTarget,precisionNotes,LINEAR_EXR_FILTER}=require("../targets.cjs");
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4);length.writeUInt32BE(data.length);return Buffer.concat([length,name,data,crc(Buffer.concat([name,data]))]);}
function grayPNG(level){const size=16,header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;const raw=Buffer.alloc((size*3+1)*size);for(let y=0;y<size;y++)raw.fill(level,y*(size*3+1)+1,(y+1)*(size*3+1));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);}
const mediaDir=process.env.HUMANITY_TEST_MEDIA_DIR?path.resolve(process.env.HUMANITY_TEST_MEDIA_DIR):path.resolve(__dirname,"..","..","resources","media",`${process.platform}-${process.arch}`);
const ffmpeg=path.join(mediaDir,process.platform==="win32"?"ffmpeg.exe":"ffmpeg");
const mediaTest={skip:process.env.HUMANITY_SKIP_MEDIA_TESTS==="1"?"Explicit HUMANITY_SKIP_MEDIA_TESTS=1: native EXR integration is tested separately":false};
function cli(args){const r=spawnSync(ffmpeg,args,{windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr?.toString()||r.error?.message);return r.stdout;}
test("target contracts distinguish actual RGB16/YUV10 conversion from RGBA8 acquisition",()=>{assert.equal(canonicalTarget("ffv1").pixelFormat,"rgba");assert.equal(canonicalTarget("lossless").pixelFormat,"rgb48le");assert.equal(canonicalTarget("nvenc-lossless").pixelFormat,"p010le");assert.ok(precisionNotes("lossless").some(n=>n.includes("cannot restore")));assert.equal(canonicalTarget("prores"),null);});
test("actual OpenEXR output linearizes a dark sRGB patch rather than storing gamma-coded normalized bytes",mediaTest,async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),"humanity-target-test-"));t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith("humanity-target-test-"));await fs.rm(dir,{recursive:true,force:true});});const input=path.join(dir,"dark.png"),output=path.join(dir,"dark.exr");await fs.writeFile(input,grayPNG(12));cli(["-v","error","-threads","2","-i",input,"-vf",LINEAR_EXR_FILTER,"-frames:v","1","-c:v","exr","-pix_fmt","gbrpf32le","-compression","zip1",output]);const raw=cli(["-v","error","-threads","2","-i",output,"-frames:v","1","-c:v","rawvideo","-pix_fmt","gbrpf32le","-f","rawvideo","pipe:1"]);assert.equal(raw.length,16*16*3*4);const encoded=12/255,expected=((encoded+0.055)/1.055)**2.4;for(let i=0;i<raw.length;i+=4){const actual=raw.readFloatLE(i);assert.ok(Math.abs(actual-expected)<0.000001,`${actual} versus expected linear ${expected}`);assert.ok(actual<encoded/5,"EXR must not retain the gamma-coded normalized value");}});
