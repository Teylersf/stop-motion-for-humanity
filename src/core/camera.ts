/** GPL-3.0-or-later. Explicit, capability-aware OS video-device capture. */
import type { CaptureSource } from './types.ts';

export type CameraStatus = 'disconnected' | 'connecting' | 'ready' | 'capturing' | 'error';
export interface CameraState {
  status: CameraStatus; error: string | null; deviceId: string | null; deviceLabel: string;
  settings: MediaTrackSettings; capabilities: Record<string, unknown>;
}
export interface CameraConnectOptions { width?: number; height?: number; frameRate?: number; timeoutMs?: number }
export interface CameraCapture { png: Uint8Array; source: CaptureSource }
export interface CameraDependencies { mediaDevices?: MediaDevices; createCanvas?: () => HTMLCanvasElement; timeoutMs?: number }
export class CameraError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'CameraError'; this.code = code; }
}
export function describeCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return new CameraError('PERMISSION_DENIED', 'Camera access was denied. Allow camera access for this app in your system privacy settings, then click Connect again.');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new CameraError('NO_CAMERA', 'No OS video camera was found. Connect a webcam or compatible capture device and retry. A USB DSLR may need its vendor/virtual-webcam software; use image import or a watch folder for still-image tethering.');
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return new CameraError('CAMERA_BUSY', 'The camera could not start. Close other camera apps, check its cable and power, then reconnect and retry.');
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return new CameraError('UNSUPPORTED_SETTINGS', 'This camera cannot supply the requested settings. Select the correct device or try a lower resolution/frame rate, then connect again.');
  if (name === 'SecurityError') return new CameraError('SECURITY', 'Camera access is blocked in this context. Open the installed application or its local secure development address, then allow camera access.');
  return new CameraError('CAMERA_ERROR', error instanceof Error ? `Camera error: ${error.message}. Reconnect the device and retry.` : 'The camera operation failed. Reconnect the device and retry.');
}
const disconnectedState = (): CameraState => ({ status: 'disconnected', error: null, deviceId: null, deviceLabel: '', settings: {}, capabilities: {} });
function stopStream(stream: MediaStream | null): void { for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop(); } }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
/** Validate constraints against actual advertised capabilities; never pretend a lock was applied. */
export function supportedCameraSettings(patch: Record<string, string | number | boolean>, capabilities: Record<string, unknown>): Record<string, string | number | boolean> {
  const accepted: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(patch)) {
    const capability = capabilities[key];
    if (capability === undefined) throw new CameraError('UNSUPPORTED_CONTROL', `This camera does not expose ${key}. Use the camera's own manual controls if available.`);
    if (Array.isArray(capability)) {
      if (!capability.includes(value)) throw new CameraError('UNSUPPORTED_CONTROL', `${key} does not support ${String(value)} on this camera.`);
    } else if (capability && typeof capability === 'object' && 'min' in capability && 'max' in capability) {
      const range = capability as { min: number; max: number; step?: number };
      if (!finite(value) || value < range.min || value > range.max) throw new CameraError('UNSUPPORTED_CONTROL', `${key} must be between ${range.min} and ${range.max} for this camera.`);
      if (finite(range.step) && range.step > 0) {
        const steps = (value - range.min) / range.step;
        if (Math.abs(steps - Math.round(steps)) > 0.001) throw new CameraError('UNSUPPORTED_CONTROL', `${key} uses steps of ${range.step}, starting at ${range.min}.`);
      }
    } else if (typeof capability === 'boolean') {
      if (typeof value !== 'boolean' || (value && !capability)) throw new CameraError('UNSUPPORTED_CONTROL', `${key} is not available on this camera.`);
    } else throw new CameraError('UNSUPPORTED_CONTROL', `${key} cannot be set by this camera driver.`);
    accepted[key] = value;
  }
  return accepted;
}

function nextVideoFrame(video: HTMLVideoElement, valid: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>; let callbackId: number | undefined; let rafId: number | undefined; let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer);
      video.removeEventListener('error', failed); video.removeEventListener('emptied', failed);
      if (callbackId !== undefined && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(callbackId);
      if (rafId !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      if (error) reject(error); else resolve();
    };
    const failed = () => finish(new CameraError('VIDEO_STALLED', 'The camera stopped delivering video. Check its USB connection and power, close other camera apps, then reconnect. No frame was saved.'));
    timer = setTimeout(() => finish(new CameraError('VIDEO_STALLED', 'No fresh camera frame arrived within five seconds. Check the camera connection, keep the app visible and reconnect. No stale frame was saved.')), timeoutMs);
    video.addEventListener('error', failed, { once: true }); video.addEventListener('emptied', failed, { once: true });
    const ready = () => { if (!valid()) return finish(new CameraError('CAMERA_CHANGED', 'The camera changed before capture completed. Connect the intended camera and try again.'));
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
      else wait();
    };
    const initialTime = video.currentTime;
    const wait = () => {
      if (settled) return;
      if (typeof video.requestVideoFrameCallback === 'function') callbackId = video.requestVideoFrameCallback(ready);
      else if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(() => { if (video.currentTime !== initialTime) ready(); else wait(); });
      else finish(new CameraError('NO_VIDEO_CALLBACK', 'This browser cannot confirm fresh camera frames. Use the installed application.'));
    };
    wait();
  });
}
export function canvasPNG(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new Error('The browser could not encode this image. Try a smaller resolution.')); return; }
    blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
  }, 'image/png'));
}

