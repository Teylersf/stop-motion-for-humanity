/* SPDX-License-Identifier: GPL-3.0-or-later */
export const CAMERA_PREFERENCES_KEY = 'humanity.camera-preferences.v1';
export interface CameraPreferences {
  version: 1; deviceId: string; deviceLabel: string;
  requestedResolution: string; countdown: number; captureMode: 'append' | 'insert' | 'replace';
}
export const DEFAULT_CAMERA_PREFERENCES: CameraPreferences = {
  version: 1, deviceId: '', deviceLabel: '', requestedResolution: '3840x2160', countdown: 0, captureMode: 'append',
};
export function parseCameraPreferences(raw: string | null): CameraPreferences {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || value.version !== 1) return { ...DEFAULT_CAMERA_PREFERENCES };
    return { version: 1,
      deviceId: typeof value.deviceId === 'string' && value.deviceId.length < 1024 ? value.deviceId : '',
      deviceLabel: typeof value.deviceLabel === 'string' ? value.deviceLabel.slice(0, 300) : '',
      requestedResolution: ['1280x720', '1920x1080', '3840x2160', '7680x4320'].includes(value.requestedResolution) ? value.requestedResolution : DEFAULT_CAMERA_PREFERENCES.requestedResolution,
      countdown: [0, 2, 5, 10].includes(value.countdown) ? value.countdown : 0,
      captureMode: ['append', 'insert', 'replace'].includes(value.captureMode) ? value.captureMode : 'append',
    };
  } catch { return { ...DEFAULT_CAMERA_PREFERENCES }; }
}
export function loadCameraPreferences(): CameraPreferences {
  try { return parseCameraPreferences(localStorage.getItem(CAMERA_PREFERENCES_KEY)); }
  catch { return { ...DEFAULT_CAMERA_PREFERENCES }; }
}
export function saveCameraPreferences(value: CameraPreferences): void {
  try { localStorage.setItem(CAMERA_PREFERENCES_KEY, JSON.stringify(value)); }
  catch { /* Restricted/quota-limited storage must never prevent capture. */ }
}
