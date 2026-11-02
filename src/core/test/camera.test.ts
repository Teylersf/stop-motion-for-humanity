/** GPL-3.0-or-later. Fake-track state-machine fixtures, not physical-camera validation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraController, describeCameraError, supportedCameraSettings } from '../camera.ts';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
class FakeVideo extends EventTarget {
  muted = false; autoplay = false; playsInline = false; srcObject: MediaStream | null = null; readyState = 2; videoWidth = 1920; videoHeight = 1080; currentTime = 0; version = 0;
  callbacks = new Map<number, VideoFrameRequestCallback>(); serial = 0;
  async play() {}
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) { const id = ++this.serial; this.callbacks.set(id, callback); return id; }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  deliverFrame() { this.version++; this.currentTime += 1 / 30; const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); for (const callback of callbacks) callback(this.currentTime, {} as VideoFrameCallbackMetadata); }
}
function fakeTrack(label = 'USB camera', settings: Record<string, string | number> = { deviceId: label, width: 1920, height: 1080 }, caps: Record<string, unknown> = {}) {
  const data = { ...settings }; const track = { label, readyState: 'live', onended: null as ((event: Event) => void) | null, stopped: false,
    getSettings: () => ({ ...data }), getCapabilities: () => ({ ...caps }), stop() { this.stopped = true; this.readyState = 'ended'; },
    async applyConstraints(constraints: MediaTrackConstraints) { for (const advanced of constraints.advanced ?? []) Object.assign(data, advanced); } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { track, stream, data };
}
const videoElement = (video: FakeVideo) => video as unknown as HTMLVideoElement;
const mediaDevices = (getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>, enumerateDevices: () => Promise<MediaDeviceInfo[]> = async () => []) => ({ getUserMedia, enumerateDevices }) as unknown as MediaDevices;

test('connect requests video only, prefers 4K, and exposes the actual lower-resolution settings', async () => {
  const fixture = fakeTrack(); let requested: MediaStreamConstraints | undefined; const video = new FakeVideo();
  const camera = new CameraController(videoElement(video), undefined, { mediaDevices: mediaDevices(async constraints => { requested = constraints; return fixture.stream; }) });
  const result = await camera.connect('usb-1'); assert.equal(requested?.audio, false);
  const constraint = requested!.video as MediaTrackConstraints; assert.deepEqual(constraint.width, { ideal: 3840 }); assert.deepEqual(constraint.height, { ideal: 2160 }); assert.deepEqual(constraint.deviceId, { exact: 'usb-1' });
  assert.equal(result.status, 'ready'); assert.equal(result.settings.width, 1920); assert.equal(result.settings.height, 1080); assert.equal(video.srcObject, fixture.stream);
  camera.disconnect(); assert.equal(fixture.track.stopped, true); assert.equal(video.srcObject, null);
});
test('a late old getUserMedia result cannot replace or stop the newer selected camera', async () => {
  const first = deferred<MediaStream>(), second = deferred<MediaStream>(); const old = fakeTrack('old'), latest = fakeTrack('new'); let calls = 0;
  const camera = new CameraController(videoElement(new FakeVideo()), undefined, { mediaDevices: mediaDevices(() => ++calls === 1 ? first.promise : second.promise) });
  const pendingOld = camera.connect('old'); const oldFailure = assert.rejects(pendingOld, error => (error as { code: string }).code === 'CAMERA_CHANGED');
  const pendingNew = camera.connect('new'); second.resolve(latest.stream); await pendingNew;
  first.resolve(old.stream); await oldFailure;
  assert.equal(old.track.stopped, true); assert.equal(latest.track.stopped, false); assert.equal(camera.state.deviceLabel, 'new'); assert.equal(camera.stream, latest.stream); camera.disconnect();
});
test('disconnect invalidates a pending connection and stops its late stream', async () => {
  const pending = deferred<MediaStream>(), fixture = fakeTrack(); const video = new FakeVideo();
  const camera = new CameraController(videoElement(video), undefined, { mediaDevices: mediaDevices(() => pending.promise) });
  const connecting = camera.connect(); const failure = assert.rejects(connecting, error => (error as { code: string }).code === 'CAMERA_CHANGED');
  camera.disconnect(); pending.resolve(fixture.stream); await failure;
  assert.equal(fixture.track.stopped, true); assert.equal(camera.state.status, 'disconnected'); assert.equal(video.srcObject, null);
});
test('old device enumeration cannot overwrite newer device results', async () => {
  const a = deferred<MediaDeviceInfo[]>(), b = deferred<MediaDeviceInfo[]>(); let calls = 0;
  const camera = new CameraController(undefined, undefined, { mediaDevices: mediaDevices(async () => { throw new Error('Unused'); }, () => ++calls === 1 ? a.promise : b.promise) });
  const first = camera.enumerate(), second = camera.enumerate();
  const latest = [{ kind: 'videoinput', deviceId: 'new' }, { kind: 'audioinput', deviceId: 'microphone' }] as MediaDeviceInfo[];
  b.resolve(latest); assert.equal((await second)[0].deviceId, 'new');
  a.resolve([{ kind: 'videoinput', deviceId: 'old' }] as MediaDeviceInfo[]); const stale = await first;
  assert.equal(stale.length, 1); assert.equal(stale[0].deviceId, 'new');
});
test('permission, unavailable-device and busy-device errors explain recovery actions', async () => {
  const camera = new CameraController(videoElement(new FakeVideo()), undefined, { mediaDevices: mediaDevices(async () => { throw new DOMException('denied', 'NotAllowedError'); }) });
  await assert.rejects(camera.connect(), /privacy settings/); assert.equal(camera.state.status, 'error');
  assert.match(describeCameraError(new DOMException('busy', 'NotReadableError')).message, /Close other camera apps/);
  assert.match(describeCameraError(new DOMException('missing', 'NotFoundError')).message, /USB DSLR/);
});
test('a timed-out connection releases its late-arriving stream instead of leaking camera access', async () => {
  const pending = deferred<MediaStream>(), fixture = fakeTrack();
  const camera = new CameraController(videoElement(new FakeVideo()), undefined, { mediaDevices: mediaDevices(() => pending.promise), timeoutMs: 10 });
  await assert.rejects(camera.connect(), /did not start in time/); pending.resolve(fixture.stream); await tick();
  assert.equal(fixture.track.stopped, true); assert.equal(camera.stream, null);
});
test('capability validation rejects invented locks, unsupported modes, range overflow and wrong steps', () => {
  const caps = { exposureMode: ['manual', 'continuous'], exposureTime: { min: 1, max: 10, step: 0.5 }, torch: false };
  assert.deepEqual(supportedCameraSettings({ exposureMode: 'manual', exposureTime: 2 }, caps), { exposureMode: 'manual', exposureTime: 2 });
  const bad: Record<string, string | number | boolean>[] = [{ focusMode: 'manual' }, { exposureMode: 'auto-fiction' }, { exposureTime: 11 }, { exposureTime: 1.2 }, { torch: true }];
  for (const patch of bad) assert.throws(() => supportedCameraSettings(patch, caps));
});
test('silently ignored driver constraints are reported and actual settings remain visible', async () => {
  const fixture = fakeTrack('camera', { deviceId: 'a', width: 1920, height: 1080, exposureMode: 'continuous' }, { exposureMode: ['continuous', 'manual'] });
  fixture.track.applyConstraints = async () => {};
  const camera = new CameraController(videoElement(new FakeVideo()), undefined, { mediaDevices: mediaDevices(async () => fixture.stream) }); await camera.connect();
  await assert.rejects(camera.applySettings({ exposureMode: 'manual' }), /driver did not apply/); assert.equal((camera.settings as Record<string, unknown>).exposureMode, 'continuous'); camera.disconnect();
});
test('capture is serialized and each PNG uses a newly delivered native-size frame without guides', async () => {
  const fixture = fakeTrack(), video = new FakeVideo(); const draws: { version: number; width: number; height: number }[] = [];
  const makeCanvas = () => {
    const target = { width: 0, height: 0, version: 0, getContext: () => ({ drawImage: (source: FakeVideo, _x: number, _y: number, width: number, height: number) => { target.version = source.version; draws.push({ version: source.version, width, height }); } }),
      toBlob: (callback: BlobCallback) => callback(new Blob([JSON.stringify({ version: target.version, width: target.width, height: target.height })], { type: 'image/png' })) };
    return target as unknown as HTMLCanvasElement;
  };
  const camera = new CameraController(videoElement(video), undefined, { mediaDevices: mediaDevices(async () => fixture.stream), createCanvas: makeCanvas }); await camera.connect();
  const first = camera.capture(), second = camera.capture(); await tick(); assert.equal(video.callbacks.size, 1); assert.equal(draws.length, 0);
  video.deliverFrame(); const result1 = await first; await tick(); assert.equal(video.callbacks.size, 1);
  video.deliverFrame(); const result2 = await second;
  assert.deepEqual(draws, [{ version: 1, width: 1920, height: 1080 }, { version: 2, width: 1920, height: 1080 }]);
  assert.equal(result1.source.width, 1920); assert.equal(result2.source.height, 1080);
  assert.equal(JSON.parse(new TextDecoder().decode(result1.png)).version, 1); assert.equal(JSON.parse(new TextDecoder().decode(result2.png)).version, 2); camera.disconnect();
});
test('camera switch during a waiting capture discards the stale frame', async () => {
  const first = fakeTrack('a'), second = fakeTrack('b'), video = new FakeVideo(); let calls = 0;
  const camera = new CameraController(videoElement(video), undefined, { mediaDevices: mediaDevices(async () => ++calls === 1 ? first.stream : second.stream) }); await camera.connect('a');
  const capture = camera.capture(); const rejected = assert.rejects(capture, /camera changed/i); await tick();
  await camera.connect('b'); video.deliverFrame(); await rejected; assert.equal(camera.state.deviceLabel, 'b'); assert.equal(second.track.stopped, false); camera.disconnect();
});
test('unplug and stalled video produce actionable errors and do not fabricate a saved frame', async () => {
  const fixture = fakeTrack(), video = new FakeVideo(); const camera = new CameraController(videoElement(video), undefined, { mediaDevices: mediaDevices(async () => fixture.stream), timeoutMs: 10 }); await camera.connect();
  await assert.rejects(camera.capture(), /No stale frame was saved/); assert.equal(camera.state.status, 'error');
  fixture.track.onended?.(new Event('ended')); assert.equal(camera.stream, null); assert.match(camera.state.error ?? '', /USB cable/); camera.disconnect();
});
