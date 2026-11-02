"use strict";
// GPL-3.0-or-later. Portable projects; original assets are never overwritten or deleted.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { assertId, bytes, geometry, pngInfo, finite, boundedJSON } = require("./security.cjs");
const PROJECT = "project.humanity.json";
const BACKUP = "project.humanity.previous.json";
const MAX_ASSET = 512 * 1024 * 1024;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif", ".tif": "image/tiff", ".tiff": "image/tiff", ".dpx":"image/x-dpx", ".exr":"image/x-exr", ".jp2":"image/jp2", ".j2k":"image/jp2", ".jxl":"image/jxl", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg", ".webm": "audio/webm", ".aiff": "audio/aiff", ".aif": "audio/aiff" };
async function hashFile(file) { const h = createHash("sha256"); for await (const chunk of fsSync.createReadStream(file))
    h.update(chunk); return h.digest("hex"); }
async function syncWrite(file, data) { const handle = await fs.open(file, "wx", 0o600); try {
    await handle.writeFile(data);
    await handle.sync();
}
finally {
    await handle.close();
} }
async function atomicWrite(file, data) { const temp = `${file}.${randomUUID()}.tmp`; try {
    await syncWrite(temp, data);
    await fs.rename(temp, file);
}
catch (error) {
    await fs.unlink(temp).catch(() => { });
    throw error;
} }
function assetURL(projectId, assetId) { return `humanity://app/asset/${assertId(projectId)}/${assertId(assetId)}`; }
function portableName(value, fallback = "Humanity film") { const name = String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().replace(/[. ]+$/g, "").slice(0, 100); return !name ? fallback : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `Film ${name}` : name; }
function text(value, max = 5000, name = "text") { if (typeof value !== "string" || value.length > max)
    throw new Error(`Invalid ${name}`); }
