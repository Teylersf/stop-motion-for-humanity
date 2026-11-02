/* SPDX-License-Identifier: GPL-3.0-or-later */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import profilesJSON from '../../assets/export-profiles.json' with { type: 'json' };
import { DEFAULT_VERIFY_EXPORT, exportPreflight, precisionExplanation, withExportVerification, type ExportProfileInfo } from './export-info.ts';
import type { AppInfo } from '../core/types.ts';

const profiles = profilesJSON as unknown as ExportProfileInfo[];
const profile = (id: string) => { const found = profiles.find(item => item.id === id); assert.ok(found, `Missing ${id}`); return found; };
const app = (encoders: string[]): AppInfo => ({ version: 'test', platform: 'win32', arch: 'x64', mediaAvailable: true, encoders, cameraPermission: 'unknown', microphonePermission: 'unknown' });

test('all 28 profiles remain discoverable even when no encoders are available', () => {
  assert.equal(profiles.length, 28); assert.equal(new Set(profiles.map(item => item.id)).size, 28);
  const before = structuredClone(profiles);
  for (const item of profiles) exportPreflight(item, app([]), { width: 1920, height: 1080, fps: 24 });
  assert.deepEqual(profiles, before);
  assert.deepEqual(exportPreflight(profile('originals'), null, { width: 1920, height: 1080, fps: 12 }).errors, []);
});
test('DNxHD preflight explains illegal 4K/12fps and accepts an HD conform', () => {
  const item = profile('dnxhd'), runtime = app(item.encoderCandidates);
  const rejected = exportPreflight(item, runtime, { width: 3840, height: 2160, fps: 12 });
  assert.ok(rejected.errors.some(message => message.includes('broadcast')));
  assert.ok(rejected.errors.some(message => message.includes('fps')));
  assert.deepEqual(exportPreflight(item, runtime, { width: 1920, height: 1080, fps: 24 }).errors, []);
});
test('NVIDIA encoder presence does not claim hardware readiness', () => {
  const item = profile('nvenc-lossless');
  assert.ok(exportPreflight(item, app([]), { width: 1920, height: 1080, fps: 24 }).errors.some(message => message.includes('runtime')));
  const available = exportPreflight(item, app(item.encoderCandidates), { width: 1920, height: 1080, fps: 24 });
  assert.equal(available.errors.length, 0);
  assert.ok(available.warnings.some(message => message.includes('actual hardware initialization')));
});
test('16-bit and float exports disclose RGBA8 expansion rather than recovered precision', () => {
  for (const id of ['png16-sequence', 'tiff-sequence', 'dpx-sequence', 'exr-sequence']) {
    const messages = precisionExplanation(profile(id), true).join(' ');
    assert.match(messages, /RGBA8/); assert.match(messages, /does not recover/); assert.match(messages, /Originals project archive/);
  }
  assert.match(precisionExplanation(profile('originals'), true).join(' '), /byte for byte/);
});
test('MXF MPEG-2 validates coupled raster/rate pairs rather than independent unions', () => {
  const item = profile('mxf-mpeg2'), runtime = app(item.encoderCandidates);
  assert.ok(exportPreflight(item, runtime, { width: 1920, height: 1080, fps: 60 }).errors.some(message => message.includes('combination')));
  assert.deepEqual(exportPreflight(item, runtime, { width: 1280, height: 720, fps: 60 }).errors, []);
  assert.deepEqual(exportPreflight(item, runtime, { width: 1920, height: 1080, fps: 24000 / 1001 }).errors, []);
});
test('CineForm discloses its block alignment before starting an encoder', () => {
  const item = profile('cineform'), runtime = app(item.encoderCandidates);
  assert.ok(exportPreflight(item, runtime, { width: 1919, height: 1079, fps: 12 }).errors.some(message => message.includes('divisible')));
  assert.deepEqual(exportPreflight(item, runtime, { width: 1920, height: 1080, fps: 12 }).errors, []);
});
test('direct RGBA8 PNG archives work without an external codec runtime', () => {
  const item = profile('png-sequence'); assert.equal(item.requiresEncoder, false);
  assert.deepEqual(exportPreflight(item, null, { width: 1920, height: 1080, fps: 12 }).errors, []);
  assert.ok(exportPreflight(item, null, { width: 9000, height: 1080, fps: 12 }).errors.length > 0);
});
test('GIF remains selectable but explains why an 8K raster is inappropriate', () => {
  const item = profile('gif'), runtime = app(item.encoderCandidates);
  assert.ok(exportPreflight(item, runtime, { width: 7680, height: 4320, fps: 12 }).errors.some(message => message.includes('limited')));
  assert.deepEqual(exportPreflight(item, runtime, { width: 1920, height: 1080, fps: 12 }).errors, []);
});
test('export payload skips expensive verification unless its checkbox is explicitly enabled', () => {
  const options = { profile: 'ffv1' as const, width: 1920, height: 1080, fps: 12, totalFrames: 27, sceneId: 'scene-one', audio: true, preserveTiming: true };
  assert.equal(DEFAULT_VERIFY_EXPORT, false);
  assert.equal(withExportVerification(options).verify, false);
  assert.equal(withExportVerification(options, false).verify, false);
  assert.equal(withExportVerification(options, true).verify, true);
  assert.deepEqual(withExportVerification(options, true), { ...options, verify: true });
  assert.equal('verify' in options, false);
});
