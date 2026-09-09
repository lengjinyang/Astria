(function () {
  'use strict';
  class PlaybackAdapter extends EventTarget {
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    get currentFrameCanvas() { return this.surface; }
    async captureFrame() {
      const canvas = document.createElement('canvas'); canvas.width = this.videoWidth; canvas.height = this.videoHeight;
      canvas.getContext('2d').drawImage(this.surface, 0, 0); return canvas;
    }
    setProjectFps(fps) { this.projectFps = fps; }
    async reverse(speed = 1) {
      this.pause(); this.stopReverse();
      this.reverseTimer = setInterval(() => this.seek(Math.max(0, this.currentTime - 1 / (this.projectFps || 24))), 1000 / ((this.projectFps || 24) * speed));
    }
    stopReverse() { clearInterval(this.reverseTimer); this.reverseTimer = null; }
    setOutputTarget() {}
    requestSourceFrame() { return this.captureFrame(); }
  }
  class HTMLVideoAdapter extends PlaybackAdapter {
    constructor(element = document.createElement('video')) {
      super(); this.surface = element; this.element = element; this.projectFps = 24;
      for (const type of ['loadedmetadata','loadeddata','timeupdate','seeked','play','pause','ended','error','volumechange']) {
        element.addEventListener(type, () => {
          this.emit(type);
          const normalized = { loadedmetadata:'metadata', loadeddata:'frame', timeupdate:'frame', seeked:'frame', play:'playing', pause:'paused' }[type];
          if (normalized) this.emit(normalized, { seeked: type === 'seeked' });
        });
      }
    }
    open(media) { this.media = media; this.emit('loading'); this.element.preload = 'auto'; this.element.src = media.url; this.element.load(); }
    play() { this.stopReverse(); return this.element.play(); }
    pause() { this.stopReverse(); this.element.pause(); }
    stop() { this.pause(); this.element.removeAttribute('src'); this.element.load(); }
    seek(time) { this.element.currentTime = time; }
    step(direction) { this.pause(); this.seek(Math.max(0, Math.min(this.duration, this.currentTime + direction / this.projectFps))); }
    setSpeed(value) { this.element.playbackRate = value; }
    setVolume(value) { this.element.volume = value; }
    setMuted(value) { this.element.muted = value; }
    requestVideoFrameCallback(callback) { return this.element.requestVideoFrameCallback?.(callback); }
    cancelVideoFrameCallback(id) { this.element.cancelVideoFrameCallback?.(id); }
    destroy() { this.pause(); this.element.removeAttribute('src'); this.element.load(); }
  }
  for (const property of ['currentTime','duration','paused','seeking','readyState','videoWidth','videoHeight','volume','muted','playbackRate','src','currentSrc']) {
    Object.defineProperty(HTMLVideoAdapter.prototype, property, { get() { return this.element[property]; }, set(value) { this.element[property] = value; } });
  }

  class LibmpvAdapter extends PlaybackAdapter {
    constructor(element) {
      super(); this.api = window.desktopAPI.media; this.surface = document.createElement('canvas');
      if (element) { this.surface.id = element.id; this.surface.className = element.className; element.replaceWith(this.surface); }
      // The launch poster is a separate 2D surface. Do not block its layout
      // or native-session IPC on WebGL context creation and shader compilation.
      this.presenter = null;
      this.videoWidth = 0; this.videoHeight = 0; this.duration = 0; this.readyState = 0; this.paused = true; this.seeking = false;
      this.time = 0; this.projectFps = 24; this._volume = 1; this._muted = false; this._speed = 1; this.callbacks = new Map(); this.nextCallback = 0;
      this.generation = 0; this.disposers = []; this.session = null; this.lastFrameId = -1; this.outputRevision = 0; this.outputTarget = null;
      this.nextOperationId = 0; this.sourceFrameRequests = new Map(); this.frameStates = new Map(); this.renderedFrames = new Map();
    }
    async ensureSession() {
      if (!this.session) this.session = this.api.create().then(id => {
        this.id = id;
        this.disposers.push(this.api.onState(event => { if (event.id === id) this.onState(event); }),
          this.api.onFrame(frame => { if (frame.id === id) this.drawSoftware(frame); }),
          this.api.onSharedTextureFrame(id, (frame, metadata) => this.drawShared(frame, metadata)));
        if (this.outputTarget) this.api.setOutputTarget(id, this.outputTarget).catch(error => this.fail(error));
        return id;
      });
      return this.session;
    }
    fail(error) { this.error = error; this.emit('error', { message: error.message || String(error) }); }
    call(command, ...args) { return this.ensureSession().then(id => this.api[command](id, ...args)).catch(error => { this.fail(error); throw error; }); }
    fire(command, ...args) { this.call(command, ...args).catch(() => {}); }
    async open(media) {
      const generation = ++this.generation;
      this.media = media; this.src = media.url; this.currentSrc = media.url; this.readyState = 0; this.time = 0;
      this.videoWidth = 0; this.videoHeight = 0; this.duration = 0; this.frameStates.clear(); this.renderedFrames.clear();
      this.emit('loading');
      try {
        await this.call('open', media.mediaId, this.projectFps, Number(media.startTime) || 0);
        if (generation !== this.generation) return;
        await this.call('setVolume', this._volume); await this.call('setMuted', this._muted); await this.call('setSpeed', this._speed);
      } catch { /* error is emitted by call */ }
    }
    onState(event) {
      if (event.type === 'metadata') {
        this.backend = event.backend;
        if (Number.isFinite(event.time)) this.time = event.time;
        this.media = event.media; this.videoWidth = event.media.width; this.videoHeight = event.media.height; this.duration = event.media.duration;
        this.readyState = 1; this.emit('metadata', event.media); this.emit('loadedmetadata');
      } else if (event.type === 'frame') this.queueFrameState(event);
      else if (event.type === 'playing' && this.stepping) {
        // libmpv briefly unpauses internally to present a frame-step. Keep the
        // public paused state stable until the user explicitly starts playback.
        return;
      } else if (event.type === 'playing' || event.type === 'paused') {
        this.paused = event.type === 'paused'; this.emit(event.type); this.emit(this.paused ? 'pause' : 'play');
      } else if (event.type === 'error') this.fail(new Error(event.message));
      else this.emit(event.type, event);
    }
    pruneFramePairs(map) {
      while (map.size > 12) map.delete(map.keys().next().value);
    }
    queueFrameState(event) {
      if (!Number.isSafeInteger(event.frameId)) { this.commitPresentedFrame(event); return; }
      this.frameStates.set(event.frameId, event); this.pruneFramePairs(this.frameStates); this.commitFramePair(event.frameId);
    }
    markFrameRendered(frame) {
      if (!Number.isSafeInteger(frame.frameId)) return;
      this.renderedFrames.set(frame.frameId, frame); this.pruneFramePairs(this.renderedFrames); this.commitFramePair(frame.frameId);
    }
    commitFramePair(frameId) {
      const state = this.frameStates.get(frameId), rendered = this.renderedFrames.get(frameId);
      if (!state || !rendered) return;
      this.frameStates.delete(frameId); this.renderedFrames.delete(frameId);
      this.commitPresentedFrame({ ...rendered, ...state });
    }
    commitPresentedFrame(event) {
      this.time = event.time; const first = this.readyState < 2; this.readyState = 4;
      if (first) this.emit('loadeddata');
      this.emit('timeupdate'); this.emit('frame', event);
      if (event.seeked) { this.seeking = false; this.emit('seeked'); }
      const callbacks = [...this.callbacks.values()]; this.callbacks.clear();
      for (const callback of callbacks) callback(performance.now(), { mediaTime: this.time });
    }
    resize(width, height) { if (this.surface.width !== width || this.surface.height !== height) { this.surface.width = width; this.surface.height = height; } }
    acceptFrame(frame) {
      if (frame.purpose === 'capture') return true;
      if (Number.isSafeInteger(frame.frameId) && frame.frameId <= this.lastFrameId) return false;
      if (Number.isSafeInteger(frame.outputRevision) && frame.outputRevision < this.outputRevision) return false;
      if (Number.isSafeInteger(frame.frameId)) this.lastFrameId = frame.frameId;
      return true;
    }
    finishSourceFrame(frame, source) {
      if (!frame.operationId) return false;
      const pending = this.sourceFrameRequests.get(frame.operationId);
      if (!pending) return frame.purpose === 'capture';
      this.sourceFrameRequests.delete(frame.operationId);
      clearTimeout(pending.timer);
      if (frame.purpose === 'capture') {
        const canvas = document.createElement('canvas');
        canvas.width = source.displayWidth || source.width || frame.width;
        canvas.height = source.displayHeight || source.height || frame.height;
        canvas.getContext('2d', { alpha: false }).drawImage(source, 0, 0, canvas.width, canvas.height);
        pending.resolve(canvas);
        return true;
      }
      pending.resolve(true);
      return false;
    }
    ensurePresenter() {
      if (!this.presenter) {
        window.desktopAPI.startupMark?.('renderer.gpu-start');
        try { this.presenter = new FrameSurfaceRenderer(this.surface); }
        catch (error) { this.fail(error); throw error; }
        finally { window.desktopAPI.startupMark?.('renderer.gpu-end'); }
      }
      return this.presenter;
    }
    drawShared(frame, metadata = {}) {
      if (!this.acceptFrame(metadata)) return;
      if (this.finishSourceFrame(metadata, frame)) return;
      this.resize(frame.displayWidth, frame.displayHeight);
      this.ensurePresenter().draw(frame);
      this.markFrameRendered(metadata);
    }
    drawSoftware(frame) {
      if (!this.acceptFrame(frame)) return;
      this.resize(frame.width, frame.height);
      // Upload software-decoded pixels through WebGL2, then expose a compositable canvas.
      if (!this.upload) this.upload = new SoftwareFrameUpload();
      this.upload.draw(frame);
      if (this.finishSourceFrame(frame, this.upload.canvas)) return;
      this.ensurePresenter().draw(this.upload.canvas);
      this.markFrameRendered(frame);
    }
    play() { this.stopReverse(); this.stepping = false; return this.call('play'); }
    pause() { this.stopReverse(); if (this.session) this.fire('pause'); }
    stop() { this.stopReverse(); if (this.session) this.fire('stop'); this.readyState = 0; }
    seek(time) { this.seeking = true; this.fire('seek', time); }
    step(direction) { this.pause(); this.stepping = true; this.seeking = true; this.fire('step', direction); }
    setSpeed(value) { this._speed = value; if (this.session) this.fire('setSpeed', value); }
    setVolume(value) { this._volume = value; if (this.session) this.fire('setVolume', value); }
    setMuted(value) { this._muted = value; if (this.session) this.fire('setMuted', value); }
    setOutputTarget(width, height, mode = 'viewport') {
      const even = value => Math.max(2, Math.round(Number(value) / 2) * 2);
      const next = { width: even(width), height: even(height), mode };
      if (!['viewport', 'source', 'scrub'].includes(mode) || !Number.isFinite(next.width) || !Number.isFinite(next.height)) return;
      if (this.outputTarget && this.outputTarget.width === next.width && this.outputTarget.height === next.height && this.outputTarget.mode === mode) return;
      this.outputTarget = { ...next, revision: ++this.outputRevision };
      if (this.session) this.fire('setOutputTarget', this.outputTarget);
    }
    requestSourceFrame(purpose = 'exact') {
      const operationId = ++this.nextOperationId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.sourceFrameRequests.delete(operationId);
          reject(new Error('源分辨率画面请求超时'));
        }, 5000);
        this.sourceFrameRequests.set(operationId, { resolve, reject, timer });
        this.call('requestSourceFrame', { operationId, purpose }).catch(error => {
          const pending = this.sourceFrameRequests.get(operationId);
          if (!pending) return;
          clearTimeout(pending.timer); this.sourceFrameRequests.delete(operationId); pending.reject(error);
        });
      });
    }
    setProjectFps(fps) {
      const changed = this.projectFps !== fps; this.projectFps = fps;
      if (changed && this.media?.mediaKind === 'sequence' && this.readyState) {
        const frame = Math.round(this.time * this.media.fps), wasPlaying = !this.paused;
        this.reconfiguring = true;
        this.addEventListener('loadeddata', () => { this.reconfiguring = false; this.seek(frame / fps); if (wasPlaying) this.play().catch(() => {}); }, { once: true });
        this.open(this.media);
      }
    }
    get currentTime() { return this.time; } set currentTime(value) { this.seek(value); }
    get volume() { return this._volume; } set volume(value) { this.setVolume(value); }
    get muted() { return this._muted; } set muted(value) { this.setMuted(value); }
    get playbackRate() { return this._speed; } set playbackRate(value) { this.setSpeed(value); }
    requestVideoFrameCallback(callback) { const id = ++this.nextCallback; this.callbacks.set(id, callback); return id; }
    cancelVideoFrameCallback(id) { this.callbacks.delete(id); }
    async captureFrame() {
      return this.requestSourceFrame('capture');
    }
    async destroy() {
      if (this.destroyPromise) return this.destroyPromise;
      this.destroyPromise = (async () => {
        this.stopReverse(); for (const dispose of this.disposers.splice(0)) dispose(); this.callbacks.clear();
        for (const pending of this.sourceFrameRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error('播放器已关闭')); }
        this.sourceFrameRequests.clear(); this.frameStates.clear(); this.renderedFrames.clear();
        if (this.session) await this.api.destroy(await this.session);
        this.upload?.destroy(); this.presenter?.destroy();
      })();
      return this.destroyPromise;
    }
  }
  class FrameSurfaceRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false, antialias: false, desynchronized: true });
      if (!gl) {
        this.context = canvas.getContext('2d', { alpha: false });
        if (!this.context) throw new Error('画面 Canvas 不可用');
        return;
      }
      const shader = (type, source) => {
        const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
        return value;
      };
      this.program = gl.createProgram();
      gl.attachShader(this.program, shader(gl.VERTEX_SHADER, '#version 300 es\n out vec2 uv; void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=vec2(p.x,1.-p.y);gl_Position=vec4(p*2.-1.,0,1);}'));
      gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, '#version 300 es\n precision highp float;in vec2 uv;uniform sampler2D pixels;out vec4 color;void main(){color=texture(pixels,uv);}'));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    draw(source) {
      if (!this.gl) {
        this.context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
        return;
      }
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      if (this.textureWidth !== this.canvas.width || this.textureHeight !== this.canvas.height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        this.textureWidth = this.canvas.width; this.textureHeight = this.canvas.height;
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    destroy() {
      if (!this.gl) return;
      this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program);
    }
  }
  class SoftwareFrameUpload {
    constructor() {
      this.canvas = document.createElement('canvas'); const gl = this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
      if (!gl) throw new Error('WebGL2 软件帧输出不可用');
      const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const program = this.program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\n out vec2 uv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); uv=vec2(p.x,1.-p.y);gl_Position=vec4(p*2.-1.,0,1);}'));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, '#version 300 es\n precision highp float; in vec2 uv; uniform sampler2D pixels; out vec4 color; void main(){vec3 linear=pow(texture(pixels,uv).rgb,vec3(2.4));vec3 srgb=mix(12.92*linear,1.055*pow(linear,vec3(1./2.4))-.055,step(vec3(.0031308),linear));color=vec4(srgb,1.);}'));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)); gl.useProgram(program);
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    draw(frame) {
      const gl = this.gl;
      const resized = this.canvas.width !== frame.width || this.canvas.height !== frame.height;
      if (resized) { this.canvas.width = frame.width; this.canvas.height = frame.height; }
      gl.viewport(0,0,frame.width,frame.height); gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D,this.texture);
      const pixels = new Uint8Array(frame.rgba);
      if (resized || this.textureWidth !== frame.width || this.textureHeight !== frame.height) {
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,frame.width,frame.height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        this.textureWidth = frame.width; this.textureHeight = frame.height;
      } else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,frame.width,frame.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    destroy() { this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program); }
  }
  window.AstriaPlayback = Object.freeze({ create: element => window.desktopAPI ? new LibmpvAdapter(element) : new HTMLVideoAdapter(element), PlaybackAdapter, HTMLVideoAdapter, LibmpvAdapter });
})();
