"use strict";
// GPL-3.0-or-later. The native quit gate must wait for the latest durable save.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { setTimeout: pause } = require("node:timers/promises");
const { CloseHandshake } = require("../close.cjs");
const { ProjectStore, PROJECT } = require("../store.cjs");
const { pngInfo } = require("../security.cjs");
const zlib = require("node:zlib");
const crc32 = require("buffer-crc32");

function gate() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixturePNG() {
    const chunk = (type, data) => { const name = Buffer.from(type), size = Buffer.alloc(4); size.writeUInt32BE(data.length); return Buffer.concat([size, name, data, crc32(Buffer.concat([name, data]))]); };
    const head = Buffer.alloc(13); head.writeUInt32BE(32); head.writeUInt32BE(24, 4); head[8] = 8; head[9] = 6;
    const pixels = Buffer.alloc((32 * 4 + 1) * 24); for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) { const i = y * 129 + 1 + x * 4; pixels[i] = x * 7; pixels[i + 1] = y * 9; pixels[i + 2] = 97; pixels[i + 3] = 255; }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

test("immediate quit waits behind an older autosave and preserves the latest title on disk", async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "humanity-close-test-"));
    const store = new ProjectStore({ dataDir: path.join(temp, "app-data") });
    await store.init();
    t.after(async () => { await store.close(); assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith("humanity-close-test-")); await fs.rm(temp, { recursive: true, force: true }); });
    const { project } = await store.create(temp, "Before the title edit");
    const root = store.entry(project.id).root, before = structuredClone(project), latest = structuredClone(project);
    latest.name = "The title typed immediately before Quit";
    latest.settings.title = "Unsaved final title card";
    const releaseAutosave = gate(), requested = gate();
    let finalized = false, requests = 0;
    let queue = releaseAutosave.promise.then(() => store.save(before));
    const handshake = new CloseHandshake({
        requestRenderer: request => {
            requests++;
            // This is the renderer contract: queued saves finish first, then save
            // its current project ref, then acknowledge the matching close only.
            queue = queue.then(() => store.save(latest));
            queue.then(() => handshake.complete({ requestId: request.requestId, ok: true }));
            requested.resolve();
        },
        finalize: async () => { await store.close(); finalized = true; },
        onFailure: error => assert.fail(error.error),
    });
    const quitting = handshake.request("quit");
    assert.equal(handshake.request("window-close"), quitting, "Repeated Quit/close must not race two final saves");
    await requested.promise;
    assert.equal(finalized, false, "Native destruction must wait for acknowledgement");
    releaseAutosave.resolve();
    assert.equal(await quitting, true);
    assert.equal(requests, 1);
    assert.equal(finalized, true);
    const saved = JSON.parse(await fs.readFile(path.join(root, PROJECT), "utf8"));
    assert.equal(saved.name, latest.name);
    assert.equal(saved.settings.title, latest.settings.title);
    const reopened = await store.open(root);
    assert.equal(reopened.project.name, latest.name);
    assert.equal(reopened.project.settings.title, latest.settings.title);
});

test("save failure keeps the app open and a new explicit retry can succeed", async () => {
    const received = [], failures = [];
    let finalized = 0;
    const handshake = new CloseHandshake({ requestRenderer: data => received.push(data), finalize: () => { finalized++; }, onFailure: data => failures.push(data) });
    const first = handshake.request(); await pause(0);
    assert.deepEqual(handshake.complete({ requestId: received[0].requestId, ok: false, error: "Project drive is disconnected" }), { accepted: true });
    assert.equal(await first, false);
    assert.equal(finalized, 0);
    assert.match(failures[0].error, /drive is disconnected/);
    const second = handshake.request(); await pause(0);
    assert.notEqual(received[0].requestId, received[1].requestId);
    assert.deepEqual(handshake.complete({ requestId: received[0].requestId, ok: true }), { accepted: false });
    assert.equal(finalized, 0, "A stale success must not discard the new in-flight save");
    handshake.complete({ requestId: received[1].requestId, ok: true });
    assert.equal(await second, true);
    assert.equal(finalized, 1);
});

test("unresponsive renderer timeout never closes and a late success cannot authorize destruction", async () => {
    let request, finalized = false; const failures = [];
    const handshake = new CloseHandshake({ requestRenderer: data => { request = data; }, finalize: () => { finalized = true; }, onFailure: data => failures.push(data), timeoutMs: 15 });
    assert.equal(await handshake.request(), false);
    assert.equal(finalized, false);
    assert.match(failures[0].error, /staying open/);
    assert.deepEqual(handshake.complete({ requestId: request.requestId, ok: true }), { accepted: false });
    assert.equal(finalized, false);
});

test("unavailable/crashed renderer and native shutdown errors surface without a successful close", async () => {
    const failures = [];
    const absent = new CloseHandshake({ requestRenderer: () => { throw new Error("View unavailable"); }, finalize: () => assert.fail("No save acknowledgement"), onFailure: data => failures.push(data) });
    assert.equal(await absent.request(), false);
    assert.equal(failures[0].error, "View unavailable");
    let request;
    const failedNative = new CloseHandshake({ requestRenderer: data => { request = data; }, finalize: () => { throw new Error("Final project sync failed"); }, onFailure: data => failures.push(data) });
    const pending = failedNative.request(); await pause(0);
    failedNative.complete({ requestId: request.requestId, ok: true });
    assert.equal(await pending, false);
    assert.equal(failures[1].error, "Final project sync failed");
});

