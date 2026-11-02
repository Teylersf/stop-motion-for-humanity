/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Check, CheckCheck, ChevronRight, CircleHelp, Download, Film, FolderOpen, Info, Layers3, LoaderCircle, ShieldCheck, Sparkles, Square } from 'lucide-react';
import records from '../../assets/export-profiles.json';
import type { AppInfo, ExportProfile, ExportProgress, ExportResult, StudioProject } from '../core/types';
import { conformTimeline, recommendExport } from '../core/exportTiming';
import { exportPreflight, precisionExplanation, sameRate, type ExportProfileInfo } from './export-info';

const profiles = records as unknown as ExportProfileInfo[];
const sizes = [[1280, 720, 'HD'], [1920, 1080, 'Full HD'], [3840, 2160, '4K'], [7680, 4320, '8K']] as const;
const fpsOptions = [1, 6, 8, 10, 12, 15, 18, 24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 120];
const rateLabel = (rate: number) => Number.isInteger(rate) ? String(rate) : rate.toFixed(3);
const dimensions = (width: number, height: number) => `${width.toLocaleString()} × ${height.toLocaleString()}`;

interface Props {
  project: StudioProject; sceneId: string; app: AppInfo | null;
  sourceSize?: { width: number; height: number; label: string };
  profileId: ExportProfile; scope: 'scene' | 'project'; width: number; height: number; fps: number;
  preserveTiming: boolean; audio: boolean; busy: boolean;
  verify: boolean; onVerify: (value: boolean) => void;
  progress: ExportProgress | null; result: ExportResult | null; error: string;
  onProfile: (profile: ExportProfile) => void; onScope: (scope: 'scene' | 'project') => void;
  onGeometry: (geometry: { width?: number; height?: number; fps?: number }) => void;
  onPreserveTiming: (value: boolean) => void; onAudio: (value: boolean) => void;
  onExport: () => void; onCancel: () => void; onReveal: (id: string) => void;
}

