'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const state = { frameCache: new Map(), frameCacheMax: 2, frameCacheGeneration: 0,
  timelineSeek: {}, frameCacheHandle: null, frameCachePending: false };
let finishBitmap;
let closed = 0;
const image = () => ({ close() { closed++; } });
const context = vm.createContext({ state, clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
  playback: { paused: true, readyState: 4, videoWidth: 3840, videoHeight: 2160, currentFrameCanvas: {} },
  els: { cacheStatus: { textContent: '', classList: { toggle() {} } },
    cacheCtx: { clearRect() {} }, cacheCanvas: { width: 960, height: 540, classList: { remove() {} } } },
  document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
  window: { createImageBitmap: true }, createImageBitmap: () => new Promise(resolve => { finishBitmap = resolve; })
});
vm.runInContext(source.slice(source.indexOf('  function updateCacheStatus('), source.indexOf('  function nearestCachedFrame(')), context);
(async () => {
  context.putCachedFrame(1, image()); context.putCachedFrame(2, image()); context.putCachedFrame(3, image());
  assert.deepEqual([...state.frameCache.keys()], [2, 3]);
  assert.equal(closed, 1);
  const pending = context.captureFrame(4);
  context.clearFrameCache();
  finishBitmap(image());
  await pending;
  assert.equal(state.frameCache.size, 0, 'Old media capture was inserted after switching');
  assert.equal(closed, 4, 'Evicted, cleared and stale bitmaps must all be closed');
  const next = context.captureFrame(5);
  finishBitmap(image()); await next;
  assert.ok(state.frameCacheMax * 960 * 540 * 4 <= 64 * 1024 * 1024);
  assert.equal(state.frameCache.size, 1);
  console.log('Frame cache tests passed: eviction, bitmap release, stale capture rejection, 4K preview memory bound.');
})().catch(error => { console.error(error); process.exitCode = 1; });
