/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';

// Preserve the audited media bytes while Electron's app/frameworks are signed.
const base = require('../desktop/electron-builder.cjs');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const exec = promisify(execFile);
const TOOL_NAMES = ['ffmpeg', 'ffprobe'];
const SIGN_IGNORE = '/Contents/Resources/media/(ffmpeg|ffprobe)$';
const MINIMUM = '14.0';
const manifestsBeforePack = new Map();

async function inheritedHook(name, context) {
  const hook = base[name];
  if (hook == null) return;
  if (typeof hook === 'function') {
    await hook(context);
    return;
  }
  // Match the pinned builder's support for a path/module/default-export hook.
  const { resolveFunction } = require('app-builder-lib/out/util/resolve');
  const workspace = context.packager.info?.getWorkspaceRoot
    ? await context.packager.info.getWorkspaceRoot()
    : context.packager.projectDir;
  const resolved = await resolveFunction(context.packager.appInfo?.type, hook, name, workspace);
  if (typeof resolved !== 'function') throw new Error(`Cannot preserve base ${name} hook`);
  await resolved(context);
}

function requireMacArm64(context) {
  const arch = typeof context.arch === 'number'
    ? require('builder-util').Arch[context.arch]
    : context.arch;
  if (context.electronPlatformName !== 'darwin' || arch !== 'arm64') {
    throw new Error('The Mac release wrapper requires --mac --arm64');
  }
}

async function regularFile(file) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Expected a regular file: ${path.basename(file)}`);
  }
  return stat;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function version(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(value)) {
    throw new Error('Invalid macOS deployment version');
  }
  return value.split('.').map(Number).concat([0, 0]).slice(0, 3).join('.');
}

async function readManifest(mediaDir) {
  const file = path.join(mediaDir, 'runtime-manifest.json');
  await regularFile(file);
  const bytes = await fsp.readFile(file);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.status !== 'passed' || manifest.platform !== 'darwin' || manifest.architecture !== 'arm64') {
    throw new Error('Mac media manifest must have passed status and darwin/arm64 platform');
  }
  if (version(manifest.minimum_macos) !== version(MINIMUM)) {
    throw new Error('Mac media manifest must declare the audited macOS 14.0 floor');
  }
  if (!manifest.binaries || Object.keys(manifest.binaries).sort().join(',') !== TOOL_NAMES.join(',')) {
    throw new Error('Mac media manifest must pin exactly ffmpeg and ffprobe');
  }
  for (const name of TOOL_NAMES) {
    const record = manifest.binaries[name];
    if (record.file !== name || !Number.isSafeInteger(record.bytes) || record.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(record.sha256) || record.architecture !== 'arm64' ||
        version(record.minimum_macos) !== version(MINIMUM)) {
      throw new Error(`Invalid Mac media byte/SHA/deployment pin: ${name}`);
    }
    if (manifest.tools) {
      const alias = manifest.tools[name];
      if (!alias || alias.file !== record.file || alias.bytes !== record.bytes || alias.sha256 !== record.sha256) {
        throw new Error(`Mac media tools alias disagrees with binary pin: ${name}`);
      }
    }
  }
  return { manifest, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function verifyTools(mediaDir, manifest) {
  for (const name of TOOL_NAMES) {
    const file = path.join(mediaDir, name);
    const stat = await regularFile(file);
    const expected = manifest.binaries[name];
    if (!(stat.mode & 0o111) || stat.size !== expected.bytes || await sha256(file) !== expected.sha256) {
      throw new Error(`Mac media bytes/SHA or executable permissions do not match manifest: ${name}`);
    }
    await exec('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file], {
      timeout: 30000, maxBuffer: 1024 * 1024,
    });
  }
}

function sourceMedia(context) {
  return path.join(context.packager.projectDir, 'resources', 'media', 'darwin-arm64');
}

async function beforePack(context) {
  requireMacArm64(context);
  await inheritedHook('beforePack', context);
  const source = await readManifest(sourceMedia(context));
  await verifyTools(sourceMedia(context), source.manifest);
  manifestsBeforePack.set(path.resolve(context.appOutDir), source.sha256);
  console.log('[mac-media] Source manifest, both exact tool pins and strict signatures verified');
}

async function afterSign(context) {
  requireMacArm64(context);
  await inheritedHook('afterSign', context);
  const before = manifestsBeforePack.get(path.resolve(context.appOutDir));
  if (!before) throw new Error('Mac afterSign has no verified beforePack manifest snapshot');
  const source = await readManifest(sourceMedia(context));
  if (source.sha256 !== before) throw new Error('Source media manifest changed during packaging');
  await verifyTools(sourceMedia(context), source.manifest);
  const productFilename = context.packager.appInfo?.productFilename || base.productName;
  if (!productFilename || path.basename(productFilename) !== productFilename) {
    throw new Error('Cannot determine the actual Mac application bundle name');
  }
  const app = path.join(context.appOutDir, `${productFilename}.app`);
  const mediaDir = path.join(app, 'Contents', 'Resources', 'media');
  const bundled = await readManifest(mediaDir);
  if (bundled.sha256 !== before) throw new Error('Bundled media manifest differs from verified source manifest');
  await verifyTools(mediaDir, bundled.manifest);
  const plist = path.join(app, 'Contents', 'Info.plist');
  const minimum = await exec('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', plist], {
    timeout: 30000, maxBuffer: 1024 * 1024,
  });
  if (version(minimum.stdout.trim()) !== version(MINIMUM)) {
    throw new Error('Final app Info.plist does not declare macOS 14.0');
  }
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
    timeout: 60000, maxBuffer: 1024 * 1024,
  });
  console.log('[mac-media] Final bundled manifests/tools match exact source pins; outer app deep/strict verified');
}

module.exports = {
  ...base,
  mac: { ...base.mac, minimumSystemVersion: MINIMUM, signIgnore: SIGN_IGNORE },
  beforePack,
  afterSign,
};