test("close acknowledgement is narrow and does not accept malformed or duplicated confirmations", async () => {
    let request, finalized = 0;
    const handshake = new CloseHandshake({ requestRenderer: data => { request = data; }, finalize: () => { finalized++; }, onFailure: data => assert.fail(data.error) });
    const pending = handshake.request(); await pause(0);
    for (const value of [null, [], { requestId: request.requestId, ok: "yes" }, { requestId: request.requestId, ok: true, path: "arbitrary" }, { requestId: "wrong", ok: true }])
        assert.throws(() => handshake.complete(value), /Invalid close confirmation/);
    assert.deepEqual(handshake.complete({ requestId: request.requestId, ok: true }), { accepted: true });
    assert.deepEqual(handshake.complete({ requestId: request.requestId, ok: true }), { accepted: false });
    assert.equal(await pending, true);
    assert.equal(finalized, 1);
});

test("quitting without the latest save requires an explicit failure-only recovery choice", async () => {
    let request, finalized = 0, explicitChoice = false;
    const handshake = new CloseHandshake({
        requestRenderer: data => { request = data; },
        finalize: () => { finalized++; },
        onFailure: async () => { assert.equal(finalized, 0); if (explicitChoice) await handshake.finalizeWithoutSaving(); },
    });
    assert.throws(() => handshake.finalizeWithoutSaving(), /explicit failure recovery/);
    const first = handshake.request(); await pause(0);
    assert.throws(() => handshake.finalizeWithoutSaving(), /explicit failure recovery/);
    handshake.complete({ requestId: request.requestId, ok: false, error: "Renderer could not save" });
    assert.equal(await first, false);
    assert.equal(finalized, 0, "Default Keep editing must never discard unsaved view state");
    explicitChoice = true;
    const retry = handshake.request(); await pause(0);
    handshake.complete({ requestId: request.requestId, ok: false, error: "Renderer remains unavailable" });
    assert.equal(await retry, false);
    assert.equal(finalized, 1, "Only the explicit recovery choice invokes normal native cleanup without a save ACK");
});

test("stopping folder watch drains an accepted real PNG import and delivers its event before the final-save barrier", async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "humanity-watch-close-test-"));
    const importing = gate(), release = gate(), events = [];
    const store = new ProjectStore({ dataDir: path.join(temp, "app-data"), imageInfo: async file => { importing.resolve(); await release.promise; return pngInfo(await fs.readFile(file)); } });
    await store.init();
    t.after(async () => { release.resolve(); await store.close(); assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith("humanity-watch-close-test-")); await fs.rm(temp, { recursive: true, force: true }); });
    const { project } = await store.create(temp, "Watched film"), watch = path.join(temp, "external-camera");
    await fs.mkdir(watch);
    await store.watch(project.id, watch, ({ asset }) => { events.push("importedFrame"); project.assets.push(asset); });
    await fs.writeFile(path.join(watch, "accepted0001.png"), fixturePNG());
    let timer;
    try { await Promise.race([importing.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The actual watched PNG was not accepted")), 6000); })]); }
    finally { clearTimeout(timer); }
    const stopped = store.stopWatch(project.id).then(() => events.push("stopped"));
    await pause(0);
    assert.deepEqual(events, [], "stopWatch must wait for the accepted import to persist and notify the renderer");
    release.resolve(); await stopped;
    assert.deepEqual(events, ["importedFrame", "stopped"]);
    await store.save(project);
    const reopened = await store.open(store.entry(project.id).root);
    assert.equal(reopened.project.assets.length, 1);
    assert.equal(reopened.project.assets[0].originalName, "accepted0001.png");
});

test("an early startup quit waits for a subscribed listener and is delivered exactly once", async () => {
    const received = []; let finalized = 0;
    const handshake = new CloseHandshake({ rendererReady: false, requestRenderer: data => received.push(data), finalize: () => { finalized++; }, onFailure: data => assert.fail(data.error) });
    const closing = handshake.request("quit"); await pause(0);
    assert.equal(received.length, 0, "A pre-preload quit must remain pending rather than send a lost event");
    handshake.setRendererReady(true); handshake.setRendererReady(false); handshake.setRendererReady(true); handshake.setRendererReady(true); await pause(0);
    assert.equal(received.length, 1);
    assert.equal(received[0].reason, "quit");
    handshake.complete({ requestId: received[0].requestId, ok: true });
    assert.equal(await closing, true);
    handshake.setRendererReady(false); handshake.setRendererReady(true); await pause(0);
    assert.equal(received.length, 1, "A completed request cannot replay on remount");
    assert.equal(finalized, 1);
});

test("cancelled startup close cannot replay to a late listener, while a fresh request can", async () => {
    const received = [], failures = [];
    const handshake = new CloseHandshake({ rendererReady: false, requestRenderer: data => received.push(data), finalize: () => {}, onFailure: data => failures.push(data) });
    const old = handshake.request(); const oldId = handshake.pending.requestId;
    handshake.fail(new Error("Startup close cancelled"));
    handshake.setRendererReady(true); await pause(0);
    assert.equal(await old, false);
    assert.equal(received.length, 0);
    assert.equal(failures.length, 1);
    const current = handshake.request(); await pause(0);
    assert.equal(received.length, 1);
    assert.notEqual(received[0].requestId, oldId);
    assert.deepEqual(handshake.complete({ requestId: oldId, ok: true }), { accepted: false });
    handshake.complete({ requestId: received[0].requestId, ok: true });
    assert.equal(await current, true);
});
