'use strict';
// Run with Electron. A fresh profile measures an uncached first open without
// touching the user's workspaces. Optional argument: a local video path.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// The general smoke maximizes at ready-to-show, which implicitly reveals the
// window. Benchmark the normal file-launch reveal instead.
BrowserWindow.prototype.maximize = function () {};
const media = path.resolve(process.argv[2] || '.cache/media/h264.mp4');
const profile = path.resolve('.cache', `startup-smoke-${Date.now()}-${process.pid}`);
const watchdog = setTimeout(() => { console.error('STARTUP_SMOKE_TIMEOUT'); app.exit(1); }, 25000);
const smoke = require.resolve('./desktop-smoke.cjs');
require(smoke);
require.cache[smoke].exports = async (window, catalog) => {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const p = window.__astriaPlayback;
    const wait = (condition, label) => new Promise((resolve, reject) => {
      const started = performance.now();
      const tick = () => condition() ? resolve() : p.error ? reject(Error(p.error.message)) :
        performance.now() - started > 15000 ? reject(Error(label)) : setTimeout(tick, 10);
      tick();
    });
    await wait(() => p.readyState >= 2, 'First frame timeout');
    await window.desktopAPI.whenWindowShown();
    await wait(() => !p.paused, 'Autoplay timeout');
    const firstTime = p.currentTime;
    await wait(() => p.currentTime >= firstTime + .5, 'Playback did not advance');
    p.pause();
    await wait(() => p.paused, 'Pause timeout');
    p.seek(.5);
    await wait(() => !p.seeking && Math.abs(p.currentTime - .5) < .1, 'Seek timeout');
    const canvas = await p.captureFrame();
    const sample = document.createElement('canvas'); sample.width = 32; sample.height = 18;
    const ctx = sample.getContext('2d'); ctx.drawImage(canvas, 0, 0, 32, 18);
    const pixels = [...ctx.getImageData(0, 0, 32, 18).data];
    if (!pixels.some((v, i) => i % 4 !== 3 && v > 16)) throw Error('Blank first video');
    if (document.body.classList.contains('media-loading')) throw Error('Loading overlay remained');
    const context = p.presenter?.gl || p.presenter?.context;
    if (context?.getContextAttributes().desynchronized) throw Error('Unsynchronized presentation');
    return { width: canvas.width, height: canvas.height, pixels };
  })()`);
  await require('../electron/startup-trace.cjs').flush();
  const trace = JSON.parse(fs.readFileSync(path.join(profile, 'startup-traces/latest.json')));
  if (trace.events.find(event => event.name === 'launch.state-ready')?.detail?.poster) throw Error('First open used a cached poster');
  const next = await catalog.describe(path.resolve('.cache/media', path.basename(media) === 'prores.mov' ? 'h264.mp4' : 'prores.mov'));
  const reopen = async descriptor => {
    await window.webContents.executeJavaScript(`(() => {
      const p = window.__astriaPlayback, start = performance.now();
      window.__startupOpenResult = null;
      const frame = () => {
        if (p.media?.mediaId !== ${JSON.stringify(descriptor.mediaId)} || p.readyState < 2) return;
        p.removeEventListener('frame', frame);
        window.__startupOpenResult = { ms: performance.now() - start, time: p.currentTime,
          width: p.surface.width, height: p.surface.height,
          loadingVisible: getComputedStyle(document.querySelector('.media-loading-indicator')).visibility === 'visible' &&
            getComputedStyle(document.querySelector('.media-loading-indicator')).display !== 'none' };
      };
      p.addEventListener('frame', frame);
    })()`);
    window.webContents.send('vfx:open-video-from-system', descriptor);
    return window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const start = performance.now();
      const tick = () => window.__startupOpenResult ? resolve(window.__startupOpenResult) :
        performance.now() - start > 10000 ? reject(Error('Reopen timeout')) : setTimeout(tick, 10);
      tick();
    })`);
  };
  const inApp = await reopen(next);
  const resumed = await reopen(await catalog.describe(media));
  if (inApp.width <= 2 || resumed.width <= 2) throw Error('Provisional frame was exposed');
  if (Math.abs(resumed.time - .5) > .1) throw Error(`Remembered position changed: ${resumed.time}`);
  fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify({ media, ...result, trace, inApp, resumed }, null, 2));
  console.log('STARTUP_SMOKE_PASSED', JSON.stringify({ media, profile, width: result.width, height: result.height, spansMs: trace.spansMs, inApp, resumed }));
  clearTimeout(watchdog);
  app.quit();
};
process.argv.push('--smoke-test', media);
require('../electron/main.cjs');
app.setPath('userData', profile);
