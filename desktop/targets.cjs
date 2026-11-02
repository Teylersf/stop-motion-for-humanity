"use strict";
// GPL-3.0-or-later. Explicit processed-target contracts, separate from acquisition precision.
const LINEAR_EXR_FILTER = "zscale=transferin=iec61966-2-1:primariesin=bt709:matrixin=gbr:rangein=full:transfer=linear:primaries=bt709:matrix=gbr:range=full,format=gbrpf32le";
const YUV709_FILTER = pixelFormat=>`zscale=transferin=iec61966-2-1:primariesin=bt709:matrixin=gbr:rangein=full:transfer=bt709:primaries=bt709:matrix=bt709:range=limited,format=${pixelFormat}`;
const TARGETS = Object.freeze({
  ffv1: { pixelFormat: "rgba", label: "RGBA8", kind: "integer" },
  lossless: { pixelFormat: "rgb48le", label: "RGB16", kind: "integer" },
  jpeg2000: { pixelFormat: "rgb48le", label: "RGB16", kind: "integer" },
  "nvenc-lossless": { pixelFormat: "p010le", label: "canonical BT.709 limited-range 10-bit 4:2:0 YUV", kind: "codec",inputFilter:YUV709_FILTER("p010le") },
  uncompressed: { pixelFormat: "rgb48le", label: "RGB16", kind: "integer" },
  "png-sequence": { pixelFormat: "rgba", label: "RGBA8", kind: "integer" },
  "png16-sequence": { pixelFormat: "rgb48le", label: "RGB16", kind: "integer" },
  "tiff-sequence": { pixelFormat: "rgb48le", label: "RGB16", kind: "integer" },
  "dpx-sequence": { pixelFormat: "rgb48le", label: "RGB16", kind: "integer" },
  "exr-sequence": { pixelFormat: "gbrpf32le", label: "linear float32 RGB", kind: "float", inputFilter: LINEAR_EXR_FILTER },
});
function canonicalTarget(id) { return TARGETS[id] || null; }
function precisionNotes(id) {
  if (id === "originals") return ["Original image files retain their stored precision and bytes; rendered edits and scaling are bypassed."];
  const target=canonicalTarget(id);
  const notes=["Processed frames originate in the browser's 8-bit RGBA canvas. A higher precision export cannot restore detail absent from that rendered source."];
  if(target&&id!=="ffv1"&&id!=="png-sequence")notes.push(`The chosen preservation contract is ${target.label}; verification compares that converted target, including its alpha/chroma/transfer choices.`);
  if(id==="exr-sequence")notes.push("Canvas sRGB values are explicitly linearized to BT.709/sRGB-primary float32 RGB before OpenEXR encoding; this is display-source conversion, not scene-referred camera acquisition.");
  return notes;
}
function colorPolicy(plan){
  if(plan.profile.id==="originals")return {filter:null,args:[],interpretation:"Unchanged original files retain their original interpretation and metadata."};
  if(plan.profile.id==="gif")return {filter:null,args:[],interpretation:"GIF palette values use the canvas sRGB display interpretation."};
  const yuv=/^(yuv|yuva|nv12|p010|p016)/.test(plan.pixelFormat||""),linear=plan.profile.id==="exr-sequence";
  return {filter:yuv?YUV709_FILTER(plan.pixelFormat):null,args:["-color_primaries","bt709","-color_trc",linear?"linear":yuv?"bt709":"iec61966-2-1","-colorspace",yuv?"bt709":"rgb","-color_range",yuv?"tv":"pc"],interpretation:linear?"Explicit sRGB-to-linear RGB conversion; BT.709/sRGB primaries, full range.":yuv?"Canvas sRGB is explicitly converted to BT.709 transfer and matrix with limited-range YUV.":"Canvas sRGB transfer and BT.709/sRGB primaries are retained as full-range RGB."};
}
module.exports={canonicalTarget,precisionNotes,LINEAR_EXR_FILTER,YUV709_FILTER,colorPolicy};
