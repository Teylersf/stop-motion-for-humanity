/** GPL-3.0-or-later. Stable renderer/native contract for Stop Motion for Humanity. */
export type AssetKind = 'image' | 'audio';
export interface AssetRecord {
  id: string; kind: AssetKind; fileName: string; originalName: string;
  mimeType: string; width: number; height: number; byteLength: number;
  sha256: string; createdAt: string; url: string; duration?: number;
  previewFileName?: string;
  bitDepth?: number;
}
export interface CaptureSource {
  type: 'camera' | 'import' | 'demo' | 'watch-folder';
  deviceLabel?: string; width?: number; height?: number;
  settings?: Record<string, string | number | boolean>;
}
export interface Point { x: number; y: number }
export interface PaintStroke { id: string; points: Point[]; size: number; color: string; erase: boolean }
export interface FrameEdits {
  exposure: number; contrast: number; saturation: number; temperature: number;
  flipX: boolean; flipY: boolean; rotation: number;
  crop: { x: number; y: number; width: number; height: number };
  keyColor: string | null; keyTolerance: number;
  maskStrokes: PaintStroke[]; drawings: PaintStroke[];
}
export interface AnimationFrame {
  id: string; assetId: string; hold: number; note: string; cue: string;
  capturedAt: string; source: CaptureSource; edits: FrameEdits; enabled: boolean;
}
export interface Scene {
  id: string; name: string; notes: string; frames: AnimationFrame[];
  referenceAssetId: string | null; cleanPlateAssetId: string | null;
}
export interface AudioClip {
  id: string; assetId: string; name: string; startFrame: number;
  inSeconds: number; outSeconds: number | null; gain: number; muted: boolean;
  fadeInSeconds: number; fadeOutSeconds: number;
}
export interface ProjectSettings {
  background: string; onionOpacity: number; onionCount: number;
  grid: 'none' | 'thirds' | 'square' | 'crosshair';
  aspect: 'project' | '16:9' | '4:3' | '1:1' | '2.39:1';
  mirrorPreview: boolean; captureSound: boolean; simpleMode: boolean;
  title: string; titleColor: string; titleSize: number;
}
export interface StudioProject {
  version: 1; id: string; name: string; createdAt: string; updatedAt: string;
  fps: number; width: number; height: number; activeSceneId: string;
  scenes: Scene[]; assets: AssetRecord[]; audio: AudioClip[]; settings: ProjectSettings;
}
export interface ProjectEnvelope { project: StudioProject; rootName: string; recovered?: boolean; notes?: string[] }
export interface RecentProject { id: string; name: string; rootName: string; updatedAt: string }
export type ExportProfile = 'mp4' | 'hevc' | 'av1' | 'webm' | 'prores' | 'prores-proxy' | 'prores-lt' | 'prores-422' | 'prores-4444' | 'prores-xq' | 'dnxhr' | 'dnxhr-444' | 'dnxhd' | 'mxf' | 'mxf-mpeg2' | 'cineform' | 'jpeg2000' | 'ffv1' | 'lossless' | 'nvenc-lossless' | 'uncompressed' | 'gif' | 'png-sequence' | 'png16-sequence' | 'tiff-sequence' | 'dpx-sequence' | 'exr-sequence' | 'originals';
export interface ExportOptions {
  profile: ExportProfile; width: number; height: number; fps: number;
  totalFrames: number; sceneId: string | null; audio: boolean;
  preserveTiming?: boolean;
  verify?: boolean;
}
export interface ExportSession { id: string; fileName: string; profile: ExportProfile }
export interface ExportProgress { id: string; phase: string; frames: number; totalFrames: number; message?: string }
export interface ExportResult { id: string; fileName: string; filePath: string; frames: number; width: number; height: number; verified: boolean; notes: string[] }
export interface AppInfo {
  version: string; platform: string; arch: string; mediaAvailable: boolean;
  encoders: string[]; cameraPermission: string; microphonePermission: string;
}
export interface NativeBridge {
  appInfo(): Promise<AppInfo>;
  chooseProject(options: { mode: 'create' | 'open'; name?: string }): Promise<ProjectEnvelope | null>;
  loadRecent(): Promise<RecentProject[]>;
  openRecent(id: string): Promise<ProjectEnvelope>;
  saveProject(project: StudioProject): Promise<{ savedAt: string }>;
  importImages(projectId: string): Promise<AssetRecord[]>;
  importAudio(projectId: string): Promise<AssetRecord | null>;
  addCapture(projectId: string, data: { png: Uint8Array; source: CaptureSource; name?: string }): Promise<AssetRecord>;
  addAudioRecording(projectId: string, data: { bytes: Uint8Array; mimeType: string }): Promise<AssetRecord>;
  exportBegin(project: StudioProject, options: ExportOptions): Promise<ExportSession | null>;
  exportFrame(id: string, data: { png: Uint8Array; repeat: number }): Promise<{ frames: number }>;
  exportFinish(id: string): Promise<ExportResult>;
  exportCancel(id: string): Promise<void>;
  revealExport(id: string): Promise<void>;
  chooseWatchFolder(projectId: string): Promise<{ name: string } | null>;
  stopWatchFolder(projectId: string): Promise<void>;
  revealProject(projectId: string): Promise<void>;
  requestMediaPermission(kind: 'camera' | 'microphone'): Promise<boolean>;
  onExportProgress(callback: (progress: ExportProgress) => void): () => void;
  onImportedFrame(callback: (data: { projectId: string; asset: AssetRecord }) => void): () => void;
  onMenuAction(callback: (action: 'new' | 'open' | 'save' | 'export' | 'help') => void): () => void;
  onBeforeClose(callback: (request: { requestId: string; reason: 'quit' | 'window-close' }) => void): () => void;
  onCloseCancelled(callback: (notice: { requestId: string; error: string }) => void): () => void;
  completeClose(reply: { requestId: string; ok: boolean; error?: string }): Promise<{ accepted: boolean }>;
}
declare global { interface Window { humanity?: NativeBridge } }
