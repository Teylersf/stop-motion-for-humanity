/* GPL-3.0-or-later. Isolated, sandboxed application test; no user-browser automation. */
'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const root = path.resolve(__dirname, '../..');
const fixtureURL = 'http://127.0.0.1:8775/src/core/test/browser-fixture.html';
const origin = new URL(fixtureURL).origin;
const outputFile = path.join(root, 'out', 'canvas-validation.json');
const publicFile = path.join(root, 'docs', 'validation', 'canvas-windows-development.json');
const prefix = 'HUMANITY_CANVAS_RECEIPT:';
const errorPrefix = 'HUMANITY_CANVAS_ERROR:';
const startedAt = new Date().toISOString();
const rendererErrors = []; let lastReceipt = null, window = null, finished = false, watchdog;
let screenshotHash = null;
const sourceSHA256 = Object.fromEntries(['desktop/test/canvas-runner.cjs', 'src/core/test/browser-fixture.ts', 'src/core/render.ts', 'src/core/demo.ts', 'src/core/model.ts', 'src/core/camera.ts', 'src/core/types.ts']
  .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
// Never share the real application's profile, cache, storage or process lock.
app.setPath('userData', path.join(root, 'out', 'canvas-harness-user-data'));
app.setName('Humanity isolated Canvas verification');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function writeReceipt(complete = false, failure = null) {
  const receipt = { ...lastReceipt, harness: {
    kind: 'isolated sandboxed Electron BrowserWindow', fixtureURL, startedAt,
    platform: process.platform, architecture: process.arch, osRelease: os.release(), versions: process.versions,
    permissions: 'All requests denied; no camera, microphone or user-media assets accessed',
    network: 'Loopback Vite fixture resources only; external requests and navigation denied',
    backgroundThrottling: false, offscreen: true, nodeIntegration: false, sandbox: true, sourceSHA256,
    completed: complete, failure, rendererErrors: [...rendererErrors], screenshotSHA256: screenshotHash
  } };
  fs.writeFileSync(outputFile, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
function deadline() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => finish(false, `Fixture stalled for 120 seconds: ${lastReceipt?.current ?? 'waiting for first receipt'}`), 120000);
}
async function finish(passed, failure = null) {
  if (finished) return; finished = true; clearTimeout(watchdog); clearTimeout(overall);
  try {
    if (passed) {
      // Only our own procedural test window is captured. This never reads the user's app.
      try {
        // The receipt is synchronous, but the compositor needs a turn to paint final PASS text.
        await new Promise(resolve => setTimeout(resolve, 250));
        const image = await Promise.race([window.webContents.capturePage(), new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot timed out')), 10000))]);
        const png = image.toPNG(); const imageFile = path.join(root, 'docs', 'images', 'canvas-verification.png');
        fs.mkdirSync(path.dirname(imageFile), { recursive: true }); fs.writeFileSync(imageFile, png);
        screenshotHash = crypto.createHash('sha256').update(png).digest('hex');
      } catch (error) { process.stdout.write(`[canvas] Optional procedural screenshot: ${error.message}\n`); }
    }
    const receipt = writeReceipt(lastReceipt?.complete === true, failure);
    // Public evidence exists only after the complete thirteen-test receipt has arrived.
    if (lastReceipt?.complete === true && lastReceipt.tests.length === 13) {
      fs.mkdirSync(path.dirname(publicFile), { recursive: true }); fs.writeFileSync(publicFile, JSON.stringify(receipt, null, 2) + '\n');
    }
    process.stdout.write(`[canvas] ${passed ? 'PASS' : 'FAIL'} ${lastReceipt?.passed ?? 0}/13; ${failure ?? outputFile}\n`);
  } catch (error) { process.stderr.write(`[canvas] Could not write receipt: ${error.stack}\n`); passed = false; }
  finally { if (window && !window.isDestroyed()) window.destroy(); app.exit(passed ? 0 : 1); }
}
function validReceipt(value) {
  return value && value.schemaVersion === 1 && value.expectedTests === 13 && value.suite === 'canvas-rgba8-v2-transform-state' &&
    ['begin', 'result', 'final'].includes(value.phase) && typeof value.complete === 'boolean' &&
    (value.current === null || typeof value.current === 'string' && value.current.length <= 300) &&
    Array.isArray(value.tests) && value.tests.length <= 13 && value.tests.every(test =>
      test && typeof test.name === 'string' && test.name.length <= 300 && typeof test.passed === 'boolean' &&
      typeof test.details === 'string' && test.details.length <= 4000 && Number.isFinite(test.milliseconds) && test.milliseconds >= 0) &&
    new Set(value.tests.map(test => test.name)).size === value.tests.length &&
    value.passed === value.tests.filter(test => test.passed).length && value.failed === value.tests.filter(test => !test.passed).length &&
    Array.isArray(value.rendererErrors) && value.rendererErrors.length <= 20 && value.rendererErrors.every(error => typeof error === 'string' && error.length <= 2000);
}
const overall = setTimeout(() => finish(false, 'Canvas fixture exceeded the overall six-minute test limit.'), 360000);
app.whenReady().then(async () => {
  const isolated = session.fromPartition(`canvas-test-${crypto.randomUUID()}`);
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.setDevicePermissionHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => {
    let permitted = /^(blob:|data:image\/)/.test(details.url);
    try { const url = new URL(details.url); permitted ||= url.origin === origin || url.protocol === 'ws:' && url.hostname === '127.0.0.1' && url.port === '8775'; } catch {}
    callback({ cancel: !permitted });
  });
  window = new BrowserWindow({ show: false, width: 1280, height: 1800, backgroundColor: '#111820',
    webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== fixtureURL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('console-message', event => {
    const message = event.message;
    if (typeof message !== 'string' || message.length > 65536) return;
    if (message.startsWith(errorPrefix)) {
      rendererErrors.push(message.slice(errorPrefix.length, errorPrefix.length + 2000));
      process.stderr.write(`[canvas] Renderer error: ${rendererErrors.at(-1)}\n`); return;
    }
    if (!message.startsWith(prefix)) {
      if (event.level === 'error') { rendererErrors.push(message.slice(0, 2000)); process.stderr.write(`[canvas] Renderer console: ${message.slice(0, 2000)}\n`); }
      return;
    }
    try {
      const value = JSON.parse(message.slice(prefix.length));
      if (!validReceipt(value)) throw new Error('Invalid bounded thirteen-test receipt schema.');
      if (lastReceipt && value.tests.length < lastReceipt.tests.length) throw new Error('Fixture reloaded or receipt ordering regressed.');
      lastReceipt = value; writeReceipt(false); deadline();
      if (value.phase === 'begin') process.stdout.write(`[canvas] RUN ${value.tests.length + 1}/13 ${value.current}\n`);
      else if (value.phase === 'result') {
        const result = value.tests.at(-1); process.stdout.write(`[canvas] ${result.passed ? 'PASS' : 'FAIL'} ${value.tests.length}/13 ${result.name} (${result.milliseconds}ms) ${result.details}\n`);
      } else {
        const passed = value.complete && value.tests.length === 13 && value.passed === 13 && value.failed === 0 && !value.rendererErrors.length && !rendererErrors.length;
        finish(passed, passed ? null : 'One or more Canvas assertions or renderer errors failed.');
      }
    } catch (error) { finish(false, `Receipt rejected: ${error.message}`); }
  });
  window.webContents.on('render-process-gone', (_event, details) => finish(false, `Renderer process exited: ${details.reason} (${details.exitCode})`));
  window.webContents.on('unresponsive', () => process.stderr.write(`[canvas] Renderer unresponsive during ${lastReceipt?.current ?? 'startup'}\n`));
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => { if (isMainFrame) finish(false, `Fixture load failed ${code}: ${description} (${url})`); });
  deadline(); process.stdout.write(`[canvas] Loading isolated local fixture: ${fixtureURL}\n`);
  await window.loadURL(fixtureURL);
}).catch(error => finish(false, error.stack ?? String(error)));
app.on('window-all-closed', () => { if (!finished) finish(false, 'Test window closed before the final receipt.'); });
process.on('uncaughtException', error => finish(false, error.stack ?? String(error)));
process.on('unhandledRejection', error => finish(false, error?.stack ?? String(error)));
