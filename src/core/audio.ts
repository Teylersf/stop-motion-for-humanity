/** GPL-3.0-or-later. Local decoding, exposure-aware audio cues and opt-in recording. */
import type { AssetRecord, AudioClip } from './types.ts';

let sharedContext: AudioContext | undefined;
export function getAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new AudioContext();
  return sharedContext;
}
export async function decodeAudio(asset: AssetRecord | string, context = getAudioContext()): Promise<AudioBuffer> {
  const url = typeof asset === 'string' ? asset : asset.url;
  if (!/^(humanity:\/\/|blob:|data:audio\/)/.test(url)) throw new Error('Import the audio into this local project before playing it.');
  const response = await fetch(url); if (!response.ok) throw new Error('The local audio file could not be read. Reopen the project or reimport the audio.');
  try { return await context.decodeAudioData(await response.arrayBuffer()); }
  catch { throw new Error('This browser cannot decode the audio track. Import a WAV, FLAC, MP3 or another format supported by the installed media engine.'); }
}
export interface WaveformPeak { min: number; max: number }
export function waveformPeaks(buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>, bins = 320): WaveformPeak[] {
  const count = Math.max(1, Math.min(10000, Math.round(Number.isFinite(bins) ? bins : 320)));
  const result = Array.from({ length: count }, () => ({ min: 0, max: 0 }));
  if (!buffer.length || !buffer.numberOfChannels) return result;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor(bin * buffer.length / count), end = Math.min(buffer.length, Math.max(start + 1, Math.floor((bin + 1) * buffer.length / count)));
    let low = 0, high = 0;
    for (const channel of channels) for (let sample = start; sample < end; sample++) { const value = Number.isFinite(channel[sample]) ? channel[sample] : 0; low = Math.min(low, value); high = Math.max(high, value); }
    result[bin] = { min: Math.max(-1, low), max: Math.min(1, high) };
  } return result;
}
export function waveform(buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>, bins = 320): Float32Array {
  return Float32Array.from(waveformPeaks(buffer, bins), peak => Math.max(Math.abs(peak.min), Math.abs(peak.max)));
}
export interface AudioFrameCue { sourceSeconds: number; gain: number; remainingSeconds: number; elapsedSeconds: number }
export function audioAtFrame(clip: AudioClip, frame: number, fps: number, duration?: number): AudioFrameCue | null {
  if (clip.muted || !Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0 || frame < clip.startFrame) return null;
  const elapsed = (frame - clip.startFrame) / fps;
  const end = Math.min(clip.outSeconds ?? duration ?? Infinity, duration ?? Infinity);
  const sourceSeconds = clip.inSeconds + elapsed;
  if (sourceSeconds < 0 || sourceSeconds >= end) return null;
  const remaining = end - sourceSeconds;
  const fadeIn = clip.fadeInSeconds > 0 ? Math.min(1, elapsed / clip.fadeInSeconds) : 1;
  const fadeOut = clip.fadeOutSeconds > 0 ? Math.min(1, remaining / clip.fadeOutSeconds) : 1;
  return { sourceSeconds, elapsedSeconds: elapsed, remainingSeconds: remaining, gain: Math.max(0, Math.min(10, clip.gain)) * Math.max(0, fadeIn) * Math.max(0, fadeOut) };
}
export async function playAudioCue(buffer: AudioBuffer, sourceSeconds: number, durationSeconds = 0.12, gain = 1, context = getAudioContext()): Promise<() => void> {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds < 0 || sourceSeconds >= buffer.duration || durationSeconds <= 0) return () => {};
  if (context.state === 'suspended') await context.resume();
  const duration = Math.min(durationSeconds, buffer.duration - sourceSeconds); const source = context.createBufferSource(); const volume = context.createGain();
  source.buffer = buffer; source.connect(volume); volume.connect(context.destination);
  const now = context.currentTime, edge = Math.min(0.004, duration / 3), level = Math.max(0, Math.min(10, gain));
  volume.gain.setValueAtTime(0, now); volume.gain.linearRampToValueAtTime(level, now + edge);
  volume.gain.setValueAtTime(level, now + duration - edge); volume.gain.linearRampToValueAtTime(0, now + duration);
  let stopped = false; const cleanup = () => { source.disconnect(); volume.disconnect(); };
  source.onended = cleanup; source.start(now, sourceSeconds, duration);
  return () => { if (stopped) return; stopped = true; try { source.stop(); } catch { /* A naturally ended cue is already stopped. */ } cleanup(); };
}
export async function playFrameCue(buffer: AudioBuffer, clip: AudioClip, frame: number, fps: number, duration = Math.max(1 / fps, 0.08)): Promise<() => void> {
  const cue = audioAtFrame(clip, frame, fps, buffer.duration); if (!cue) return () => {};
  return playAudioCue(buffer, cue.sourceSeconds, Math.min(cue.remainingSeconds, duration), cue.gain);
}
export class CaptureSounds {
  enabled: boolean; private nodes = new Set<OscillatorNode>();
  constructor(enabled = true) { this.enabled = enabled; }
  async beep(frequency = 700, duration = 0.06): Promise<void> {
    if (!this.enabled) return;
    const context = getAudioContext(); if (context.state === 'suspended') await context.resume();
    const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    oscillator.connect(gain); gain.connect(context.destination); const now = context.currentTime;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.06, now + 0.004); gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    this.nodes.add(oscillator); oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration);
  }
  tick(): Promise<void> { return this.beep(650, 0.06); }
  capture(): Promise<void> { return this.beep(1050, 0.09); }
  stop(): void { for (const node of this.nodes) try { node.stop(); } catch { /* Already ended. */ } this.nodes.clear(); }
}
export interface RecordedAudio { bytes: Uint8Array; mimeType: string }
export class AudioRecorder {
  private recorder: MediaRecorder | null = null; private stream: MediaStream | null = null; private chunks: Blob[] = []; private failure: Error | null = null; private bytes = 0;
  private generation = 0;
  get isRecording(): boolean { return this.recorder?.state === 'recording'; }
  /** Must only be called from the user's explicit Record action. Camera capture never requests audio. */
  async start(deviceId?: string): Promise<void> {
    if (this.isRecording) throw new Error('An audio recording is already in progress. Stop it before starting another.');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable. Import an audio file instead.');
    const generation = ++this.generation;
    this.chunks = []; this.failure = null; this.bytes = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); throw new Error('The microphone request was cancelled.'); }
      this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); this.recorder = recorder;
      recorder.ondataavailable = event => { if (generation !== this.generation || !event.data.size) return; this.bytes += event.data.size;
        if (this.bytes > 256 * 1024 * 1024) { this.failure = new Error('Recording reached the 256 MB limit. Record a shorter section.'); if (recorder.state === 'recording') recorder.stop(); }
        else this.chunks.push(event.data);
      };
      recorder.onerror = () => { if (generation === this.generation) this.failure = new Error('Microphone recording failed. Check the microphone connection and privacy settings.'); for (const track of stream.getTracks()) track.stop(); };
      recorder.onstop = () => { for (const track of stream.getTracks()) track.stop(); if (generation === this.generation) this.stream = null; };
      recorder.start(1000);
    } catch (error) {
      if (generation === this.generation) { for (const track of this.stream?.getTracks() ?? []) track.stop(); this.stream = null; }
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError') throw new Error('Microphone access was denied. Allow it in system privacy settings or import an audio file.');
      throw error;
    }
  }
  async stop(): Promise<RecordedAudio> {
    const generation = this.generation;
    const recorder = this.recorder; if (!recorder) throw new Error('No microphone recording has started.');
    if (recorder.state !== 'inactive') await new Promise<void>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.addEventListener('error', () => reject(this.failure ?? new Error('Recording failed.')), { once: true }); recorder.stop();
    });
    if (generation !== this.generation) throw new Error('The microphone recording was cancelled.');
    for (const track of this.stream?.getTracks() ?? []) track.stop(); this.stream = null; this.recorder = null;
    if (this.failure) throw this.failure;
    if (!this.chunks.length) throw new Error('No audio was recorded. Check the selected microphone and record for a little longer.');
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }); this.chunks = [];
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type };
  }
  cancel(): void { ++this.generation; if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    for (const track of this.stream?.getTracks() ?? []) track.stop(); this.stream = null; this.recorder = null; this.chunks = [];
  }
}
