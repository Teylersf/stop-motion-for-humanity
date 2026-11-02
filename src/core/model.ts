/** GPL-3.0-or-later. Pure, immutable project and exposure-sheet operations. */
import type { AnimationFrame, AssetRecord, CaptureSource, FrameEdits, Scene, StudioProject } from './types.ts';

export const MAX_EXPOSURES = 100_000;
export const MAX_HOLD = 10_000;
export const MAX_PIXELS = 35_651_584;
export function newId(prefix = 'id'): string { return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`; }
export function cloneProject<T>(value: T): T { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T; }
export function defaultFrameEdits(): FrameEdits {
  return { exposure: 0, contrast: 1, saturation: 1, temperature: 0, flipX: false, flipY: false, rotation: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 }, keyColor: null, keyTolerance: 0.15, maskStrokes: [], drawings: [] };
}
export function newScene(name = 'Scene 1'): Scene { return { id: newId('scene'), name, notes: '', frames: [], referenceAssetId: null, cleanPlateAssetId: null }; }
export function createProject(name = 'Untitled animation', options: { width?: number; height?: number; fps?: number } = {}): StudioProject {
  const scene = newScene(); const now = new Date().toISOString();
  return { version: 1, id: newId('project'), name: name.trim() || 'Untitled animation', createdAt: now, updatedAt: now,
    width: options.width ?? 1920, height: options.height ?? 1080, fps: options.fps ?? 12, activeSceneId: scene.id,
    scenes: [scene], assets: [], audio: [], settings: { background: '#10131d', onionOpacity: 0.35, onionCount: 1,
      grid: 'none', aspect: 'project', mirrorPreview: false, captureSound: true, simpleMode: true,
      title: '', titleColor: '#ffffff', titleSize: 64 } };
}
export function newFrame(asset: AssetRecord | string, source: CaptureSource = { type: 'import' }, hold = 1): AnimationFrame {
  return { id: newId('frame'), assetId: typeof asset === 'string' ? asset : asset.id,
    hold: Math.max(1, Math.min(MAX_HOLD, Math.round(Number.isFinite(hold) ? hold : 1))), note: '', cue: '',
    capturedAt: new Date().toISOString(), source: cloneProject(source), edits: defaultFrameEdits(), enabled: true };
}
function touch(project: StudioProject): StudioProject { return { ...project, updatedAt: new Date().toISOString() }; }
export interface AddFramesOptions { sceneId?: string; source?: CaptureSource; insertAt?: number; hold?: number }
export function addFrames(project: StudioProject, assets: AssetRecord[], options: AddFramesOptions = {}): StudioProject {
  const id = options.sceneId ?? project.activeSceneId;
  if (!project.scenes.some(scene => scene.id === id)) throw new Error('The destination scene does not exist.');
  if (assets.some(asset => asset.kind !== 'image')) throw new Error('Only image assets can be added as animation frames.');
  const known = new Set(project.assets.map(asset => asset.id));
  const addedAssets = assets.filter(asset => { if (known.has(asset.id)) return false; known.add(asset.id); return true; });
  const frames = assets.map(asset => newFrame(asset, options.source ?? { type: 'import', width: asset.width, height: asset.height }, options.hold));
  return touch({ ...project, assets: [...project.assets, ...addedAssets], scenes: project.scenes.map(scene => {
    if (scene.id !== id) return scene;
    const position = Math.max(0, Math.min(scene.frames.length, Math.trunc(options.insertAt ?? scene.frames.length)));
    return { ...scene, frames: [...scene.frames.slice(0, position), ...frames, ...scene.frames.slice(position)] };
  }) });
}
export function allFrames(project: StudioProject, sceneId?: string | null): AnimationFrame[] {
  return project.scenes.filter(scene => !sceneId || scene.id === sceneId).flatMap(scene => scene.frames);
}
export interface TimelineExposure { frame: AnimationFrame; scene: Scene; startFrame: number; endFrame: number; hold: number }
/** One entry per enabled source frame. endFrame is exclusive; holds are never expanded in memory. */
export function timeline(project: StudioProject, sceneId?: string | null): TimelineExposure[] {
  let position = 0; const result: TimelineExposure[] = [];
  for (const scene of project.scenes) { if (sceneId && scene.id !== sceneId) continue;
    for (const frame of scene.frames) { if (!frame.enabled) continue;
      const hold = Math.max(1, Math.min(MAX_HOLD, Math.trunc(Number.isFinite(frame.hold) ? frame.hold : 1)));
      if (position + hold > MAX_EXPOSURES) throw new Error(`This sequence exceeds ${MAX_EXPOSURES.toLocaleString()} exposures. Split it into scenes.`);
      result.push({ frame, scene, hold, startFrame: position, endFrame: position + hold }); position += hold;
    }
  }
  return result;
}
export const flattenProject = timeline;
export const flattenFrames = allFrames;
export function totalFrames(project: StudioProject, sceneId?: string | null): number { const list = timeline(project, sceneId); return list.at(-1)?.endFrame ?? 0; }
export function projectDuration(project: StudioProject, sceneId?: string | null): number { return totalFrames(project, sceneId) / project.fps; }
export function frameAtExposure(project: StudioProject, exposure: number, sceneId?: string | null): TimelineExposure | null {
  if (!Number.isFinite(exposure) || exposure < 0) return null;
  const entries = timeline(project, sceneId); let lo = 0, hi = entries.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >>> 1; const entry = entries[mid];
    if (exposure < entry.startFrame) hi = mid - 1; else if (exposure >= entry.endFrame) lo = mid + 1; else return entry;
  } return null;
}
export function frameAtTime(project: StudioProject, seconds: number, sceneId?: string | null): TimelineExposure | null { return frameAtExposure(project, Math.floor(seconds * project.fps), sceneId); }
export function updateFrame(project: StudioProject, frameId: string, patch: Partial<AnimationFrame>): StudioProject {
  return touch({ ...project, scenes: project.scenes.map(scene => ({ ...scene, frames: scene.frames.map(frame => frame.id === frameId ? { ...frame, ...patch, id: frame.id } : frame) })) });
}
export function updateFrameEdits(project: StudioProject, frameId: string, patch: Partial<FrameEdits>): StudioProject {
  const frame = allFrames(project).find(item => item.id === frameId); if (!frame) return project;
  return updateFrame(project, frameId, { edits: { ...frame.edits, ...cloneProject(patch), crop: patch.crop ? { ...patch.crop } : { ...frame.edits.crop } } });
}
export function setFrameHold(project: StudioProject, frameId: string, hold: number): StudioProject {
  if (!Number.isFinite(hold)) throw new Error('A frame hold must be a finite number.');
  return updateFrame(project, frameId, { hold: Math.max(1, Math.min(MAX_HOLD, Math.round(hold))) });
}
export function deleteFrames(project: StudioProject, frameIds: readonly string[]): StudioProject {
  const ids = new Set(frameIds); return touch({ ...project, scenes: project.scenes.map(scene => ({ ...scene, frames: scene.frames.filter(frame => !ids.has(frame.id)) })) });
}
export const removeFrames = deleteFrames;
export function duplicateFrames(project: StudioProject, frameIds: readonly string[], sceneId?: string): StudioProject {
  const ids = new Set(frameIds); return touch({ ...project, scenes: project.scenes.map(scene => {
    if (sceneId && scene.id !== sceneId) return scene;
    return { ...scene, frames: scene.frames.flatMap(frame => ids.has(frame.id) ? [frame, { ...cloneProject(frame), id: newId('frame') }] : [frame]) };
  }) });
}
/** targetIndex is the insertion position after removing the selected frames. Originals/assets are retained. */
export function moveFrames(project: StudioProject, frameIds: readonly string[], targetIndex: number, sceneId = project.activeSceneId): StudioProject {
  const ids = new Set(frameIds); return touch({ ...project, scenes: project.scenes.map(scene => {
    if (scene.id !== sceneId) return scene;
    const moved = scene.frames.filter(frame => ids.has(frame.id)); const remaining = scene.frames.filter(frame => !ids.has(frame.id));
    const at = Math.max(0, Math.min(remaining.length, Math.trunc(targetIndex)));
    return { ...scene, frames: [...remaining.slice(0, at), ...moved, ...remaining.slice(at)] };
  }) });
}
export function reverseFrames(project: StudioProject, frameIds?: readonly string[], sceneId?: string): StudioProject {
  const ids = frameIds ? new Set(frameIds) : null; return touch({ ...project, scenes: project.scenes.map(scene => {
    if (sceneId && scene.id !== sceneId) return scene;
    const selected = scene.frames.filter(frame => !ids || ids.has(frame.id)).reverse(); let index = 0;
    return { ...scene, frames: scene.frames.map(frame => !ids || ids.has(frame.id) ? selected[index++] : frame) };
  }) });
}
export interface ProjectHistory { past: StudioProject[]; present: StudioProject; future: StudioProject[]; limit: number }
export function createHistory(project: StudioProject, limit = 100): ProjectHistory { return { past: [], present: cloneProject(project), future: [], limit: Math.max(1, Math.min(500, Math.trunc(limit))) }; }
export function commitHistory(history: ProjectHistory, project: StudioProject): ProjectHistory {
  if (history.present === project) return history;
  return { ...history, past: [...history.past, cloneProject(history.present)].slice(-history.limit), present: cloneProject(project), future: [] };
}
export function undoHistory(history: ProjectHistory): ProjectHistory { if (!history.past.length) return history;
  return { ...history, past: history.past.slice(0, -1), present: cloneProject(history.past.at(-1)!), future: [cloneProject(history.present), ...history.future] };
}
export function redoHistory(history: ProjectHistory): ProjectHistory { if (!history.future.length) return history;
  return { ...history, past: [...history.past, cloneProject(history.present)].slice(-history.limit), present: cloneProject(history.future[0]), future: history.future.slice(1) };
}

export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[] }
/** Validate untrusted JSON without allocating an expanded exposure sheet or trusting supplied asset paths. */
export function validateProject(value: unknown): ValidationResult {
  const errors: string[] = []; const warnings: string[] = [];
  const fail = (message: string) => { if (errors.length < 200) errors.push(message); };
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const number = (item: unknown, min: number, max: number, integer = false) => typeof item === 'number' && Number.isFinite(item) && item >= min && item <= max && (!integer || Number.isInteger(item));
  const text = (item: unknown, max = 5000) => typeof item === 'string' && item.length <= max;
  const safeId = (item: unknown) => typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item);
  if (!object(value)) return { valid: false, errors: ['Project must be an object.'], warnings };
  try {
  if (value.version !== 1) fail('Unsupported project version.');
  if (!safeId(value.id)) fail('Project ID is invalid.');
  if (!text(value.name, 200) || !String(value.name).trim()) fail('Project name must be 1–200 characters.');
  if (!number(value.fps, 1, 120)) fail('Frame rate must be between 1 and 120 fps.');
  if (!number(value.width, 16, 8192, true) || !number(value.height, 16, 8192, true) || Number(value.width) * Number(value.height) > MAX_PIXELS) fail('Project raster must be 16–8192 pixels per side and no larger than 35,651,584 pixels.');
  for (const key of ['createdAt', 'updatedAt']) if (!text(value[key], 50) || !Number.isFinite(Date.parse(String(value[key])))) fail(`${key} is not a valid date.`);
  if (!Array.isArray(value.assets) || value.assets.length > 100_000) fail('Asset list is missing or too large.');
  const assets = new Map<string, string>();
  for (const entry of Array.isArray(value.assets) && value.assets.length <= 100_000 ? value.assets : []) {
    if (!object(entry)) { fail('Invalid asset record.'); continue; }
    if (!safeId(entry.id) || assets.has(String(entry.id))) fail('Asset IDs must be valid and unique.');
    assets.set(String(entry.id), String(entry.kind));
    if (!['image', 'audio'].includes(String(entry.kind))) fail(`Asset ${entry.id}: unsupported kind.`);
    if (!text(entry.url, 10000) || !/^(humanity:\/\/|blob:|data:image\/)/.test(String(entry.url))) fail(`Asset ${entry.id}: use a trusted local asset URL.`);
    if (!text(entry.originalName, 1024) || !text(entry.fileName, 1024) || !text(entry.mimeType, 100)) fail(`Asset ${entry.id}: invalid name or media type.`);
    if (!number(entry.width, 0, 8192, true) || !number(entry.height, 0, 8192, true) || !number(entry.byteLength, 1, 512 * 1024 * 1024, true)) fail(`Asset ${entry.id}: invalid dimensions or size.`);
    if (!text(entry.fileName, 180) || !/^[-A-Za-z0-9_]+\.[A-Za-z0-9]{1,8}$/.test(String(entry.fileName)) || !text(entry.sha256, 64) || !/^[a-f0-9]{64}$/.test(String(entry.sha256))) fail(`Asset ${entry.id}: unsafe file name or invalid SHA-256.`);
    if (entry.kind === 'image' && (!number(entry.width, 16, 8192, true) || !number(entry.height, 16, 8192, true) || Number(entry.width) * Number(entry.height) > MAX_PIXELS)) fail(`Image ${entry.id}: dimensions exceed the supported raster.`);
  }
  if (!Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 1000) fail('Project needs 1–1000 scenes.');
  const scenes = new Set<string>(), frameIds = new Set<string>(); let exposures = 0, frameCount = 0;
  for (const scene of Array.isArray(value.scenes) && value.scenes.length <= 1000 ? value.scenes : []) {
    if (!object(scene)) { fail('Invalid scene.'); continue; }
    if (!safeId(scene.id) || scenes.has(String(scene.id))) fail('Scene IDs must be valid and unique.'); scenes.add(String(scene.id));
    if (!text(scene.name, 200) || !text(scene.notes)) fail(`Scene ${scene.id}: invalid name or notes.`);
    for (const ref of ['referenceAssetId', 'cleanPlateAssetId']) if (scene[ref] !== null && assets.get(String(scene[ref])) !== 'image') fail(`Scene ${scene.id}: ${ref} must refer to an image.`);
    if (!Array.isArray(scene.frames) || scene.frames.length > 100_000) { fail(`Scene ${scene.id}: frame list is missing or too large.`); continue; }
    frameCount += scene.frames.length;
    for (const frame of scene.frames) {
      if (!object(frame)) { fail('Invalid frame.'); continue; }
      if (!safeId(frame.id) || frameIds.has(String(frame.id))) fail('Frame IDs must be valid and unique.'); frameIds.add(String(frame.id));
      if (assets.get(String(frame.assetId)) !== 'image') fail(`Frame ${frame.id}: source image is missing.`);
      if (!number(frame.hold, 1, MAX_HOLD, true)) fail(`Frame ${frame.id}: hold must be an integer from 1 to ${MAX_HOLD}.`);
      if (typeof frame.enabled !== 'boolean') fail(`Frame ${frame.id}: enabled must be boolean.`);
      if (frame.enabled === true && typeof frame.hold === 'number' && Number.isFinite(frame.hold)) exposures += frame.hold;
      if (!text(frame.note) || !text(frame.cue, 1000)) fail(`Frame ${frame.id}: note/cue is too long.`);
      if (!object(frame.source) || !['camera', 'import', 'demo', 'watch-folder'].includes(String(frame.source.type))) fail(`Frame ${frame.id}: source metadata is invalid.`);
      if (!object(frame.edits)) { fail(`Frame ${frame.id}: edits are missing.`); continue; }
      const edits = frame.edits;
      for (const [key, min, max] of [['exposure', -10, 10], ['contrast', 0, 5], ['saturation', 0, 5], ['temperature', -1, 1], ['rotation', -36000, 36000], ['keyTolerance', 0, 1]] as const) if (!number(edits[key], min, max)) fail(`Frame ${frame.id}: ${key} is outside its supported range.`);
      if (typeof edits.flipX !== 'boolean' || typeof edits.flipY !== 'boolean') fail(`Frame ${frame.id}: flips must be boolean.`);
      if (edits.keyColor !== null && (typeof edits.keyColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(edits.keyColor))) fail(`Frame ${frame.id}: key color must be a hex color.`);
      const crop = edits.crop;
      if (!object(crop) || !number(crop.x, 0, 1) || !number(crop.y, 0, 1) || !number(crop.width, 0.00001, 1) || !number(crop.height, 0.00001, 1) || Number(crop.x) + Number(crop.width) > 1.000001 || Number(crop.y) + Number(crop.height) > 1.000001) fail(`Frame ${frame.id}: crop must be within the source image.`);
      for (const key of ['maskStrokes', 'drawings']) {
        const strokes = edits[key]; if (!Array.isArray(strokes) || strokes.length > 10_000) { fail(`Frame ${frame.id}: invalid ${key}.`); continue; }
        for (const stroke of strokes) {
          if (!object(stroke) || !safeId(stroke.id) || !number(stroke.size, 0.1, 16384) || !text(stroke.color, 50) || typeof stroke.erase !== 'boolean' || !Array.isArray(stroke.points) || stroke.points.length > 10_000 || stroke.points.some(point => !object(point) || !number(point.x, 0, 1) || !number(point.y, 0, 1))) fail(`Frame ${frame.id}: invalid paint stroke.`);
        }
      }
    }
  }
  if (!scenes.has(String(value.activeSceneId))) fail('Active scene is missing.');
  if (frameCount > 100_000 || exposures > MAX_EXPOSURES) fail(`Project exceeds the limit of 100,000 frames or ${MAX_EXPOSURES} exposures.`);
  if (!Array.isArray(value.audio) || value.audio.length > 256) fail('Invalid audio clip list.');
  const audioIds = new Set<string>();
  for (const clip of Array.isArray(value.audio) && value.audio.length <= 256 ? value.audio : []) {
    if (!object(clip)) { fail('Invalid audio clip.'); continue; }
    if (!safeId(clip.id) || audioIds.has(String(clip.id))) fail('Audio clip IDs must be unique.'); audioIds.add(String(clip.id));
    if (assets.get(String(clip.assetId)) !== 'audio') fail(`Audio ${clip.id}: asset is missing.`);
    if (!number(clip.startFrame, 0, MAX_EXPOSURES, true) || !number(clip.inSeconds, 0, 86400) || (clip.outSeconds !== null && (!number(clip.outSeconds, 0, 86400) || Number(clip.outSeconds) <= Number(clip.inSeconds))) || !number(clip.gain, 0, 16) || !number(clip.fadeInSeconds, 0, 86400) || !number(clip.fadeOutSeconds, 0, 86400) || typeof clip.muted !== 'boolean') fail(`Audio ${clip.id}: invalid timing, gain or fades.`);
  }
  if (!object(value.settings)) fail('Project settings are missing.');
  else { const s = value.settings;
    if (!text(s.background, 50) || !text(s.title, 1000) || !text(s.titleColor, 50) || !number(s.titleSize, 1, 4096)) fail('Invalid title or background settings.');
    if (!number(s.onionOpacity, 0, 1) || !number(s.onionCount, 0, 5, true) || !['none', 'thirds', 'square', 'crosshair'].includes(String(s.grid)) || !['project', '16:9', '4:3', '1:1', '2.39:1'].includes(String(s.aspect))) fail('Invalid onion skin or guide settings.');
    for (const key of ['mirrorPreview', 'captureSound', 'simpleMode']) if (typeof s[key] !== 'boolean') fail(`${key} must be boolean.`);
  }
  if (!frameCount) warnings.push('The project has no frames yet.');
  if (frameCount && !exposures) warnings.push('All frames are disabled; enable at least one before exporting.');
  } catch { fail('Project contains invalid structured fields. Reopen a previous good save or correct the project JSON.'); }
  return { valid: !errors.length, errors, warnings };
}
