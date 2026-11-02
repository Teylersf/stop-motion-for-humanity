"use strict";
// GPL-3.0-or-later. Optional streaming ZIP/ZIP64 integrity audit; never extracts paths to disk.
const fs=require("node:fs/promises");
const fsSync=require("node:fs");
const zlib=require("node:zlib");
const crypto=require("node:crypto");
const crc=require("buffer-crc32");
async function read(handle,position,length){const data=Buffer.alloc(length);const {bytesRead}=await handle.read(data,0,length,position);if(bytesRead!==length)throw new Error("Archive is truncated");return data;}
function number64(buffer,offset){const number=buffer.readBigUInt64LE(offset);if(number>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("Archive offset exceeds supported bounds");return Number(number);}
async function verifyArchive(file,expectedHashes=new Map(),signal){
  const handle=await fs.open(file,"r");let entries=0;
  try{
    const stat=await handle.stat(),tailLength=Math.min(stat.size,65557),tail=await read(handle,stat.size-tailLength,tailLength),index=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    if(index<0||index+22>tail.length)throw new Error("Archive has no readable end record");
    const endPosition=stat.size-tailLength+index;let count=tail.readUInt16LE(index+10),central=tail.readUInt32LE(index+16);
    if(count===0xffff||central===0xffffffff){const locator=await read(handle,endPosition-20,20);if(locator.readUInt32LE(0)!==0x07064b50)throw new Error("ZIP64 locator is missing");const end=await read(handle,number64(locator,8),56);if(end.readUInt32LE(0)!==0x06064b50)throw new Error("Invalid ZIP64 record");count=number64(end,32);central=number64(end,48);}
    if(count>200010||central>=stat.size)throw new Error("Archive directory exceeds its bounds");const directoryStart=central,names=new Set();
    for(let index=0;index<count;index++){
      if(signal?.aborted)throw new Error("Archive verification cancelled");const header=await read(handle,central,46);if(header.readUInt32LE(0)!==0x02014b50)throw new Error("Archive directory is corrupt");
      const flags=header.readUInt16LE(8),method=header.readUInt16LE(10),expectedCRC=header.readUInt32LE(16),nameLength=header.readUInt16LE(28),extraLength=header.readUInt16LE(30),commentLength=header.readUInt16LE(32);
      if(flags&1||![0,8].includes(method)||nameLength>4096||extraLength>65535)throw new Error("Unsupported archive entry");let compressed=header.readUInt32LE(20),unpacked=header.readUInt32LE(24),local=header.readUInt32LE(42);
      const details=await read(handle,central+46,nameLength+extraLength),name=details.toString("utf8",0,nameLength),extra=details.subarray(nameLength);
      if(names.has(name)||name.startsWith("/")||name.split(/[\\/]/).some(part=>part===".."))throw new Error("Archive entry names are unsafe or duplicated");names.add(name);
      if([compressed,unpacked,local].includes(0xffffffff)){let offset=0,found=false;while(offset+4<=extra.length){const tag=extra.readUInt16LE(offset),length=extra.readUInt16LE(offset+2);if(offset+4+length>extra.length)throw new Error("Truncated ZIP64 extra record");if(tag===1){let cursor=offset+4;if(unpacked===0xffffffff){unpacked=number64(extra,cursor);cursor+=8;}if(compressed===0xffffffff){compressed=number64(extra,cursor);cursor+=8;}if(local===0xffffffff)local=number64(extra,cursor);found=true;break;}offset+=4+length;}if(!found)throw new Error("Missing ZIP64 entry sizes");}
      const localHeader=await read(handle,local,30);if(localHeader.readUInt32LE(0)!==0x04034b50)throw new Error("Archive local record is corrupt");const start=local+30+localHeader.readUInt16LE(26)+localHeader.readUInt16LE(28);if(start+compressed>directoryStart||unpacked>1024**4)throw new Error("Archive entry data exceeds its bounds");
      const raw=compressed?fsSync.createReadStream(file,{start,end:start+compressed-1,signal}):require("node:stream").Readable.from([]);let source=raw;if(method===8){source=raw.pipe(zlib.createInflateRaw());raw.on("error",error=>source.destroy(error));}
      let size=0,checksum;const hash=crypto.createHash("sha256");try{for await(const chunk of source){if(signal?.aborted)throw new Error("Archive verification cancelled");size+=chunk.length;if(size>unpacked)throw new Error("Archive inflated size exceeds the directory record");hash.update(chunk);checksum=crc(chunk,checksum);}}finally{raw.destroy();source.destroy();}
      if(size!==unpacked||(checksum?checksum.readUInt32BE():0)!==expectedCRC)throw new Error(`Archive CRC did not verify: ${name}`);const expected=expectedHashes.get(name);if(expected&&hash.digest("hex")!==expected)throw new Error(`Archive SHA-256 did not verify: ${name}`);
      entries++;central+=46+nameLength+extraLength+commentLength;
    }
    for(const name of expectedHashes.keys())if(!names.has(name))throw new Error(`Expected archive entry is missing: ${name}`);return {entries,crcVerified:true,sha256Verified:expectedHashes.size};
  }finally{await handle.close();}
}
module.exports={verifyArchive};
