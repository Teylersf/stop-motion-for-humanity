"use strict";
// GPL-3.0-or-later. No raw IPC, filesystem, process or shell access is exposed.
const { contextBridge, ipcRenderer } = require("electron");
const call = (name, ...args) => ipcRenderer.invoke(`humanity:${name}`, ...args);
function subscribe(channel, callback) { if (typeof callback !== "function")
    throw new TypeError("A callback is required"); const listener = (_event, value) => callback(value); ipcRenderer.on(`humanity:${channel}`, listener); return () => ipcRenderer.removeListener(`humanity:${channel}`, listener); }
contextBridge.exposeInMainWorld("humanity", Object.freeze({
    appInfo: () => call("appInfo"), chooseProject: options => call("chooseProject", options), loadRecent: () => call("loadRecent"), openRecent: id => call("openRecent", id), saveProject: project => call("saveProject", project),
    importImages: id => call("importImages", id), importAudio: id => call("importAudio", id), addCapture: (id, data) => call("addCapture", id, data), addAudioRecording: (id, data) => call("addAudioRecording", id, data),
    exportBegin: (project, options) => call("exportBegin", project, options), exportFrame: (id, data) => call("exportFrame", id, data), exportFinish: id => call("exportFinish", id), exportCancel: id => call("exportCancel", id), revealExport: id => call("revealExport", id),
    chooseWatchFolder: id => call("chooseWatchFolder", id), stopWatchFolder: id => call("stopWatchFolder", id), revealProject: id => call("revealProject", id), requestMediaPermission: kind => call("requestMediaPermission", kind),
    onExportProgress: callback => subscribe("exportProgress", callback), onImportedFrame: callback => subscribe("importedFrame", callback), onMenuAction: callback => subscribe("menuAction", callback),
}));