export class CameraController {
  private video: HTMLVideoElement | undefined;
  private onState: ((state: CameraState) => void) | undefined;
  private dependencies: CameraDependencies;
  private currentStream: MediaStream | null = null;
  private currentState: CameraState = disconnectedState();
  private generation = 0;
  private enumerateGeneration = 0;
  private lastDevices: MediaDeviceInfo[] = [];
  private captureQueue: Promise<unknown> = Promise.resolve();
  private operationQueue: Promise<unknown> = Promise.resolve();
  constructor(video?: HTMLVideoElement, onState?: (state: CameraState) => void, dependencies: CameraDependencies = {}) {
    this.video = video; this.onState = onState; this.dependencies = dependencies;
    if (video) { video.muted = true; video.playsInline = true; video.autoplay = true; }
  }
  get state(): CameraState { return { ...this.currentState, settings: { ...this.currentState.settings }, capabilities: { ...this.currentState.capabilities } }; }
  get settings(): MediaTrackSettings { return { ...this.currentState.settings }; }
  get capabilities(): Record<string, unknown> { return { ...this.currentState.capabilities }; }
  get stream(): MediaStream | null { return this.currentStream; }
  get busy(): boolean { return this.currentState.status === 'connecting' || this.currentState.status === 'capturing'; }
  getSettings(): MediaTrackSettings { return this.settings; }
  getCapabilities(): Record<string, unknown> { return this.capabilities; }
  private mediaDevices(): MediaDevices {
    const devices = this.dependencies.mediaDevices ?? globalThis.navigator?.mediaDevices;
    if (!devices?.getUserMedia) throw new CameraError('CAMERA_UNAVAILABLE', 'Camera access is unavailable. Use the installed app and allow camera access in system privacy settings.');
    return devices;
  }
  private emit(patch: Partial<CameraState>): void { this.currentState = { ...this.currentState, ...patch }; this.onState?.(this.state); }
  attachVideo(video: HTMLVideoElement): void { this.video = video; video.muted = true; video.autoplay = true; video.playsInline = true; video.srcObject = this.currentStream; }
  async enumerate(): Promise<MediaDeviceInfo[]> {
    const generation = ++this.enumerateGeneration;
    const devices = (await this.mediaDevices().enumerateDevices()).filter(device => device.kind === 'videoinput');
    if (generation === this.enumerateGeneration) this.lastDevices = devices;
    return [...this.lastDevices];
  }
  listCameras(): Promise<MediaDeviceInfo[]> { return this.enumerate(); }
  async connect(deviceId?: string, options: CameraConnectOptions = {}): Promise<CameraState> {
    const generation = ++this.generation; stopStream(this.currentStream); this.currentStream = null;
    if (this.video) this.video.srcObject = null;
    this.emit({ ...disconnectedState(), status: 'connecting', deviceId: deviceId ?? null });
    let timer: ReturnType<typeof setTimeout> | undefined; let expired = false;
    try {
      const media = this.mediaDevices();
      const pending = media.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: options.width ?? 3840 }, height: { ideal: options.height ?? 2160 }, frameRate: { ideal: options.frameRate ?? 30 } } });
      pending.then(stream => { if (expired || generation !== this.generation) stopStream(stream); }, () => {});
      const stream = await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new CameraError('CONNECT_TIMEOUT', 'The camera did not start in time. Check the permission prompt, close competing camera apps and reconnect.')); }, options.timeoutMs ?? this.dependencies.timeoutMs ?? 20000); })]);
      if (generation !== this.generation) { stopStream(stream); throw new CameraError('CAMERA_CHANGED', 'A newer camera connection replaced this request.'); }
      const track = stream.getVideoTracks()[0]; if (!track) { stopStream(stream); throw new CameraError('NO_VIDEO_TRACK', 'The selected device did not provide a video track. Choose another camera.'); }
      this.currentStream = stream;
      if (!this.video) this.video = globalThis.document?.createElement('video');
      if (!this.video) throw new CameraError('NO_VIDEO_ELEMENT', 'No camera preview surface is available. Reopen the capture workspace.');
      this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true; this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) throw new CameraError('CAMERA_CHANGED', 'The camera changed while its preview was starting.');
      const settings = track.getSettings();
      this.emit({ status: 'ready', error: null, deviceId: settings.deviceId ?? deviceId ?? null, deviceLabel: track.label || 'Connected camera', settings,
        capabilities: typeof track.getCapabilities === 'function' ? track.getCapabilities() as unknown as Record<string, unknown> : {} });
      track.onended = () => { if (generation !== this.generation) return;
        this.generation++; stopStream(stream); this.currentStream = null; if (this.video) this.video.srcObject = null;
        this.emit({ status: 'error', error: 'The camera was disconnected or stopped by the system. Check its USB cable and power, then click Connect again.' });
      };
      return this.state;
    } catch (error) {
      if (generation === this.generation) { stopStream(this.currentStream); this.currentStream = null; if (this.video) this.video.srcObject = null;
        this.emit({ status: 'error', error: describeCameraError(error).message }); }
      throw describeCameraError(error);
    } finally { if (timer) clearTimeout(timer); }
  }
  disconnect(): void { ++this.generation; ++this.enumerateGeneration; stopStream(this.currentStream); this.currentStream = null;
    if (this.video) this.video.srcObject = null; this.emit(disconnectedState());
  }
  async applySettings(patch: Record<string, string | number | boolean>): Promise<CameraState> {
    const generation = this.generation;
    const run = async () => {
      const track = this.currentStream?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended' || generation !== this.generation) throw new CameraError('NOT_CONNECTED', 'Connect a camera before changing its controls.');
      const accepted = supportedCameraSettings(patch, this.currentState.capabilities);
      try { await track.applyConstraints({ advanced: [accepted as MediaTrackConstraintSet] }); }
      catch (error) { throw describeCameraError(error); }
      if (generation !== this.generation) throw new CameraError('CAMERA_CHANGED', 'The camera changed while settings were being applied.');
      const settings = track.getSettings(); this.emit({ settings, error: null });
      for (const [key, wanted] of Object.entries(accepted)) {
        const actual = (settings as Record<string, unknown>)[key];
        const equal = typeof wanted === 'number' && typeof actual === 'number' ? Math.abs(actual - wanted) <= Math.max(0.0001, Math.abs(wanted) * 0.001) : actual === wanted;
        if (!equal) throw new CameraError('CONTROL_NOT_APPLIED', actual === undefined ? `The driver does not report the actual ${key}, so this change cannot be verified. Use the camera's own controls if needed.` : `The camera kept ${key} at ${String(actual)} instead of ${String(wanted)}. Its driver did not apply the requested change; the displayed value is the actual setting.`);
      }
      return this.state;
    };
    const result = this.operationQueue.then(run, run); this.operationQueue = result.catch(() => {}); return result;
  }
  async lockSettings(): Promise<{ state: CameraState; unavailable: string[] }> {
    const patch: Record<string, string> = {}, unavailable: string[] = [];
    for (const name of ['exposureMode', 'focusMode', 'whiteBalanceMode']) {
      const capability = this.currentState.capabilities[name];
      if (Array.isArray(capability) && capability.includes('manual')) patch[name] = 'manual'; else unavailable.push(name);
    }
    return { state: Object.keys(patch).length ? await this.applySettings(patch) : this.state, unavailable };
  }
  capture(): Promise<CameraCapture> {
    const generation = this.generation;
    const run = async (): Promise<CameraCapture> => {
      const stream = this.currentStream; const track = stream?.getVideoTracks()[0]; const video = this.video;
      const valid = () => generation === this.generation && this.currentStream === stream && !!track && track.readyState !== 'ended';
      if (!video || !stream || !valid()) throw new CameraError('NOT_CONNECTED', 'Connect a camera and wait for its live preview before capturing.');
      this.emit({ status: 'capturing', error: null });
      try {
        await this.operationQueue;
        await nextVideoFrame(video, valid, this.dependencies.timeoutMs ?? 5000);
        if (!valid()) throw new CameraError('CAMERA_CHANGED', 'The camera changed before capture. No frame was saved.');
        const width = video.videoWidth, height = video.videoHeight;
        if (width < 16 || height < 16 || width > 8192 || height > 8192 || width * height > 35_651_584) throw new CameraError('INVALID_RASTER', 'The camera supplied invalid or excessively large image dimensions. Reconnect at a supported resolution.');
        const canvas = this.dependencies.createCanvas?.() ?? document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false }); if (!context) throw new CameraError('CANVAS_UNAVAILABLE', 'A capture image could not be allocated. Close unused apps or choose a smaller camera resolution.');
        context.drawImage(video, 0, 0, width, height);
        const png = await canvasPNG(canvas); canvas.width = 1; canvas.height = 1;
        if (!valid()) throw new CameraError('CAMERA_CHANGED', 'The camera changed before its image was saved. Capture again on the selected device.');
        const settings = track!.getSettings(); const metadata: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(settings)) if (typeof value === 'string' || typeof value === 'boolean' || finite(value)) metadata[key] = value;
        this.emit({ status: 'ready', settings });
        return { png, source: { type: 'camera', deviceLabel: track!.label || 'Connected camera', width, height, settings: metadata } };
      } catch (error) {
        if (generation === this.generation) this.emit({ status: 'error', error: describeCameraError(error).message });
        throw describeCameraError(error);
      }
    };
    const result = this.captureQueue.then(run, run); this.captureQueue = result.catch(() => {}); return result;
  }
  async capturePNG(): Promise<Uint8Array> { return (await this.capture()).png; }
}