function plain(value, name) { if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${name}`); }
function date(value, name) { text(value, 50, name); if (!Number.isFinite(Date.parse(value)))
    throw new Error(`Invalid ${name}`); }
function validateEdits(edits) { plain(edits, "frame edits"); for (const [key, min, max] of [["exposure", -10, 10], ["contrast", 0, 5], ["saturation", 0, 5], ["temperature", -1, 1], ["rotation", -36000, 36000], ["keyTolerance", 0, 1]])
    finite(edits[key], min, max, key); if (typeof edits.flipX !== "boolean" || typeof edits.flipY !== "boolean")
    throw new Error("Invalid frame flips"); if (edits.keyColor !== null && (typeof edits.keyColor !== "string" || !/^#[a-f0-9]{6}$/i.test(edits.keyColor)))
    throw new Error("Invalid chroma key color"); plain(edits.crop, "crop"); const c = edits.crop; finite(c.x, 0, 1, "crop x"); finite(c.y, 0, 1, "crop y"); finite(c.width, 0.00001, 1, "crop width"); finite(c.height, 0.00001, 1, "crop height"); if (c.x + c.width > 1.000001 || c.y + c.height > 1.000001)
    throw new Error("Crop must stay inside the source image"); for (const key of ["maskStrokes", "drawings"]) {
    const strokes = edits[key];
    if (!Array.isArray(strokes) || strokes.length > 10000)
        throw new Error("Too many paint strokes");
    for (const s of strokes) {
        plain(s, "paint stroke");
        assertId(s.id);
        finite(s.size, 0.1, 16384, "paint size");
        text(s.color, 50, "paint color");
        if (typeof s.erase !== "boolean" || !Array.isArray(s.points) || s.points.length > 10000)
            throw new Error("Invalid paint stroke");
        for (const point of s.points) {
            plain(point, "paint point");
            finite(point.x, 0, 1, "paint x");
            finite(point.y, 0, 1, "paint y");
        }
    }
} }
function validateSettings(s) { plain(s, "project settings"); text(s.background, 50, "background"); text(s.title, 1000, "title"); text(s.titleColor, 50, "title color"); finite(s.titleSize, 1, 4096, "title size"); finite(s.onionOpacity, 0, 1, "onion opacity"); if (!Number.isInteger(s.onionCount) || s.onionCount < 1 || s.onionCount > 5 || !["none", "thirds", "square", "crosshair"].includes(s.grid) || !["project", "16:9", "4:3", "1:1", "2.39:1"].includes(s.aspect))
    throw new Error("Invalid guides or onion skin settings"); for (const key of ["mirrorPreview", "captureSound", "simpleMode"])
    if (typeof s[key] !== "boolean")
        throw new Error(`Invalid ${key}`); }
function validateSource(source) { plain(source, "capture source"); if (!["camera", "import", "demo", "watch-folder"].includes(source.type))
    throw new Error("Invalid capture source"); if (source.deviceLabel !== undefined)
    text(source.deviceLabel, 2000, "device label"); for (const key of ["width", "height"])
    if (source[key] !== undefined)
        finite(source[key], 1, 100000, "source size"); if (source.settings !== undefined) {
    plain(source.settings, "camera settings");
    if (Object.keys(source.settings).length > 200)
        throw new Error("Too many camera settings");
    for (const [key, value] of Object.entries(source.settings)) {
        text(key, 100, "camera setting name");
        if (typeof value === "number") {
            if (!Number.isFinite(value))
                throw new Error("Invalid camera setting");
        }
        else if (typeof value === "string")
            text(value, 4096, "camera setting");
        else if (typeof value !== "boolean")
            throw new Error("Invalid camera setting value");
    }
} }
function defaults(name) { const now = new Date().toISOString(), scene = randomUUID(); return { version: 1, id: randomUUID(), name, createdAt: now, updatedAt: now, fps: 12, width: 1920, height: 1080, activeSceneId: scene, scenes: [{ id: scene, name: "Scene 1", notes: "", frames: [], referenceAssetId: null, cleanPlateAssetId: null }], assets: [], audio: [], settings: { background: "#111820", onionOpacity: 0.35, onionCount: 1, grid: "thirds", aspect: "project", mirrorPreview: false, captureSound: true, simpleMode: true, title: "", titleColor: "#ffffff", titleSize: 64 } }; }
function validateProject(input, knownAssets) {
    const p = boundedJSON(input);
    if (p.version !== 1)
        throw new Error("Unsupported project version");
    assertId(p.id);
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 200)
        throw new Error("Invalid project name");
    date(p.createdAt, "project creation date");
    date(p.updatedAt, "project save date");
    validateSettings(p.settings);
    geometry(p.width, p.height);
    finite(p.fps, 1, 120, "frame rate");
    if (!Array.isArray(p.assets) || p.assets.length > 100000 || !Array.isArray(p.scenes) || !p.scenes.length || p.scenes.length > 1000 || !Array.isArray(p.audio) || p.audio.length > 256)
        throw new Error("Invalid project collections");
    const assets = new Map(), frameIds = new Set(), sceneIds = new Set();
    for (const a of p.assets) {
        assertId(a.id);
        if (assets.has(a.id))
            throw new Error("Duplicate asset");
        const canonical = knownAssets?.get(a.id);
        if (knownAssets && !canonical)
            throw new Error("Unknown project asset");
        const selected = canonical || a; if(selected.bitDepth!==undefined&&(!Number.isInteger(selected.bitDepth)||selected.bitDepth<1||selected.bitDepth>64))throw new Error("Invalid source image precision");
        if (!["image", "audio"].includes(selected.kind) || typeof selected.fileName !== "string" || !/^[-A-Za-z0-9_]+\.[A-Za-z0-9]{1,8}$/.test(selected.fileName) || !/^([a-f0-9]{64})$/.test(selected.sha256) || !Number.isSafeInteger(selected.byteLength) || selected.byteLength < 1 || selected.byteLength > MAX_ASSET)
            throw new Error("Invalid asset record");
        assets.set(a.id, { ...selected, url: assetURL(p.id, a.id) });
    }
    let frameCount = 0, exposures = 0;
    for (const s of p.scenes) {
        assertId(s.id);
        text(s.name, 200, "scene name");
        text(s.notes, 5000, "scene notes");
        if (sceneIds.has(s.id) || !Array.isArray(s.frames) || s.frames.length > 100000)
            throw new Error("Invalid scene");
        sceneIds.add(s.id);
        for (const f of s.frames) {
            assertId(f.id);
            if (frameIds.has(f.id) || assets.get(f.assetId)?.kind !== "image")
                throw new Error("Invalid frame reference");
            frameIds.add(f.id);
            if (!Number.isInteger(f.hold) || f.hold < 1 || f.hold > 10000 || typeof f.enabled !== "boolean" || !f.edits)
                throw new Error("Invalid frame");
            text(f.note, 5000, "frame note");
            text(f.cue, 1000, "frame cue");
            date(f.capturedAt, "frame date");
            validateSource(f.source);
            validateEdits(f.edits);
            if (f.enabled)
                exposures += f.hold;
            if (++frameCount > 100000 || exposures > 100000)
                throw new Error("Project exceeds 100,000 frames or exposures");
        }
        for (const key of ["referenceAssetId", "cleanPlateAssetId"])
            if (s[key] !== null && s[key] !== undefined && assets.get(s[key])?.kind !== "image")
                throw new Error("Invalid reference image");
    }
    if (!sceneIds.has(p.activeSceneId))
        throw new Error("Active scene is missing");
    const audioIds = new Set();
    for (const a of p.audio) {
        assertId(a.id);
        if (audioIds.has(a.id) || assets.get(a.assetId)?.kind !== "audio")
            throw new Error("Invalid audio reference");
        audioIds.add(a.id);
        text(a.name, 5000, "audio name");
        finite(a.startFrame, 0, 100000, "audio start");
        if (!Number.isInteger(a.startFrame))
            throw new Error("Audio starts on an integer timeline frame");
        finite(a.inSeconds, 0, 86400, "audio trim");
        if (a.outSeconds !== null) {
            finite(a.outSeconds, a.inSeconds, 86400, "audio end");
            if (a.outSeconds <= a.inSeconds)
                throw new Error("Audio trim end must follow its start");
        }
        finite(a.gain, 0, 10, "audio gain");
        finite(a.fadeInSeconds, 0, 86400, "audio fade");
        finite(a.fadeOutSeconds, 0, 86400, "audio fade");
        if (typeof a.muted !== "boolean")
            throw new Error("Invalid audio mute");
    }
    p.assets = [...assets.values()];
    return p;
}
class ProjectStore {
    constructor(options) { this.dataDir = options.dataDir; this.imageInfo = options.imageInfo; this.audioInfo = options.audioInfo; this.projects = new Map(); this.recent = []; this.locks = new Map(); this.watchers = new Map(); }
    async init() { await fs.mkdir(this.dataDir, { recursive: true }); try {
        const saved = JSON.parse(await fs.readFile(path.join(this.dataDir, "recent.json"), "utf8"));
        if (Array.isArray(saved))
            this.recent = saved.filter(r => typeof r.path === "string" && typeof r.id === "string").slice(0, 20);
    }
    catch { } }
    async locked(id, action) { const previous = this.locks.get(id) || Promise.resolve(); const pending = previous.catch(() => { }).then(action); this.locks.set(id, pending); try {
        return await pending;
    }
    finally {
        if (this.locks.get(id) === pending)
            this.locks.delete(id);
    } }
    entry(id) { const e = this.projects.get(assertId(id)); if (!e)
        throw new Error("Open the project before using its media"); return e; }
    async remember(project, root) { this.recent = [{ id: project.id, name: project.name, path: root, rootName: path.basename(root), updatedAt: project.updatedAt }, ...this.recent.filter(r => r.id !== project.id && r.path !== root)].slice(0, 20); await atomicWrite(path.join(this.dataDir, "recent.json"), JSON.stringify(this.recent, null, 2)); }
    loadRecent() { return this.recent.map(({ id, name, rootName, updatedAt }) => ({ id, name, rootName, updatedAt })); }
    async create(parent, name = "Untitled film") { name = String(name).trim().slice(0, 200) || "Untitled film"; const base = portableName(name); let root; for (let i = 0; i < 100; i++) {
        const candidate = path.join(parent, i ? `${base} ${i + 1}` : base);
        try {
            await fs.mkdir(candidate);
            root = candidate;
            break;
        }
        catch (e) {
            if (e.code !== "EEXIST")
                throw e;
        }
    } if (!root)
        throw new Error("Choose another project location"); root = await fs.realpath(root); await fs.mkdir(path.join(root, "assets")); const p = defaults(name); await syncWrite(path.join(root, PROJECT), JSON.stringify(p, null, 2)); this.projects.set(p.id, { root, project: p, assets: new Map() }); await this.remember(p, root); return { project: p, rootName: path.basename(root) }; }
    async open(target) {
        const root = await fs.realpath(path.extname(target).toLowerCase() === ".json" ? path.dirname(target) : target);
        let p, recovered = false;
        const notes = [];
        try {
            p = validateProject(JSON.parse(await fs.readFile(path.join(root, PROJECT), "utf8")));
        }
        catch (error) {
            try {
                p = validateProject(JSON.parse(await fs.readFile(path.join(root, BACKUP), "utf8")));
                recovered = true;
                notes.push("Recovered the previous good save; the unreadable main save was preserved.");
            }
            catch {
                throw new Error(`This folder has no readable Humanity project: ${error.message}`);
            }
        }
        const rootAssets = path.join(root, "assets");
        await fs.mkdir(rootAssets, { recursive: true });
        const realAssets = await fs.realpath(rootAssets);
        if (realAssets !== rootAssets)
            throw new Error("Project assets folder cannot be a symbolic link");
        try {
            const registry = JSON.parse(await fs.readFile(path.join(root, "assets.humanity.json"), "utf8"));
            if (registry.projectId !== p.id || !Array.isArray(registry.assets))
                throw new Error("Invalid asset registry");
            const merged = new Map(p.assets.map(a => [a.id, a]));
            let added = 0;
            for (const a of registry.assets) {
                if (!merged.has(a.id))
                    added++;
                merged.set(a.id, a);
            }
            p = validateProject({ ...p, assets: [...merged.values()] });
            if (added)
                notes.push(`${added} preserved original asset(s) recovered from the durable import registry.`);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                notes.push("The auxiliary asset registry was unreadable; project references remain available.");
        }
        for (const a of p.assets) {
            try {
                const f = path.join(rootAssets, a.fileName), s = await fs.lstat(f);
                if (!s.isFile() || s.isSymbolicLink() || s.size !== a.byteLength)
                    notes.push(`Missing or changed original: ${a.originalName}`);
            }
            catch {
                notes.push(`Missing original: ${a.originalName}`);
            }
        }
        if (this.projects.has(p.id) && this.projects.get(p.id).root !== root)
            throw new Error("Another open folder has this project ID; close and reopen the app before opening this copy");
        this.projects.set(p.id, { root, project: p, assets: new Map(p.assets.map(a => [a.id, a])) });
        await this.remember(p, root);
        return { project: p, rootName: path.basename(root), recovered, notes };
    }
    async openRecent(id) { const r = this.recent.find(r => r.id === assertId(id)); if (!r)
        throw new Error("Recent project is unavailable"); return this.open(r.path); }
    async save(input) { const e = this.entry(input.id); return this.locked(input.id, async () => { const p = validateProject(input, e.assets); p.updatedAt = new Date().toISOString(); const primary = path.join(e.root, PROJECT); let old = null; try {
        old = await fs.readFile(primary, "utf8");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    } if (old !== null) {
        let valid = true;
        try {
            validateProject(JSON.parse(old));
        }
        catch {
            valid = false;
        }
        const history = path.join(e.root, ".humanity-autosaves");
        await fs.mkdir(history, { recursive: true });
        const stamp = `${valid ? "" : "unreadable-"}${Date.now()}-${randomUUID()}.json`;
        await syncWrite(path.join(history, stamp), old);
        if (valid)
            await atomicWrite(path.join(e.root, BACKUP), old);
    } await atomicWrite(primary, JSON.stringify(p, null, 2)); e.project = p; await this.remember(p, e.root); return { savedAt: p.updatedAt }; }); }
    async persistAssets(id) { const e = this.entry(id); return this.locked(id, () => atomicWrite(path.join(e.root, "assets.humanity.json"), JSON.stringify({ version: 1, projectId: id, assets: [...e.assets.values()] }, null, 2))); }
    async assetPath(projectId, assetId, { preview = false, verify = false } = {}) { const e = this.entry(projectId), a = e.assets.get(assertId(assetId)); if (!a)
        throw new Error("Unknown asset"); const name = preview && a.previewFileName ? a.previewFileName : a.fileName; if (!/^[-A-Za-z0-9_]+\.[A-Za-z0-9]{1,8}$/.test(name))
        throw new Error("Unsafe asset path"); const file = path.join(e.root, "assets", name), s = await fs.lstat(file); if (!s.isFile() || s.isSymbolicLink())
        throw new Error("Asset is not a regular original file"); if (verify && (s.size !== a.byteLength || await hashFile(file) !== a.sha256))
        throw new Error(`Original asset changed: ${a.originalName}`); return file; }
    async addFile(projectId, source, kind) { const e = this.entry(projectId), stat = await fs.stat(source); if (!stat.isFile() || stat.size < 1 || stat.size > MAX_ASSET)
        throw new Error("Media must be a regular file under 512 MiB"); const ext = path.extname(source).toLowerCase(); if (!MIME[ext] || !MIME[ext].startsWith(kind + "/"))
        throw new Error("Unsupported media extension"); const id = randomUUID(), name = id + ext, target = path.join(e.root, "assets", name), temp = target + ".tmp"; try {
        await pipeline(fsSync.createReadStream(source), fsSync.createWriteStream(temp, { flags: "wx", mode: 0o600 }));
        const after = await fs.stat(source);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
            throw new Error("Source is still being written; retry after it finishes");
        const h = await fs.open(temp, "r+");
        await h.sync();
        await h.close();
        await fs.rename(temp, target);
        let meta = kind === "image" ? await this.imageInfo(target) : await this.audioInfo(target);
        if (kind === "image")
            geometry(meta.width, meta.height);
        const a = { id, kind, fileName: name, originalName: path.basename(source), mimeType: MIME[ext], width: meta.width || 0, height: meta.height || 0, byteLength: stat.size, sha256: await hashFile(target), createdAt: new Date().toISOString(), url: assetURL(projectId, id), ...(meta.duration ? { duration: meta.duration } : {}), ...(kind === "image" ? {bitDepth:meta.bitDepth||8}: {}) };
        if (meta.preview) {
            a.previewFileName = id + "-preview.png";
            await syncWrite(path.join(e.root, "assets", a.previewFileName), meta.preview);
        }
        e.assets.set(id, a);
        await this.persistAssets(projectId);
        return a;
    }
    catch (error) {
        await fs.unlink(temp).catch(() => { }); /* A copied original is preserved even if decoding fails. */
        throw error;
    } }
    async addBytes(projectId, buffer, kind, mime, source, name) { const e = this.entry(projectId), raw = bytes(buffer, kind === "image" ? 160 * 1024 * 1024 : MAX_ASSET); let ext; if (kind === "image") {
        pngInfo(raw);
        ext = ".png";
    }
    else {
        ext = { "audio/webm": ".webm", "audio/webm;codecs=opus": ".webm", "audio/ogg": ".ogg", "audio/ogg;codecs=opus": ".ogg", "audio/wav": ".wav", "audio/mp4": ".m4a" }[mime];
        if (!ext)
            throw new Error("Unsupported recording type");
    } const id = randomUUID(), fileName = id + ext, target = path.join(e.root, "assets", fileName); await syncWrite(target, raw); const meta = kind === "image" ? await this.imageInfo(target) : await this.audioInfo(target); if (kind === "image")
        geometry(meta.width, meta.height); const a = { id, kind, fileName, originalName: (typeof name === "string" ? name.slice(0, 180) : null) || `${kind === "image" ? "Capture" : "Recording"}-${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`, mimeType: kind === "image" ? "image/png" : mime, width: meta.width || 0, height: meta.height || 0, byteLength: raw.length, sha256: createHash("sha256").update(raw).digest("hex"), createdAt: new Date().toISOString(), url: assetURL(projectId, id), ...(meta.duration ? { duration: meta.duration } : {}), ...(kind === "image" ? {bitDepth:meta.bitDepth||8}: {}) }; e.assets.set(id, a); await this.persistAssets(projectId); return a; }
    async watch(projectId, directory, onAsset) { await this.stopWatch(projectId); const e = this.entry(projectId), root = await fs.realpath(directory); if (root === await fs.realpath(path.join(e.root, "assets")))
        throw new Error("Watch an external capture folder, not the project's own assets"); const seen = new Map(), pending = new Set(); for (const name of await fs.readdir(root)) {
        try {
            const s = await fs.stat(path.join(root, name));
            seen.set(name, `${s.size}:${s.mtimeMs}`);
        }
        catch { }
    } let closed = false; const activeImports = new Set(); const scan = async () => { if (closed)
        return; for (const name of await fs.readdir(root).catch(() => [])) {
        if (pending.has(name) || !/^.+\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name))
            continue;
        const file = path.join(root, name);
        let first;
        try {
            first = await fs.stat(file);
        }
        catch {
            continue;
        }
        const key = `${first.size}:${first.mtimeMs}`;
        if (!first.isFile() || seen.get(name) === key || !first.size)
            continue;
        pending.add(name);
        try {
            await new Promise(r => setTimeout(r, 750));
            const second = await fs.stat(file);
            if (second.size !== first.size || second.mtimeMs !== first.mtimeMs || closed)
                continue;
            // Once persistence has begun, deliver this accepted frame even if a
            // close request stops new scans. stopWatch waits for its event before
            // resolving, so the renderer can include it in the final save.
            const importing = this.addFile(projectId, file, "image").then(a => {
                seen.set(name, key);
                onAsset({ projectId, asset: a });
            });
            activeImports.add(importing);
            try { await importing; }
            finally { activeImports.delete(importing); }
        }
        catch { }
        finally {
            pending.delete(name);
        }
    } }; const timer = setInterval(() => void scan(), 1500); timer.unref?.(); this.watchers.set(projectId, { stop: async () => { closed = true; clearInterval(timer); await Promise.allSettled([...activeImports]); } }); return { name: path.basename(root) }; }
    async stopWatch(id) { const watcher = this.watchers.get(id); if (watcher) await watcher.stop(); if (this.watchers.get(id) === watcher) this.watchers.delete(id); }
    async close() { for (const id of this.watchers.keys())
        await this.stopWatch(id); await Promise.allSettled([...this.locks.values()]); }
}
module.exports = { ProjectStore, validateProject, defaults, atomicWrite, syncWrite, hashFile, assetURL, portableName, PROJECT, BACKUP };
