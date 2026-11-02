"use strict";
// GPL-3.0-or-later. Stop Motion for Humanity by Taylor Kalin.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell, systemPreferences, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { nativeImage } = require("electron");
const { ProjectStore, portableName } = require("./store.cjs");
const { ExportManager, EXTENSIONS, validateOptions } = require("./export.cjs");
const { ownedURL, safeExternal, assertId, pngInfo } = require("./security.cjs");
app.setName("Stop Motion for Humanity");
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: "humanity", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const testMode = process.argv.includes("--humanity-test") && process.env.HUMANITY_TEST_MODE === "1" && !app.isPackaged;
if (testMode && process.env.HUMANITY_TEST_USER_DATA)
    app.setPath("userData", path.resolve(process.env.HUMANITY_TEST_USER_DATA));
const gotLock = app.requestSingleInstanceLock();
let window = null, store = null, exportsManager = null, quitting = false, closed = false;
const grants = new Set();
function send(channel, value) { if (window && !window.isDestroyed())
    window.webContents.send(`humanity:${channel}`, value); }
function senderAllowed(event) { return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && ownedURL(event.senderFrame.url); }
function handle(name, action) { ipcMain.handle(`humanity:${name}`, async (event, ...args) => { if (!senderAllowed(event))
    throw new Error("Untrusted native request"); if (quitting)
    throw new Error("Application is closing"); try {
    return await action(...args);
}
catch (error) {
    throw new Error(error.message || "Native action failed");
} }); }
function cameraStatus(kind) { try {
    return systemPreferences.getMediaAccessStatus(kind);
}
catch {
    return "unknown";
} }
async function permission(kind) { if (!["camera", "microphone"].includes(kind))
    throw new Error("Invalid media permission"); let allowed = true; if (process.platform === "darwin") {
    const status = cameraStatus(kind);
    allowed = status === "granted" || (status === "not-determined" && await systemPreferences.askForMediaAccess(kind));
}
else
    allowed = !['denied', 'restricted'].includes(cameraStatus(kind)); if (allowed)
    grants.add(kind === "camera" ? "video" : "audio"); return allowed; }
async function selectedProject(options) { if (!options || !["create", "open"].includes(options.mode))
    throw new Error("Choose create or open"); if (options.mode === "create") {
    const chosen = await dialog.showOpenDialog(window, { title: "Choose where to create the portable film project", properties: ["openDirectory", "createDirectory"] });
    if (chosen.canceled)
        return null;
    return store.create(chosen.filePaths[0], options.name);
} const chosen = await dialog.showOpenDialog(window, { title: "Open Humanity project", properties: ["openFile"], filters: [{ name: "Humanity project", extensions: ["json"] }] }); if (chosen.canceled)
    return null; return store.open(chosen.filePaths[0]); }
