/* SPDX-License-Identifier: GPL-3.0-or-later */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAMERA_PREFERENCES, parseCameraPreferences } from './camera-preferences.ts';

test('first-run defaults request 4K without specifying or opening any camera', () => {
  assert.deepEqual(parseCameraPreferences(null), DEFAULT_CAMERA_PREFERENCES);
  assert.equal(DEFAULT_CAMERA_PREFERENCES.requestedResolution, '3840x2160');
  assert.equal(DEFAULT_CAMERA_PREFERENCES.deviceId, '');
});
test('restart preferences keep the exact selected device and capture choices', () => {
  const preferences = { version: 1 as const, deviceId: 'exact-device-abc', deviceLabel: 'EMEET camera', requestedResolution: '3840x2160', countdown: 5, captureMode: 'replace' as const };
  assert.deepEqual(parseCameraPreferences(JSON.stringify(preferences)), preferences);
});
test('invalid or future preference data never injects unsupported capture choices', () => {
  assert.deepEqual(parseCameraPreferences('{broken'), DEFAULT_CAMERA_PREFERENCES);
  assert.deepEqual(parseCameraPreferences('{"version":2}'), DEFAULT_CAMERA_PREFERENCES);
  const parsed = parseCameraPreferences(JSON.stringify({ version: 1, deviceId: { id: 'wrong' }, requestedResolution: '999999x999999', countdown: -1, captureMode: 'delete' }));
  assert.deepEqual(parsed, DEFAULT_CAMERA_PREFERENCES);
});
