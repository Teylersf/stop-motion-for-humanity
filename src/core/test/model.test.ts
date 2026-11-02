/** GPL-3.0-or-later. Exposure semantics and portable non-destructive project fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssetRecord } from '../types.ts';
import { addFrames, allFrames, cloneProject, commitHistory, createHistory, createProject, defaultFrameEdits, deleteFrames, duplicateFrames, frameAtExposure, moveFrames, newFrame, newScene, redoHistory, reverseFrames, setFrameHold, timeline, totalFrames, undoHistory, updateFrameEdits, validateProject } from '../model.ts';

function asset(id: string): AssetRecord { return { id, kind: 'image', fileName: `${id}.png`, originalName: `${id}.png`, mimeType: 'image/png', width: 1280, height: 720, byteLength: 4000, sha256: 'a'.repeat(64), createdAt: new Date().toISOString(), url: `humanity://app/asset/project/${id}` }; }
function fixture() { return addFrames(createProject('Paper orbit'), [asset('a'), asset('b'), asset('c')]); }

test('new projects and independently editable frame defaults survive a JSON round trip', () => {
  const p = fixture(); const roundTrip = JSON.parse(JSON.stringify(p)); assert.equal(validateProject(roundTrip).valid, true);
  const first = defaultFrameEdits(), second = defaultFrameEdits(); first.crop.x = 0.1; first.drawings.push({ id: 'stroke', size: 10, color: '#ffffff', erase: false, points: [{ x: 0.5, y: 0.5 }] });
  assert.equal(second.crop.x, 0); assert.equal(second.drawings.length, 0); assert.equal(roundTrip.assets.length, 3);
});
test('adding frames does not mutate the prior project or duplicate original asset records', () => {
  const initial = createProject(); const a = asset('a'); const p = addFrames(initial, [a, a], { hold: 2 });
  assert.equal(initial.assets.length, 0); assert.equal(initial.scenes[0].frames.length, 0); assert.equal(p.assets.length, 1);
  assert.equal(p.scenes[0].frames.length, 2); assert.notEqual(p.scenes[0].frames[0].id, p.scenes[0].frames[1].id);
  assert.equal(totalFrames(p), 4); assert.throws(() => addFrames(p, [a], { sceneId: 'missing' }), /does not exist/);
});
test('exposure sheet respects enabled frames, holds, scene ordering and exclusive boundaries', () => {
  const p = fixture(); const [a, b, c] = p.scenes[0].frames; a.hold = 2; b.enabled = false; c.hold = 3;
  const scene2 = newScene('Next shot'); scene2.frames = [newFrame(asset('a'), { type: 'import' }, 2)]; p.scenes.push(scene2);
  const entries = timeline(p); assert.deepEqual(entries.map(e => [e.frame.assetId, e.startFrame, e.endFrame]), [['a', 0, 2], ['c', 2, 5], ['a', 5, 7]]);
  assert.equal(frameAtExposure(p, 1)?.frame.id, a.id); assert.equal(frameAtExposure(p, 2)?.frame.id, c.id);
  assert.equal(frameAtExposure(p, 7), null); assert.equal(frameAtExposure(p, -1), null); assert.equal(frameAtExposure(p, NaN), null);
  assert.equal(totalFrames(p, scene2.id), 2); assert.equal(allFrames(p).length, 4);
});
test('holds stay compressed; excessive exposure totals fail before export allocations', () => {
  let p = fixture(); p = setFrameHold(p, p.scenes[0].frames[0].id, 10000);
  assert.equal(timeline(p).length, 3); assert.equal(totalFrames(p), 10002);
  p.scenes[0].frames = Array.from({ length: 11 }, () => newFrame('a', { type: 'import' }, 10000));
  assert.throws(() => timeline(p), /exceeds/); assert.equal(validateProject(p).valid, false);
});
test('move, selected reverse, duplicate and delete retain original assets and exact frame timing', () => {
  const p = fixture(); const [a, b, c] = p.scenes[0].frames;
  const moved = moveFrames(p, [c.id], 0); assert.deepEqual(moved.scenes[0].frames.map(f => f.assetId), ['c', 'a', 'b']);
  const reversed = reverseFrames(p, [a.id, c.id]); assert.deepEqual(reversed.scenes[0].frames.map(f => f.assetId), ['c', 'b', 'a']);
  const doubled = duplicateFrames(setFrameHold(p, b.id, 3), [b.id]); assert.deepEqual(doubled.scenes[0].frames.map(f => f.hold), [1, 3, 3, 1]);
  assert.equal(new Set(doubled.scenes[0].frames.map(f => f.id)).size, 4);
  const removed = deleteFrames(doubled, [b.id]); assert.equal(removed.assets.length, 3); assert.equal(removed.scenes[0].frames.length, 3);
  assert.deepEqual(p.scenes[0].frames.map(f => f.assetId), ['a', 'b', 'c']);
});
test('undo and redo retain complete non-destructive edits, and a new edit clears redo', () => {
  const p = fixture(); const frameId = p.scenes[0].frames[0].id; let history = createHistory(p, 2);
  const changed = updateFrameEdits(p, frameId, { exposure: 1.5 }); history = commitHistory(history, changed);
  changed.scenes[0].frames[0].edits.exposure = 9;
  assert.equal(history.present.scenes[0].frames[0].edits.exposure, 1.5);
  history = undoHistory(history); assert.equal(history.present.scenes[0].frames[0].edits.exposure, 0);
  history = redoHistory(history); assert.equal(history.present.scenes[0].frames[0].edits.exposure, 1.5);
  history = commitHistory(undoHistory(history), setFrameHold(p, frameId, 4)); assert.equal(history.future.length, 0); assert.equal(totalFrames(history.present), 6);
});
test('validator rejects remote assets, missing references, duplicate IDs and invalid crops without throwing', () => {
  const p = fixture(); const invalid = cloneProject(p); invalid.assets[0].url = 'https://example.com/leak.png'; invalid.scenes[0].frames[0].assetId = 'missing';
  invalid.scenes[0].frames[1].id = invalid.scenes[0].frames[0].id; invalid.scenes[0].frames[2].edits.crop = { x: 0.8, y: 0, width: 0.5, height: 1 };
  const result = validateProject(invalid); assert.equal(result.valid, false); assert.ok(result.errors.some(e => e.includes('local asset'))); assert.ok(result.errors.some(e => e.includes('source image')));
  assert.ok(result.errors.some(e => e.includes('unique'))); assert.ok(result.errors.some(e => e.includes('crop')));
  assert.equal(validateProject(null).valid, false); assert.equal(validateProject({ version: 2 }).valid, false);
});
test('validator accepts native UHD and DCI 8K, rejects rasters beyond the native engine limit', () => {
  for (const [width, height] of [[7680, 4320], [8192, 4320]]) assert.equal(validateProject(createProject('8K', { width, height })).valid, true);
  assert.equal(validateProject(createProject('Too large', { width: 8192, height: 8192 })).valid, false);
});
