'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
let now = 0, nextId = 0, display = 1, samples = 0;
const timers = new Map();
const classes = { contains: () => false, add() {}, remove() {} };
const ambient = { enabled: true, timer: null, sampleTimer: null, lastSample: -Infinity, steps: 0, canvas: { value: 0, classList: classes }, target: { value: 0 } };
const context = {
  ambient, Math, performance: { now: () => now },
  setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  document: { hidden: false, body: { classList: classes }, documentElement: { style: { setProperty() {}, removeProperty() {} } } },
  playback: { readyState: 2, videoWidth: 100 },
  state: { lumaMode: false }, els: { video: {}, cacheCanvas: { classList: classes }, colorCanvas: {} },
  topbarAmbientCtx: { clearRect() {}, drawImage() {} },
  ambientCtx: {
    globalAlpha: 1,
    clearRect() { ambient.canvas.value = 0; },
    drawImage(target) { ambient.canvas.value += (target.value - ambient.canvas.value) * this.globalAlpha; },
    getImageData() { return { data: new Uint8ClampedArray(64 * 36 * 4) }; }
  },
  ambientTargetCtx: { drawImage() { ambient.target.value = display; samples++; } },
  scheduleColorRender() { context.sampleAmbient(); }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function cancelAmbientSampling()'), source.indexOf('  function setAmbientEnabled')), context);
function advance(until) {
  for (;;) {
    const entry = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
    if (!entry || entry[1].at > until) break;
    now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
  }
  now = until;
}
context.sampleAmbient();
advance(30); display = 0.4; context.sampleAmbient();
advance(60); display = 0.8; context.sampleAmbient();
assert.equal(samples, 1);
advance(160); assert.equal(samples, 2); assert.equal(ambient.target.value, 0.8);
advance(1000); assert.equal(ambient.canvas.value, 0.8); assert.equal(timers.size, 0);
// Last update after a pause must settle completely, including a fade to black.
display = 0; context.sampleAmbient(); advance(2000);
assert.equal(ambient.canvas.value, 0);
// Reset must cancel both blending and any deferred sample.
context.sampleAmbient(); advance(2030); display = 1; context.sampleAmbient();
const count = samples; context.resetAmbient(); advance(3000);
assert.equal(samples, count); assert.equal(timers.size, 0); assert.equal(ambient.canvas.value, 0);
console.log('Ambient tests passed: latest sample, exact settling, black frame, reset cancellation.');
