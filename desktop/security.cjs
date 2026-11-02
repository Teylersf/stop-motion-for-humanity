"use strict";
// GPL-3.0-or-later. Shared validation, with no Electron privileges.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_PIXELS = 35651584;
function assertId(value) { if (typeof value !== "string" || !ID.test(value))
    throw new Error("Invalid identifier"); return value; }
function ownedURL(value) { try {
    const u = new URL(value);
    return u.protocol === "humanity:" && u.hostname === "app" && !u.port && !u.username && !u.password;
}
catch {
    return false;
} }
function safeExternal(value) { try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443");
}
catch {
    return false;
} }
function bytes(value, max = 160 * 1024 * 1024) { if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > max)
    throw new Error("Invalid or oversized media data"); return Buffer.from(value.buffer, value.byteOffset, value.byteLength); }
function geometry(width, height) { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192 || width * height > MAX_PIXELS)
    throw new Error("Picture size must be 16..8192 pixels per side and at most 35,651,584 pixels"); }
function pngHeaderInfo(buffer){const b=bytes(buffer);if(b.length<33||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b.readUInt32BE(8)!==13||b.toString("ascii",12,16)!=="IHDR")throw new Error("A PNG frame header is required");const width=b.readUInt32BE(16),height=b.readUInt32BE(20),bitDepth=b[24];geometry(width,height);if(![1,2,4,8,16].includes(bitDepth))throw new Error("Invalid PNG precision");return {width,height,bitDepth};}
function pngInfo(buffer) { const b = bytes(buffer,512*1024*1024); if (b.length < 45 || !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || b.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("A valid PNG frame is required"); const width = b.readUInt32BE(16), height = b.readUInt32BE(20); geometry(width, height); const crc = require("buffer-crc32"); let offset = 8, ended = false, picture = false, chunks = 0; while (offset + 12 <= b.length) {
    const length = b.readUInt32BE(offset), end = offset + 12 + length;
    if (end > b.length || ++chunks > 100000)
        throw new Error("PNG frame is incomplete");
    if (!crc(b.subarray(offset + 4, end - 4)).equals(b.subarray(end - 4, end)))
        throw new Error("PNG frame checksum failed");
    const type = b.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT")
        picture = true;
    if (type === "IEND") {
        if (length !== 0 || end !== b.length)
            throw new Error("Invalid PNG end marker");
        ended = true;
        break;
    }
    offset = end;
} if (!ended || !picture)
    throw new Error("PNG frame is incomplete"); const bitDepth=b[24];if(![1,2,4,8,16].includes(bitDepth))throw new Error("Unsupported PNG precision");return { width, height,bitDepth }; }
function finite(value, min, max, name) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`); return value; }
function boundedJSON(value, max = 24 * 1024 * 1024) { const text = JSON.stringify(value); if (!text || Buffer.byteLength(text) > max)
    throw new Error("Project metadata exceeds its size limit"); return JSON.parse(text); }
module.exports = { assertId, ownedURL, safeExternal, bytes, geometry, pngInfo,pngHeaderInfo, finite, boundedJSON, MAX_PIXELS };