function registerIPC() {
    handle("appInfo", async () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, ...await exportsManager.mediaInfo(), cameraPermission: cameraStatus("camera"), microphonePermission: cameraStatus("microphone") }));
    handle("chooseProject", selectedProject);
    handle("loadRecent", () => store.loadRecent());
    handle("openRecent", id => store.openRecent(id));
    handle("saveProject", project => store.save(project));
    handle("importImages", async (id) => { store.entry(id); const chosen = await dialog.showOpenDialog(window, { title: "Import original still frames", properties: ["openFile", "multiSelections"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "dpx", "exr", "jp2", "j2k", "jxl"] }] }); if (chosen.canceled)
        return []; if (chosen.filePaths.length > 10000)
        throw new Error("Import at most 10,000 frames at once"); const assets = []; for (const file of chosen.filePaths)
        assets.push(await store.addFile(id, file, "image")); return assets; });
    handle("importAudio", async (id) => { store.entry(id); const chosen = await dialog.showOpenDialog(window, { title: "Import original audio", properties: ["openFile"], filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "webm", "aif", "aiff"] }] }); return chosen.canceled ? null : store.addFile(id, chosen.filePaths[0], "audio"); });
    handle("addCapture", (id, data) => { if (!data || !data.source || !["camera", "demo"].includes(data.source.type))
        throw new Error("Invalid capture source"); return store.addBytes(id, data.png, "image", "image/png", data.source, data.name); });
    handle("addAudioRecording", (id, data) => { if (!data)
        throw new Error("Recording data is missing"); return store.addBytes(id, data.bytes, "audio", data.mimeType); });
    handle("exportBegin", async (project, rawOptions) => { const options = validateOptions(rawOptions); store.entry(project.id); const chosen = await dialog.showSaveDialog(window, { title: "Export film", defaultPath: `${portableName(project.name)}${EXTENSIONS[options.profile]}`, filters: [{ name: options.profile === "originals" ? "Original sequence ZIP" : options.profile.toUpperCase(), extensions: [EXTENSIONS[options.profile].slice(1)] }] }); if (chosen.canceled || !chosen.filePath)
        return null; return exportsManager.begin(project, options, chosen.filePath); });
    handle("exportFrame", (id, data) => exportsManager.frame(id, data));
    handle("exportFinish", id => exportsManager.finish(id));
    handle("exportCancel", id => exportsManager.cancel(id));
    handle("revealExport", id => { shell.showItemInFolder(exportsManager.result(id).filePath); });
    handle("chooseWatchFolder", async (id) => { store.entry(id); const selected = await dialog.showOpenDialog(window, { title: "Watch external camera capture folder", properties: ["openDirectory"] }); if (selected.canceled)
        return null; return store.watch(id, selected.filePaths[0], data => send("importedFrame", data)); });
    handle("stopWatchFolder", id => store.stopWatch(assertId(id)));
    handle("revealProject", async (id) => { const error = await shell.openPath(store.entry(id).root); if (error)
        throw new Error(error); });
    handle("requestMediaPermission", permission);
}
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
async function registerProtocol() { const dist = path.resolve(__dirname, "..", "dist"); session.fromPartition("persist:stop-motion-humanity").protocol.handle("humanity", async (request) => { try {
    const u = new URL(request.url);
    if (!ownedURL(request.url) || request.method !== "GET")
        return new Response("Denied", { status: 403 });
    let target, type;
    const asset = u.pathname.match(/^\/asset\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,80})$/);
    if (asset) {
        target = await store.assetPath(asset[1], asset[2], { preview: true });
        const record = store.entry(asset[1]).assets.get(asset[2]);
        type = record.previewFileName ? "image/png" : record.mimeType;
    }
    else {
        const decoded = decodeURIComponent(u.pathname);
        if (decoded.includes("\\") || decoded.split("/").some(s => s === ".." || s === ".") || !/^\/[A-Za-z0-9_./-]*$/.test(decoded))
            return new Response("Denied", { status: 403 });
        target = path.resolve(dist, "." + (decoded === "/" ? "/index.html" : decoded));
        if (!target.startsWith(dist + path.sep))
            return new Response("Denied", { status: 403 });
        const real = await fs.realpath(target);
        if (!real.startsWith(dist + path.sep))
            return new Response("Denied", { status: 403 });
    }
    const range = request.headers.get("Range");
    const response = await net.fetch(pathToFileURL(target).href, { headers: range ? { Range: range } : {} }), headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");
    if (type)
        headers.set("Content-Type", type);
    return new Response(response.body, { status: response.status, headers });
}
catch {
    return new Response("Asset is unavailable", { status: 404 });
} }); }
function installMenu() { const trigger = action => send("menuAction", action); const menu = []; if (process.platform === "darwin")
    menu.push({ label: app.name, submenu: [{ label: "About Stop Motion for Humanity", click: () => dialog.showMessageBox(window, { type: "info", message: "Stop Motion for Humanity", detail: `${app.getVersion()} · Taylor Kalin\nFree software under GPL-3.0-or-later. Camera images and projects stay on your computer.` }) }, { type: "separator" }, { role: "services" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }); menu.push({ label: "File", submenu: [{ label: "New film", accelerator: "CmdOrCtrl+N", click: () => trigger("new") }, { label: "Open film", accelerator: "CmdOrCtrl+O", click: () => trigger("open") }, { label: "Save film", accelerator: "CmdOrCtrl+S", click: () => trigger("save") }, { label: "Export film", accelerator: "CmdOrCtrl+E", click: () => trigger("export") }, { type: "separator" }, { role: process.platform === "darwin" ? "close" : "quit" }] }, { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] }, { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] }, { label: "Help", submenu: [{ label: "Studio guide", click: () => trigger("help") }, { label: "Source and release downloads", click: () => shell.openExternal(require("../package.json").homepage) }] }); Menu.setApplicationMenu(Menu.buildFromTemplate(menu)); }
