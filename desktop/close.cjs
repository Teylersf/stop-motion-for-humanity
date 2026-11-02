"use strict";
// GPL-3.0-or-later. A normal close never races the renderer's final durable save.
const { randomUUID } = require("node:crypto");

class CloseHandshake {
    constructor({ requestRenderer, finalize, onFailure, timeoutMs = 60000, rendererReady = true }) {
        this.requestRenderer = requestRenderer;
        this.finalize = finalize;
        this.onFailure = onFailure;
        this.timeoutMs = timeoutMs;
        this.pending = null;
        this.rendererReady = rendererReady;
    }
    request(reason = "quit") {
        if (this.pending)
            return this.pending.promise;
        let resolve, reject;
        const acknowledgement = new Promise((yes, no) => { resolve = yes; reject = no; });
        const pending = { requestId: randomUUID(), reason, phase: "waiting", delivered: false, resolve, reject, timer: null, promise: null };
        this.pending = pending;
        pending.promise = acknowledgement.then(() => this.finalize()).then(() => true).catch(async error => {
            pending.phase = "failed";
            try { await this.onFailure({ requestId: pending.requestId, reason, error: error.message || "The film could not be saved before closing." }); }
            catch (failure) { console.error("Close feedback failed:", failure.message); }
            return false;
        }).finally(() => {
            clearTimeout(pending.timer);
            if (this.pending === pending)
                this.pending = null;
        });
        pending.timer = setTimeout(() => this.fail(new Error("The editing view did not confirm that its latest changes were saved within 60 seconds. The app is staying open to protect unsaved work.")), this.timeoutMs);
        this.deliver();
        return pending.promise;
    }
    setRendererReady(ready) {
        if (typeof ready !== "boolean") throw new Error("Invalid close listener readiness");
        this.rendererReady = ready;
        if (!ready && this.pending?.phase === "waiting") this.pending.delivered = false;
        this.deliver();
    }
    deliver() {
        const pending = this.pending;
        if (!this.rendererReady || !pending || pending.phase !== "waiting" || pending.delivered) return;
        pending.delivered = true;
        const delivery = {}; pending.delivery = delivery;
        Promise.resolve().then(() => {
            if (this.pending === pending && pending.phase === "waiting" && this.rendererReady && pending.delivered && pending.delivery === delivery)
                return this.requestRenderer({ requestId: pending.requestId, reason: pending.reason });
        }).catch(error => this.fail(error));
    }
    finalizeWithoutSaving() {
        if (!this.pending || this.pending.phase !== "failed")
            throw new Error("An explicit failure recovery choice is required before quitting without the latest save");
        return this.finalize();
    }
    complete(reply) {
        if (!reply || typeof reply !== "object" || Array.isArray(reply) || typeof reply.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(reply.requestId) || typeof reply.ok !== "boolean" || (reply.error !== undefined && (typeof reply.error !== "string" || reply.error.length > 2000)) || Object.keys(reply).some(key => !["requestId", "ok", "error"].includes(key)))
            throw new Error("Invalid close confirmation");
        const pending = this.pending;
        if (!pending || pending.phase !== "waiting" || pending.requestId !== reply.requestId)
            return { accepted: false };
        clearTimeout(pending.timer);
        if (!reply.ok) {
            this.fail(new Error(reply.error || "The latest film changes could not be saved. The app is staying open."));
            return { accepted: true };
        }
        pending.phase = "finalizing";
        pending.resolve();
        return { accepted: true };
    }
    fail(error) {
        const pending = this.pending;
        if (!pending || pending.phase !== "waiting")
            return;
        pending.phase = "failed";
        clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
}
module.exports = { CloseHandshake };
