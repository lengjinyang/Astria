'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../electron/media-service.cjs'), 'utf8');
const events = [], delivered = [], renders = [], released = [];
let opening = false, restarted = false, reads = 0;
class Player {
  async initialize() {}
  getInfo() {
    if (!opening) return { 'mpv-version': 'mpv 0.41.0' };
    assert.ok(restarted, 'Metadata query would block the first render callback');
    reads++;
    return { width: 1920, height: 1080, duration: 3, 'container-fps': 24, 'time-pos': .5 };
  }
  setEventCallback() {} setUpdateCallback() {} pause() {} setFps() {} destroy() {}
  open() { opening = true; return '1'; }
  pollEvents() { return events.splice(0); }
  seek(time) { this.seekTime = time; }
  async renderSharedTexture(width, height) { renders.push({ width, height }); return { slotId: 0 }; }
  releaseSharedTexture(slot) { released.push(slot); }
}
const context = vm.createContext({ randomUUID: () => 'session', integer: value => value,
  startupTrace: { mark() {} }, sharedTexture: {
    importSharedTexture({ allReferencesReleased }) { return { release: allReferencesReleased }; },
    async sendSharedTexture(_target, _id, metadata) { delivered.push({ type: 'texture', ...metadata }); }
  }
});
vm.runInContext(source.slice(source.indexOf('class Session'), source.indexOf('\nmodule.exports')) + '\nthis.Session = Session;', context);
(async () => {
  const owner = { mainFrame: {}, isDestroyed: () => false, send: (_channel, payload) => delivered.push(payload) };
  const catalog = { source: async () => ({ source: 'C:\\video.mp4', descriptor: { mediaKind: 'video' } }), release: async () => {} };
  const session = new context.Session({ MpvPlayer: Player }, owner, catalog);
  await session.ready;
  await session.open('video:1', 24, .5);
  events.push({ type: 'file-loaded', playlistEntryId: '1' }, { type: 'video-reconfig', playlistEntryId: '1' });
  session.events();
  await session.pumping;
  assert.equal(reads, 0);
  assert.ok(renders.length > 0, 'The first render must advance mpv');
  assert.equal(delivered.filter(e => e.type === 'texture' || e.type === 'frame').length, 0, 'Provisional pixels leaked');
  assert.equal(released.length, renders.length, 'Provisional texture slots leaked');
  session.seek(1, 'video:1');
  assert.equal(session.player.seekTime, undefined, 'Seek must wait for initial metadata');
  restarted = true;
  events.push({ type: 'playback-restart', playlistEntryId: '1' });
  session.events();
  await session.pumping;
  assert.equal(reads, 1, 'Read initial metadata once');
  assert.equal(session.player.seekTime, 1);
  assert.deepEqual(delivered.filter(e => ['metadata', 'texture', 'frame'].includes(e.type)).map(e => e.type), ['metadata', 'texture', 'frame']);
  assert.equal(delivered.find(e => e.type === 'frame').width, 1920);
  assert.equal(delivered.find(e => e.type === 'frame').height, 1080);
  await session.destroy();
  const renderer = vm.createContext({ EventTarget, CustomEvent, performance,
    window: { desktopAPI: { media: {} } }, document: { createElement: () => ({}) }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../playback-adapter.js'), 'utf8'), renderer);
  const adapter = new renderer.window.AstriaPlayback.LibmpvAdapter();
  adapter.generation = 2;
  adapter.onState({ type: 'metadata', openToken: 1, media: { width: 2, height: 2 } });
  assert.equal(adapter.readyState, 0, 'Stale metadata crossed a fast reopen');
  assert.equal(adapter.acceptFrame({ openToken: 1, frameId: 100 }), false);
  assert.equal(adapter.lastFrameId, -1, 'Stale texture consumed a current frame ID');
  assert.equal(adapter.acceptFrame({ openToken: 2, frameId: 101 }), true);
  console.log('MEDIA_FIRST_FRAME_TEST_PASSED');
})().catch(error => { console.error(error); process.exitCode = 1; });
