/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { AppInfo, ExportOptions, ExportProfile } from '../core/types.ts';

export const DEFAULT_VERIFY_EXPORT = false;
export function withExportVerification(options: Omit<ExportOptions, 'verify'>, verify = DEFAULT_VERIFY_EXPORT): ExportOptions {
  return { ...options, verify: verify === true };
}

export interface ExportProfileInfo {
  id: ExportProfile; label: string; category: string; extension: string;
  kind: 'movie' | 'sequence' | 'originals'; encoderCandidates: string[];
  pixelFormat: string; audioCodec: string | null; losslessKind: string;
  precision: { source: string; storageBits: number | null; representation: 'integer' | 'float32' | 'original'; alpha: boolean; upconverted: boolean };
  description: string; warnings: string[]; requiredRaster?: [number, number][];
  rates?: number[]; evenDimensions?: boolean; sequenceExtension?: string; container: string;
  minimumRaster?: [number, number]; multiples?: [number, number]; maxRaster?: [number, number]; maxPixels?: number;
  hardwareCandidates?: string[]; requiresHardware?: boolean;
  requiresEncoder?: boolean;
  conformPresets?: { width: number; height: number; fps: number }[];
  rasterRates?: { width: number; height: number; rates: number[] }[];
}
export interface ExportGeometry { width: number; height: number; fps: number }
export function sameRate(a: number, b: number): boolean { return Math.abs(a - b) < .005; }
/** Compile-time encoder presence is not a promise that the hardware/driver will initialize. */
export function exportPreflight(profile: ExportProfileInfo, app: AppInfo | null, geometry: ExportGeometry): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (profile.kind === 'originals') return { errors, warnings };
  if (profile.requiresEncoder !== false) {
    if (!app) errors.push('Checking the native media runtime. Please wait a moment.');
    else if (!app.mediaAvailable) errors.push('The media runtime is unavailable. You can still export an untouched original sequence or direct RGBA8 PNG sequence.');
    else if (profile.encoderCandidates.length && !profile.encoderCandidates.some(encoder => app.encoders.includes(encoder))) errors.push(`This runtime does not include ${profile.encoderCandidates.join(' or ')}. This format remains selectable; choose another format to export on this computer.`);
  }
  if (!Number.isInteger(geometry.width) || !Number.isInteger(geometry.height) || geometry.width < 16 || geometry.height < 16 || geometry.width > 8192 || geometry.height > 8192 || geometry.width * geometry.height > 35_651_584) errors.push('Choose an output from 16–8192 pixels per side, up to 35,651,584 pixels total.');
  if (!Number.isFinite(geometry.fps) || geometry.fps < 1 || geometry.fps > 120) errors.push('Choose an output frame rate from 1 to 120 fps.');
  if (profile.evenDimensions && (geometry.width % 2 !== 0 || geometry.height % 2 !== 0)) errors.push('This format needs an even width and height. Round the output dimensions to even numbers below.');
  if (profile.minimumRaster && (geometry.width < profile.minimumRaster[0] || geometry.height < profile.minimumRaster[1])) errors.push(`This profile needs at least ${profile.minimumRaster[0]} × ${profile.minimumRaster[1]} pixels.`);
  if (profile.multiples && (geometry.width % profile.multiples[0] !== 0 || geometry.height % profile.multiples[1] !== 0)) errors.push(`This profile needs a width divisible by ${profile.multiples[0]} and a height divisible by ${profile.multiples[1]}. Use aligned dimensions below.`);
  if (profile.maxRaster && (geometry.width > profile.maxRaster[0] || geometry.height > profile.maxRaster[1])) errors.push(`This profile is limited to ${profile.maxRaster[0]} × ${profile.maxRaster[1]} pixels. Choose a smaller raster or another format.`);
  if (profile.maxPixels && geometry.width * geometry.height > profile.maxPixels) errors.push(`This profile is limited to ${profile.maxPixels.toLocaleString()} pixels per frame. Choose a smaller size or another format.`);
  if (profile.requiredRaster?.length && !profile.requiredRaster.some(([w, h]) => geometry.width === w && geometry.height === h)) errors.push(`This broadcast profile supports ${profile.requiredRaster.map(([w, h]) => `${w} × ${h}`).join(' or ')}. Use a conform preset below; your project stays unchanged.`);
  if (profile.rates?.length && !profile.rates.some(rate => sameRate(rate, geometry.fps))) errors.push(`This profile requires ${profile.rates.join(', ')} fps. Choose a conform preset to preserve the film’s duration.`);
  if (profile.rasterRates?.length && !profile.rasterRates.some(item => item.width === geometry.width && item.height === geometry.height && item.rates.some(rate => sameRate(rate, geometry.fps)))) errors.push('This raster and frame-rate combination is not valid for the broadcast profile. Use one of its conform presets below.');
  if (profile.id === 'nvenc-lossless') warnings.push('Requires a compatible NVIDIA GPU and driver. The runtime encoder is checked here; actual hardware initialization is checked before encoding.');
  else if (app && profile.hardwareCandidates?.some(encoder => app.encoders.includes(encoder))) warnings.push('A hardware encoder is included in this runtime. The actual GPU/driver and requested size are checked before encoding; the chosen encoder is reported with the export.');
  return { errors, warnings };
}
export function precisionExplanation(profile: ExportProfileInfo, higherPrecisionOriginals: boolean): string[] {
  if (profile.kind === 'originals') return ['Archives the complete portable project: all scenes, the project manifest, frame order and holds, plus original image and audio assets included once each. Files are copied byte for byte at their native precision; effects, scaling and rendered titles are bypassed.'];
  const result = ['Processed frames use the browser’s RGBA8 pipeline: 8 bits per channel. Webcam captures are saved through this same 8-bit pipeline.'];
  if (higherPrecisionOriginals) result.push('Some imported originals contain more than 8 bits per channel. Their processed preview/export passes through RGBA8. Choose Originals project archive to retain those files at their native precision.');
  if (profile.precision.upconverted || profile.precision.representation === 'float32' || (profile.precision.storageBits ?? 8) > 8) result.push(`The ${profile.precision.representation === 'float32' ? '32-bit float' : `${profile.precision.storageBits ?? 'higher'}-bit`} output stores expanded 8-bit rendered values for workflow compatibility. It does not recover extra sensor precision, HDR latitude or captured detail.`);
  if (profile.id === 'ffv1' || profile.id === 'png-sequence') result.push('Recommended for preserving the processed RGBA8 frame pixels. “Lossless” applies to these rendered pixels, not to recovering information missing from the source.');
  if (!profile.precision.alpha) result.push('This profile does not preserve transparency. The project background is included in rendered frames.');
  return result;
}