function makeWindow() {
    window = new BrowserWindow({ title: "Stop Motion for Humanity", width: 1500, height: 980, minWidth: 1024, minHeight: 700, backgroundColor: "#10141d", show: true, icon: path.join(__dirname, "..", "assets", "icon.png"), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false, partition: "persist:stop-motion-humanity", devTools: !app.isPackaged } });
    const ses = window.webContents.session;
    ses.setPermissionCheckHandler((contents, permission, origin, details) => contents === window.webContents && ownedURL(origin) && details.isMainFrame && permission === "media" && grants.has(details.mediaType));
    ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === window.webContents && ownedURL(details.requestingUrl || contents.getURL()) && details.isMainFrame && ((permission === "fullscreen") || (permission === "media" && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every(kind => grants.has(kind))))));
    window.webContents.setWindowOpenHandler(({ url }) => { if (safeExternal(url))
        void shell.openExternal(url); return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, url) => { if (!ownedURL(url))
        event.preventDefault(); });
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.once("ready-to-show", () => { window.show(); window.focus(); });
    window.on("closed", () => { window = null; });
    window.webContents.on("render-process-gone", (_event, details) => { grants.clear(); if (!quitting)
        dialog.showErrorBox("Studio view stopped", `The editing view stopped (${details.reason}). Your saved film and originals remain in the project folder. Quit and reopen the app to recover.`); });
    window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => { if (isMainFrame && !quitting) {
        window.show();
        dialog.showErrorBox("Studio could not load", `The local application view could not load (${code}: ${description}). Reopen the app; if this continues, report the exact message.`);
    } });
    window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame)
        grants.clear(); });
    void window.loadURL("humanity://app/index.html").catch(error => { if (!quitting)
        console.error("Studio local view failed:", error.message); });
}
async function shutdown() { if (closed)
    return; closed = true; await exportsManager?.close(); await store?.close(); }
if (!gotLock)
    app.quit();
else {
    app.on("second-instance", () => { if (window) {
        if (window.isMinimized())
            window.restore();
        window.show();
        window.focus();
    } });
    app.whenReady().then(async () => { const mediaDir = app.isPackaged ? path.join(process.resourcesPath, "media") : path.resolve(process.env.HUMANITY_MEDIA_DIR || path.join(__dirname, "..", "resources", "media", `${process.platform}-${process.arch}`)); store = new ProjectStore({ dataDir: app.getPath("userData"), imageInfo: file => exportsManager.imageInfo(file, nativeImage), audioInfo: file => exportsManager.audioInfo(file) }); exportsManager = new ExportManager({ store, mediaDir, onProgress: data => send("exportProgress", data), checkPNG: buffer => { const dimensions = pngInfo(buffer), image = nativeImage.createFromBuffer(buffer); if (image.isEmpty())
            throw new Error("Cannot decode captured PNG"); const actual = image.getSize(); if (actual.width !== dimensions.width || actual.height !== dimensions.height)
            throw new Error("PNG dimensions did not verify"); return actual; } }); await store.init(); registerIPC(); await registerProtocol(); makeWindow(); installMenu(); }).catch(error => { dialog.showErrorBox("Studio could not start", error.message); app.exit(1); });
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", event => { if (closed)
        return; event.preventDefault(); if (quitting)
        return; quitting = true; void shutdown().finally(() => app.quit()); });
}
