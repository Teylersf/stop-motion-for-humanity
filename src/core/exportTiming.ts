/** GPL-3.0-or-later. Duration-preserving conform using rounded cumulative boundaries. */
import type { AnimationFrame, ExportProfile, StudioProject } from './types.ts';
import { MAX_EXPOSURES, MAX_HOLD, MAX_PIXELS, timeline, type TimelineExposure } from './model.ts';

export const standardRates = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];
export function canonicalFrameRate(fps: number): number {
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error('Output frame rate must be between 1 and 120 fps.');
  return standardRates.find(rate => Math.abs(rate - fps) < 0.0001) ?? fps;
}
export interface RetimedExposure extends TimelineExposure { repeat: number; sourceIndex: number; sourceStartFrame: number; sourceEndFrame: number }
export interface ConformedTimeline {
  entries: RetimedExposure[]; totalFrames: number; sourceFrames: number; sourceFps: number; outputFps: number;
  durationSeconds: number; sourceDurationSeconds: number; droppedFrames: number; notes: string[];
}
export function conformTimeline(project: StudioProject, outputFps: number, sceneId?: string | null, preserveTiming = true): ConformedTimeline {
  const sourceFps = canonicalFrameRate(project.fps), targetFps = canonicalFrameRate(outputFps), source = timeline(project, sceneId);
  const sourceFrames = source.at(-1)?.endFrame ?? 0, ratio = preserveTiming ? targetFps / sourceFps : 1;
  const totalFrames = sourceFrames ? Math.max(1, Math.round(sourceFrames * ratio)) : 0;
  if (totalFrames > MAX_EXPOSURES) throw new Error(`This conform needs ${totalFrames.toLocaleString()} output frames; the limit is ${MAX_EXPOSURES.toLocaleString()}. Export fewer scenes or choose a lower output rate.`);
  const entries: RetimedExposure[] = []; let previousBoundary = 0, droppedFrames = 0;
  source.forEach((entry, sourceIndex) => {
    const boundary = sourceIndex === source.length - 1 ? totalFrames : Math.round(entry.endFrame * ratio);
    let hold = boundary - previousBoundary;
    if (!hold) droppedFrames++;
    // Keep frame IPC bounded without expanding every exposure or exceeding its per-record repeat limit.
    for (let startFrame = previousBoundary; hold > 0;) {
      const repeat = Math.min(MAX_HOLD, hold); entries.push({ frame: entry.frame, scene: entry.scene, sourceIndex,
        sourceStartFrame: entry.startFrame, sourceEndFrame: entry.endFrame, startFrame, endFrame: startFrame + repeat, hold: repeat, repeat });
      hold -= repeat; startFrame += repeat;
    }
    previousBoundary = boundary;
  });
  const notes: string[] = [];
  if (targetFps !== sourceFps) notes.push(preserveTiming ? `Duration-preserving conform: ${sourceFps} to ${targetFps} fps; cumulative rounded exposure boundaries prevent timing drift.` : `Playback-speed change: frame holds are unchanged at ${targetFps} fps.`);
  if (droppedFrames) notes.push(`${droppedFrames} source frame(s) have zero output exposures at this lower output rate.`);
  if (preserveTiming && sourceFrames && Math.round(sourceFrames * ratio) === 0) notes.push('This shot is shorter than one output exposure and is retained as one frame.');
  return { entries, totalFrames, sourceFrames, sourceFps, outputFps: targetFps, durationSeconds: totalFrames / targetFps, sourceDurationSeconds: sourceFrames / sourceFps, droppedFrames, notes };
}
export const buildRetimedTimeline = conformTimeline;

