'use strict';
const { ipcMain, sharedTexture } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function runtimePath(app) {
  if (!app.isPackaged) return path.join(__dirname, '../native/runtime/win32-x64');
  const directory = path.join(process.resourcesPath, 'mpv');
  return fs.existsSync(directory) ? directory : path.join(process.resourcesPath, 'win32-x64');
}
function loadCore(app) {
  try {
    const core = require(path.join(runtimePath(app), 'astria_mpv.node'));
    const probe = new core.MpvPlayer({ mode: 'software' });
    try {
      const version = probe.getInfo()['mpv-version'];
      if (!/^mpv (?:v)?0\.41\.0(?:\s|$)/.test(version || '')) throw new Error(`需要 mpv 0.41.0，实际为 ${version}`);
    } finally { probe.destroy(); }
    return core;
  } catch (error) { throw new Error(`播放核心缺失或损坏：${error.message}`); }
}
function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('无效播放参数');
  return value;
}
function operationId(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff) throw new Error('无效帧操作标识');
  return value;
}
function sessionOptions(value) {
  if (value === undefined) return { purpose: 'playback', maxWidth: null, maxHeight: null };
  const purpose = value && typeof value === 'object' ? value.purpose || 'playback' : null;
  if (!['playback','scrub'].includes(purpose)) throw new Error('无效媒体会话配置');
  const scrub = purpose === 'scrub';
  return {
    purpose,
    maxWidth: scrub ? Math.round(number(value.maxWidth ?? 960, 64, 1920)) : null,
    maxHeight: scrub ? Math.round(number(value.maxHeight ?? 540, 64, 1080)) : null
  };
}

class MediaService {
  constructor(app, catalog, getWindow) {
    this.app = app; this.catalog = catalog; this.getWindow = getWindow; this.sessions = new Map();
    this.core = null;
    const handlers = {
      create: async (event, options) => {
        if (this.sessions.size >= 4) throw new Error('媒体会话数量已达上限');
        this.core ||= loadCore(app);
        const session = new Session(this.core, event.sender, catalog, sessionOptions(options));
        this.sessions.set(session.id, session);
        return session.id;
      },
      open: (event, id, mediaId, fps) => this.session(event, id).open(mediaId, number(fps, 1, 240)),
      play: (event, id) => this.session(event, id).player.play(),
      pause: (event, id) => this.session(event, id).player.pause(),
      seek: (event, id, seconds, op) => this.session(event, id).seek(number(seconds, 0, 1e10), operationId(op)),
      step: (event, id, direction, op) => { if (direction !== -1 && direction !== 1) throw new Error('无效逐帧方向'); return this.session(event, id).step(direction, operationId(op)); },
      setSpeed: (event, id, speed) => this.session(event, id).player.setSpeed(number(speed, 0.01, 100)),
      setVolume: (event, id, volume) => this.session(event, id).player.setVolume(number(volume, 0, 1) * 100),
      setMuted: (event, id, muted) => { if (typeof muted !== 'boolean') throw new Error('无效静音参数'); this.session(event, id).player.setMuted(muted); },
      captureFrame: (event, id) => this.session(event, id).captureFrame(),
      destroy: async (event, id) => { await this.session(event, id).destroy(); this.sessions.delete(id); }
    };
    for (const [command, handler] of Object.entries(handlers)) {
      ipcMain.handle(`media:${command}`, (event, ...args) => {
        if (this.closing) return;
        const window = this.getWindow();
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('媒体会话访问被拒绝');
        return handler(event, ...args);
      });
    }
  }
  session(event, id) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== event.sender) throw new Error('无效媒体会话');
    return session;
  }
  async dispose() { this.closing = true; await Promise.all([...this.sessions.values()].map(s => s.destroy())); this.sessions.clear(); }
}

