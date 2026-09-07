(function () {
  'use strict';
  class PlaybackAdapter extends EventTarget {
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    get currentFrameCanvas() { return this.surface; }
    async captureFrame() {
      const canvas = document.createElement('canvas'); canvas.width = this.surface.width || this.videoWidth; canvas.height = this.surface.height || this.videoHeight;
      canvas.getContext('2d').drawImage(this.surface, 0, 0); return canvas;
    }
    setProjectFps(fps) { this.projectFps = fps; }
    async reverse(speed = 1) {
      this.pause(); this.stopReverse();
      this.reverseTimer = setInterval(() => this.seek(Math.max(0, this.currentTime - 1 / (this.projectFps || 24))), 1000 / ((this.projectFps || 24) * speed));
    }
    stopReverse() { clearInterval(this.reverseTimer); this.reverseTimer = null; }
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
    open(media) { this.media = media; this.emit('loading'); this.element.src = media.url; this.element.load(); }
    play() { this.stopReverse(); return this.element.play(); }
    pause() { this.stopReverse(); this.element.pause(); }
    seek(time) { this.element.currentTime = time; }
    step(direction) { this.pause(); this.seek(Math.max(0, Math.min(this.duration, this.currentTime + direction / this.projectFps))); }
    seekFrameExact(frame, fps = this.projectFps) { return this.frameOperation(frame / fps); }
    stepFrame(direction, fps = this.projectFps) { return this.frameOperation(Math.max(0, Math.min(this.duration, this.currentTime + direction / fps))); }
    frameOperation(time) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('逐帧操作超时')); }, 5000);
        const done = () => { cleanup(); resolve({ time: this.currentTime }); };
        const failed = () => { cleanup(); reject(new Error('逐帧解码失败')); };
        const cleanup = () => { clearTimeout(timer); this.element.removeEventListener('seeked', done); this.element.removeEventListener('error', failed); };
        this.element.addEventListener('seeked', done, { once: true }); this.element.addEventListener('error', failed, { once: true });
        if (this.element.readyState >= 2 && Math.abs(this.currentTime - time) < .0005) {
          requestAnimationFrame(() => { cleanup(); resolve({ time: this.currentTime, direction: 0 }); });
          return;
        }
        this.element.currentTime = time;
      });
    }
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
    constructor(element, options = {}) {
      super(); this.api = window.desktopAPI.media; this.options = options; this.surface = document.createElement('canvas');
      if (element) { this.surface.id = element.id; this.surface.className = element.className; element.replaceWith(this.surface); }
      this.context = this.surface.getContext('2d', { alpha: false });
      this.videoWidth = 0; this.videoHeight = 0; this.duration = 0; this.readyState = 0; this.paused = true; this.seeking = false;
      this.time = 0; this.projectFps = 24; this._volume = 1; this._muted = false; this._speed = 1; this.callbacks = new Map(); this.nextCallback = 0;
      this.generation = 0; this.disposers = []; this.session = null; this.operationSequence = 0; this.operations = new Map();
    }
    async ensureSession() {
      if (!this.session) this.session = this.api.create(this.options).then(id => {
        this.id = id;
        this.disposers.push(this.api.onState(event => { if (event.id === id) this.onState(event); }),
          this.api.onFrame(frame => { if (frame.id === id) this.drawSoftware(frame); }),
          this.api.onSharedTextureFrame(id, frame => { this.resize(frame.displayWidth, frame.displayHeight); this.context.drawImage(frame, 0, 0); }));
        return id;
      });
      return this.session;
    }
    fail(error) {
      this.error = error;
      this.seeking = false;
      for (const operation of this.operations.values()) { clearTimeout(operation.timer); operation.reject(error); }
      this.operations.clear();
      this.emit('error', { message: error.message || String(error) });
    }
    call(command, ...args) { return this.ensureSession().then(id => this.api[command](id, ...args)).catch(error => { this.fail(error); throw error; }); }
    fire(command, ...args) { this.call(command, ...args).catch(() => {}); }
    async open(media) {
      const generation = ++this.generation;
      this.media = media; this.src = media.url; this.currentSrc = media.url; this.readyState = 0; this.time = 0; this.emit('loading');
      try {
        await this.call('open', media.mediaId, this.projectFps);
        if (generation !== this.generation) return;
        await this.call('setVolume', this._volume); await this.call('setMuted', this._muted); await this.call('setSpeed', this._speed);
      } catch { /* error is emitted by call */ }
    }
    onState(event) {
      if (event.type === 'metadata') {
        this.backend = event.backend;
        this.media = event.media; this.videoWidth = event.media.width; this.videoHeight = event.media.height; this.duration = event.media.duration;
        this.readyState = 1; this.emit('metadata', event.media); this.emit('loadedmetadata');
      } else if (event.type === 'frame') {
        this.time = event.time; const first = this.readyState < 2; this.readyState = 4;
        if (first) this.emit('loadeddata');
        this.emit('timeupdate'); this.emit('frame', event);
        if (event.seeked) { this.seeking = false; this.emit('seeked'); }
        if (Number.isSafeInteger(event.operationId)) {
          const operation = this.operations.get(event.operationId);
          if (operation) { clearTimeout(operation.timer); this.operations.delete(event.operationId); operation.resolve(event); }
        }
        const callbacks = [...this.callbacks.values()]; this.callbacks.clear();
        for (const callback of callbacks) callback(performance.now(), { mediaTime: this.time });
      } else if (event.type === 'playing' || event.type === 'paused') {
        this.paused = event.type === 'paused'; this.emit(event.type); this.emit(this.paused ? 'pause' : 'play');
      } else if (event.type === 'error') this.fail(new Error(event.message));
      else this.emit(event.type, event);
    }
    resize(width, height) { if (this.surface.width !== width || this.surface.height !== height) { this.surface.width = width; this.surface.height = height; } }
    drawSoftware(frame) {
      this.resize(frame.width, frame.height);
      // Upload software-decoded pixels through WebGL2, then expose a compositable canvas.
      if (!this.upload) this.upload = new SoftwareFrameUpload();
      this.upload.draw(frame); this.context.drawImage(this.upload.canvas, 0, 0);
    }
    play() { this.stopReverse(); return this.call('play'); }
    pause() { this.stopReverse(); if (this.session) this.fire('pause'); }
    seek(time) { this.seeking = true; this.fire('seek', time); }
    step(direction) { this.pause(); this.seeking = true; this.fire('step', direction); }
    seekFrameExact(frame, fps = this.projectFps) { return this.frameOperation('seek', frame / fps); }
    stepFrame(direction, fps = this.projectFps) {
      const sourceFps = Number(this.media?.sourceFps);
      if (this.media?.mediaKind === 'video' && sourceFps && Math.abs(sourceFps - fps) > .001) {
        const time = Math.max(0, Math.min(this.duration, this.currentTime + direction / fps));
        return this.frameOperation('seek', time);
      }
      return this.frameOperation('step', direction);
    }
    async frameOperation(command, value) {
      const id = await this.ensureSession();
      const operationId = ++this.operationSequence;
      this.seeking = true;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.operations.delete(operationId); this.seeking = false; reject(new Error('逐帧操作超时')); }, 5000);
        this.operations.set(operationId, { resolve, reject, timer });
        this.api[command](id, value, operationId).catch(error => {
          const operation = this.operations.get(operationId);
          if (!operation) return;
          clearTimeout(operation.timer); this.operations.delete(operationId); operation.reject(error); this.fail(error);
        });
      });
    }
    setSpeed(value) { this._speed = value; if (this.session) this.fire('setSpeed', value); }
    setVolume(value) { this._volume = value; if (this.session) this.fire('setVolume', value); }
    setMuted(value) { this._muted = value; if (this.session) this.fire('setMuted', value); }
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
      const result = await this.call('captureFrame');
      if (!result.currentCanvas) this.drawSoftware(result);
      return super.captureFrame();
    }
    async destroy() {
      if (this.destroyPromise) return this.destroyPromise;
      this.destroyPromise = (async () => {
        this.stopReverse(); for (const dispose of this.disposers) dispose(); this.callbacks.clear();
        const error = new Error('媒体会话已关闭');
        for (const operation of this.operations.values()) { clearTimeout(operation.timer); operation.reject(error); }
        this.operations.clear(); if (this.session) await this.api.destroy(await this.session); this.upload?.destroy();
      })();
      return this.destroyPromise;
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
      const gl = this.gl; this.canvas.width = frame.width; this.canvas.height = frame.height;
      gl.viewport(0,0,frame.width,frame.height); gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,frame.width,frame.height,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(frame.rgba)); gl.drawArrays(gl.TRIANGLES,0,3);
    }
    destroy() { this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program); }
  }
  window.AstriaPlayback = Object.freeze({ create: (element, options) => window.desktopAPI ? new LibmpvAdapter(element, options) : new HTMLVideoAdapter(element), PlaybackAdapter, HTMLVideoAdapter, LibmpvAdapter });
})();
