'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const events = new Map();
let directory, timer, active = true, writes = Promise.resolve();
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const runId = `${startedAt.replace(/[:.]/g, '-')}-${process.pid}`;
let context = {};
function mark(name, detail) {
  if (!active || events.has(name)) return;
  events.set(name, { name, ms: Math.round(performance.now() * 100) / 100, ...(detail ? { detail } : {}) });
  if (events.has('window.shown')) schedule();
}
function configure(userData, metadata) {
  directory = path.join(userData, 'startup-traces');
  context = metadata;
  const deadline = setTimeout(() => { active = false; flush(); }, 60000);
  deadline.unref();
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(flush, 2000);
  timer.unref();
}
function flush() {
  clearTimeout(timer);
  if (!directory) return writes;
  const list = [...events.values()].sort((a, b) => a.ms - b.ms);
  const span = (from, to) => events.has(from) && events.has(to)
    ? Math.round((events.get(to).ms - events.get(from).ms) * 100) / 100 : null;
  const payload = JSON.stringify({ runId, startedAt, ...context,
    clock: 'Milliseconds from Node performance time origin; excludes OS launch work before Node. Renderer marks are main-process IPC receipt times.',
    spansMs: {
      mainEntryToShown: span('main.entry', 'window.shown'),
      mainEntryToFullOpacity: span('main.entry', 'window.full-opacity'),
      mainEntryToFirstFrame: span('main.entry', 'renderer.first-frame'),
      sharedTextureImport: span('texture.import-start', 'texture.import-end'),
      sharedTextureSend: span('texture.send-start', 'texture.send-end'),
      rendererGpuInitialization: span('renderer.gpu-start', 'renderer.gpu-end'),
      windowConstruction: span('window.create-start', 'window.created'),
      nativeModuleAndDllLoad: span('core.load-start', 'core.load-end'),
      nativeConstruction: span('session.construct-start', 'session.construct-end'),
      nativeInitialization: span('session.construct-end', 'session.ready'),
      descriptorAndLaunchState: span('launch.describe-start', 'launch.state-ready'),
      compositorPresentation: span('compositor.start', 'compositor.end'),
      nativeFade: span('window.shown', 'window.full-opacity'),
      mediaOpenToFirstFrame: span('media.open', 'renderer.first-frame'),
      fileLoadedToMetadata: span('media.file-loaded', 'media.metadata-ready'),
      firstNativeRender: span('texture.render-start', 'texture.render-end')
    }, events: list }, null, 2) + '\n';
  writes = writes.then(async () => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${runId}.json`), payload);
    await fs.writeFile(path.join(directory, 'latest.json'), payload);
    const names = (await fs.readdir(directory)).filter(name => /^\d{4}-.*-\d+\.json$/.test(name)).sort();
    for (const name of names.slice(0, -20)) await fs.unlink(path.join(directory, name)).catch(() => {});
  }).catch(error => console.warn('Unable to write startup trace:', error.message));
  return writes;
}
module.exports = { mark, configure, flush };