export default function ExportControls(props: Props) {
  const { project, sceneId, app, profileId, scope, width, height, fps, preserveTiming, audio, busy, progress, result, error } = props;
  const profile = profiles.find(item => item.id === profileId) ?? profiles[0];
  const activeScene = project.scenes.find(scene => scene.id === sceneId)!;
  const exportSceneId = profile.kind === 'originals' ? undefined : scope === 'scene' ? sceneId : undefined;
  const recommendation = recommendExport(project, { sceneId: exportSceneId });
  const selectedFrames = project.scenes.filter(scene => !exportSceneId || scene.id === exportSceneId).flatMap(scene => scene.frames.filter(frame => frame.enabled));
  const sourceIds = new Set(selectedFrames.map(frame => frame.assetId));
  const sourceAssets = project.assets.filter(asset => sourceIds.has(asset.id));
  const sourceSizes = [...new Set(sourceAssets.map(asset => dimensions(asset.width, asset.height)))];
  const knownDepths = [...new Set(sourceAssets.map(asset => asset.bitDepth).filter((depth): depth is number => typeof depth === 'number'))].sort((a, b) => a - b);
  const hasUnknownDepth = sourceAssets.some(asset => asset.bitDepth === undefined);
  const highDepth = sourceAssets.some(asset => (asset.bitDepth ?? 8) > 8);
  const downscales = sourceAssets.some(asset => asset.width > width || asset.height > height);
  const upscales = sourceAssets.some(asset => asset.width < width || asset.height < height);
  const hasCamera = selectedFrames.some(frame => frame.source.type === 'camera');
  const availability = exportPreflight(profile, app, { width, height, fps });
  let timing: ReturnType<typeof conformTimeline> | null = null;
  let timingError = '';
  try { timing = conformTimeline(project, profile.kind === 'originals' ? project.fps : fps, exportSceneId, profile.kind === 'originals' ? true : preserveTiming); }
  catch (cause) { timingError = cause instanceof Error ? cause.message : String(cause); }
  const errors = [...availability.errors, ...(timingError ? [timingError] : []), ...(!selectedFrames.length ? ['Add a few frames to your timeline before exporting.'] : [])];
  const categories = [...new Set(profiles.map(item => item.category))];
  const converted = profile.kind !== 'originals' && (profile.precision.upconverted || profile.precision.representation === 'float32' || (profile.precision.storageBits ?? 8) > 8);
  const canEmbedAudio = profile.kind === 'movie' && !!profile.audioCodec && !['none', 'no', 'n/a'].includes(profile.audioCodec.toLowerCase());
  const audioSidecar = profile.kind === 'sequence';
  if (audioSidecar && audio && project.audio.length > 0 && !app?.mediaAvailable) errors.push('Turn off the soundtrack to export direct PNG frames without the media runtime, or restore the runtime to create mix.wav.');
  const chooseRecommendation = (id: ExportProfile) => { props.onProfile(id); props.onPreserveTiming(true); props.onGeometry({ width: recommendation.width, height: recommendation.height, fps: project.fps }); };
  const conformPresets = profile.conformPresets ?? [
    { width: 1920, height: 1080, fps: 24 }, { width: 1920, height: 1080, fps: 25 }, { width: 1920, height: 1080, fps: 30 },
    { width: 1280, height: 720, fps: 50 }, { width: 1280, height: 720, fps: 60 },
  ].filter(preset => (!profile.requiredRaster?.length || profile.requiredRaster.some(([w, h]) => preset.width === w && preset.height === h)) && (!profile.rates?.length || profile.rates.some(rate => sameRate(rate, preset.fps))));
  const rateOnlyPresets = !profile.requiredRaster?.length && !profile.conformPresets?.length && profile.rates?.length ? profile.rates.map(rate => ({ width, height, fps: rate })) : null;
  const widthMultiple = profile.multiples?.[0] ?? (profile.evenDimensions ? 2 : 1), heightMultiple = profile.multiples?.[1] ?? (profile.evenDimensions ? 2 : 1);
  const compressionLabel: Record<string, string> = { 'rgba-samples': 'Lossless rendered RGBA samples', 'rgb-samples': 'Lossless converted RGB samples', 'codec-target': 'Codec lossless after pixel conversion', 'converted-float': 'Converted floating-point samples', 'original-bytes': 'Untouched original bytes', 'none': 'Lossy compression' };
  const timingChanged = !sameRate(fps, project.fps);

  return <div className="export-controls">
    <div className="export-recommendations" aria-label="Recommended formats">
      <button className={`export-recommendation ${profileId === 'ffv1' ? 'selected' : ''}`} disabled={busy} onClick={() => chooseRecommendation('ffv1')}>
        <ShieldCheck size={18} /><span><strong>Best lossless master</strong><small>FFV1 · RGBA8 rendered pixels</small></span>{recommendation.profile === 'ffv1' && <span className="recommendation-tag">RECOMMENDED</span>}
      </button>
      <button className={`export-recommendation ${profileId === 'mp4' ? 'selected' : ''}`} disabled={busy} onClick={() => chooseRecommendation('mp4')}>
        <Film size={18} /><span><strong>Easiest to share</strong><small>H.264 MP4 · smaller, lossy video</small></span>
      </button>
      <button className={`export-recommendation ${profileId === 'originals' ? 'selected' : ''}`} disabled={busy} onClick={() => chooseRecommendation('originals')}>
        <FolderOpen size={18} /><span><strong>Keep the whole project</strong><small>Originals · portable project archive</small></span>{recommendation.profile === 'originals' && <span className="recommendation-tag">RECOMMENDED</span>}
      </button>
    </div>
    <div className="export-layout"><div className="export-form-column">
      <label className="field-label">Choose a format <span className="format-count">{profiles.length} profiles · availability shown below</span><select disabled={busy} value={profileId} onChange={event => props.onProfile(event.target.value as ExportProfile)}>
        {categories.map(category => <optgroup key={category} label={category}>{profiles.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
      </select></label>
      {profile.kind === 'originals' ? <div className="originals-scope-note"><FolderOpen size={16} /><span>Complete portable project<strong>All {project.scenes.length} scenes · {project.assets.length} original image/audio assets · project + sequence manifests. Each asset is included once.</strong></span></div> : <label className="field-label">What to include<select value={scope} disabled={busy} onChange={event => props.onScope(event.target.value as typeof scope)}><option value="scene">This scene · {activeScene.name}</option><option value="project">All scenes in order</option></select></label>}
      {profile.kind !== 'originals' && <>
        <div className="two-columns"><label className="field-label">Output width<input disabled={busy} type="number" min={16} max={8192} value={width} onChange={event => props.onGeometry({ width: Math.round(Math.max(16, Math.min(8192, Number(event.target.value)))) })} /></label><label className="field-label">Output height<input disabled={busy} type="number" min={16} max={8192} value={height} onChange={event => props.onGeometry({ height: Math.round(Math.max(16, Math.min(8192, Number(event.target.value)))) })} /></label></div>
        <div className="size-presets">{sizes.map(([w, h, label]) => <button className="pill-button" disabled={busy} key={label} onClick={() => props.onGeometry({ width: w, height: h })}>{label}</button>)}</div>
        {props.sourceSize && <button className="button secondary source-size-button" disabled={busy} onClick={() => props.onGeometry({ width: props.sourceSize!.width, height: props.sourceSize!.height })}><Film size={14} />Use {props.sourceSize.label} size · {dimensions(props.sourceSize.width, props.sourceSize.height)}</button>}
        {downscales && <p className="timing-note speed-change">This output downscales one or more selected originals. Captured pixels will be resampled; use a native source size when retaining their detail is your priority.</p>}
        {upscales && <p className="timing-note">One or more originals will be upscaled to this common canvas. A larger output cannot create captured detail.</p>}
        <label className="field-label">Output frame rate<select value={fps} disabled={busy} onChange={event => props.onGeometry({ fps: Number(event.target.value) })}>{[...new Set([...fpsOptions, project.fps])].sort((a, b) => a - b).map(rate => <option key={rate} value={rate}>{rateLabel(rate)} fps{sameRate(rate, project.fps) ? ' · project rate' : ''}</option>)}</select></label>
        <label className="check-field"><input type="checkbox" checked={preserveTiming} disabled={busy} onChange={event => props.onPreserveTiming(event.target.checked)} />Preserve the film’s duration when frame rate changes</label>
        {timingChanged && <p className={`timing-note ${preserveTiming ? '' : 'speed-change'}`}>{preserveTiming ? `Holds are retimed from ${rateLabel(project.fps)} to ${rateLabel(fps)} fps. Frames are repeated or omitted without inventing new motion. Your project is unchanged.` : `Playback speed changes by ${(fps / project.fps).toFixed(3)}×. The original hold counts are kept; duration and audio alignment can change.`}</p>}
        {canEmbedAudio || audioSidecar ? <label className="check-field"><input type="checkbox" checked={audio} disabled={busy} onChange={event => props.onAudio(event.target.checked)} />{audioSidecar ? 'Include soundtrack as a separate mix.wav' : `Include soundtrack · ${profile.audioCodec}`}</label> : <p className="field-help">This format does not embed the soundtrack. Audio stays in your saved project.</p>}
      </>}
      {(!!profile.requiredRaster?.length || !!profile.rates?.length) && <div className="broadcast-conform"><h3><RefreshIcon />One-click broadcast conform</h3><p>Use a legal raster and rate without changing the project. Duration preservation stays on.</p><div>{(rateOnlyPresets ?? conformPresets).map(preset => <button key={`${preset.height}-${preset.fps}`} className="pill-button" disabled={busy} onClick={() => { props.onGeometry(preset); props.onPreserveTiming(true); }}>{rateOnlyPresets ? `${rateLabel(preset.fps)} fps` : `${preset.height}p${rateLabel(preset.fps)}`}</button>)}</div></div>}
      {width % widthMultiple || height % heightMultiple ? <button className="button secondary" disabled={busy} onClick={() => props.onGeometry({ width: Math.min(8192, Math.ceil(width / widthMultiple) * widthMultiple), height: Math.min(8192, Math.ceil(height / heightMultiple) * heightMultiple) })}>{profile.multiples ? 'Align size to codec blocks' : 'Use nearest even dimensions'}</button> : null}
    </div><aside className="export-information" aria-label="Source and format information">
      <section><h3><CameraSourceIcon />What you actually captured</h3><dl><div><dt>Original image sizes</dt><dd>{sourceSizes.slice(0, 3).join(' · ') || 'No captured frames'}{sourceSizes.length > 3 ? ` + ${sourceSizes.length - 3} more` : ''}</dd></div><div><dt>Reported original precision</dt><dd>{knownDepths.length ? `${knownDepths.join(' / ')} bits per channel` : 'Not reported'}{hasUnknownDepth && knownDepths.length ? ' · some unknown' : ''}</dd></div><div><dt>Processed render pipeline</dt><dd>RGBA8 · 8 bits per channel</dd></div></dl>{hasCamera && <p>The camera’s actual delivered dimensions are used above. Webcam captures pass through RGBA8; a requested 4K/8K setting cannot add camera detail.</p>}{highDepth && <p className="precision-warning">Higher-precision originals detected. Use Originals project archive to retain their native files and precision.</p>}<button className="text-button" disabled={busy || profile.kind === 'originals'} onClick={() => props.onGeometry({ width: recommendation.width, height: recommendation.height })}>Match recommended source size<ChevronRight size={12} /></button></section>
      <section><h3><Layers3 size={14} />{profile.label}</h3><p>{profile.description}</p><dl><div><dt>Storage / pixel format</dt><dd>{profile.kind === 'originals' ? 'Untouched original bytes' : `${profile.precision.representation === 'float32' ? '32-bit float' : `${profile.precision.storageBits ?? 8}-bit`} · ${profile.pixelFormat}`}</dd></div><div><dt>Compression</dt><dd>{compressionLabel[profile.losslessKind] ?? profile.losslessKind.replace(/[-_]/g, ' ')}</dd></div><div><dt>Container</dt><dd>{profile.container} · {profile.extension}</dd></div><div><dt>Audio</dt><dd>{profile.kind === 'originals' ? 'Original audio assets copied verbatim' : audioSidecar ? 'Optional float PCM mix.wav sidecar' : canEmbedAudio ? profile.audioCodec : 'Not embedded'}</dd></div></dl></section>
    </aside></div>
    <div className={`precision-disclosure ${converted || highDepth ? 'has-conversion' : ''}`}><Info size={17} /><div><h3>{profile.kind === 'originals' ? 'Original files stay original.' : converted ? 'Higher-bit output is a compatibility conversion.' : 'A clear word about “lossless”.'}</h3>{precisionExplanation(profile, highDepth).map((note, index) => <p key={index}>{note}</p>)}{profile.warnings.filter(note => !note.startsWith('The effects renderer supplies RGBA8 samples.')).map((note, index) => <p key={`profile-${index}`}>{note}</p>)}{availability.warnings.map((note, index) => <p key={`availability-${index}`}>{note}</p>)}</div></div>
    {errors.length > 0 && <div className="export-preflight" role="status"><CircleHelp size={17} /><div><strong>A quick adjustment before export</strong>{errors.map((message, index) => <p key={index}>{message}</p>)}</div></div>}
    <div className="export-summary"><Film size={18} /><span>{profile.kind === 'originals' ? `Complete project · ${project.assets.length} original assets · ${project.fps} fps source timing` : `${timing?.totalFrames.toLocaleString() ?? '—'} output exposures · ${rateLabel(fps)} fps · ${dimensions(width, height)}`}<strong>{profile.kind === 'originals' ? 'All scenes and audio are included. Reopen the archived project to continue editing. Rendered effects are not baked into the original assets.' : `${timing?.sourceDurationSeconds.toFixed(3) ?? '—'}s source → ${timing?.durationSeconds.toFixed(3) ?? '—'}s output · ${preserveTiming ? 'duration preserved to the nearest output exposure' : 'original holds, changed playback speed'}`}</strong></span></div>
    <div className="verification-choice"><label className="check-field"><input type="checkbox" checked={props.verify} disabled={busy} onChange={event => props.onVerify(event.target.checked)} />Verify export (slower)</label><p>{props.verify ? 'Adds an independent decode and full sample/file hash comparisons where supported. This can take significant time for large exports.' : 'Off by default for faster exports. The extra decode and full sample/file hash comparisons are skipped.'}</p></div>
    {timing && timing.droppedFrames > 0 && profile.kind !== 'originals' && <p className="timing-note">{timing.droppedFrames} source images have no exposure at this lower output rate. Choose a higher rate to retain every pose.</p>}
    {busy && <div className="export-progress" role="status"><div><LoaderCircle className="spinning" size={15} /><span>{progress?.message || progress?.phase || 'Preparing your frames…'}</span><strong>{progress ? Math.min(100, Math.round(progress.frames / Math.max(1, progress.totalFrames) * 100)) : 0}%</strong></div><progress max={progress?.totalFrames || 1} value={progress?.frames || 0} /></div>}
    {error && <div className="error-box" role="alert"><strong>Export needs attention</strong><p>{error}</p></div>}
    {result && <div className="export-success"><span>{result.verified ? <CheckCheck size={23} /> : <Check size={23} />}</span><div><strong>{result.verified ? 'Your film is ready. Export verified.' : 'Export ready.'}</strong><p>{result.fileName}</p><button className="text-button" onClick={() => props.onReveal(result.id)}>Show in folder<FolderOpen size={13} /></button>{result.notes.length > 0 && <details><summary>Processing notes ({result.notes.length})</summary>{result.notes.map((note, index) => <p key={index}>{note}</p>)}</details>}</div></div>}
    <div className="export-footer"><span><Check size={13} />Your project and originals stay unchanged.</span>{busy ? <button className="button secondary" onClick={props.onCancel}><Square size={15} />Cancel export</button> : <button className="button primary" onClick={props.onExport} disabled={errors.length > 0}><Download size={16} />{result ? 'Export another copy' : 'Choose location & export'}</button>}</div>
  </div>;
}
function CameraSourceIcon() { return <Film size={14} />; }
function RefreshIcon() { return <Sparkles size={14} />; }
