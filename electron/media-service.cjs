'use strict';
const startupTrace = require('./startup-trace.cjs');
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
    return require(path.join(runtimePath(app), 'astria_mpv.node'));
  } catch (error) { throw new Error(`播放核心缺失或损坏：${error.message}`); }
}
function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('无效播放参数');
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('无效播放参数');
  return value;
}

class MediaService {
  constructor(app, catalog, getWindow) {
    this.app = app; this.catalog = catalog; this.getWindow = getWindow; this.sessions = new Map();
    this.core = null;
    const handlers = {
      create: async event => {
        if (this.sessions.size >= 4) throw new Error('媒体会话数量已达上限');
        startupTrace.mark('core.load-start');
        this.core ||= loadCore(app);
        startupTrace.mark('core.load-end');
        startupTrace.mark('session.construct-start');
        const session = new Session(this.core, event.sender, catalog);
        startupTrace.mark('session.construct-end');
        this.sessions.set(session.id, session);
        try {
          await session.ready;
          startupTrace.mark('session.ready');
          if (this.closing || session.closed || event.sender.isDestroyed()) throw new Error('Media session closed');
          return session.id;
        } catch (error) {
          startupTrace.mark('session.error');
          await session.destroy();
          this.sessions.delete(session.id);
          throw error;
        }
      },
      open: (event, id, mediaId, fps, startTime = 0) => this.session(event, id).open(mediaId, number(fps, 1, 240), number(startTime, 0, 1e10)),
      play: (event, id) => this.session(event, id).player.play(),
      pause: (event, id) => this.session(event, id).player.pause(),
      stop: (event, id) => this.session(event, id).player.stop(),
      seek: (event, id, seconds) => this.session(event, id).player.seek(number(seconds, 0, 1e10)),
      step: (event, id, direction) => { if (direction !== -1 && direction !== 1) throw new Error('无效逐帧方向'); const session = this.session(event, id); session.stepPending = true; session.player.step(direction); },
      setSpeed: (event, id, speed) => this.session(event, id).player.setSpeed(number(speed, 0.01, 100)),
      setVolume: (event, id, volume) => this.session(event, id).player.setVolume(number(volume, 0, 1) * 100),
      setMuted: (event, id, muted) => { if (typeof muted !== 'boolean') throw new Error('无效静音参数'); this.session(event, id).player.setMuted(muted); },
      setOutputTarget: (event, id, target) => this.session(event, id).setOutputTarget(target),
      requestSourceFrame: (event, id, request) => this.session(event, id).requestSourceFrame(request),
      captureFrame: (event, id) => this.session(event, id).captureFrame(),
      destroy: async (event, id) => { await this.session(event, id).destroy(); this.sessions.delete(id); },
      destroyAll: async event => {
        const owned = [...this.sessions.values()].filter(session => session.owner === event.sender);
        await Promise.all(owned.map(session => session.destroy()));
        for (const session of owned) this.sessions.delete(session.id);
      }
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
  setWindowInteraction(active) {
    for (const session of this.sessions.values()) session.setWindowInteraction(!!active);
  }
  setPresentationSuspended(suspended) {
    for (const session of this.sessions.values()) session.setPresentationSuspended(!!suspended);
  }
  async dispose() { this.closing = true; await Promise.all([...this.sessions.values()].map(s => s.destroy())); this.sessions.clear(); }
}

class Session {
  constructor(core, owner, catalog) {
    this.id = randomUUID(); this.core = core; this.owner = owner; this.catalog = catalog;
    if (!sharedTexture) throw new Error('当前 Electron 运行时不支持 GPU 共享纹理');
    this.mode = 'shared-texture'; this.closed = false; this.pending = false;
    this.outputTarget = { width: 0, height: 0, mode: 'source', revision: 0 };
    this.exactFrames = []; this.frameId = 0; this.inFlight = 0; this.releases = new Set(); this.windowInteraction = false; this.lockedOutputTarget = null; this.framePresentable = false;
    this.player = new core.MpvPlayer({ mode: this.mode, deferInitialization: true });
    this.ready = this.initialize();
  }
  async initialize() {
    await this.player.initialize();
    if (this.closed || this.owner.isDestroyed()) throw new Error('Media session closed');
    const version = this.player.getInfo()['mpv-version'];
    if (!/^mpv (?:v)?0\.41\.0(?:\s|$)/.test(version || '')) {
      throw new Error(`需要 mpv 0.41.0，实际为 ${version}`);
    }
    this.attach();
  }
  attach() {
    this.player.setEventCallback(() => this.events());
    this.player.setUpdateCallback(() => this.queueFrame());
    this.events();
  }
  send(type, data = {}) { if (!this.closed && !this.owner.isDestroyed()) this.owner.send('media:state', { id: this.id, type, ...data }); }
  async open(mediaId, fps, startTime = 0) {
    startupTrace.mark('media.open');
    const generation = this.generation = (this.generation || 0) + 1;
    if (this.mediaId && this.mediaId !== mediaId) await this.catalog.release(this.mediaId, this.id);
    this.mediaId = mediaId;
    let entry;
    try { entry = await this.catalog.source(mediaId, fps, this.id); }
    catch (error) {
      if (this.mediaId === mediaId) { await this.catalog.release(mediaId, this.id); this.mediaId = null; }
      throw error;
    }
    if (this.closed || generation !== this.generation) {
      if (this.mediaId !== mediaId) await this.catalog.release(mediaId, this.id);
      return;
    }
    this.descriptor = entry.descriptor; this.source = entry.source; this.loaded = false; this.framePresentable = false; this.startTime = startTime;
    this.send('loading'); this.player.pause(); this.player.setFps(fps); this.loadId = this.player.open(this.source, startTime);
    return this.descriptor;
  }
  events() {
    if (this.closed) return;
    for (const event of this.player.pollEvents()) {
      if (event.playlistEntryId && this.loadId && event.playlistEntryId !== this.loadId) continue;
      if (event.error) { this.send('error', { message: `无法解复用或解码此媒体（容器/编码不受支持或文件损坏）：${event.error}` }); continue; }
      if (event.type === 'file-loaded') {
        startupTrace.mark('media.file-loaded');
        const info = this.player.getInfo(); this.loaded = true;
        this.time = Number.isFinite(info['time-pos']) ? info['time-pos'] : this.startTime;
        Object.assign(this.descriptor, { width: info.width || 0, height: info.height || 0,
          duration: this.descriptor.mediaKind === 'sequence' ? this.descriptor.duration : info.duration || 0,
          codec: info['video-codec'], container: info['file-format'], hardwareDecoder: info['hwdec-current'] || 'none' });
        if (this.descriptor.mediaKind === 'video') {
          this.descriptor.sourceFps = info['container-fps'] || 24;
          this.descriptor.fps = this.descriptor.sourceFps;
          this.descriptor.totalFrames = Math.max(1, Math.round(this.descriptor.duration * this.descriptor.sourceFps));
        }
        if (this.descriptor.width && this.descriptor.height) this.send('metadata', { media: this.descriptor, backend: this.mode, time: this.time });
        this.queueFrame();
        if (this.restore) {
          const restore = this.restore; this.restore = null;
          this.player.seek(restore.position); if (!restore.paused) this.player.play();
        }
      }
      if (event.type === 'video-reconfig' && this.loaded) {
        const info = this.player.getInfo();
        let metadataChanged = false;
        if (info.width && info.height && (this.descriptor.width !== info.width || this.descriptor.height !== info.height)) {
          Object.assign(this.descriptor, { width: info.width, height: info.height });
          metadataChanged = true;
        }
        const hardwareDecoder = info['hwdec-current'] || 'none';
        if (this.descriptor.hardwareDecoder !== hardwareDecoder) {
          this.descriptor.hardwareDecoder = hardwareDecoder;
          metadataChanged = true;
        }
        if (metadataChanged) this.send('metadata', { media: this.descriptor, backend: this.mode });
        this.queueFrame();
      }
      if (event.type === 'property-change') {
        if (event.name === 'pause') { this.paused = event.data; this.send(event.data ? 'paused' : 'playing'); }
        if (event.name === 'time-pos' && typeof event.data === 'number') {
          this.time = event.data;
          if (this.stepPending) { this.seeked = true; this.stepPending = false; this.queueFrame(); }
        }
        if (event.name === 'eof-reached' && event.data) this.send('ended');
      }
      if (event.type === 'playback-restart') {
        this.framePresentable = true;
        const hardwareDecoder = this.player.getInfo()['hwdec-current'] || 'none';
        if (this.descriptor.hardwareDecoder !== hardwareDecoder) {
          this.descriptor.hardwareDecoder = hardwareDecoder;
          this.send('metadata', { media: this.descriptor, backend: this.mode });
        }
        this.seeked = true; this.queueFrame();
      }
    }
  }
  setOutputTarget(target) {
    if (!target || typeof target !== 'object' || !['viewport', 'source', 'scrub'].includes(target.mode)) throw new Error('无效输出目标');
    const next = {
      width: integer(target.width, 2, 16384),
      height: integer(target.height, 2, 16384),
      mode: target.mode,
      revision: integer(target.revision, 0, Number.MAX_SAFE_INTEGER)
    };
    if (next.revision < this.outputTarget.revision) return;
    const changed = next.width !== this.outputTarget.width || next.height !== this.outputTarget.height ||
      next.mode !== this.outputTarget.mode || next.revision !== this.outputTarget.revision;
    this.outputTarget = next;
    if (changed && !this.windowInteraction) this.queueFrame();
  }
  setWindowInteraction(active) {
    if (this.windowInteraction === active) return;
    this.windowInteraction = active;
    if (active) this.lockedOutputTarget = { ...this.outputTarget };
    else {
      this.lockedOutputTarget = null;
    }
  }
  setPresentationSuspended(suspended) {
    if (this.presentationSuspended === suspended) return;
    this.presentationSuspended = suspended;
    if (!suspended) this.queueFrame();
  }
  requestSourceFrame(request) {
    if (!request || typeof request !== 'object') throw new Error('无效源帧请求');
    const operationId = integer(request.operationId, 1, Number.MAX_SAFE_INTEGER);
    const purpose = String(request.purpose || 'exact');
    if (!['exact', 'pause', 'capture', 'pixel-check'].includes(purpose)) throw new Error('无效源帧用途');
    return new Promise((resolve, reject) => {
      this.exactFrames.push({ operationId, purpose, resolve, reject, source: true });
      this.queueFrame(false);
    });
  }
  outputDimensions(request) {
    const sourceWidth = Math.max(2, this.descriptor.width || 2);
    const sourceHeight = Math.max(2, this.descriptor.height || 2);
    if (request?.source) return { width: sourceWidth, height: sourceHeight, mode: 'source', revision: this.outputTarget.revision };
    const target = this.lockedOutputTarget || this.outputTarget;
    if (target.mode === 'source' || !target.width || !target.height) return { width: sourceWidth, height: sourceHeight, mode: 'source', revision: target.revision };
    const scale = Math.min(1, target.width / sourceWidth, target.height / sourceHeight);
    const even = value => Math.max(2, Math.round(value / 2) * 2);
    return { width: even(sourceWidth * scale), height: even(sourceHeight * scale), mode: target.mode, revision: target.revision };
  }
  queueFrame(markPending = true) {
    if (markPending) this.pending = true;
    if (this.pumping || !this.loaded || this.closed || this.presentationSuspended) return;
    this.pumping = this.pump().finally(() => {
      this.pumping = null;
      if ((this.pending || this.exactFrames.length) && !this.closed && !this.waitingForSlot) this.queueFrame(false);
    });
  }
  async pump() {
    while ((this.pending || this.exactFrames.length) && !this.closed) {
      const request = this.exactFrames.length ? this.exactFrames.shift() : null;
      if (!request) this.pending = false;
      const { width, height, mode, revision } = this.outputDimensions(request);
      const presentable = this.framePresentable;
      if (!width || !height) return;
      try {
        const metadata = {
          id: this.id,
          frameId: ++this.frameId,
          operationId: request?.operationId || null,
          purpose: request?.purpose || mode,
          mediaTime: this.time || 0,
          outputRevision: revision,
          width,
          height
        };
        if (this.mode === 'shared-texture') {
          const renderPlayer = this.player;
          const textureInfo = await renderPlayer.renderSharedTexture(width, height);
          if (textureInfo?.busy) {
            this.frameId -= 1;
            if (request) this.exactFrames.unshift(request); else this.pending = true;
            this.waitingForSlot = true;
            return;
          }
          const slotId = Number.isInteger(textureInfo?.slotId) ? textureInfo.slotId : null;
          let texture, releasedResolve;
          const released = new Promise(resolve => {
            releasedResolve = resolve;
          });
          this.releases.add(released);
          const releaseSlot = () => {
            if (slotId !== null) renderPlayer.releaseSharedTexture(slotId);
            this.inFlight = Math.max(0, this.inFlight - 1);
            this.waitingForSlot = false;
            this.releases.delete(released);
            releasedResolve();
            if (!this.closed) this.queueFrame(false);
          };
          try {
            startupTrace.mark('texture.import-start');
            texture = sharedTexture.importSharedTexture({ textureInfo, allReferencesReleased: releaseSlot });
            startupTrace.mark('texture.import-end');
            this.inFlight += 1;
          } catch (error) {
            if (slotId !== null) renderPlayer.releaseSharedTexture(slotId);
            this.releases.delete(released);
            releasedResolve();
            throw error;
          }
          startupTrace.mark('texture.send-start');
          try { await sharedTexture.sendSharedTexture({ frame: this.owner.mainFrame, importedSharedTexture: texture }, this.id, metadata); }
          finally { texture.release(); }
          startupTrace.mark('texture.send-end');
          // macOS and the diagnostic single-texture path do not expose slots.
          if (slotId === null) await released;
        } else {
          const frame = this.player.renderFrame(width, height);
          this.owner.send('media:frame', { ...metadata, ...frame });
        }
        if (presentable && request?.purpose !== 'capture' && metadata.outputRevision >= this.outputTarget.revision) {
          this.send('frame', { ...metadata, time: metadata.mediaTime, seeked: !!this.seeked });
          this.seeked = false;
        }
        request?.resolve(metadata);
      } catch (error) {
        request?.reject(error);
        this.send('error', { message: `GPU 共享纹理输出失败：${error.message}` }); return;
      }
    }
  }
  captureFrame() {
    if (!this.loaded) throw new Error('尚无可抓取画面');
    if (this.mode !== 'software') return { currentCanvas: true, width: this.descriptor.width, height: this.descriptor.height };
    return this.player.renderFrame(this.descriptor.width, this.descriptor.height);
  }
  destroy() {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyPromise = (async () => {
      this.closed = true;
      // Initialization owns the native resources until its promise settles.
      await this.ready.catch(() => {});
      this.player.setEventCallback(); this.player.setUpdateCallback();
      const error = new Error('媒体会话已关闭');
      for (const request of this.exactFrames.splice(0)) request.reject(error);
      if (this.pumping) await this.pumping.catch(() => {});
      if (this.releases.size) await Promise.allSettled([...this.releases]);
      this.player.destroy();
      if (this.mediaId) await this.catalog.release(this.mediaId, this.id);
    })();
    return this.destroyPromise;
  }
}
module.exports = { MediaService, runtimePath, loadCore };
