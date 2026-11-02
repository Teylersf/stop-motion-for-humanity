/** GPL-3.0-or-later. Browser-executed assertions using the real Canvas and PNG codecs. */
import { addFrames, cloneProject, createProject, defaultFrameEdits } from '../model.ts';
import { drawComparison, drawGuides, loadAssetImage, renderFrame, renderFramePNG } from '../render.ts';
import { canvasPNG } from '../camera.ts';
import { createDemoFrame, generateDemoFrames } from '../demo.ts';
import type { AssetRecord, PaintStroke, StudioProject } from '../types.ts';

interface Result { name: string; passed: boolean; details: string; milliseconds: number }
const results: Result[] = []; const started = performance.now();
const output = document.getElementById('results')!, receipt = document.getElementById('receipt')!, status = document.getElementById('status')!;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray { return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; }
function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] { return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data]; }
function imageCanvas(width = 64, height = 48, color?: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!;
  if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); }
  else { for (const [x, y, color] of [[0, 0, '#ff0000'], [width / 2, 0, '#00ff00'], [0, height / 2, '#0000ff'], [width / 2, height / 2, '#ffff00']] as const) { ctx.fillStyle = color; ctx.fillRect(x, y, width / 2, height / 2); } }
  return canvas;
}
function asset(canvas: HTMLCanvasElement, id: string): AssetRecord {
  return { id, kind: 'image', fileName: `${id}.png`, originalName: `${id}.png`, mimeType: 'image/png', width: canvas.width, height: canvas.height, byteLength: 1, sha256: '0'.repeat(64), createdAt: new Date().toISOString(), url: canvas.toDataURL('image/png') };
}
const source = imageCanvas(); const base = addFrames(createProject('Canvas verification', { width: 64, height: 48 }), [asset(source, 'source')]);
async function render(project = base): Promise<HTMLCanvasElement> { return renderFrame(project, project.scenes[0].frames[0]); }
async function sha(bytes: Uint8Array | Uint8ClampedArray): Promise<string> { const copy = Uint8Array.from(bytes); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(value => value.toString(16).padStart(2, '0')).join(''); }
async function decodedPNG(png: Uint8Array): Promise<HTMLImageElement> { const url = URL.createObjectURL(new Blob([Uint8Array.from(png)], { type: 'image/png' })); try { return await loadAssetImage(url); } finally { URL.revokeObjectURL(url); } }
async function run(name: string, operation: () => Promise<string | void>): Promise<void> {
  const begin = performance.now(); const item = document.createElement('li'); item.textContent = `${name} — running`; output.append(item); status.textContent = `Running: ${name}`;
  try { const details = await operation(); results.push({ name, passed: true, details: details ?? '', milliseconds: Math.round(performance.now() - begin) }); item.textContent = `PASS · ${name}${details ? ` — ${details}` : ''}`; item.className = 'pass'; }
  catch (error) { const details = error instanceof Error ? error.message : String(error); results.push({ name, passed: false, details, milliseconds: Math.round(performance.now() - begin) }); item.textContent = `FAIL · ${name} — ${details}`; item.className = 'fail'; }
  receipt.textContent = JSON.stringify({ app: 'Stop Motion for Humanity', runtime: navigator.userAgent, tests: results, passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, elapsedMs: Math.round(performance.now() - started) }, null, 2);
}
await run('Default render preserves all original opaque RGBA pixels', async () => { assert(same(pixels(source), pixels(await render())), 'Rendered pixels differ from original quadrants.'); });
await run('Repeat PNG encoding is deterministic and independently decodes to the same samples', async () => {
  const frame = base.scenes[0].frames[0], a = await renderFramePNG(base, frame), b = await renderFramePNG(base, frame); assert(same(a, b), 'Repeated PNG bytes changed.');
  const decoded = await decodedPNG(a); assert(decoded.naturalWidth === 64 && decoded.naturalHeight === 48, 'Decoded dimensions differ.');
  const roundTrip = imageCanvas(); roundTrip.getContext('2d')!.drawImage(decoded, 0, 0); assert(same(pixels(source), pixels(roundTrip)), 'PNG decoded samples differ.'); return `SHA-256 ${await sha(a)}`;
});
await run('Normalized crop renders the chosen source quadrant', async () => {
  const p = cloneProject(base); p.scenes[0].frames[0].edits.crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
  const out = await render(p); assert(same(pixel(out, 2, 2), [255, 0, 0, 255]) && same(pixel(out, 61, 45), [255, 0, 0, 255]), 'Crop did not fill the output with the red source quadrant.');
});
await run('Horizontal and vertical flips map the original quadrants correctly', async () => {
  const p = cloneProject(base); p.scenes[0].frames[0].edits.flipX = true; assert(same(pixel(await render(p), 8, 8), [0, 255, 0, 255]), 'Horizontal flip is wrong.');
  p.scenes[0].frames[0].edits.flipY = true; assert(same(pixel(await render(p), 8, 8), [255, 255, 0, 255]), 'Combined flips are wrong.');
});
await run('90-degree rotation fits the full rotated image and maintains orientation', async () => {
  const p = cloneProject(base); p.scenes[0].frames[0].edits.rotation = 90; const out = await render(p);
  assert(same(pixel(out, 20, 10), [0, 0, 255, 255]), 'Rotated bottom-left quadrant did not become top-left.');
  assert(same(pixel(out, 44, 10), [255, 0, 0, 255]), 'Rotated top-left quadrant did not become top-right.');
  assert(same(pixel(out, 2, 10), [16, 19, 29, 255]), 'Rotation should fit without clipping, retaining background at the sides.');
});
await run('Chroma key composites onto the chosen background without removing the foreground', async () => {
  const p = cloneProject(base); p.settings.background = '#112233'; p.scenes[0].frames[0].edits.keyColor = '#00ff00'; p.scenes[0].frames[0].edits.keyTolerance = 0.01;
  const out = await render(p); assert(same(pixel(out, 48, 12), [17, 34, 51, 255]), 'Keyed green area is not transparent onto background.'); assert(same(pixel(out, 8, 8), [255, 0, 0, 255]), 'Key removed red foreground.');
});
const dot = (id: string, size: number, color: string, erase = false): PaintStroke => ({ id, points: [{ x: 0.5, y: 0.5 }], size, color, erase });
await run('Clean-plate restoration and mask eraser remain separate non-destructive operations', async () => {
  const p = addFrames(createProject('Mask', { width: 64, height: 48 }), [asset(imageCanvas(64, 48, '#ff0000'), 'red')]); p.assets.push(asset(imageCanvas(64, 48, '#0000ff'), 'plate')); p.scenes[0].cleanPlateAssetId = 'plate';
  p.scenes[0].frames[0].edits.maskStrokes = [dot('restore', 24, '#ffffff')]; assert(same(pixel(await render(p), 32, 24), [0, 0, 255, 255]), 'Cleanup did not restore blue clean plate.');
  p.scenes[0].frames[0].edits.maskStrokes.push(dot('erase-mask', 8, '#ffffff', true)); const out = await render(p);
  assert(same(pixel(out, 32, 24), [255, 0, 0, 255]), 'Mask eraser did not restore original foreground.'); assert(same(pixel(out, 39, 24), [0, 0, 255, 255]), 'Mask eraser removed unrelated restored background.');
});
await run('Drawing eraser clears artwork without erasing the captured source', async () => {
  const p = addFrames(createProject('Drawing', { width: 64, height: 48 }), [asset(imageCanvas(64, 48, '#ff0000'), 'red')]);
  p.scenes[0].frames[0].edits.drawings = [dot('paint', 16, '#00ff00'), dot('erase-paint', 8, '#ffffff', true)]; const out = await render(p);
  assert(same(pixel(out, 32, 24), [255, 0, 0, 255]), 'Drawing eraser erased captured pixels.'); assert(same(pixel(out, 37, 24), [0, 255, 0, 255]), 'Drawing color/size did not render.');
});
await run('Titles are rendered when enabled and absent from title-free reference renders', async () => {
  const p = cloneProject(base); p.settings.title = 'HI'; p.settings.titleSize = 16; const out = await render(p); const reference = await renderFrame(p, p.scenes[0].frames[0], { includeTitle: false });
  assert(!same(pixels(out), pixels(reference)), 'Title made no visible difference.'); assert(same(pixels(source), pixels(reference)), 'Title-free render did not preserve source.');
});
await run('Difference, split and blink comparison use actual rendered pixels', async () => {
  const red = imageCanvas(64, 48, '#ff0000'), blue = imageCanvas(64, 48, '#0000ff'), target = imageCanvas(), ctx = target.getContext('2d')!;
  drawComparison(ctx, red, red, { mode: 'difference' }); assert(same(pixel(target, 10, 10), [0, 0, 0, 255]), 'Identical-frame difference is not black.');
  drawComparison(ctx, red, blue, { mode: 'split', split: 0.5 }); assert(same(pixel(target, 10, 10), [0, 0, 255, 255]) && same(pixel(target, 50, 10), [255, 0, 0, 255]), 'Split view sides are wrong.');
  drawComparison(ctx, red, blue, { mode: 'blink', time: 0.75 }); assert(same(pixel(target, 10, 10), [0, 0, 255, 255]), 'Blink comparison failed to switch.');
});
await run('Preview guides do not contaminate later PNG output or originals', async () => {
  const frame = base.scenes[0].frames[0], before = await renderFramePNG(base, frame), preview = await render(); drawGuides(preview.getContext('2d')!, { grid: 'thirds', aspect: '2.39:1' });
  assert(!same(pixels(preview), pixels(source)), 'Guide overlay was not visible.'); const after = await renderFramePNG(base, frame); assert(same(before, after), 'Preview guides changed saved image output.');
});
await run('24 original procedural demo PNGs animate, decode and repeat deterministically', async () => {
  const frames = await generateDemoFrames(24); assert(frames.length === 24, 'Demo frame count differs.'); const hashes = await Promise.all(frames.map(frame => sha(frame.png))); assert(new Set(hashes).size === 24, 'Demo frames are not all unique.');
  assert(same(frames[5].png, await createDemoFrame(5)), 'Demo redraw changed pixels/PNG bytes.');
  const first = await decodedPNG(frames[0].png), last = await decodedPNG(frames[23].png); assert(first.naturalWidth === 1280 && first.naturalHeight === 720 && last.naturalWidth === 1280, 'Demo dimensions differ.');
  const preview = document.createElement('canvas'); preview.width = 1280; preview.height = 720; preview.getContext('2d')!.drawImage(first, 0, 0); document.getElementById('preview')!.append(preview);
  return `24 × 1280×720, all unique; frame 1 SHA-256 ${hashes[0]}`;
});
await run('Actual UHD 8K source → rendered PNG → independent decoded RGBA sample hash', async () => {
  const original = imageCanvas(7680, 4320); const expected = await sha(pixels(original));
  const p = addFrames(createProject('8K raster fixture', { width: 7680, height: 4320 }), [asset(original, 'native8k')]); original.width = 1;
  const png = await renderFramePNG(p, p.scenes[0].frames[0]); const decoded = await decodedPNG(png); assert(decoded.naturalWidth === 7680 && decoded.naturalHeight === 4320, 'PNG dimensions are not native 8K.');
  const roundTrip = document.createElement('canvas'); roundTrip.width = 7680; roundTrip.height = 4320; roundTrip.getContext('2d')!.drawImage(decoded, 0, 0); const actual = await sha(pixels(roundTrip)); roundTrip.width = 1;
  assert(actual === expected, 'Independent decoded 8K RGBA hash differs from the original.'); return `7680×4320 · ${png.byteLength.toLocaleString()} PNG bytes · RGBA SHA-256 ${actual}`;
});
status.textContent = `${results.filter(item => item.passed).length}/${results.length} Canvas fixtures passed; ${results.filter(item => !item.passed).length} failed.`;
status.dataset.complete = 'true'; status.dataset.passed = String(results.every(item => item.passed));