class Session {
  constructor(core, owner, catalog, options) {
    this.id = randomUUID(); this.core = core; this.owner = owner; this.catalog = catalog;
    this.options = options;
    this.mode = sharedTexture && process.env.ASTRIA_RENDER_BACKEND !== 'software' ? 'shared-texture' : 'software'; this.closed = false; this.pending = false;
    try { this.player = new core.MpvPlayer({ mode: this.mode }); }
    catch (error) {
      if (this.mode !== 'shared-texture') throw error;
      this.mode = 'software'; this.player = new core.MpvPlayer({ mode: this.mode });
    }
    this.attach();
  }
  attach() {
    this.player.setEventCallback(() => this.events());
    this.player.setUpdateCallback(() => this.queueFrame());
    this.events();
  }
  send(type, data = {}) { if (!this.closed && !this.owner.isDestroyed()) this.owner.send('media:state', { id: this.id, type, ...data }); }
  async open(mediaId, fps) {
    const generation = this.generation = (this.generation || 0) + 1;
    const entry = await this.catalog.source(mediaId, fps);
    if (this.closed || generation !== this.generation) return;
    this.descriptor = entry.descriptor; this.source = entry.source; this.projectFps = fps; this.loaded = false;
    this.pendingOperation = null; this.frameOperation = null;
    this.send('loading'); this.player.pause(); this.player.setFps(fps); this.loadId = this.player.open(this.source);
    return this.descriptor;
  }
  seek(seconds, operation) {
    this.pendingOperation = operation === null ? null : { id: operation, direction: 0 };
    this.stepPending = false;
    this.player.seek(seconds);
  }
  step(direction, operation) {
    this.pendingOperation = operation === null ? null : { id: operation, direction };
    this.stepPending = true;
    this.player.step(direction);
  }
  finishOperation() {
    if (this.pendingOperation !== null) {
      this.frameOperation = this.pendingOperation;
      this.pendingOperation = null;
    }
  }
  renderSize() {
    const width = this.descriptor?.width || 0, height = this.descriptor?.height || 0;
    if (!width || !height || this.options.purpose !== 'scrub') return { width, height };
    const scale = Math.min(1, this.options.maxWidth / width, this.options.maxHeight / height);
    return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
  }
  events() {
    if (this.closed) return;
    for (const event of this.player.pollEvents()) {
      if (event.playlistEntryId && this.loadId && event.playlistEntryId !== this.loadId) continue;
      if (event.error) { this.send('error', { message: `无法解复用或解码此媒体（容器/编码不受支持或文件损坏）：${event.error}` }); continue; }
      if (event.type === 'file-loaded') {
        const info = this.player.getInfo(); this.loaded = true;
        Object.assign(this.descriptor, { width: info.width || 0, height: info.height || 0,
          duration: this.descriptor.mediaKind === 'sequence' ? this.descriptor.duration : info.duration || 0,
          codec: info['video-codec'], container: info['file-format'] });
        if (this.descriptor.mediaKind === 'video') {
          this.descriptor.sourceFps = info['container-fps'] || 24;
          this.descriptor.fps = this.descriptor.sourceFps;
          this.descriptor.totalFrames = Math.max(1, Math.round(this.descriptor.duration * this.descriptor.sourceFps));
        }
        if (this.descriptor.width && this.descriptor.height) this.send('metadata', { media: this.descriptor, backend: this.mode });
        this.queueFrame();
        if (this.restore) {
          const restore = this.restore; this.restore = null;
          this.player.seek(restore.position); if (!restore.paused) this.player.play();
        }
      }
      if (event.type === 'video-reconfig' && this.loaded) {
        const info = this.player.getInfo();
        if (info.width && info.height && (this.descriptor.width !== info.width || this.descriptor.height !== info.height)) {
          Object.assign(this.descriptor, { width: info.width, height: info.height });
          this.send('metadata', { media: this.descriptor, backend: this.mode });
        }
        this.queueFrame();
      }
      if (event.type === 'property-change') {
        if (event.name === 'pause') { this.paused = event.data; this.send(event.data ? 'paused' : 'playing'); }
        if (event.name === 'time-pos' && typeof event.data === 'number') {
          this.time = event.data;
          if (this.stepPending) { this.seeked = true; this.stepPending = false; this.finishOperation(); this.queueFrame(); }
        }
        if (event.name === 'eof-reached' && event.data) this.send('ended');
      }
      if (event.type === 'playback-restart') { this.seeked = true; if (!this.stepPending) this.finishOperation(); this.queueFrame(); }
    }
  }
  queueFrame() {
    this.pending = true;
    if (this.pumping || !this.loaded || this.closed) return;
    this.pumping = this.pump().finally(() => { this.pumping = null; if (this.pending && !this.closed) this.queueFrame(); });
  }
  async pump() {
    while (this.pending && !this.closed) {
      this.pending = false;
      const completedOperation = this.frameOperation;
      const completedTime = this.time || 0;
      const { width, height } = this.renderSize();
      if (!width || !height) return;
      try {
        if (this.mode === 'shared-texture') {
          let texture;
          const released = new Promise(resolve => {
            texture = sharedTexture.importSharedTexture({ textureInfo: this.player.renderSharedTexture(width, height), allReferencesReleased: resolve });
          });
          try { await sharedTexture.sendSharedTexture({ frame: this.owner.mainFrame, importedSharedTexture: texture }, this.id); }
          finally { texture.release(); }
          await released;
        } else {
          const frame = this.player.renderFrame(width, height);
          this.owner.send('media:frame', { id: this.id, ...frame });
        }
        this.send('frame', { time: completedTime, seeked: !!this.seeked, operationId: completedOperation?.id ?? null,
          direction: completedOperation?.direction ?? 0,
          outputWidth: width, outputHeight: height });
        if (this.frameOperation === completedOperation) this.frameOperation = null;
        this.seeked = false;
      } catch (error) {
        if (this.mode === 'shared-texture' && !this.closed) {
          const position = this.time || 0, paused = this.paused;
          this.player.setEventCallback(); this.player.setUpdateCallback(); this.player.destroy();
          this.mode = 'software'; this.player = new this.core.MpvPlayer({ mode: 'software' });
          this.attach(); this.restore = { position, paused };
          await this.open(this.descriptor.mediaId, this.projectFps || this.descriptor.fps);
          return;
        }
        this.send('error', { message: `输出画面失败：${error.message}` }); return;
      }
    }
  }
  captureFrame() {
    if (!this.loaded) throw new Error('尚无可抓取画面');
    const { width, height } = this.renderSize();
    if (this.mode !== 'software') return { currentCanvas: true, width, height };
    return this.player.renderFrame(width, height);
  }
  async destroy() {
    if (this.closed) return;
    this.closed = true; this.player.setEventCallback(); this.player.setUpdateCallback();
    if (this.pumping) await this.pumping;
    this.player.destroy();
  }
}
module.exports = { MediaService, runtimePath, loadCore };
