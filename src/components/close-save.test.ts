/* SPDX-License-Identifier: GPL-3.0-or-later */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CloseSaveCoordinator, scheduleAutosave } from './close-save.ts';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('immediate quit persists the last typed title after an older serialized autosave', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'humanity-close-save-'));
  try {
    const file = join(directory, 'project.json'), older = deferred();
    let state = { name: 'Before typing' };
    let queue = older.promise.then(() => writeFile(file, JSON.stringify({ name: 'Before typing' })));
    const save = async (snapshot: typeof state) => { queue = queue.then(() => writeFile(file, JSON.stringify(snapshot))); await queue; return true; };
    const coordinator = new CloseSaveCoordinator<typeof state>();
    state = { name: 'Title typed immediately before Quit' };
    let acknowledged = false;
    const result = coordinator.flush('quit-now', { stop() {}, snapshot: () => state, save }).then(value => { acknowledged = value.ok; return value; });
    await Promise.resolve(); assert.equal(acknowledged, false);
    older.resolve(); assert.equal((await result).ok, true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(directory, { recursive: true, force: true });
  }
});
test('capture and recorder finalization commit before the final snapshot', async () => {
  const coordinator = new CloseSaveCoordinator<{ frames: number; audio: number }>();
  const capture = deferred(), recording = deferred(); let state = { frames: 27, audio: 0 }, written = state;
  coordinator.track(capture.promise.then(() => { state = { ...state, frames: 28 }; }));
  coordinator.track(recording.promise.then(() => { state = { ...state, audio: 1 }; }));
  let stopped = false, disconnected = false;
  const result = coordinator.flush('with-media', { stop() { stopped = true; recording.resolve(); }, afterDrain() { disconnected = true; }, snapshot: () => state, save: async snapshot => { assert.ok(disconnected); written = snapshot; return true; } });
  await Promise.resolve(); assert.ok(stopped); assert.equal(disconnected, false);
  capture.resolve(); assert.equal((await result).ok, true); assert.deepEqual(written, { frames: 28, audio: 1 });
});
test('a failed final save returns an actionable failure instead of permission to close', async () => {
  const coordinator = new CloseSaveCoordinator<{ title: string }>();
  const result = await coordinator.flush('failed', { stop() {}, snapshot: () => ({ title: 'Unsaved title' }), save: async () => false });
  assert.equal(result.ok, false); assert.match(result.error!, /could not be saved/);
});
test('late completion of a cancelled request cannot acknowledge a newer request', async () => {
  const coordinator = new CloseSaveCoordinator<{ title: string }>(), pending = deferred();
  coordinator.track(pending.promise);
  const first = coordinator.flush('old', { stop() {}, snapshot: () => ({ title: 'Old' }), save: async () => { throw new Error('stale request must not save'); } });
  assert.equal(coordinator.cancel('old'), true);
  const writes: string[] = [];
  const second = coordinator.flush('new', { stop() {}, snapshot: () => ({ title: 'Latest' }), save: async value => { writes.push(value.title); return true; } });
  pending.resolve(); assert.equal((await first).stale, true); assert.equal((await second).ok, true); assert.deepEqual(writes, ['Latest']);
});
test('a stale debounce callback cannot queue an older snapshot after the close flush', async () => {
  const coordinator = new CloseSaveCoordinator<{ title: string }>();
  const writes: string[] = []; let closing = false, callback!: () => void;
  const save = async (value: { title: string }) => { writes.push(value.title); return true; };
  const cancel = scheduleAutosave({ title: 'Old debounced title' }, save, () => closing, 650,
    work => { callback = work; return 1 as unknown as ReturnType<typeof setTimeout>; }, () => {});
  closing = true; cancel();
  assert.equal((await coordinator.flush('quit', { stop() {}, snapshot: () => ({ title: 'Latest title' }), save })).ok, true);
  callback(); await Promise.resolve(); assert.deepEqual(writes, ['Latest title']);
});
