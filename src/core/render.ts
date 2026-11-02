/** GPL-3.0-or-later. Original-image rendering; guides and onion skins are preview-only. */
import type { AnimationFrame, AssetRecord, FrameEdits, PaintStroke, ProjectSettings, Scene, StudioProject } from './types.ts';
import { MAX_PIXELS } from './model.ts';
import { canvasPNG } from './camera.ts';

export interface RenderOptions { width?: number; height?: number; scene?: Scene; includeTitle?: boolean; signal?: AbortSignal }
export type ComparisonMode = 'none' | 'onion' | 'difference' | 'split' | 'blink';
export interface ComparisonOptions { mode?: ComparisonMode; opacity?: number; split?: number; time?: number }
const imageCache = new Map<string, { promise: Promise<HTMLImageElement>; pixels: number }>();
export function clearImageCache(): void { imageCache.clear(); }
export function assertLocalAssetURL(url: string): void {
  if (!/^(humanity:\/\/|blob:|data:image\/)/.test(url)) throw new Error('Only trusted local project images can be rendered. Reimport this asset into the project.');
}
export async function loadAssetImage(asset: AssetRecord | string): Promise<HTMLImageElement> {
  const url = typeof asset === 'string' ? asset : asset.url; assertLocalAssetURL(url);
  const existing = imageCache.get(url); if (existing) { imageCache.delete(url); imageCache.set(url, existing); return existing.promise; }
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.decoding = 'async';
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) { imageCache.delete(url); reject(new Error('This image has no readable pixels.')); return; }
      const cached = imageCache.get(url); if (cached) cached.pixels = image.naturalWidth * image.naturalHeight;
      // Count and decoded-pixel budgets bound retained originals, even with 8K onion/reference layers.
      let pixels = [...imageCache.values()].reduce((sum, entry) => sum + entry.pixels, 0);
      while (pixels > MAX_PIXELS * 2 && imageCache.size > 1) {
        const oldest = imageCache.keys().next().value!; const removed = imageCache.get(oldest)!; imageCache.delete(oldest); pixels -= removed.pixels;
      }
      resolve(image);
    };
    image.onerror = () => { imageCache.delete(url); reject(new Error(`The original image could not be loaded${typeof asset === 'string' ? '' : `: ${asset.originalName}`}. Reopen the project or relink/import the original file.`)); };
    image.src = url;
  });
  imageCache.set(url, { promise, pixels: 0 }); while (imageCache.size > 4) imageCache.delete(imageCache.keys().next().value!);
  return promise;
}
export const loadImage = loadAssetImage;
function canvas(width: number, height: number): HTMLCanvasElement {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192 || width * height > MAX_PIXELS) throw new Error('Choose an output raster of 16–8192 pixels per side and at most 35,651,584 pixels (including UHD/DCI 8K).');
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}
function contextFor(target: HTMLCanvasElement, read = false): CanvasRenderingContext2D {
  const result = target.getContext('2d', read ? { willReadFrequently: true } : undefined);
  if (!result) throw new Error('The image renderer could not allocate a canvas. Try a smaller output size or close unused applications.');
  return result;
}
function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Rendering was cancelled.', 'AbortError'); }
const clamp = (number: number, min = 0, max = 1) => Math.max(min, Math.min(max, number));
const srgbToLinear = (number: number) => number <= 0.04045 ? number / 12.92 : ((number + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (number: number) => number <= 0.0031308 ? number * 12.92 : 1.055 * number ** (1 / 2.4) - 0.055;
const linearLUT = Float64Array.from({ length: 256 }, (_, index) => srgbToLinear(index / 255));
export function parseHexColor(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value); if (!match) throw new Error('Choose a six-digit hex color, for example #00ff00.');
  const number = Number.parseInt(match[1], 16); return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}
/** CPU reference color/key transform on unpremultiplied sRGB8 samples; no temporal or random state. */
export function processPixels(data: Uint8ClampedArray, edits: Pick<FrameEdits, 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'keyColor' | 'keyTolerance'>, startPixel = 0, endPixel = data.length / 4): void {
  const exposure = 2 ** clamp(edits.exposure, -10, 10); const contrast = clamp(edits.contrast, 0, 5);
  const saturation = clamp(edits.saturation, 0, 5); const temperature = clamp(edits.temperature, -1, 1);
  const key = edits.keyColor ? parseHexColor(edits.keyColor) : null;
  const unchangedColor = edits.exposure === 0 && edits.contrast === 1 && edits.saturation === 1 && edits.temperature === 0;
  if (!key && unchangedColor) return;
  for (let pixel = startPixel; pixel < endPixel; pixel++) {
    const i = pixel * 4; if (data[i + 3] === 0) continue;
    if (key) {
      const distance = Math.sqrt((data[i] - key[0]) ** 2 + (data[i + 1] - key[1]) ** 2 + (data[i + 2] - key[2]) ** 2) / (255 * Math.sqrt(3));
      const edge = clamp((distance - clamp(edits.keyTolerance, 0, 1)) / 0.05);
      data[i + 3] = Math.round(data[i + 3] * edge * edge * (3 - 2 * edge));
      if (!data[i + 3]) continue;
    }
    if (unchangedColor) continue;
    let r = linearLUT[data[i]] * exposure * (1 + temperature * 0.25);
    let g = linearLUT[data[i + 1]] * exposure;
    let b = linearLUT[data[i + 2]] * exposure * (1 - temperature * 0.25);
    r = (r - 0.18) * contrast + 0.18; g = (g - 0.18) * contrast + 0.18; b = (b - 0.18) * contrast + 0.18;
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    data[i] = Math.round(clamp(linearToSrgb(clamp(luminance + (r - luminance) * saturation))) * 255);
    data[i + 1] = Math.round(clamp(linearToSrgb(clamp(luminance + (g - luminance) * saturation))) * 255);
    data[i + 2] = Math.round(clamp(linearToSrgb(clamp(luminance + (b - luminance) * saturation))) * 255);
  }
}
async function editPixels(target: HTMLCanvasElement, edits: FrameEdits, signal?: AbortSignal, key = true): Promise<void> {
  const applied = key ? edits : { ...edits, keyColor: null };
  if (!applied.keyColor && applied.exposure === 0 && applied.contrast === 1 && applied.saturation === 1 && applied.temperature === 0) return;
  const ctx = contextFor(target, true); const image = ctx.getImageData(0, 0, target.width, target.height);
  const batch = Math.max(target.width, target.width * 128);
  for (let pixel = 0; pixel < image.data.length / 4; pixel += batch) {
    aborted(signal); processPixels(image.data, applied, pixel, Math.min(image.data.length / 4, pixel + batch));
    if (image.data.length > 8_000_000) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  aborted(signal); ctx.putImageData(image, 0, 0);
}
function transformedImage(image: HTMLImageElement, width: number, height: number, edits: FrameEdits): HTMLCanvasElement {
  const target = canvas(width, height); const ctx = contextFor(target);
  const crop = edits.crop; const sx = clamp(crop.x) * image.naturalWidth; const sy = clamp(crop.y) * image.naturalHeight;
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, crop.width * image.naturalWidth));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, crop.height * image.naturalHeight));
  const angle = edits.rotation * Math.PI / 180;
  const boundsWidth = Math.abs(Math.cos(angle)) * sw + Math.abs(Math.sin(angle)) * sh;
  const boundsHeight = Math.abs(Math.sin(angle)) * sw + Math.abs(Math.cos(angle)) * sh;
  const scale = Math.min(width / boundsWidth, height / boundsHeight);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(width / 2, height / 2); ctx.rotate(angle); ctx.scale(edits.flipX ? -scale : scale, edits.flipY ? -scale : scale);
  ctx.drawImage(image, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  return target;
}
/** Strokes use normalized output coordinates, and brush size is measured in project pixels. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly PaintStroke[], width: number, height: number, projectWidth = width, mask = false): void {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = mask ? '#ffffff' : stroke.color; ctx.fillStyle = mask ? '#ffffff' : stroke.color;
    ctx.lineWidth = Math.max(0.1, stroke.size * width / projectWidth);
    ctx.beginPath();
    if (stroke.points.length === 1) { const point = stroke.points[0]; ctx.arc(point.x * width, point.y * height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height); for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * width, point.y * height); ctx.stroke(); }
  } ctx.restore();
}
export async function renderFrame(project: StudioProject, frame: AnimationFrame, options: RenderOptions = {}): Promise<HTMLCanvasElement> {
  const width = options.width ?? project.width, height = options.height ?? project.height; aborted(options.signal);
  const asset = project.assets.find(item => item.id === frame.assetId && item.kind === 'image');
  if (!asset) throw new Error(`Frame ${frame.id} has no source image. Reimport or relink its original.`);
  const source = await loadAssetImage(asset); aborted(options.signal);
  const scene = options.scene ?? project.scenes.find(item => item.frames.some(candidate => candidate.id === frame.id));
  const image = transformedImage(source, width, height, frame.edits);
  await editPixels(image, frame.edits, options.signal);
  if (frame.edits.maskStrokes.some(stroke => !stroke.erase)) {
    const plateAsset = project.assets.find(item => item.id === scene?.cleanPlateAssetId && item.kind === 'image');
    if (!plateAsset) throw new Error('This frame has cleanup strokes but no clean plate. Assign an empty-set image to this scene, or remove the cleanup strokes.');
    const plate = transformedImage(await loadAssetImage(plateAsset), width, height, frame.edits); aborted(options.signal);
    await editPixels(plate, frame.edits, options.signal, false);
    const mask = canvas(width, height); drawStrokes(contextFor(mask), frame.edits.maskStrokes, width, height, project.width, true);
    const plateCtx = contextFor(plate); plateCtx.globalCompositeOperation = 'destination-in'; plateCtx.drawImage(mask, 0, 0);
    contextFor(image).drawImage(plate, 0, 0); plate.width = 1; mask.width = 1;
  }
  const target = canvas(width, height); const ctx = contextFor(target);
  ctx.fillStyle = project.settings.background; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0); image.width = 1;
  if (frame.edits.drawings.length) {
    const drawing = canvas(width, height); drawStrokes(contextFor(drawing), frame.edits.drawings, width, height, project.width); ctx.drawImage(drawing, 0, 0); drawing.width = 1;
  }
  if (options.includeTitle !== false && project.settings.title.trim()) {
    const size = Math.max(8, project.settings.titleSize * width / project.width);
    ctx.save(); ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = project.settings.titleColor; ctx.shadowColor = '#000000'; ctx.shadowBlur = size * 0.15; ctx.shadowOffsetY = size * 0.03;
    const lines = project.settings.title.split('\n').slice(0, 8);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], width / 2, height - height * 0.06 - (lines.length - 1 - i) * size * 1.2, width * 0.9);
    ctx.restore();
  }
  aborted(options.signal); return target;
}
export async function renderFramePNG(project: StudioProject, frame: AnimationFrame, options: RenderOptions = {}): Promise<Uint8Array> {
  const result = await renderFrame(project, frame, options); try { return await canvasPNG(result); } finally { result.width = 1; result.height = 1; }
}
export const renderFrameToPNG = renderFramePNG;

export function drawComparison(ctx: CanvasRenderingContext2D, current: CanvasImageSource, reference?: CanvasImageSource | null, options: ComparisonOptions = {}): void {
  const { width, height } = ctx.canvas; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(current, 0, 0, width, height);
  const mode = options.mode ?? 'onion'; if (!reference || mode === 'none') { ctx.restore(); return; }
  if (mode === 'onion') { ctx.globalAlpha = clamp(options.opacity ?? 0.35); ctx.drawImage(reference, 0, 0, width, height); }
  else if (mode === 'difference') { ctx.globalCompositeOperation = 'difference'; ctx.drawImage(reference, 0, 0, width, height); }
  else if (mode === 'split') { const x = width * clamp(options.split ?? 0.5); ctx.beginPath(); ctx.rect(0, 0, x, height); ctx.clip(); ctx.drawImage(reference, 0, 0, width, height); }
  else if (mode === 'blink' && Math.floor((options.time ?? 0) * 2) % 2 === 1) ctx.drawImage(reference, 0, 0, width, height);
  ctx.restore();
}
export function drawGuides(ctx: CanvasRenderingContext2D, settings: Pick<ProjectSettings, 'grid' | 'aspect'>): void {
  const { width, height } = ctx.canvas; ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, width / 1280); ctx.beginPath();
  const vertical = (x: number) => { ctx.moveTo(x, 0); ctx.lineTo(x, height); }; const horizontal = (y: number) => { ctx.moveTo(0, y); ctx.lineTo(width, y); };
  if (settings.grid === 'thirds') { vertical(width / 3); vertical(width * 2 / 3); horizontal(height / 3); horizontal(height * 2 / 3); }
  else if (settings.grid === 'crosshair') { vertical(width / 2); horizontal(height / 2); }
  else if (settings.grid === 'square') { const step = Math.min(width, height) / 6; for (let x = width / 2 % step; x < width; x += step) vertical(x); for (let y = height / 2 % step; y < height; y += step) horizontal(y); }
  ctx.stroke();
  const ratios: Record<string, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '2.39:1': 2.39 };
  const ratio = ratios[settings.aspect];
  if (ratio) { const fitWidth = Math.min(width, height * ratio), fitHeight = fitWidth / ratio;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; const x = (width - fitWidth) / 2, y = (height - fitHeight) / 2;
    ctx.fillRect(0, 0, width, y); ctx.fillRect(0, height - y, width, y); ctx.fillRect(0, y, x, fitHeight); ctx.fillRect(width - x, y, x, fitHeight);
    ctx.strokeRect(x, y, fitWidth, fitHeight);
  } ctx.restore();
}
