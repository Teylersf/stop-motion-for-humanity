/** GPL-3.0-or-later. Deterministic pixel transforms and frame/audio timing, without a physical device. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFrameEdits } from '../model.ts';
import { assertLocalAssetURL, parseHexColor, processPixels } from '../render.ts';
import { audioAtFrame, CaptureSounds, waveform, waveformPeaks } from '../audio.ts';
import type { AudioClip } from '../types.ts';

test('default picture edits preserve every source sample including transparent RGB values', () => {
  const values = new Uint8ClampedArray([0, 127, 255, 255, 28, 49, 201, 200, 193, 88, 64, 0]); const original = values.slice();
  processPixels(values, defaultFrameEdits()); assert.deepEqual(values, original);
});
test('color/exposure render is deterministic and chunk-independent, without temporal flicker', () => {
  const source = new Uint8ClampedArray([25, 99, 231, 255, 103, 128, 57, 128, 250, 240, 230, 255]);
  const edits = { ...defaultFrameEdits(), exposure: 0.75, contrast: 1.1, saturation: 0.6, temperature: 0.3 };
  const a = source.slice(), b = source.slice(), c = source.slice(); processPixels(a, edits); processPixels(b, edits);
  processPixels(c, edits, 0, 1); processPixels(c, edits, 1, 3); assert.deepEqual(a, b); assert.deepEqual(a, c); assert.notDeepEqual(a, source);
  assert.equal(a[7], 128); assert.equal(a[11], 255);
});
test('chroma key removes the selected color and preserves distant foreground pixels', () => {
  const values = new Uint8ClampedArray([0, 255, 0, 255, 240, 30, 40, 255]); processPixels(values, { ...defaultFrameEdits(), keyColor: '#00ff00', keyTolerance: 0.1 });
  assert.equal(values[3], 0); assert.equal(values[7], 255); assert.deepEqual([...values.slice(4, 7)], [240, 30, 40]);
  assert.deepEqual(parseHexColor('#AB10fF'), [171, 16, 255]); assert.throws(() => parseHexColor('red'), /hex color/);
});
test('image loading rejects network/file URLs before any image request', () => {
  assert.doesNotThrow(() => assertLocalAssetURL('humanity://app/asset/project/frame'));
  assert.doesNotThrow(() => assertLocalAssetURL('blob:some-local-url'));
  for (const url of ['https://example.com/a.png', 'file:///etc/passwd', 'javascript:alert(1)']) assert.throws(() => assertLocalAssetURL(url), /local project/);
});
test('audio cues account for exposure offset, trims, gain, fades, mute and exclusive end', () => {
  const clip: AudioClip = { id: 'audio', assetId: 'track', name: 'Dialogue', startFrame: 24, inSeconds: 1, outSeconds: 5, gain: 0.8, muted: false, fadeInSeconds: 1, fadeOutSeconds: 1 };
  assert.equal(audioAtFrame(clip, 23, 24, 10), null);
  const middle = audioAtFrame(clip, 36, 24, 10)!; assert.equal(middle.sourceSeconds, 1.5); assert.equal(middle.gain, 0.4);
  const endFade = audioAtFrame(clip, 108, 24, 10)!; assert.equal(endFade.sourceSeconds, 4.5); assert.equal(endFade.gain, 0.4);
  assert.equal(audioAtFrame(clip, 120, 24, 10), null); assert.equal(audioAtFrame({ ...clip, muted: true }, 36, 24, 10), null);
  assert.equal(audioAtFrame(clip, 36, 0), null);
});
test('waveform includes all channels and quiet samples; no peaks are skipped by sparse sampling', () => {
  const channels = [Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0]), Float32Array.from([0, -0.9, 0.7, 0, 0, 0, 0, 0])];
  const buffer = { length: 8, numberOfChannels: 2, getChannelData: (i: number) => channels[i] };
  const peaks = waveformPeaks(buffer, 2); assert.ok(peaks[0].min < -0.89); assert.ok(peaks[0].max > 0.69); assert.equal(peaks[1].max, 0);
  assert.ok(waveform(buffer, 2)[0] > 0.89); assert.equal(waveformPeaks({ length: 0, numberOfChannels: 0, getChannelData: () => new Float32Array() }, 1)[0].max, 0);
});
test('muted capture sounds do not instantiate audio or request a microphone', async () => { const sounds = new CaptureSounds(false); await sounds.tick(); await sounds.capture(); sounds.stop(); });