export interface SourceSummary {
  minimumWidth: number; minimumHeight: number; maximumBitDepth: number | null; hasHigherBitDepth: boolean; hasUnknownBitDepth: boolean;
  cameraLabels: string[]; mixedDimensions: boolean; uniformWidth: number | null; uniformHeight: number | null; frameCount: number;
  largestWidth: number | null; largestHeight: number | null;
}
export function summarizeSources(project: StudioProject, sceneId?: string | null): SourceSummary {
  const frames = timeline(project, sceneId).map(entry => entry.frame); const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const dimensions: [number, number][] = [], depths: number[] = [], cameraLabels = new Set<string>(); let hasUnknownBitDepth = false;
  for (const frame of frames) {
    const asset = assets.get(frame.assetId); if (!asset) continue;
    dimensions.push([asset.width, asset.height]);
    // Native capture and the built-in demo are actual Canvas PNG8 sources; imports need decoder metadata.
    const depth = asset.bitDepth ?? (frame.source.type === 'camera' || frame.source.type === 'demo' ? 8 : undefined);
    if (depth === undefined) hasUnknownBitDepth = true; else depths.push(depth);
    if (frame.source.deviceLabel && frame.source.type === 'camera') cameraLabels.add(frame.source.deviceLabel);
  }
  const first = dimensions[0]; const mixedDimensions = dimensions.some(size => size[0] !== first?.[0] || size[1] !== first?.[1]);
  // Pick a real stored raster, preserving its aspect ratio; do not synthesize max(width)×max(height).
  const largest = dimensions.filter(([width, height]) => Number.isInteger(width) && Number.isInteger(height) && width >= 16 && height >= 16 && width <= 8192 && height <= 8192 && width * height <= MAX_PIXELS)
    .reduce<[number, number] | null>((best, size) => !best || size[0] * size[1] > best[0] * best[1] ? size : best, null);
  return { minimumWidth: dimensions.length ? Math.min(...dimensions.map(size => size[0])) : project.width,
    minimumHeight: dimensions.length ? Math.min(...dimensions.map(size => size[1])) : project.height,
    maximumBitDepth: depths.length ? Math.max(...depths) : null, hasHigherBitDepth: depths.some(depth => depth > 8), hasUnknownBitDepth,
    cameraLabels: [...cameraLabels], mixedDimensions, uniformWidth: first && !mixedDimensions ? first[0] : null, uniformHeight: first && !mixedDimensions ? first[1] : null,
    largestWidth: largest?.[0] ?? null, largestHeight: largest?.[1] ?? null, frameCount: frames.length };
}
export interface ExportRecommendation { profile: ExportProfile; width: number; height: number; fps: number; notes: string[]; source: SourceSummary }
export function recommendExport(project: StudioProject, options: { sceneId?: string | null; profile?: ExportProfile; width?: number; height?: number; fps?: number; preserveTiming?: boolean } = {}): ExportRecommendation {
  const source = summarizeSources(project, options.sceneId); const width = options.width ?? source.largestWidth ?? project.width, height = options.height ?? source.largestHeight ?? project.height;
  const fps = canonicalFrameRate(options.fps ?? project.fps); const profile = options.profile ?? (source.hasHigherBitDepth ? 'originals' : 'ffv1');
  const notes = ['Recommendations do not restrict your choice. Every export profile remains selectable with its stated tradeoffs.'];
  if (source.hasHigherBitDepth) notes.push('High-bit-depth originals were detected. The Originals portable project archive retains their stored bytes, all scenes and original audio; processed effects currently use an RGBA8 Canvas pipeline.');
  if (source.hasUnknownBitDepth) notes.push('Some imported source bit depths are unknown; do not infer precision from the file extension.');
  if (width > source.minimumWidth || height > source.minimumHeight) notes.push(`This output scales at least one source above its stored ${source.minimumWidth}×${source.minimumHeight} raster. Upscaling does not create captured detail.`);
  if (source.mixedDimensions) notes.push('The selection mixes source rasters; the largest-area stored source within rendering limits is the recommended common canvas. Smaller sources may be scaled or letterboxed.');
  if (source.largestWidth && source.largestHeight && (width < source.largestWidth || height < source.largestHeight)) notes.push(`This output downsizes the stored ${source.largestWidth}×${source.largestHeight} source. Choose its native raster to retain captured spatial detail.`);
  if (!source.hasHigherBitDepth && !options.profile) notes.push('FFV1 preserves the processed RGBA8 pixels and float PCM mix without delivery-codec loss.');
  if (Math.abs(fps - project.fps) > 0.0001) notes.push(options.preserveTiming === false ? 'The selected output rate changes playback speed because holds are unchanged.' : 'Output frame holds will be conformed to preserve shot duration.');
  return { profile, width, height, fps, notes, source };
}
