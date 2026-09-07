(async () => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'vfx-player-workspace-v01';
  const WORKSPACES_KEY = 'vfx-player-media-workspaces-v02';
  const PREFERENCES_KEY = 'vfx-player-preferences-v02';
  const desktopAPI = window.desktopAPI || null;
  let desktopData = null;
  const DEFAULT_SHORTCUTS = Object.freeze({
    togglePlay: 'Space', previousFrame: 'D', nextFrame: 'F', loopIn: 'I', loopOut: 'O', bookmark: 'M',
    luma: 'G', pixelInspector: 'X', toggleGuides: 'H', cleanMode: 'P', togglePanel: 'F2', resetView: 'Ctrl+0', resetTimeline: 'Alt+0'
  });
  const SHORTCUT_ACTIONS = Object.freeze({
    togglePlay: () => playback.paused && !state.isReverse ? play() : pause(),
    previousFrame: () => step(-1), nextFrame: () => step(1), loopIn: () => setLoopPoint('in'), loopOut: () => setLoopPoint('out'),
    bookmark: () => createBookmark(), luma: () => $('#lumaBtn').click(), pixelInspector: () => setPixelInspector(!state.pixelInspector), toggleGuides: () => toggleCompositionGuides(), cleanMode: () => setCleanMode(!state.cleanMode),
    togglePanel: () => setPanelOpen(!state.panelOpen), resetView: () => resetViewerView(), resetTimeline: () => resetTimelineZoom()
  });

  const els = {
    video: $('#video'), videoInput: $('#videoInput'), viewerStage: $('#viewerStage'), viewerEmpty: $('#viewerEmpty'), mediaSurface: $('#mediaSurface'),
    canvas: $('#annotationCanvas'), ctx: $('#annotationCanvas').getContext('2d'), cacheCanvas: $('#frameCacheCanvas'), cacheCtx: $('#frameCacheCanvas').getContext('2d'), colorCanvas: $('#colorViewCanvas'), guides: $('#compositionGuides'), playBtn: $('#playBtn'),
    timelineTrack: $('#timelineTrack'), timelineWrap: $('#timelineTrackWrap'), timelineProgress: $('#timelineProgress'),
    playhead: $('#playhead'), markerLayer: $('#markerLayer'), annotationMarkerLayer: $('#annotationMarkerLayer'), ruler: $('#timelineRuler'), currentTimecode: $('#currentTimecode'),
    durationTimecode: $('#durationTimecode'), frameReadout: $('#frameReadout'), secondsReadout: $('#secondsReadout'),
    fpsInput: $('#fpsInput'), speedRange: $('#speedRange'), speedNumber: $('#speedNumber'), bookmarkList: $('#bookmarkList'), bookmarkEmpty: $('#bookmarkEmpty'),
    annotationList: $('#annotationList'), annotationEmpty: $('#annotationEmpty'), notes: $('#bookmarkNotes'), notesSaved: $('#notesSaved'),
    projectName: $('#projectName'), statusText: $('#statusText'), helpModal: $('#helpModal'),
    scrubSensitivity: $('#scrubSensitivity'), scrubSensitivityValue: $('#scrubSensitivityValue'),
    lumaContrast: $('#lumaContrast'), lumaContrastValue: $('#lumaContrastValue'),
    timelineTooltip: $('#timelineTooltip'),
    volumeSlider: $('#volumeSlider'), volumeValue: $('#volumeValue'), muteBtn: $('#muteBtn'), timelineZoomValue: $('#timelineZoomValue'),
    loopRange: $('#loopRange'), loopInMarker: $('#loopInMarker'), loopOutMarker: $('#loopOutMarker'), cacheStatus: $('#cacheStatus'),
    viewerZoomSelect: $('#viewerZoomSelect'), viewerZoomValue: $('#viewerZoomValue'), radialMenu: $('#annotationRadialMenu'),
    radialDismissLayer: $('#radialDismissLayer'), annotationSizeRange: $('#annotationSizeRange'),
    textEditor: $('#annotationTextEditor'), textInput: $('#annotationTextInput'), endBehaviorSelect: $('#endBehaviorSelect'),
    timelinePreviewImage: $('#timelinePreviewImage'), pixelInspectorHud: $('#pixelInspectorHud'), contactSheetModal: $('#contactSheetModal'), contactFrameList: $('#contactFrameList')
  };

  const playback = AstriaPlayback.create(els.video);
  if (new URLSearchParams(location.search).has('smoke')) window.__astriaPlayback = playback;
  els.video = playback.surface;
  els.videoInput.accept = (desktopAPI ? AstriaFormats.selectable : AstriaFormats.browser).map(ext => '.' + ext).join(',');
  const state = {
    fileName: '', fileMeta: null, fps: 24, fpsMode: 'source', bookmarks: [], annotations: [], selectedBookmarkIds: [],
    selectedAnnotationId: null, selectedAnnotationFrame: null, activeTool: 'select', annotationColor: '#8b5cf6', annotationVisible: true,
    timelineZoom: 1, reverseTimer: null, reverseSeekInFlight: false, reverseAnchorFrame: 0, reverseAnchorTime: 0, reverseFrame: 0, playbackUiRaf: null, isReverse: false, scrub: null, draw: null, favoriteOnly: false,
    view: 'list', autosave: true, currentObjectUrl: null, saveTimer: null, contextBookmarkId: null,
    timelineScrub: null, annotationScope: 'all',
    lumaMode: false, lumaContrast: 1, viewerScrubSensitivity: 0.3, lastFrameContent: null,
    volume: 1, muted: false, previousVolume: 1, loopInFrame: null, loopOutFrame: null,
    frameCache: new Map(), frameCacheSizes: new Map(), frameCacheBytes: 0, frameCacheCapture: null, frameCachePending: false, frameCacheHandle: null,
    frameCacheMax: 80, frameCacheGeneration: 0, currentMediaKey: null, sourcePath: null,
    scrubDecoder: null, scrubDecoderPromise: null, scrubDecoderFrame: null, scrubDecoderMediaId: null,
    scrubWorkerBusy: false, scrubWorkerPromise: null, scrubPrefetchTimer: null, scrubInteraction: 0, scrubDisplayFrame: null, scrubFinalizing: false,
    scrubController: { active: false, pointerTargetFrame: null, targetFrame: null, presentedFrame: null, direction: 0, inFlight: false },
    cleanMode: false, cleanControlsTimer: null, cleanPreviousTool: 'select',
    quickAnnotationTool: 'brush', annotationSize: 4, annotationUndo: [], quickGesture: null, pendingTextAnnotation: null,
    viewerZoomMode: 'fit', viewerZoom: 1, viewerPan: { x: 0, y: 0 }, viewerPanGesture: null,
    endBehavior: 'stop', panelOpen: false, viewerResizeObserver: null, viewerResizeRaf: null,
    playbackSpeed: 1, shortcuts: { ...DEFAULT_SHORTCUTS }, shortcutRecording: null, pixelInspector: false, timelineHoverPreview: true, timelineHoverPreviewSize: 196,
    autoplayOnOpen: true, startupMode: 'clean', startupModeApplied: false,

    pixelInspectorLocked: false, pixelSample: null, pixelSampleCanvas: null,
    annotationThumbnails: {},
    timelinePreviewVideo: null, timelinePreviewPending: null, timelinePreviewRaf: null, timelinePreviewGeneration: 0, timelinePreviewCache: new Map(), timelinePreviewActive: null, timelinePreviewWarmIndex: 0, timelinePreviewWarmTimer: null,
    initialMediaPresentationSent: false
    ,colorPreset: 'original', colorRenderer: null, colorLuts: new Map(), colorRenderPending: false,
    guidesMaster: true, guideThirds: false, guideGolden: false, guideSpiral: false, guideSpiralRotation: 0, guideCenter: false, guideDiagonal: false, guideTriangle: false, guideSymmetry: false, guideActionSafe: false, guideTitleSafe: false, guideAspect: 'off', guideOpacity: .55, guideMaskStrength: .55,
    contactCandidates: [], contactSheetCancel: false, contactSheetBusy: false
  };

  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const frameDuration = () => 1 / Math.max(1, state.fps);
  const totalFrames = () => playback.media?.mediaKind === 'sequence' ? playback.media.totalFrames : Math.max(1, Math.round((playback.duration || 0) * state.fps));
  const lastFrame = () => Math.max(0, totalFrames() - 1);
  const currentFrame = () => Number.isFinite(state.scrubDisplayFrame) ? state.scrubDisplayFrame :
    clamp(state.isReverse ? Math.round(state.reverseFrame) : Math.round(playback.currentTime * state.fps), 0, lastFrame());
  const sourceFrame = frame => Math.round(frame) + (state.fileMeta?.sourceFrameOffset || 0);
  const missingFrameNotice = document.createElement('div');
  missingFrameNotice.className = 'missing-frame-notice'; missingFrameNotice.hidden = true; els.mediaSurface.appendChild(missingFrameNotice);
  const selectedBookmark = () => state.bookmarks.find(b => state.selectedBookmarkIds.includes(b.id));

  function formatTimecode(seconds) {
    if (!Number.isFinite(seconds)) return '00:00:00:00';
    const frame = Math.floor((seconds % 1) * state.fps);
    const whole = Math.floor(seconds);
    const s = whole % 60, m = Math.floor(whole / 60) % 60, h = Math.floor(whole / 3600);
    return [h, m, s, frame].map(v => String(v).padStart(2, '0')).join(':');
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function toast(message) {
    const node = document.createElement('div');
    node.className = 'toast'; node.textContent = message;
    $('#toastStack').appendChild(node);
    setTimeout(() => { node.style.opacity = '0'; node.style.translate = '10px 0'; }, 2600);
    setTimeout(() => node.remove(), 2850);
  }

  function setStatus(message) { els.statusText.textContent = message; }
  function syncVolumeUI() {
    const percent = Math.round(playback.volume * 100);
    state.volume = playback.volume;
    state.muted = playback.muted;
    els.volumeSlider.value = percent;
    $('#cleanVolumeSlider').value = percent;
    $('#cleanMuteBtn').setAttribute('aria-pressed', String(state.muted || percent === 0));
    $('#cleanMuteBtn').setAttribute('aria-label', state.muted ? '取消静音' : '静音');
    els.volumeValue.textContent = `${percent}%`;
    els.muteBtn.title = state.muted || percent === 0 ? '取消静音' : '静音';
    els.muteBtn.setAttribute('aria-label', els.muteBtn.title);
    $('.volume-control').classList.toggle('muted', state.muted || percent === 0);
    $('#volumeDisclosure').classList.toggle('muted', state.muted || percent === 0);
    $('#volumeDisclosure > summary').title = state.muted || percent === 0 ? '音量 · 已静音' : `音量 · ${percent}%`;
  }
  function setPlaybackSpeed(value, persist = false) {
    state.playbackSpeed = Math.round(clamp(Number(value) || 1, .1, 4) * 20) / 20;
    playback.playbackRate = state.playbackSpeed;
    if (state.isReverse) {
      state.reverseAnchorFrame = currentFrame();
      state.reverseFrame = state.reverseAnchorFrame;
      state.reverseAnchorTime = performance.now();
    }
    els.speedRange.value = state.playbackSpeed;
    els.speedNumber.value = state.playbackSpeed.toFixed(2);
    if (persist) persistPreferences();
  }
  function setTimelinePreviewSize(value, persist = false) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    state.timelineHoverPreviewSize = clamp(Math.round(numeric / 2) * 2, 140, 320);
    const imageHeight = Math.round(state.timelineHoverPreviewSize * 9 / 16);
    document.documentElement.style.setProperty('--timeline-preview-width', `${state.timelineHoverPreviewSize}px`);
    document.documentElement.style.setProperty('--timeline-preview-image-height', `${imageHeight}px`);
    $('#previewSizeRange').value = state.timelineHoverPreviewSize;
    $('#previewSizeNumber').value = state.timelineHoverPreviewSize;
    if (persist) persistPreferences();
  }
  function shortcutFromEvent(event) {
    if (['Control','Shift','Alt','Meta'].includes(event.key)) return '';
    let key = event.code === 'Space' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (key === ' ') key = 'Space';
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(key);
    return parts.join('+');
  }
  function formatShortcut(shortcut) { return String(shortcut || '').replaceAll('+',' + '); }
  function renderShortcutEditor() {
    $$('#shortcutEditor [data-shortcut-action]').forEach(button => {
      $('kbd', button).textContent = formatShortcut(state.shortcuts[button.dataset.shortcutAction]);
    });
    $('#shortcutPreviousFrame').textContent = `${formatShortcut(state.shortcuts.previousFrame)} / ←`;
    $('#shortcutNextFrame').textContent = `${formatShortcut(state.shortcuts.nextFrame)} / →`;
    $('#shortcutResetView').textContent = formatShortcut(state.shortcuts.resetView);
    $('#shortcutResetTimeline').textContent = formatShortcut(state.shortcuts.resetTimeline);
    $('#shortcutPixelInspector').textContent = formatShortcut(state.shortcuts.pixelInspector);
    $('#shortcutGuides').textContent = formatShortcut(state.shortcuts.toggleGuides);
  }
  function finishShortcutRecording(shortcut = null) {
    const action = state.shortcutRecording;
    const button = action ? $(`#shortcutEditor [data-shortcut-action="${action}"]`) : null;
    button?.classList.remove('recording');
    state.shortcutRecording = null;
    if (!action || !shortcut) { renderShortcutEditor(); return; }
    const conflict = Object.entries(state.shortcuts).find(([name, value]) => name !== action && value === shortcut);
    if (conflict) { toast(`快捷键 ${formatShortcut(shortcut)} 已被占用`); renderShortcutEditor(); return; }
    state.shortcuts[action] = shortcut;
    renderShortcutEditor(); persistPreferences();
    toast(`快捷键已设置为 ${formatShortcut(shortcut)}`);
  }
  function setMediaReady(ready) {
    if (!ready) resetAmbient();
    const topbar = $('.topbar');
    const shell = $('.app-shell');
    // During playback the header belongs to the window overlay, never its grid.
    if (ready && topbar.parentElement !== document.body) document.body.appendChild(topbar);
    else if (!ready && topbar.parentElement !== shell) shell.prepend(topbar);
    document.body.classList.toggle('media-ready', ready);
    $$('.transport button, .transport input, .transport select, .annotation-toolbar button, .annotation-toolbar input, .luma-control button, #lumaContrast, #resetTimelineZoomBtn, #addBookmarkBtn, #cleanModeBtn, #pixelInspectorBtn, #exportAnnotatedFrameBtn').forEach(control => {
      const alwaysEnabled = ['togglePanelBtn','openDefaultAppsBtn','autoplaySwitch','startupModeSelect','hoverPreviewSwitch','previewSizeRange','previewSizeNumber','previewSizeDownBtn','previewSizeUpBtn','previewSizeResetBtn'].includes(control.id);
      control.disabled = alwaysEnabled ? false : !ready;
      control.setAttribute('aria-disabled', String(alwaysEnabled ? false : !ready));
    });
  }

  const COLOR_PRESETS = Object.freeze({
    original: '原始／标准视频', 'ue5-filmic': 'UE5 Filmic SDR', 'unity-neutral': 'Unity Linear Neutral',
    'unity-aces': 'Unity Linear ACES', acescg: 'ACEScg → ACES SDR', aces2065: 'ACES2065-1 → ACES SDR'
  });
  const COLOR_MATRICES = Object.freeze({
    acescg: [1.70505,-.62179,-.08326,-.13026,1.1408,-.01055,-.024,-.12897,1.15297],
    aces2065: [2.52169,-1.13413,-.38756,-.27648,1.37272,-.09624,-.01538,-.15298,1.16835]
  });
  const srgbEncode = value => value <= .0031308 ? value * 12.92 : 1.055 * Math.pow(Math.max(0,value),1/2.4)-.055;
  function acesTone(value) { return clamp((value*(2.51*value+.03))/(value*(2.43*value+.59)+.14),0,1); }
  function neutralTone(value) { const x=Math.max(0,value-.004); return clamp((x*(6.2*x+.5))/(x*(6.2*x+1.7)+.06),0,1); }
  function transformViewRgb(rgb, preset = state.colorPreset) {
    if (preset === 'original') return rgb.map(value=>clamp(value,0,1));
    let color = rgb.slice();
    const matrix = COLOR_MATRICES[preset];
    if (matrix) color = [matrix[0]*color[0]+matrix[1]*color[1]+matrix[2]*color[2],matrix[3]*color[0]+matrix[4]*color[1]+matrix[5]*color[2],matrix[6]*color[0]+matrix[7]*color[1]+matrix[8]*color[2]];
    const tone = preset === 'unity-neutral' ? neutralTone : acesTone;
    color = color.map(value => srgbEncode(tone(value)));
    if (preset === 'ue5-filmic') color = color.map((value,index)=>clamp(value*(index===2?.985:1.01),0,1));
    return color;
  }
  function generateColorLut(preset) {
    if (state.colorLuts.has(preset)) return state.colorLuts.get(preset);
    const size=64, data=new Uint8Array(size*size*size*4); let offset=0;
    for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++){
      const output=transformViewRgb([r/(size-1),g/(size-1),b/(size-1)],preset);
      data[offset++]=Math.round(output[0]*255);data[offset++]=Math.round(output[1]*255);data[offset++]=Math.round(output[2]*255);data[offset++]=255;
    }
    state.colorLuts.set(preset,data); return data;
  }
  async function preloadBuiltInColorLuts(){for(const preset of Object.keys(COLOR_PRESETS).filter(name=>name!=='original')){try{const response=await fetch(`assets/luts/${preset}-64.rgba`);if(!response.ok)continue;const data=new Uint8Array(await response.arrayBuffer());if(data.length===64*64*64*4)state.colorLuts.set(preset,data);}catch{/* browser file mode can fall back to deterministic local generation */}}}
  function createShader(gl,type,source){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Shader compile failed');return shader;}
  function createColorRenderer() {
    if (state.colorRenderer) return state.colorRenderer;
    const gl=els.colorCanvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
    if(!gl)throw new Error('WebGL2 unavailable');
    const vertex=createShader(gl,gl.VERTEX_SHADER,'#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=vec2((p.x+1.0)*.5,1.0-(p.y+1.0)*.5);gl_Position=vec4(p,0,1);}');
    const fragment=createShader(gl,gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;precision highp sampler3D;in vec2 uv;out vec4 outColor;uniform sampler2D frame;uniform sampler3D lut;uniform bool doLuma;uniform float contrast;void main(){vec3 c=texture(frame,uv).rgb;c=texture(lut,clamp(c,0.0,1.0)).rgb;if(doLuma){float y=dot(c,vec3(.2126,.7152,.0722));c=vec3(y);}c=(c-.5)*contrast+.5;outColor=vec4(clamp(c,0.0,1.0),1.0);}');
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Program link failed');
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    const frameTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,frameTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const lutTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,lutTexture);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
    gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'frame'),0);gl.uniform1i(gl.getUniformLocation(program,'lut'),1);
    state.colorRenderer={gl,program,vao,frameTexture,lutTexture,preset:null};
    els.colorCanvas.addEventListener('webglcontextlost',event=>{event.preventDefault();state.colorRenderer=null;setColorPreset('original',false);toast('GPU 色彩查看已回到原始显示');},{once:true});
    return state.colorRenderer;
  }
  // A tiny, temporally blended copy supplies only the light behind the opaque video.
  const ambient = {
    enabled: true, canvas: $('#ambientCanvas'), target: document.createElement('canvas'),
    timer: null, lastSample: -Infinity, steps: 0
  };
  ambient.target.width = 64; ambient.target.height = 36;
  const ambientCtx = ambient.canvas.getContext('2d');
  const ambientTargetCtx = ambient.target.getContext('2d');
  const topbarAmbientCanvas = $('#topbarAmbientCanvas');
  const topbarAmbientCtx = topbarAmbientCanvas.getContext('2d');

  function resetAmbient() {
    clearTimeout(ambient.timer); ambient.timer = null; ambient.steps = 0;
    ambient.lastSample = -Infinity;
    ambientCtx.clearRect(0, 0, 64, 36);
    topbarAmbientCtx.clearRect(0, 0, 64, 36);
    ambient.canvas.classList.remove('active');
    document.body.classList.remove('ambient-lit');
  }

  function blendAmbient() {
    ambient.timer = null;
    if (!ambient.enabled || document.hidden) return;
    ambientCtx.globalAlpha = .22;
    ambientCtx.drawImage(ambient.target, 0, 0);
    ambientCtx.globalAlpha = 1;
    topbarAmbientCtx.clearRect(0, 0, 64, 36);
    topbarAmbientCtx.drawImage(ambient.canvas, 0, 0);
    ambient.canvas.classList.add('active');
    document.body.classList.add('ambient-lit');
    if (--ambient.steps > 0) ambient.timer = setTimeout(blendAmbient, 80);
  }

  function sampleAmbient(source) {
    if (!ambient.enabled || document.hidden || playback.readyState < 2 || !playback.videoWidth) return;
    const now = performance.now();
    if (now - ambient.lastSample < 80) return;
    ambient.lastSample = now;
    source ||= els.cacheCanvas.classList.contains('visible') ? els.cacheCanvas : els.video;
    try {
      ambientTargetCtx.filter = state.lumaMode && source !== els.colorCanvas ? `grayscale(1) contrast(${state.lumaContrast})` : 'none';
      ambientTargetCtx.drawImage(source, 0, 0, 64, 36);
      ambient.steps = 22;
      if (ambient.timer === null) blendAmbient();
    } catch { resetAmbient(); }
  }

  function setAmbientEnabled(enabled, persist = true) {
    ambient.enabled = enabled;
    $('#ambientSwitch').classList.toggle('on', enabled);
    $('#ambientSwitch').setAttribute('aria-checked', String(enabled));
    if (!enabled) resetAmbient();
    else { ambient.lastSample = -Infinity; scheduleColorRender(); }
    if (persist) persistPreferences();
  }

  function renderColorView() {
    state.colorRenderPending=false;if(state.colorPreset==='original'||!playback.videoWidth)return;
    try{
      const renderer=createColorRenderer(),gl=renderer.gl,source=els.cacheCanvas.classList.contains('visible')?els.cacheCanvas:els.video;
      const max=gl.getParameter(gl.MAX_TEXTURE_SIZE)||4096,scale=Math.min(1,max/playback.videoWidth,max/playback.videoHeight),width=Math.max(1,Math.round(playback.videoWidth*scale)),height=Math.max(1,Math.round(playback.videoHeight*scale));
      if(els.colorCanvas.width!==width||els.colorCanvas.height!==height){els.colorCanvas.width=width;els.colorCanvas.height=height;gl.viewport(0,0,width,height);}
      gl.useProgram(renderer.program);gl.bindVertexArray(renderer.vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,renderer.frameTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);
      if(renderer.preset!==state.colorPreset){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,renderer.lutTexture);gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,64,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,generateColorLut(state.colorPreset));renderer.preset=state.colorPreset;}
      gl.uniform1i(gl.getUniformLocation(renderer.program,'doLuma'),state.lumaMode?1:0);gl.uniform1f(gl.getUniformLocation(renderer.program,'contrast'),state.lumaContrast);gl.drawArrays(gl.TRIANGLES,0,6);els.colorCanvas.classList.add('active');sampleAmbient(els.colorCanvas);
    }catch(error){console.warn('Color view unavailable',error);state.colorPreset='original';els.colorCanvas.classList.remove('active');$('#colorPresetSelect').value='original';toast('GPU 不可用，已回到原始显示');}
  }
  function scheduleColorRender(){if(state.colorPreset==='original'){sampleAmbient();return;}if(state.colorRenderPending)return;state.colorRenderPending=true;requestAnimationFrame(renderColorView);}
  function setColorPreset(preset,persist=true){state.colorPreset=COLOR_PRESETS[preset]?preset:'original';$('#colorPresetSelect').value=state.colorPreset;$('#colorPresetWarning').classList.toggle('show',state.colorPreset!=='original');els.colorCanvas.classList.toggle('active',state.colorPreset!=='original');if(state.colorPreset==='original')state.colorRenderer&&(state.colorRenderer.preset=null);else scheduleColorRender();if(persist)saveWorkspace();toast(`色彩查看 · ${COLOR_PRESETS[state.colorPreset]}`);}

  function renderCompositionGuides(){const on=state.guidesMaster;els.guides.classList.toggle('show-thirds',on&&state.guideThirds);els.guides.classList.toggle('show-golden',on&&state.guideGolden);els.guides.classList.toggle('show-spiral',on&&state.guideSpiral);$('#spiralGuides').setAttribute('transform',`rotate(${state.guideSpiralRotation} 500 500)`);els.guides.classList.toggle('show-center',on&&state.guideCenter);els.guides.classList.toggle('show-diagonal',on&&state.guideDiagonal);els.guides.classList.toggle('show-triangle',on&&state.guideTriangle);els.guides.classList.toggle('show-symmetry',on&&state.guideSymmetry);els.guides.classList.toggle('show-action',on&&state.guideActionSafe);els.guides.classList.toggle('show-title',on&&state.guideTitleSafe);els.guides.classList.toggle('show-mask',on&&state.guideAspect!=='off');els.guides.style.setProperty('--guide-opacity',state.guideOpacity);els.guides.style.setProperty('--guide-mask',state.guideMaskStrength);const ratios={'16:9':16/9,'1.85':1.85,'2.39':2.39,'4:3':4/3,'1:1':1,'9:16':9/16};const target=ratios[state.guideAspect];if(target&&playback.videoWidth){const source=playback.videoWidth/playback.videoHeight;let x=0,y=0,w=1000,h=1000;if(target>source){h=1000*source/target;y=(1000-h)/2;}else{w=1000*target/source;x=(1000-w)/2;}$('#aspectMaskPath').setAttribute('d',`M0 0H1000V1000H0Z M${x} ${y}H${x+w}V${y+h}H${x}Z`);}}
  function toggleCompositionGuides(){const configured=state.guideThirds||state.guideGolden||state.guideSpiral||state.guideCenter||state.guideDiagonal||state.guideTriangle||state.guideSymmetry||state.guideActionSafe||state.guideTitleSafe||state.guideAspect!=='off';if(!configured){state.guideThirds=true;$('#guideThirds').checked=true;state.guidesMaster=true;}else state.guidesMaster=!state.guidesMaster;renderCompositionGuides();persistPreferences();toast(state.guidesMaster?'构图辅助已恢复':'构图辅助已隐藏');}

  function usesAutoHideControls() {
    return state.cleanMode || document.body.classList.contains('window-fullscreen') || !!document.fullscreenElement;
  }

  function controlsAreHeld() {
    return (!state.isReverse && playback.paused) || !!state.timelineScrub || !!state.scrub ||
      !!document.querySelector('.clean-mode .bottom-dock:hover, .transport:hover, .timeline-panel:hover, .clean-window-controls:hover, .transport details[open], .transport :focus-visible, .timeline-panel :focus-visible');
  }

  function scheduleCleanControlsHide(delay = 2000) {
    clearTimeout(state.cleanControlsTimer);
    if (state.cleanMode && document.body.classList.contains('clean-pointer-outside')) return;
    if (!usesAutoHideControls()) return;
    if (controlsAreHeld()) {
      document.body.classList.add('clean-controls-visible');
      return;
    }
    state.cleanControlsTimer = setTimeout(() => {
      if (usesAutoHideControls() && !controlsAreHeld()) {
        document.body.classList.remove('clean-controls-visible');
        hideTimelinePreview();
      }
    }, delay);
  }

  function revealCleanControls() {
    if (!usesAutoHideControls()) return;
    if (state.cleanMode && document.body.classList.contains('clean-pointer-outside')) return;
    document.body.classList.add('clean-controls-visible');
    scheduleCleanControlsHide();
  }

  let classicTopbarTimer = null;
  let classicPointerInside = false;
  let classicWindowOutside = false;
  const nativeClassicPointer = !!desktopAPI?.onTitlebarHover;

  function refreshClassicTopbar() {
    const topbar = $('.topbar');
    const held = topbar.matches(':has(details[open], .export-menu.open, :focus-visible)');
    const visible = !state.cleanMode && !classicWindowOutside && (classicPointerInside || held);
    if (visible || state.cleanMode || classicWindowOutside) {
      clearTimeout(classicTopbarTimer); classicTopbarTimer = null;
      document.body.classList.toggle('classic-topbar-visible', visible);
    } else if (classicTopbarTimer === null) classicTopbarTimer = setTimeout(() => {
      classicTopbarTimer = null;
      if (!classicPointerInside && !topbar.matches(':has(details[open], .export-menu.open, :focus-visible)')) {
        document.body.classList.remove('classic-topbar-visible');
      }
    }, 280);
  }
  function updateClassicTopbar(event) {
    // Native drag regions can synthesize DOM leave/enter without cursor movement.
    // Desktop hover has one authority; DOM coordinates remain the browser fallback.
    if (nativeClassicPointer && !event.nativePointer) return;
    const topbar = $('.topbar');
    const rect = topbar.getBoundingClientRect();
    classicWindowOutside = false;
    if (document.querySelector('.modal-backdrop.open') || event.target.closest?.('.modal-backdrop')) {
      classicPointerInside = false;
      refreshClassicTopbar();
      return;
    }
    const revealed = document.body.classList.contains('classic-topbar-visible');
    // A wider exit boundary keeps the header stable around the reveal edge.
    const triggerBottom = rect.top + (revealed ? Math.max(rect.height + 24, 64) : Math.max(rect.height, 36));
    classicPointerInside = (event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= triggerBottom) || (revealed && !!event.target.closest?.('.topbar'));
    refreshClassicTopbar();
  }
  function closeClassicTopbarMenus() {
    $$('.topbar details[open]').forEach(menu => { menu.open = false; });
    setTopExportOpen(false);
  }
  function setTopExportOpen(open) {
    const menu = $('#exportMenu');
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', String(!open));
    menu.inert = !open;
    $('#exportBtn').setAttribute('aria-expanded', String(open));
  }

  function fitVideoWindowToMedia(resizeWindow = true) {
    if (!playback.videoWidth) return;
    const sideInset = !state.cleanMode && state.panelOpen ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-width')) || 340 : 0;
    desktopAPI?.fitVideoWindow?.({ enabled: true, width: playback.videoWidth, height: playback.videoHeight,
      bottomInset: state.cleanMode ? 0 : 44, sideInset, resizeWindow }).catch(() => {});
  }

  function setCleanMode(enabled) {
    hideTimelinePreview();
    if (enabled && !playback.duration) { toast('请先打开视频'); return; }
    if (state.cleanMode === enabled) return;
    state.cleanMode = enabled;
    fitVideoWindowToMedia();
    clearTimeout(classicTopbarTimer); classicTopbarTimer = null;
    classicPointerInside = false;
    if (enabled) closeClassicTopbarMenus();
    clearTimeout(state.cleanControlsTimer);
    document.body.classList.toggle('clean-mode', enabled);
    document.body.classList.remove('classic-topbar-visible');
    document.body.classList.remove('clean-pointer-outside');
    document.body.classList.toggle('clean-controls-visible', enabled);
    $('#cleanModeBtn').classList.toggle('active', enabled);
    $('#cleanModeBtn').setAttribute('aria-pressed', String(enabled));
    $('#cleanModeBtn').setAttribute('aria-label', enabled ? '退出纯净模式' : '进入纯净模式');
    if (enabled) {
      els.helpModal.classList.remove('open');
      hideBookmarkMenu();
      hideAnnotationRadialMenu();
      cancelTextAnnotation();
      scheduleCleanControlsHide();
    }
    revealCleanControls();
    requestAnimationFrame(() => { resizeCanvas(); updatePlaybackUI(); });
  }
  function pause() { playback.pause(); stopReverse(); }
  function hasLoopRange() {
    return Number.isFinite(state.loopInFrame) && Number.isFinite(state.loopOutFrame) && state.loopOutFrame > state.loopInFrame;
  }

  function play() {
    stopReverse();
    if (hasLoopRange() && (currentFrame() < state.loopInFrame || currentFrame() >= state.loopOutFrame)) {
      playback.currentTime = state.loopInFrame / state.fps;
    }
    playback.play().catch(() => {});
  }

  function stopReverse() {
    const wasReverse = state.isReverse;
    const targetFrame = Math.round(state.reverseFrame);
    if (state.reverseTimer) cancelAnimationFrame(state.reverseTimer);
    state.reverseTimer = null;
    state.reverseSeekInFlight = false;
    state.isReverse = false;
    $('#reverseBtn').classList.remove('active');
    if (wasReverse && playback.duration) {
      const targetTime = clamp(targetFrame / state.fps, 0, playback.duration);
      if (Math.abs(playback.currentTime - targetTime) > frameDuration() * .2) {
        showCachedFrame(targetFrame, true);
        playback.currentTime = targetTime;
      }
      updatePlaybackUI(targetTime, targetFrame);
      updateFrameContent(true);
      revealCleanControls();
    }
  }

  function pumpReversePlayback(now = performance.now()) {
    state.reverseTimer = null;
    if (!state.isReverse || state.reverseSeekInFlight || !playback.duration) return;
    const loopStartFrame = hasLoopRange() ? state.loopInFrame : 0;
    const loopEndFrame = hasLoopRange() ? state.loopOutFrame : lastFrame();
    const elapsedSeconds = Math.max(0, now - state.reverseAnchorTime) / 1000;
    let targetFrame = state.reverseAnchorFrame - Math.floor(elapsedSeconds * state.fps * state.playbackSpeed);

    if (targetFrame >= state.reverseFrame) {
      state.reverseTimer = requestAnimationFrame(pumpReversePlayback);
      return;
    }
    if (targetFrame < loopStartFrame) {
      if (hasLoopRange()) {
        state.reverseAnchorFrame = loopEndFrame;
        state.reverseAnchorTime = now;
        state.reverseFrame = loopEndFrame;
        targetFrame = Math.max(loopStartFrame, loopEndFrame - 1);
      } else targetFrame = 0;
    }

    targetFrame = clamp(Math.round(targetFrame), loopStartFrame, loopEndFrame);
    state.reverseFrame = targetFrame;
    const targetTime = targetFrame / state.fps;
    if (state.frameCache.has(targetFrame)) {
      showCachedFrame(targetFrame, true);
      updatePlaybackUI(targetTime, targetFrame);
      updateFrameContent(true);
      if (!hasLoopRange() && targetFrame <= 0) {
        stopReverse();
        setStatus('已到第一帧');
        return;
      }
      state.reverseTimer = requestAnimationFrame(pumpReversePlayback);
      return;
    }

    state.reverseSeekInFlight = true;
    playback.currentTime = targetTime;
    updatePlaybackUI(targetTime, targetFrame);
    updateFrameContent(true);
  }

  function reverse() {
    if (!playback.duration) return;
    if (!hasLoopRange() && currentFrame() <= 0) { setStatus('已在第一帧'); return; }
    const startFrame = Math.round(playback.currentTime * state.fps);
    playback.pause();
    stopReverse();
    state.isReverse = true;
    revealCleanControls();
    state.reverseAnchorFrame = startFrame;
    state.reverseFrame = state.reverseAnchorFrame;
    state.reverseAnchorTime = performance.now();
    $('#reverseBtn').classList.add('active');
    setStatus('实时倒放中');
    state.reverseTimer = requestAnimationFrame(pumpReversePlayback);
  }

  function seekFrame(frame, shouldPause = true, renderFrameContent = true) {
    if (!playback.duration) return;
    if (shouldPause) pause();
    const targetFrame = clamp(frame, 0, lastFrame());
    state.scrubDisplayFrame = null;
    const selectedAnnotation = state.annotations.find(a => a.id === state.selectedAnnotationId);
    if (selectedAnnotation && selectedAnnotation.frame !== Math.round(targetFrame)) { state.selectedAnnotationId = null; state.selectedAnnotationFrame = null; }
    showCachedFrame(targetFrame);
    playback.currentTime = targetFrame / state.fps;
    updatePlaybackUI(targetFrame / state.fps, targetFrame);
    if (renderFrameContent) updateFrameContent(true);
  }

  function step(frames) { pause(); if (Math.abs(frames) === 1) playback.step(frames); else seekFrame(currentFrame() + frames); }

  function syncRulerToTimeline() {
    els.ruler.style.transform = `translate3d(${-els.timelineWrap.scrollLeft}px, 0, 0)`;
  }

  function keepPlayheadInView(ratio) {
    if (state.timelineScrub) return;
    const viewportWidth = els.timelineWrap.clientWidth;
    const trackWidth = els.timelineTrack.getBoundingClientRect().width;
    if (!viewportWidth || !trackWidth) return;
    if (trackWidth <= viewportWidth + 1) {
      if (els.timelineWrap.scrollLeft) els.timelineWrap.scrollLeft = 0;
      syncRulerToTimeline();
      return;
    }

    const playheadX = ratio * trackWidth;
    const currentScroll = els.timelineWrap.scrollLeft;
    const maxScroll = Math.max(0, trackWidth - viewportWidth);
    let targetScroll = currentScroll;

    if (!playback.paused || state.isReverse) {
      targetScroll = playheadX - viewportWidth * .35;
    } else {
      const safeInset = viewportWidth * .12;
      const visibleStart = currentScroll + safeInset;
      const visibleEnd = currentScroll + viewportWidth - safeInset;
      if (playheadX < visibleStart || playheadX > visibleEnd) targetScroll = playheadX - viewportWidth * .5;
    }

    targetScroll = clamp(targetScroll, 0, maxScroll);
    if (Math.abs(targetScroll - currentScroll) > .5) els.timelineWrap.scrollLeft = targetScroll;
    syncRulerToTimeline();
  }

  function stopPlaybackUiLoop() {
    if (state.playbackUiRaf) cancelAnimationFrame(state.playbackUiRaf);
    state.playbackUiRaf = null;
  }

  function startPlaybackUiLoop() {
    stopPlaybackUiLoop();
    const tick = () => {
      if (playback.paused || state.isReverse) {
        state.playbackUiRaf = null;
        return;
      }
      if (hasLoopRange() && playback.currentTime >= state.loopOutFrame / state.fps - frameDuration() * .25) {
        playback.currentTime = state.loopInFrame / state.fps;
      }
      if (!state.timelineScrub && !state.scrub && !state.scrubController.active) updateUI();
      state.playbackUiRaf = requestAnimationFrame(tick);
    };
    state.playbackUiRaf = requestAnimationFrame(tick);
  }

  function updatePlaybackUI(time = playback.currentTime || 0, frame = Math.round(time * state.fps)) {
    const t = time, duration = playback.duration || 0;
    frame = clamp(Math.round(frame), 0, lastFrame());
    const missing = playback.media?.missingFrames?.includes(sourceFrame(frame));
    missingFrameNotice.hidden = !missing;
    missingFrameNotice.textContent = missing ? `缺失帧 ${sourceFrame(frame)}` : '';
    const ratio = lastFrame() ? clamp(frame / lastFrame(), 0, 1) : 0;
    els.currentTimecode.textContent = formatTimecode(t);
    els.durationTimecode.textContent = formatTimecode(duration);
    els.frameReadout.textContent = `FRAME ${String(sourceFrame(frame)).padStart(5, '0')}`;
    els.secondsReadout.textContent = `${t.toFixed(3)} SEC`;
    els.timelineProgress.style.width = `${ratio * 100}%`;
    els.playhead.style.left = `${ratio * 100}%`;
    keepPlayheadInView(ratio);
    updateActiveMarker(Math.round(frame));
  }

  function updateFrameContent(force = false) {
    const frame = currentFrame();
    if (!force && state.lastFrameContent === frame) return;
    state.lastFrameContent = frame;
    if (state.annotationScope === 'current' && state.selectedAnnotationFrame !== null && state.selectedAnnotationFrame !== frame) {
      state.selectedAnnotationId = null;
      state.selectedAnnotationFrame = null;
    }
    drawAnnotations();
    if (state.annotationScope === 'current') renderAnnotationList();
  }

  function updateUI(forceFrameContent = false) {
    updatePlaybackUI();
    updateFrameContent(forceFrameContent);
  }

  function updateActiveMarker(frame = currentFrame()) {
    $$('.timeline-marker', els.markerLayer).forEach(marker => {
      const b = state.bookmarks.find(item => item.id === marker.dataset.id);
      marker.classList.toggle('active', !!b && b.frame === frame);
    });
    $$('.annotation-timeline-marker', els.annotationMarkerLayer).forEach(marker => marker.classList.toggle('active', Number(marker.dataset.frame) === frame));
  }

  function updateCacheStatus(hitFrame = null) {
    const count = state.frameCache.size;
    const label = hitFrame === null ? `CACHE · ${count}F` : `HIT · F${String(hitFrame).padStart(5, '0')}`;
    if (els.cacheStatus.textContent !== label) els.cacheStatus.textContent = label;
    els.cacheStatus.classList.toggle('hit', hitFrame !== null);
  }

  function clearFrameCache() {
    state.frameCacheGeneration += 1;
    if (state.frameCacheHandle !== null && playback.cancelVideoFrameCallback) playback.cancelVideoFrameCallback(state.frameCacheHandle);
    state.frameCacheHandle = null;
    state.frameCachePending = false;
    state.frameCache.forEach(frame => frame.close?.());
    state.frameCache.clear();
    state.frameCacheSizes.clear();
    state.frameCacheBytes = 0;
    state.frameCacheCapture = null;
    els.cacheCtx.clearRect(0, 0, els.cacheCanvas.width, els.cacheCanvas.height);
    els.cacheCanvas.classList.remove('visible');
    updateCacheStatus();
  }

  function putCachedFrame(frame, image) {
    const previous = state.frameCache.get(frame);
    previous?.close?.();
    state.frameCacheBytes -= state.frameCacheSizes.get(frame) || 0;
    state.frameCache.delete(frame);
    state.frameCacheSizes.delete(frame);
    state.frameCache.set(frame, image);
    const bytes = Math.max(1, image.width) * Math.max(1, image.height) * 4;
    state.frameCacheSizes.set(frame, bytes);
    state.frameCacheBytes += bytes;
    while (state.frameCache.size > state.frameCacheMax || state.frameCacheBytes > 96 * 1024 * 1024) {
      const oldestFrame = state.frameCache.keys().next().value;
      state.frameCache.get(oldestFrame)?.close?.();
      state.frameCacheBytes -= state.frameCacheSizes.get(oldestFrame) || 0;
      state.frameCache.delete(oldestFrame);
      state.frameCacheSizes.delete(oldestFrame);
    }
    updateCacheStatus();
  }

  async function captureFrame(frame = currentFrame()) {

    if (state.frameCachePending || state.frameCache.has(frame) || playback.readyState < 2 || !playback.videoWidth) return;
    state.frameCachePending = true;
    const generation = state.frameCacheGeneration;
    try {
      const scale = Math.min(1, 960 / playback.videoWidth, 540 / playback.videoHeight);
      const width = Math.max(2, Math.round(playback.videoWidth * scale));
      const height = Math.max(2, Math.round(playback.videoHeight * scale));
      if (!state.frameCacheCapture) state.frameCacheCapture = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
      const surface = state.frameCacheCapture;
      if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; }
      surface.getContext('2d', { alpha: false }).drawImage(playback.currentFrameCanvas, 0, 0, width, height);
      const bytesPerFrame = width * height * 4;
      state.frameCacheMax = clamp(Math.floor(96 * 1024 * 1024 / bytesPerFrame), 24, 144);
      let image;
      if (surface.transferToImageBitmap) image = surface.transferToImageBitmap();
      else if (window.createImageBitmap) image = await createImageBitmap(surface);
      else {
        image = document.createElement('canvas'); image.width = width; image.height = height;
        image.getContext('2d').drawImage(surface, 0, 0);
      }
      if (generation !== state.frameCacheGeneration) { image.close?.(); return; }
      putCachedFrame(frame, image);
    } catch { /* decoding can briefly be unavailable while seeking */ }
    finally { if (generation === state.frameCacheGeneration) state.frameCachePending = false; }
  }

  function nearestCachedFrame(frame) {
    if (state.frameCache.has(frame)) return frame;
    for (let distance = 1; distance <= 2; distance++) {
      if (state.frameCache.has(frame - distance)) return frame - distance;
      if (state.frameCache.has(frame + distance)) return frame + distance;
    }
    return null;
  }

  function showCachedFrame(frame, exact = false) {
    const requestedFrame = Math.round(frame);
    const cachedFrame = exact ? (state.frameCache.has(requestedFrame) ? requestedFrame : null) : nearestCachedFrame(requestedFrame);
    if (cachedFrame === null) { hideCachedFrame(); return false; }
    const image = state.frameCache.get(cachedFrame);
    state.frameCache.delete(cachedFrame); state.frameCache.set(cachedFrame, image);
    if (els.cacheCanvas.width !== image.width || els.cacheCanvas.height !== image.height) {
      els.cacheCanvas.width = image.width; els.cacheCanvas.height = image.height;
    }
    els.cacheCtx.clearRect(0, 0, els.cacheCanvas.width, els.cacheCanvas.height);
    els.cacheCtx.drawImage(image, 0, 0, els.cacheCanvas.width, els.cacheCanvas.height);
    els.cacheCanvas.classList.add('visible');
    scheduleColorRender();
    updateCacheStatus(cachedFrame);
    return true;
  }

  function hideCachedFrame() {
    els.cacheCanvas.classList.remove('visible');
    scheduleColorRender();
    els.cacheStatus.classList.remove('hit');
    updateCacheStatus();
  }

  function startFrameCacheLoop() {
    if (!playback.requestVideoFrameCallback) return;
    if (state.frameCacheHandle !== null) playback.cancelVideoFrameCallback?.(state.frameCacheHandle);
    const watchFrame = (_now, metadata) => {
      captureFrame(Math.round(metadata.mediaTime * state.fps));
      scheduleColorRender();
      state.frameCacheHandle = playback.requestVideoFrameCallback(watchFrame);
    };
    state.frameCacheHandle = playback.requestVideoFrameCallback(watchFrame);
  }

  async function cacheFrameFromMedia(media, frame, generation = state.frameCacheGeneration) {
    if (!media?.currentFrameCanvas || !media.videoWidth || generation !== state.frameCacheGeneration) return false;
    const source = media.currentFrameCanvas;
    const sourceWidth = source.width || media.videoWidth, sourceHeight = source.height || media.videoHeight;
    const scale = Math.min(1, 960 / sourceWidth, 540 / sourceHeight);
    const width = Math.max(2, Math.round(sourceWidth * scale)), height = Math.max(2, Math.round(sourceHeight * scale));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d', { alpha: false }).drawImage(source, 0, 0, width, height);
    let image;
    if (canvas.transferToImageBitmap) image = canvas.transferToImageBitmap();
    else if (window.createImageBitmap) image = await createImageBitmap(canvas);
    else { image = document.createElement('canvas'); image.width = width; image.height = height; image.getContext('2d').drawImage(canvas, 0, 0); }
    if (generation !== state.frameCacheGeneration) { image.close?.(); return false; }
    putCachedFrame(frame, image);
    return true;
  }

  function resetScrubDecoder() {
    clearTimeout(state.scrubPrefetchTimer); state.scrubPrefetchTimer = null;
    state.scrubInteraction += 1;
    const decoder = state.scrubDecoder;
    state.scrubDecoder = null; state.scrubDecoderPromise = null; state.scrubDecoderFrame = null; state.scrubDecoderMediaId = null;
    state.scrubWorkerBusy = !!state.scrubWorkerPromise; state.scrubDisplayFrame = null; state.scrubFinalizing = false;
    Object.assign(state.scrubController, { active: false, pointerTargetFrame: null, targetFrame: null, presentedFrame: null, direction: 0, inFlight: false });
    if (decoder && decoder !== playback) Promise.resolve(decoder.destroy()).catch(() => {});
  }

  async function ensureScrubDecoder(anchorFrame = currentFrame()) {
    const mediaId = playback.media?.mediaId || playback.currentSrc;
    if (!mediaId) throw new Error('没有可供拖动的媒体');
    if (state.scrubDecoder && state.scrubDecoderMediaId === mediaId && state.scrubDecoder.readyState >= 2) return state.scrubDecoder;
    if (state.scrubDecoderPromise) return state.scrubDecoderPromise;
    const generation = state.frameCacheGeneration;
    let decoder;
    const promise = (async () => {
      decoder = AstriaPlayback.create(null, { purpose: 'scrub', maxWidth: 960, maxHeight: 540 });
      decoder.muted = true; decoder.setProjectFps(state.fps);
      const metadata = waitForMediaEvent(decoder, 'loadedmetadata', 8000);
      const loaded = waitForMediaEvent(decoder, 'loadeddata', 8000);
      decoder.open(playback.media);
      await metadata; await loaded;
      if (generation !== state.frameCacheGeneration) throw new Error('拖动解码器已过期');
      state.scrubDecoder = decoder; state.scrubDecoderMediaId = mediaId;
      const target = clamp(Math.round(anchorFrame), 0, lastFrame());
      if (target) await decoder.seekFrameExact(target, state.fps);
      state.scrubDecoderFrame = target;
      await cacheFrameFromMedia(decoder, target, generation);
      return decoder;
    })().catch(async error => {
      if (generation === state.frameCacheGeneration && (!state.scrubDecoder || state.scrubDecoder === decoder)) {
        state.scrubDecoder = null; state.scrubDecoderMediaId = null; state.scrubDecoderFrame = null;
      }
      if (decoder) await Promise.resolve(decoder.destroy()).catch(() => {});
      throw error;
    }).finally(() => { if (state.scrubDecoderPromise === promise) state.scrubDecoderPromise = null; });
    state.scrubDecoderPromise = promise;
    return promise;
  }

  async function positionScrubDecoder(targetFrame, generation = state.frameCacheGeneration) {
    let decoder;
    try { decoder = await ensureScrubDecoder(targetFrame); }
    catch { decoder = playback; state.scrubDecoderFrame = currentFrame(); }
    if (generation !== state.frameCacheGeneration) return false;
    const target = clamp(Math.round(targetFrame), 0, lastFrame());
    const delta = target - state.scrubDecoderFrame;
    if (delta === 1 || delta === -1) await decoder.stepFrame(Math.sign(delta), state.fps);
    else if (delta) await decoder.seekFrameExact(target, state.fps);
    if (generation !== state.frameCacheGeneration || (decoder !== playback && state.scrubDecoder !== decoder)) return false;
    state.scrubDecoderFrame = target;
    return cacheFrameFromMedia(decoder, target, generation);
  }

  function scheduleScrubPrefetch(delay = 600) {
    clearTimeout(state.scrubPrefetchTimer);
    if (!playback.duration) return;
    state.scrubPrefetchTimer = setTimeout(prefetchScrubWindow, delay);
  }

  async function prefetchScrubWindow() {
    if (!playback.duration || !playback.paused || state.scrubController.active || state.scrubWorkerBusy || document.hidden) {
      scheduleScrubPrefetch(900); return;
    }
    const generation = state.frameCacheGeneration, anchor = currentFrame();
    const direction = state.scrubController.direction || 1;
    const forward = direction > 0 ? 33 : 14, backward = direction > 0 ? 14 : 33;
    const targets = [];
    for (let distance = 0; distance <= forward; distance++) targets.push(clamp(anchor + distance * direction, 0, lastFrame()));
    for (let distance = 1; distance <= backward; distance++) targets.push(clamp(anchor - distance * direction, 0, lastFrame()));
    state.scrubWorkerBusy = true;
    const work = (async () => {
      try {
        for (const frame of [...new Set(targets)]) {
          if (generation !== state.frameCacheGeneration || state.scrubController.active || !playback.paused) break;
          if (state.frameCache.has(frame)) continue;
          await positionScrubDecoder(frame, generation);
        }
      } catch { /* prefetch is optional; active scrub can fall back to the main player */ }
    })().finally(() => {
      if (state.scrubWorkerPromise !== work) return;
      state.scrubWorkerPromise = null; state.scrubWorkerBusy = false;
      if (generation !== state.frameCacheGeneration) return;
      if (state.scrubController.active) pumpProfessionalScrub();
      else scheduleScrubPrefetch(1200);
    });
    state.scrubWorkerPromise = work;
    await work;
  }

  function announceInitialMediaPresented(immediate = false) {
    if (state.initialMediaPresentationSent || !desktopAPI?.initialMediaPresented) return;
    state.initialMediaPresentationSent = true;
    const announce = () => requestAnimationFrame(() => desktopAPI.initialMediaPresented());
    if (!immediate && playback.requestVideoFrameCallback) playback.requestVideoFrameCallback(announce);
    else announce();
  }

  function waitForMediaEvent(media, eventName, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`${eventName} timeout`)); }, timeout);
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('media error')); };
      const cleanup = () => {
        clearTimeout(timer);
        media.removeEventListener(eventName, done);
        media.removeEventListener('error', failed);
      };
      media.addEventListener(eventName, done, { once: true });
      media.addEventListener('error', failed, { once: true });
    });
  }

  async function seekAuxiliaryVideo(media, time) {
    if (Math.abs(media.currentTime - time) < .002) {
      if (media.readyState >= 2) return;
      await waitForMediaEvent(media, 'loadeddata'); return;
    }
    const ready = waitForMediaEvent(media, 'seeked');
    media.currentTime = time;
    await ready;
  }

  function hideTimelinePreview() {
    els.timelineTooltip.classList.remove('show');
    state.timelinePreviewPending = null;
    cancelAnimationFrame(state.timelinePreviewRaf);
    state.timelinePreviewRaf = null;
    if (state.timelinePreviewVideo && !state.scrubController.active) warmTimelinePreview();
  }

  function disposeTimelinePreview() {
    hideTimelinePreview();
    state.timelinePreviewGeneration += 1;
    clearTimeout(state.timelinePreviewWarmTimer);
    state.timelinePreviewActive = null;
    state.timelinePreviewWarmIndex = 0;
    const media = state.timelinePreviewVideo;
    state.timelinePreviewVideo = null;
    if (media) media.destroy();
    state.timelinePreviewCache.clear();
    delete els.timelineTooltip.dataset.previewTime;
    els.timelinePreviewImage.width = 0;
  }

  function ensureTimelinePreviewVideo() {
    const source = playback.currentSrc || playback.src;
    if (!source) return null;
    if (state.timelinePreviewVideo?.src === source) return state.timelinePreviewVideo;
    const generation = state.timelinePreviewGeneration;
    const media = AstriaPlayback.create();
    media.muted = true; media.preload = 'auto'; media.playsInline = true;
    state.timelinePreviewVideo = media;
    const current = () => generation === state.timelinePreviewGeneration && state.timelinePreviewVideo === media;
    media.addEventListener('loadedmetadata', () => { if (current()) { pumpTimelinePreview(); warmTimelinePreview(); } });
    const present = () => { if (current()) presentTimelinePreview(media); };
    media.addEventListener('loadeddata', present);
    media.addEventListener('seeked', present);
    media.addEventListener('error', () => {
      if (current()) state.timelinePreviewActive = null;
      if (current() && state.timelinePreviewPending) $('.preview-status', els.timelineTooltip).textContent = '此位置无法预览';
    });
    media.setProjectFps(state.fps);
    media.open(playback.media);
    return media;
  }

  function showTimelinePreviewCanvas(canvas, time, approximate = false) {
    const output = els.timelinePreviewImage;
    output.width = canvas.width; output.height = canvas.height;
    output.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0);
    els.timelineTooltip.dataset.previewTime = String(time);
    els.timelineTooltip.classList.remove('loading');
    els.timelineTooltip.classList.toggle('approximate', approximate);
    const frame = Math.floor(time * state.fps);
    $('b', els.timelineTooltip).textContent = `F ${String(sourceFrame(frame)).padStart(5,'0')}`;
    $('span', els.timelineTooltip).textContent = formatTimecode(frame / state.fps);
  }

  function requestTimelinePreview(time, frame) {
    clearTimeout(state.timelinePreviewWarmTimer);
    state.timelinePreviewPending = { time, frame };
    const cached = state.timelinePreviewCache.get(time) || state.frameCache.get(frame);
    if (cached) { showTimelinePreviewCanvas(cached, time); return; }
    let nearest = null;
    for (const [cachedTime, canvas] of state.timelinePreviewCache) {
      if (!nearest || Math.abs(cachedTime - time) < Math.abs(nearest.time - time)) nearest = { time: cachedTime, canvas };
    }
    for (const [cachedFrame, canvas] of state.frameCache) {
      const cachedTime = (cachedFrame + .25) / state.fps;
      if (!nearest || Math.abs(cachedTime - time) < Math.abs(nearest.time - time)) nearest = { time: cachedTime, canvas };
    }
    if (nearest) showTimelinePreviewCanvas(nearest.canvas, nearest.time, true);
    else {
      els.timelineTooltip.classList.add('loading');
      els.timelineTooltip.classList.remove('approximate');
      $('.preview-status', els.timelineTooltip).textContent = '正在取帧…';
    }
    if (state.timelinePreviewRaf === null) {
      state.timelinePreviewRaf = requestAnimationFrame(() => {
        state.timelinePreviewRaf = null;
        pumpTimelinePreview();
      });
    }
  }

  function pumpTimelinePreview() {
    const request = state.timelinePreviewPending;
    if (!request || !state.timelineHoverPreview) return;
    const media = ensureTimelinePreviewVideo();
    if (!media || media.readyState < 1 || !Number.isFinite(media.duration)) return;
    if (state.timelinePreviewCache.has(request.time) || state.frameCache.has(request.frame)) return;
    // Finish one foreground decode; pointer moves only replace the next target.
    // A background sample may be interrupted once to prioritize the pointer.
    if (state.timelinePreviewActive && !state.timelinePreviewActive.background) return;
    state.timelinePreviewActive = { ...request, background: false };
    if (Math.abs(media.currentTime - request.time) > .00001) media.currentTime = request.time;
    else presentTimelinePreview(media);
  }

  function warmTimelinePreview() {
    clearTimeout(state.timelinePreviewWarmTimer);
    if (state.scrubController.active) return;
    const generation = state.timelinePreviewGeneration;
    state.timelinePreviewWarmTimer = setTimeout(() => {
      if (generation !== state.timelinePreviewGeneration || state.timelinePreviewPending || state.timelinePreviewActive || !state.timelineHoverPreview) return;
      const media = state.timelinePreviewVideo;
      if (!media || media.readyState < 1 || !Number.isFinite(media.duration)) return;
      const count = Math.min(64, Math.max(2, Math.ceil(media.duration * 2)));
      if (state.timelinePreviewWarmIndex >= count) return;
      const frame = Math.min(Math.max(0, Math.ceil(media.duration * state.fps) - 1), Math.floor(state.timelinePreviewWarmIndex++ / (count - 1) * media.duration * state.fps));
      const time = Math.min((frame + .25) / state.fps, Math.max(0, media.duration - .001));
      if (state.timelinePreviewCache.has(time)) { warmTimelinePreview(); return; }
      state.timelinePreviewActive = { time, frame, background: true };
      if (Math.abs(media.currentTime - time) > .00001) media.currentTime = time;
      else presentTimelinePreview(media);
    }, 80);
  }

  function presentTimelinePreview(media) {
    const active = state.timelinePreviewActive;
    if (!active || media.seeking || media.readyState < 2 || Math.abs(media.currentTime - active.time) > .00001) return;
    state.timelinePreviewActive = null;
    const canvas = document.createElement('canvas');
    const aspect = media.videoWidth / Math.max(1, media.videoHeight);
    canvas.width = aspect >= 1 ? 320 : Math.max(1, Math.round(180 * aspect));
    canvas.height = aspect >= 1 ? Math.max(1, Math.round(320 / aspect)) : 180;
    try {
      canvas.getContext('2d', { alpha: false }).drawImage(media.currentFrameCanvas, 0, 0, canvas.width, canvas.height);
      state.timelinePreviewCache.set(active.time, canvas);
      if (state.timelinePreviewCache.size > 128) state.timelinePreviewCache.delete(state.timelinePreviewCache.keys().next().value);
      const request = state.timelinePreviewPending;
      if (request) requestTimelinePreview(request.time, request.frame);
    } catch { $('.preview-status', els.timelineTooltip).textContent = '此位置无法预览'; }
    if (state.timelinePreviewPending) pumpTimelinePreview();
    else warmTimelinePreview();
  }

  function setLoopPoint(kind) {
    if (!playback.duration) { toast('请先打开视频'); return; }
    const frame = currentFrame();
    if (kind === 'in') {
      state.loopInFrame = frame;
      if (Number.isFinite(state.loopOutFrame) && state.loopOutFrame <= frame) state.loopOutFrame = null;
      toast(`A 点已设置 · Frame ${sourceFrame(frame)}`);
    } else {
      if (Number.isFinite(state.loopInFrame) && frame <= state.loopInFrame) { toast('B 点需要位于 A 点之后'); return; }
      state.loopOutFrame = frame;
      toast(`B 点已设置 · Frame ${sourceFrame(frame)}`);
    }
    renderLoopRange(); saveWorkspace();
  }

  function clearLoopPoint(kind) {
    if (kind === 'in') state.loopInFrame = null; else state.loopOutFrame = null;
    renderLoopRange(); saveWorkspace(); toast(`${kind === 'in' ? 'A' : 'B'} 点已清除`);
  }

  function renderLoopRange() {
    const total = Math.max(1, lastFrame());
    const inSet = Number.isFinite(state.loopInFrame);
    const outSet = Number.isFinite(state.loopOutFrame);
    els.loopInMarker.classList.toggle('show', inSet);
    els.loopOutMarker.classList.toggle('show', outSet);
    if (inSet) els.loopInMarker.style.left = `${clamp(state.loopInFrame / total * 100, 0, 100)}%`;
    if (outSet) els.loopOutMarker.style.left = `${clamp(state.loopOutFrame / total * 100, 0, 100)}%`;
    els.loopRange.classList.toggle('show', hasLoopRange());
    if (hasLoopRange()) {
      const left = clamp(state.loopInFrame / total * 100, 0, 100);
      const right = clamp(state.loopOutFrame / total * 100, 0, 100);
      els.loopRange.style.left = `${left}%`; els.loopRange.style.width = `${right - left}%`;
    }
  }

  function loadMediaSource(media, ownedObjectUrl = null) {
    if (!media?.url || !media?.name) { toast('请选择有效的视频文件'); return; }
    persistCurrentWorkspaceNow();
    pause();
    hideAnnotationRadialMenu();
    cancelTextAnnotation();
    unlockPixelInspector(true);
    $('#transportSettings').removeAttribute('open');
    resetScrubDecoder(); clearFrameCache();
    disposeTimelinePreview();
    state.annotationUndo = []; state.quickGesture = null;
    state.viewerZoomMode = 'fit'; state.viewerZoom = 1; state.viewerPan = { x: 0, y: 0 };
    setMediaReady(false);
    document.body.classList.add('media-loading');
    els.viewerStage.classList.remove('has-video');
    els.ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    if (state.currentObjectUrl) URL.revokeObjectURL(state.currentObjectUrl);
    state.currentObjectUrl = ownedObjectUrl;
    state.sourcePath = media.path || null;
    state.fileName = media.name;
    state.fileMeta = { name: media.name, size: media.size || 0, type: media.type || 'video/*', modified: media.lastModified || 0, path: media.path || null, mediaId: media.mediaId, mediaKind: media.mediaKind || 'video', sourceFps: media.sourceFps || null, sourceFrameOffset: media.sourceFrameOffset || 0, sequence: media.sequence || null };
    activateMediaWorkspace(state.fileMeta);
    playback.setProjectFps(state.fps);
    playback.open(media);
    els.projectName.textContent = media.name;
    els.projectName.title = media.name;
    document.title = `${media.name} — Astria`;
    desktopAPI?.setWindowTitle(`${media.name} — Astria`);
    setStatus(`正在载入 ${media.name}`);

  }

  async function openVideo(file) {
    if (desktopAPI) { openDesktopVideo(await desktopAPI.describeDroppedFile(file)); return; }
    const extension = file?.name?.split('.').pop()?.toLowerCase();
    const looksLikeVideo = file && (file.type?.startsWith('video/') || AstriaFormats.browser.includes(extension));
    if (!looksLikeVideo) { toast('请选择有效的视频文件'); return; }
    const objectUrl = URL.createObjectURL(file);
    loadMediaSource({ url: objectUrl, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }, objectUrl);
  }

  function openDesktopVideo(media) {
    if (!media) return;
    if (media.error) { announceInitialMediaPresented(true); toast(media.error === 'missing' ? '视频文件已移动或删除' : '无法打开视频'); refreshRecentVideos(); return; }
    loadMediaSource(media);
    refreshRecentVideos();
  }

  function onMetadata() {
    state.fileMeta.sourceFps = Number(playback.media?.sourceFps || playback.media?.fps) || null;
    if (state.fileMeta.mediaKind === 'video' && state.fpsMode === 'source' && state.fileMeta.sourceFps) {
      state.fps = state.fileMeta.sourceFps;
      playback.setProjectFps(state.fps);
      els.fpsInput.value = Number(state.fps.toFixed(3));
      $('#hudFps').textContent = `${Number(state.fps.toFixed(3))} FPS`;
      $('#propFps').textContent = `${Number(state.fps.toFixed(3))} fps`;
    }
    document.body.classList.remove('media-loading');
    els.viewerStage.classList.add('has-video');
    setMediaReady(true);
    playback.playbackRate = state.playbackSpeed;
    $('#hudResolution').textContent = `${playback.videoWidth} × ${playback.videoHeight}`;
    $('#propFilename').textContent = state.fileName;
    $('#propResolution').textContent = `${playback.videoWidth} × ${playback.videoHeight}`;
    $('#propDuration').textContent = formatClock(playback.duration);
    $('#propFrames').textContent = totalFrames().toLocaleString();
    setStatus('视频已就绪');
    resetViewerView(false); renderTimeline(); updateUI(); startFrameCacheLoop(); captureFrame(); renderCompositionGuides(); scheduleScrubPrefetch(250);
    if (state.colorPreset !== 'original') scheduleColorRender();
    if (state.timelineHoverPreview) ensureTimelinePreviewVideo();
    saveWorkspace();
    if (!state.startupModeApplied) {
      state.startupModeApplied = true;
      if (state.startupMode === 'clean') setCleanMode(true);
    }
    fitVideoWindowToMedia();
    if (state.autoplayOnOpen && !playback.reconfiguring) play();
  }

  function viewerFitScale(stage = els.viewerStage.getBoundingClientRect()) {
    if (!playback.videoWidth || !playback.videoHeight || !stage.width || !stage.height) return 1;
    return Math.min(stage.width / playback.videoWidth, stage.height / playback.videoHeight);
  }

  function updateViewerZoomUI(scale) {
    const percent = Math.max(1, Math.round(scale * 100));
    els.viewerZoomValue.textContent = state.viewerZoomMode === 'fit' ? `${percent}%` : `${percent}%`;
    if (state.viewerZoomMode === 'fit') els.viewerZoomSelect.value = 'fit';
    else {
      const preset = ['0.25','0.5','1','2'].find(value => Math.abs(Number(value) - state.viewerZoom) < .001);
      els.viewerZoomSelect.value = preset || 'custom';
    }
  }

  function clampViewerPan(width, height, stage) {
    const maxX = Math.max(0, (width - stage.width) / 2);
    const maxY = Math.max(0, (height - stage.height) / 2);
    state.viewerPan.x = clamp(state.viewerPan.x, -maxX, maxX);
    state.viewerPan.y = clamp(state.viewerPan.y, -maxY, maxY);
  }

  function resizeCanvas() {
    if (!playback.videoWidth) return;
    const stage = els.viewerStage.getBoundingClientRect();
    if (!stage.width || !stage.height) return;
    const scale = state.viewerZoomMode === 'fit' ? viewerFitScale(stage) : clamp(state.viewerZoom, .05, 4);
    const width = Math.max(1, playback.videoWidth * scale);
    const height = Math.max(1, playback.videoHeight * scale);
    clampViewerPan(width, height, stage);
    els.mediaSurface.style.width = `${width}px`;
    els.mediaSurface.style.height = `${height}px`;
    els.mediaSurface.style.transform = `translate3d(${state.viewerPan.x}px,${state.viewerPan.y}px,0)`;
    // Keep the falloff outside the picture, including wide pillarbox/letterbox areas.
    const workspace = $('.workspace').getBoundingClientRect();
    ambient.canvas.style.width = `${Math.max(width * 1.5, workspace.width * 1.35)}px`;
    ambient.canvas.style.height = `${Math.max(height * 1.5, stage.height * 1.35)}px`;
    ambient.canvas.style.left = `${workspace.width / 2}px`;
    ambient.canvas.style.top = `${stage.top - workspace.top + stage.height / 2}px`;
    ambient.canvas.style.transform = els.mediaSurface.style.transform;
    topbarAmbientCanvas.style.cssText = ambient.canvas.style.cssText;
    const header = $('.topbar').getBoundingClientRect();
    topbarAmbientCanvas.style.left = `${workspace.left - header.left + workspace.width / 2}px`;
    topbarAmbientCanvas.style.top = `${stage.top - header.top + stage.height / 2}px`;
    const dpr = window.devicePixelRatio || 1;
    const renderScale = Math.max(.25, Math.min(dpr, 4096 / width, 4096 / height));
    els.canvas.width = Math.max(1, Math.round(width * renderScale));
    els.canvas.height = Math.max(1, Math.round(height * renderScale));
    els.ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    scheduleColorRender();
    updateViewerZoomUI(scale);
    drawAnnotations();
  }

  function scheduleLayoutRefresh() {
    hideTimelinePreview();
    if (state.viewerResizeRaf !== null) return;
    state.viewerResizeRaf = requestAnimationFrame(() => {
      state.viewerResizeRaf = null;
      resizeCanvas();
      renderRuler();
      updatePlaybackUI();
    });
  }

  function resetViewerView(showNotice = true) {
    state.viewerZoomMode = 'fit';
    state.viewerZoom = 1;
    state.viewerPan = { x: 0, y: 0 };
    resizeCanvas();
    if (showNotice && playback.videoWidth) toast('画面已适应播放器大小');
  }

  function setViewerZoom(value, showNotice = true) {
    if (!playback.videoWidth) return;
    if (value === 'fit') { resetViewerView(showNotice); return; }
    state.viewerZoomMode = 'custom';
    state.viewerZoom = clamp(Number(value) || 1, .05, 4);
    state.viewerPan = { x: 0, y: 0 };
    resizeCanvas();
    if (showNotice) toast(state.viewerZoom === 1 ? '画面已恢复为 1:1' : `画面缩放 ${Math.round(state.viewerZoom * 100)}%`);
  }

  function zoomViewerAt(clientX, clientY, direction) {
    if (!playback.videoWidth) return;
    const stage = els.viewerStage.getBoundingClientRect();
    const currentScale = state.viewerZoomMode === 'fit' ? viewerFitScale(stage) : state.viewerZoom;
    const nextScale = clamp(currentScale * (direction > 0 ? 1.12 : 1 / 1.12), .05, 4);
    const offsetX = clientX - (stage.left + stage.width / 2);
    const offsetY = clientY - (stage.top + stage.height / 2);
    const ratio = nextScale / currentScale;
    state.viewerPan.x = offsetX - (offsetX - state.viewerPan.x) * ratio;
    state.viewerPan.y = offsetY - (offsetY - state.viewerPan.y) * ratio;
    state.viewerZoomMode = 'custom';
    state.viewerZoom = nextScale;
    resizeCanvas();
  }

  function thumbnail() {
    if (!playback.videoWidth) return '';
    const c = document.createElement('canvas');
    c.width = 256; c.height = Math.round(256 * playback.videoHeight / playback.videoWidth);
    c.getContext('2d').drawImage(playback.currentFrameCanvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .72);
  }

  function createBookmark() {
    if (!playback.duration) { toast('请先打开视频'); return; }
    pause();
    const frame = currentFrame();
    const existing = state.bookmarks.find(b => b.frame === frame);
    if (existing) { selectBookmark(existing.id); toast('当前帧已有书签'); return; }
    const now = new Date().toISOString();
    const bookmark = {
      id: uid(), frame, timestamp: playback.currentTime, title: `关键帧 ${String(sourceFrame(frame)).padStart(5, '0')}`,
      description: '', color: '#ff9f43', tags: [], favorite: false, rating: 0,
      thumbnail: thumbnail(), notes: '', createdTime: now, updatedTime: now
    };
    state.bookmarks.push(bookmark); state.selectedBookmarkIds = [bookmark.id];
    renderBookmarks(); renderTimeline(); syncNotes(); saveWorkspace(); toast(`已添加书签 · Frame ${sourceFrame(frame)}`);
    requestAnimationFrame(() => {
      const title = $(`.bookmark-card[data-id="${bookmark.id}"] .bookmark-title`);
      if (title && state.panelOpen) { title.contentEditable = 'true'; title.focus({ preventScroll: true }); document.execCommand?.('selectAll', false, null); }
    });
  }

  function selectBookmark(id, additive = false, range = false) {
    const index = state.bookmarks.findIndex(b => b.id === id);
    if (index < 0) return;
    if (range && state.selectedBookmarkIds.length) {
      const lastIndex = state.bookmarks.findIndex(b => b.id === state.selectedBookmarkIds.at(-1));
      const [a, z] = [lastIndex, index].sort((x,y) => x-y);
      state.selectedBookmarkIds = state.bookmarks.slice(a, z + 1).map(b => b.id);
    } else if (additive) {
      state.selectedBookmarkIds = state.selectedBookmarkIds.includes(id)
        ? state.selectedBookmarkIds.filter(item => item !== id) : [...state.selectedBookmarkIds, id];
    } else state.selectedBookmarkIds = [id];
    const bookmark = state.bookmarks[index];
    seekFrame(bookmark.frame);
    renderBookmarks(); renderTimeline(); syncNotes();
    if (state.panelOpen) requestAnimationFrame(() => $(`.bookmark-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' }));
  }

  function deleteSelection() {
    if (state.selectedAnnotationFrame !== null) {
      state.annotations = state.annotations.filter(annotation => annotation.frame !== state.selectedAnnotationFrame);
      state.selectedAnnotationId = null; state.selectedAnnotationFrame = null; renderAnnotationList(); renderTimeline(); drawAnnotations(); updateCounts(); saveWorkspace(); return;
    }
    if (!state.selectedBookmarkIds.length) return;
    const count = state.selectedBookmarkIds.length;
    state.bookmarks = state.bookmarks.filter(b => !state.selectedBookmarkIds.includes(b.id));
    state.selectedBookmarkIds = []; renderBookmarks(); renderTimeline(); syncNotes(); saveWorkspace(); toast(`已删除 ${count} 个书签`);
  }

  function renderBookmarks() {
    const query = $('#bookmarkSearch').value.trim().toLowerCase();
    const sort = $('#sortSelect').value;
    let list = state.bookmarks.filter(b => {
      const haystack = `${b.title} ${b.description} ${b.notes} ${b.tags.join(' ')} ${b.frame}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!state.favoriteOnly || b.favorite);
    });
    list.sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'rating' ? b.rating - a.rating : sort === 'created' ? a.createdTime.localeCompare(b.createdTime) : a.frame - b.frame);
    els.bookmarkList.classList.toggle('grid', state.view === 'grid');
    els.bookmarkList.innerHTML = '';
    if (!list.length) {
      els.bookmarkList.appendChild(els.bookmarkEmpty);
      els.bookmarkEmpty.style.display = 'flex';
    } else {
      list.forEach(b => {
        const card = document.createElement('article');
        card.className = `bookmark-card${state.selectedBookmarkIds.includes(b.id) ? ' selected' : ''}`;
        card.dataset.id = b.id; card.style.setProperty('--bookmark-color', b.color);
        card.innerHTML = `
          ${b.thumbnail ? `<img class="bookmark-thumb" src="${b.thumbnail}" alt="Frame ${sourceFrame(b.frame)}">` : '<div class="bookmark-thumb"></div>'}
          <div class="bookmark-meta">
            <div class="bookmark-title" title="双击重命名">${escapeHtml(b.title)}</div>
            <div class="bookmark-data"><b>F ${String(sourceFrame(b.frame)).padStart(5,'0')}</b><span>${formatTimecode(b.timestamp)}</span></div>
            <div class="tag-row">${b.tags.slice(0,3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          </div>
          <div class="bookmark-side"><button class="favorite-star ${b.favorite ? 'on' : ''}" title="收藏" aria-label="收藏书签" aria-pressed="${b.favorite ? 'true' : 'false'}">${reviewIcon('star')}</button><span class="rating">${b.rating ? '●'.repeat(b.rating) : '○'}</span></div>`;
        card.addEventListener('click', e => { if (!e.target.closest('.favorite-star') && !e.target.isContentEditable) selectBookmark(b.id, e.ctrlKey || e.metaKey, e.shiftKey); });
        $('.favorite-star', card).addEventListener('click', e => { e.stopPropagation(); b.favorite = !b.favorite; b.updatedTime = new Date().toISOString(); renderBookmarks(); saveWorkspace(); });
        const title = $('.bookmark-title', card);
        title.addEventListener('dblclick', e => { e.stopPropagation(); title.contentEditable = 'true'; title.focus(); });
        title.addEventListener('blur', () => { title.contentEditable = 'false'; b.title = title.textContent.trim() || `关键帧 ${b.frame}`; b.updatedTime = new Date().toISOString(); renderBookmarks(); saveWorkspace(); });
        title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
        card.addEventListener('contextmenu', e => { e.preventDefault(); showBookmarkMenu(e.clientX, e.clientY, b.id); });
        $('.rating', card).title = '点击循环设置 0–5 星评分';
        $('.rating', card).addEventListener('click', e => { e.stopPropagation(); b.rating = (b.rating + 1) % 6; b.updatedTime = new Date().toISOString(); renderBookmarks(); saveWorkspace(); });
        els.bookmarkList.appendChild(card);
      });
    }
    updateCounts();
  }

  function renderTimeline() {
    const width = Math.max(100, state.timelineZoom * 100);
    updateTimelineZoomUI();
    els.timelineTrack.style.width = `${width}%`;
    els.ruler.style.width = `${width}%`;
    els.markerLayer.innerHTML = '';
    els.annotationMarkerLayer.innerHTML = '';
    const timelineLastFrame = Math.max(1, lastFrame());
    state.bookmarks.forEach(b => {
      const marker = document.createElement('div');
      marker.className = `timeline-marker${state.selectedBookmarkIds.includes(b.id) ? ' active' : ''}`;
      marker.dataset.id = b.id; marker.style.left = `${clamp(b.frame / timelineLastFrame * 100, 0, 100)}%`;
      marker.style.setProperty('--marker-color', b.color); marker.title = `${b.title} · Frame ${sourceFrame(b.frame)}`;
      marker.addEventListener('click', e => { e.stopPropagation(); selectBookmark(b.id, e.ctrlKey || e.metaKey); });
      let moving = false;
      marker.addEventListener('pointerdown', e => { moving = true; marker.setPointerCapture(e.pointerId); pause(); e.stopPropagation(); });
      marker.addEventListener('pointermove', e => {
        if (!moving) return;
        const rect = els.timelineTrack.getBoundingClientRect();
        b.frame = Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * lastFrame());
        b.timestamp = b.frame / state.fps;
        marker.style.left = `${b.frame / timelineLastFrame * 100}%`; seekFrame(b.frame); renderBookmarks();
      });
      marker.addEventListener('pointerup', () => { moving = false; saveWorkspace(); });
      els.markerLayer.appendChild(marker);
    });
    const annotationsByFrame = new Map();
    state.annotations.forEach(annotation => {
      if (!annotationsByFrame.has(annotation.frame)) annotationsByFrame.set(annotation.frame, []);
      annotationsByFrame.get(annotation.frame).push(annotation);
    });
    annotationsByFrame.forEach((annotations, frame) => {
      const marker = document.createElement('div');
      marker.className = 'annotation-timeline-marker';
      marker.dataset.frame = frame;
      marker.style.left = `${clamp(frame / timelineLastFrame * 100, 0, 100)}%`;
      marker.style.setProperty('--annotation-marker-color', annotations[0].color || state.annotationColor);
      marker.title = `Frame ${sourceFrame(frame)} 有批注 · ${annotations.length} 个内容`;
      marker.addEventListener('pointerdown', e => e.stopPropagation());
      marker.addEventListener('click', e => {
        e.stopPropagation();
        state.selectedAnnotationId = annotations[0].id;
        state.selectedAnnotationFrame = frame;
        seekFrame(frame);
        showPanel('annotations');
        renderAnnotationList();
      });
      els.annotationMarkerLayer.appendChild(marker);
    });
    renderLoopRange(); renderRuler(); updateUI(); syncRulerToTimeline();
  }

  function renderRuler() {
    els.ruler.innerHTML = '';
    const duration = playback.duration || 0;
    if (!duration) return;
    const labels = Math.min(14, Math.max(5, Math.floor(els.ruler.clientWidth / 110)));
    for (let i = 0; i <= labels; i++) {
      const label = document.createElement('span'); label.className = 'ruler-label';
      label.style.left = `${i / labels * 100}%`; label.textContent = formatClock(duration * i / labels);
      els.ruler.appendChild(label);
    }
  }

  function updateTimelineZoomUI() {
    const percent = Math.round(state.timelineZoom * 100);
    els.timelineZoomValue.textContent = `${percent}%`;
    $('#resetTimelineZoomBtn').disabled = !document.body.classList.contains('media-ready') || state.timelineZoom === 1;
  }

  function resetTimelineZoom(showNotice = true) {
    state.timelineZoom = 1;
    renderTimeline(); saveWorkspace();
    if (showNotice) toast('时间轴缩放已恢复为 100%');
  }

  function syncNotes() {
    const b = selectedBookmark();
    els.notes.disabled = !b; els.notes.value = b?.notes || '';
    els.notes.placeholder = b ? '记录 Shader 思路、实现方式、疑问或 TODO…' : '选中书签后记录 Shader 思路、实现方式、疑问或 TODO…';
  }

  function showPanel(name) {
    $$('.panel-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === name));
    $$('.panel-view').forEach(panel => panel.classList.toggle('active', panel.id === `${name}Panel`));
    $('#notesSection').style.display = name === 'properties' ? 'none' : 'flex';
  }

  function setPanelOpen(open) {
    const changed = state.panelOpen !== !!open;
    state.panelOpen = !!open;
    document.body.classList.toggle('panel-collapsed', !state.panelOpen);
    const toggle = $('#togglePanelBtn');
    toggle.classList.toggle('active', state.panelOpen);
    toggle.setAttribute('aria-pressed', String(state.panelOpen));
    toggle.setAttribute('aria-label', state.panelOpen ? '隐藏分析面板' : '显示分析面板');
    toggle.title = `${state.panelOpen ? '隐藏' : '显示'}分析面板 (F2)`;
    if (changed) {
      fitVideoWindowToMedia(false); scheduleLayoutRefresh();
    }
  }

  function canvasPoint(e) {
    const rect = els.canvas.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1) };
  }

  function quickToolName(tool) {
    return ({select:'浏览 / Scrub',brush:'画笔',arrow:'箭头',rectangle:'矩形',text:'文字',eraser:'橡皮擦',circle:'圆形',highlight:'高亮'})[tool] || tool;
  }

  function setQuickAnnotationTool(tool, showNotice = true) {
    state.quickAnnotationTool = tool;
    $$('#annotationRadialMenu [data-quick-tool]').forEach(button => {
      const selected = button.dataset.quickTool === tool;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (!button.querySelector('.annotation-tool-name')) {
        const label = document.createElement('span');
        label.className = 'annotation-tool-name';
        label.textContent = button.dataset.quickTool === 'select' ? '浏览' : quickToolName(button.dataset.quickTool);
        button.append(label);
      }
    });
    $('#radialToolLabel').textContent = quickToolName(tool);
    if (showNotice) toast(`右键快速工具：${quickToolName(tool)}`);
  }

  function updateAnnotationSizeLabel() {
    $('#annotationSizeLabel').textContent = `${state.annotationSize} px`;
    els.annotationSizeRange.value = state.annotationSize;
  }

  function showAnnotationRadialMenu(clientX, clientY) {
    if (!playback.duration || state.cleanMode) return;
    setQuickAnnotationTool(state.quickAnnotationTool, false);
    updateAnnotationSizeLabel();
    els.radialMenu.classList.add('open');
    const rect = els.radialMenu.getBoundingClientRect();
    els.radialMenu.style.left = `${clamp(clientX + 8, 8, Math.max(8, innerWidth - rect.width - 8))}px`;
    els.radialMenu.style.top = `${clamp(clientY + 8, 8, Math.max(8, innerHeight - rect.height - 8))}px`;
    els.radialDismissLayer.classList.add('open');
    els.radialMenu.setAttribute('aria-hidden', 'false');
    els.radialDismissLayer.setAttribute('aria-hidden', 'false');
  }

  function hideAnnotationRadialMenu() {
    els.radialMenu.classList.remove('open');
    els.radialDismissLayer.classList.remove('open');
    els.radialMenu.setAttribute('aria-hidden', 'true');
    els.radialDismissLayer.setAttribute('aria-hidden', 'true');
  }

  function clientInsideCanvas(clientX, clientY) {
    const rect = els.canvas.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    if (!dx && !dy) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function annotationHitAt(annotation, clientX, clientY) {
    if (annotation.frame !== currentFrame()) return false;
    const rect = els.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const point = value => ({ x: value.x * rect.width, y: value.y * rect.height });
    const start = point(annotation.start), end = point(annotation.end);
    const threshold = Math.max(9, (annotation.strokeWidth ? annotation.strokeWidth * rect.width : 3) * 2.2);
    if (annotation.type === 'brush') {
      const points = annotation.points.map(point);
      if (points.length === 1) return Math.hypot(px - points[0].x, py - points[0].y) <= threshold;
      return points.some((current, index) => index && distanceToSegment(px, py, points[index - 1].x, points[index - 1].y, current.x, current.y) <= threshold);
    }
    if (annotation.type === 'arrow') return distanceToSegment(px, py, start.x, start.y, end.x, end.y) <= threshold * 1.4;
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x), top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
    if (annotation.type === 'text') return px >= start.x - threshold && px <= start.x + 180 && py >= start.y - 34 && py <= start.y + threshold;
    if (annotation.type === 'highlight') return px >= left - threshold && px <= right + threshold && py >= top - threshold && py <= bottom + threshold;
    if (annotation.type === 'rectangle') {
      const insideBounds = px >= left - threshold && px <= right + threshold && py >= top - threshold && py <= bottom + threshold;
      const nearEdge = Math.min(Math.abs(px-left),Math.abs(px-right),Math.abs(py-top),Math.abs(py-bottom)) <= threshold;
      return insideBounds && nearEdge;
    }
    if (annotation.type === 'circle') {
      const rx = Math.max(1,(right-left)/2), ry = Math.max(1,(bottom-top)/2), cx = (left+right)/2, cy = (top+bottom)/2;
      const ellipse = Math.sqrt(((px-cx)/rx)**2 + ((py-cy)/ry)**2);
      return Math.abs(ellipse - 1) <= threshold / Math.max(rx,ry) * 1.7;
    }
    return false;
  }

  function eraseAnnotationsAt(clientX, clientY) {
    const gesture = state.quickGesture;
    const hits = state.annotations.filter(annotation => annotationHitAt(annotation, clientX, clientY));
    if (!hits.length) return;
    if (!gesture.historyPushed) { pushAnnotationUndo(); gesture.historyPushed = true; }
    const ids = new Set(hits.map(annotation => annotation.id));
    state.annotations = state.annotations.filter(annotation => !ids.has(annotation.id));
    gesture.erasedCount += hits.length;
    state.selectedAnnotationId = null; state.selectedAnnotationFrame = null;
    drawAnnotations();
  }

  function beginQuickAnnotation(e) {
    if (e.button !== 2 || !playback.duration || state.cleanMode || !clientInsideCanvas(e.clientX, e.clientY)) return;
    e.preventDefault(); hideAnnotationRadialMenu();
    state.quickGesture = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, drawing: false,
      tool: e.shiftKey ? 'eraser' : (e.altKey ? 'arrow' : state.quickAnnotationTool),
      annotation: null, historyPushed: false, erasedCount: 0
    };
    els.viewerStage.setPointerCapture(e.pointerId);
  }

  function moveQuickAnnotation(e) {
    const gesture = state.quickGesture;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const movement = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
    if (!gesture.drawing && movement < 4) return;
    if (!gesture.drawing) {
      gesture.drawing = true; pause();
      if (gesture.tool === 'select') {
        gesture.scrubStartFrame = currentFrame(); beginProfessionalScrub();
      } else if (gesture.tool !== 'eraser') {
        const rect = els.canvas.getBoundingClientRect();
        const startEvent = { clientX: gesture.startX, clientY: gesture.startY };
        const p = canvasPoint(startEvent);
        gesture.annotation = { id: uid(), type: gesture.tool, frame: currentFrame(), color: state.annotationColor, strokeWidth: state.annotationSize / Math.max(1, rect.width), start: p, end: p, points: [p], text: '', hidden: false, locked: false, createdTime: new Date().toISOString() };
      } else eraseAnnotationsAt(gesture.startX, gesture.startY);
    }
    e.preventDefault();
    if (gesture.tool === 'select') {
      const px = e.clientX - gesture.startX;
      const factor = e.altKey ? 1 : (e.shiftKey ? state.viewerScrubSensitivity * .2 : state.viewerScrubSensitivity);
      updateProfessionalScrubTarget(gesture.scrubStartFrame + px * factor);
    } else if (gesture.tool === 'eraser') eraseAnnotationsAt(e.clientX, e.clientY);
    else {
      const p = canvasPoint(e); gesture.annotation.end = p;
      if (gesture.annotation.type === 'brush') gesture.annotation.points.push(p);
      drawAnnotations(gesture.annotation);
    }
  }

  function endQuickAnnotation(e) {
    const gesture = state.quickGesture;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    state.quickGesture = null;
    if (!gesture.drawing) { showAnnotationRadialMenu(e.clientX, e.clientY); return; }
    if (gesture.tool === 'select') { endProfessionalScrub(); return; }
    if (gesture.tool === 'eraser') {
      if (gesture.erasedCount) { refreshAnnotationUI(); toast(`已擦除 ${gesture.erasedCount} 个批注内容`); }
      else drawAnnotations();
      return;
    }
    commitAnnotation(gesture.annotation);
  }

  function adjustAnnotationSize(delta) {
    state.annotationSize = clamp(state.annotationSize + delta, 1, 24);
    const annotation = state.quickGesture?.annotation;
    if (annotation) annotation.strokeWidth = state.annotationSize / Math.max(1, els.canvas.getBoundingClientRect().width);
    updateAnnotationSizeLabel();
    if (annotation) drawAnnotations(annotation);
    persistPreferences();
  }

  function pushAnnotationUndo() {
    const snapshot = typeof structuredClone === 'function' ? structuredClone(state.annotations) : JSON.parse(JSON.stringify(state.annotations));
    state.annotationUndo.push(snapshot);
    if (state.annotationUndo.length > 50) state.annotationUndo.shift();
  }

  function refreshAnnotationUI() {
    updateAnnotationThumbnail(currentFrame());
    state.lastFrameContent = null;
    renderAnnotationList(); renderTimeline(); drawAnnotations(); updateCounts(); saveWorkspace();
  }

  function openTextAnnotation(a) {
    state.pendingTextAnnotation = a;
    drawAnnotations();
    const rect = els.canvas.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 24);
    const left = clamp(rect.left + a.start.x * rect.width, 12, innerWidth - width - 12);
    const preferredTop = rect.top + a.start.y * rect.height + 12;
    const top = clamp(preferredTop, 12, innerHeight - 50);
    els.textEditor.style.left = `${left}px`;
    els.textEditor.style.top = `${top}px`;
    els.textEditor.classList.add('open');
    els.textEditor.setAttribute('aria-hidden', 'false');
    els.textInput.value = '';
    requestAnimationFrame(() => els.textInput.focus());
  }

  function cancelTextAnnotation() {
    state.pendingTextAnnotation = null;
    els.textEditor.classList.remove('open');
    els.textEditor.setAttribute('aria-hidden', 'true');
    els.textInput.value = '';
    drawAnnotations();
  }

  function finishAnnotation(a) {
    pushAnnotationUndo();
    state.annotations.push(a); state.selectedAnnotationId = a.id; state.selectedAnnotationFrame = a.frame;
    refreshAnnotationUI(); toast(`已添加${annotationName(a.type)}批注`);
  }

  function confirmTextAnnotation() {
    const a = state.pendingTextAnnotation;
    const text = els.textInput.value.trim();
    if (!a || !text) { cancelTextAnnotation(); return; }
    a.text = text;
    state.pendingTextAnnotation = null;
    els.textEditor.classList.remove('open');
    els.textEditor.setAttribute('aria-hidden', 'true');
    finishAnnotation(a);
  }

  function commitAnnotation(a) {
    const movement = Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y);
    if (a.type === 'text') {
      openTextAnnotation(a);
      return;
    } else if (movement < .005 && a.type !== 'brush') { drawAnnotations(); return; }
    finishAnnotation(a);
  }

  function undoAnnotation() {
    const previous = state.annotationUndo.pop();
    if (!previous) { toast('没有可撤销的批注操作'); return; }
    state.annotations = previous;
    state.selectedAnnotationId = null; state.selectedAnnotationFrame = null;
    refreshAnnotationUI(); toast('已撤销批注操作');
  }

  function drawAnnotations(preview = null) {
    const rect = els.canvas.getBoundingClientRect();
    const ctx = els.ctx; ctx.clearRect(0, 0, rect.width, rect.height);
    if (!state.annotationVisible) return;
    const list = state.annotations.filter(a => a.frame === currentFrame() && !a.hidden);
    if (preview) list.push(preview);
    list.forEach(a => drawShape(ctx, a, rect.width, rect.height));
  }

  function drawShape(ctx, a, w, h) {
    const x1 = a.start.x*w, y1 = a.start.y*h, x2 = a.end.x*w, y2 = a.end.y*h;
    ctx.save(); ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = Math.max(1, a.strokeWidth ? a.strokeWidth * w : w/500); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (a.id === state.selectedAnnotationId) { ctx.shadowColor = a.color; ctx.shadowBlur = 5; }
    if (a.type === 'rectangle' || a.type === 'highlight') {
      if (a.type === 'highlight') { ctx.globalAlpha = .22; ctx.fillRect(x1,y1,x2-x1,y2-y1); ctx.globalAlpha = .8; }
      ctx.strokeRect(x1,y1,x2-x1,y2-y1);
    } else if (a.type === 'circle') {
      ctx.beginPath(); ctx.ellipse((x1+x2)/2,(y1+y2)/2,Math.abs(x2-x1)/2,Math.abs(y2-y1)/2,0,0,Math.PI*2); ctx.stroke();
    } else if (a.type === 'arrow') {
      const angle = Math.atan2(y2-y1,x2-x1), head = Math.max(10, ctx.lineWidth * 3);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x2-head*Math.cos(angle-Math.PI/6),y2-head*Math.sin(angle-Math.PI/6)); ctx.moveTo(x2,y2); ctx.lineTo(x2-head*Math.cos(angle+Math.PI/6),y2-head*Math.sin(angle+Math.PI/6)); ctx.stroke();
    } else if (a.type === 'brush') {
      if (a.points.length === 1) { ctx.beginPath(); ctx.arc(a.points[0].x*w,a.points[0].y*h,ctx.lineWidth/2,0,Math.PI*2); ctx.fill(); }
      else { ctx.beginPath(); a.points.forEach((p,i) => i ? ctx.lineTo(p.x*w,p.y*h) : ctx.moveTo(p.x*w,p.y*h)); ctx.stroke(); }
    } else if (a.type === 'text') {
      ctx.font = `600 ${clamp(12 + ctx.lineWidth * 2, 14, 60)}px Inter, sans-serif`; ctx.shadowColor = '#000'; ctx.shadowBlur = 3; ctx.fillText(a.text, x1, y1);
    }
    ctx.restore();
  }

  function updateAnnotationThumbnail(frame) {
    const annotations = state.annotations.filter(annotation => annotation.frame === frame && !annotation.hidden);
    if (!annotations.length) { delete state.annotationThumbnails[frame]; return; }
    if (!playback.videoWidth || Math.abs(currentFrame() - frame) > 1 || playback.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = Math.max(72, Math.round(256 * playback.videoHeight / playback.videoWidth));
    const context = canvas.getContext('2d', { alpha: false });
    try {
      context.drawImage(playback.currentFrameCanvas, 0, 0, canvas.width, canvas.height);
      annotations.forEach(annotation => drawShape(context, annotation, canvas.width, canvas.height));
      state.annotationThumbnails[frame] = canvas.toDataURL('image/jpeg', .7);
    } catch { /* a decoded frame may not be available during a source transition */ }
  }

  function annotationName(type) { return ({arrow:'箭头',circle:'圆形',rectangle:'矩形',brush:'画笔',text:'文字',highlight:'高亮'})[type] || type; }

  function renderAnnotationList() {
    const byFrame = new Map();
    state.annotations.forEach(annotation => {
      if (!byFrame.has(annotation.frame)) byFrame.set(annotation.frame, []);
      byFrame.get(annotation.frame).push(annotation);
    });
    const list = [...byFrame.entries()]
      .filter(([frame]) => state.annotationScope === 'all' || frame === currentFrame())
      .sort((a, b) => a[0] - b[0]);
    els.annotationList.innerHTML = '';
    els.annotationEmpty.style.display = list.length ? 'none' : 'flex';
    $('b', els.annotationEmpty).textContent = state.annotationScope === 'all' ? '此视频还没有批注' : '此帧没有批注';
    $('p', els.annotationEmpty).textContent = '在画面上右键打开批注工具环';
    list.forEach(([frame, annotations]) => {
      const row = document.createElement('div');
      const allHidden = annotations.every(annotation => annotation.hidden);
      row.className = `annotation-row${state.selectedAnnotationFrame === frame ? ' selected' : ''}`;
      const thumbnail = state.annotationThumbnails[frame];
      row.innerHTML = `${thumbnail ? `<img class="annotation-thumb" src="${thumbnail}" alt="Frame ${sourceFrame(frame)} 批注缩略图">` : '<div class="annotation-thumb"></div>'}<span class="annotation-info"><b>Frame ${String(sourceFrame(frame)).padStart(5,'0')} 批注</b><small>${annotations.length} 个内容 · ${formatTimecode(frame/state.fps)}</small></span><button class="jump-annotation-btn" title="跳转到此帧" aria-label="跳转到此帧">${reviewIcon('jump')}</button><button class="visibility-btn" title="显示/隐藏此帧全部批注" aria-label="${allHidden ? '显示' : '隐藏'}此帧全部批注">${reviewIcon(allHidden ? 'eye-off' : 'eye')}</button><button class="delete-btn" title="删除此帧全部批注" aria-label="删除此帧全部批注">${reviewIcon('trash')}</button>`;
      const jump = () => { state.selectedAnnotationId = annotations[0].id; state.selectedAnnotationFrame = frame; seekFrame(frame); renderAnnotationList(); };
      row.addEventListener('click', jump);
      $('.jump-annotation-btn',row).addEventListener('click', e => { e.stopPropagation(); jump(); });
      $('.visibility-btn',row).addEventListener('click', e => { e.stopPropagation(); annotations.forEach(annotation => annotation.hidden = !allHidden); renderAnnotationList(); drawAnnotations(); saveWorkspace(); });
      $('.delete-btn',row).addEventListener('click', e => { e.stopPropagation(); state.annotations=state.annotations.filter(annotation=>annotation.frame!==frame); delete state.annotationThumbnails[frame]; if(state.selectedAnnotationFrame===frame){state.selectedAnnotationId=null;state.selectedAnnotationFrame=null;} renderAnnotationList(); renderTimeline(); drawAnnotations(); updateCounts(); saveWorkspace(); });
      els.annotationList.appendChild(row);
    });
  }

  function updateCounts() {
    $('#bookmarkCount').textContent = state.bookmarks.length;
    const annotationFrames = new Set(state.annotations.map(annotation => annotation.frame)).size;
    $('#annotationCount').textContent = annotationFrames;
    $('#propBookmarks').textContent = state.bookmarks.length;
    $('#propAnnotations').textContent = annotationFrames;
  }

  function workspaceData() {
    return { version: '0.7', mediaKind: state.fileMeta?.mediaKind || 'video', sourceFrameOffset: state.fileMeta?.sourceFrameOffset || 0, sequence: state.fileMeta?.sequence || null, fileMeta: state.fileMeta, fps: state.fps, fpsMode: state.fpsMode, bookmarks: state.bookmarks, annotations: state.annotations, annotationThumbnails: state.annotationThumbnails, timelineZoom: state.timelineZoom, loopInFrame: state.loopInFrame, loopOutFrame: state.loopOutFrame, colorPreset: state.colorPreset, updatedAt: new Date().toISOString() };
  }

  function legacyMediaKey(meta) {
    return meta ? `${meta.name}::${meta.size || 0}::${meta.modified || 0}` : null;
  }

  function mediaKey(meta) {
    return meta?.mediaId || legacyMediaKey(meta);
  }

  function sameMediaPath(left, right) {
    if (!left || !right) return true;
    return String(left).replaceAll('/', '\\').toLowerCase() === String(right).replaceAll('/', '\\').toLowerCase();
  }

  function readWorkspaceLibrary() {
    if (desktopData?.workspaces && typeof desktopData.workspaces === 'object') return desktopData.workspaces;
    try { return JSON.parse(localStorage.getItem(WORKSPACES_KEY)) || {}; }
    catch { return {}; }
  }

  function preferenceData() {
    return { ambientEnabled: ambient.enabled, autosave: state.autosave, viewerScrubSensitivity: state.viewerScrubSensitivity, lumaMode: state.lumaMode, lumaContrast: state.lumaContrast, volume: state.volume, muted: state.muted, annotationSize: state.annotationSize, annotationColor: state.annotationColor, quickAnnotationTool: state.quickAnnotationTool, endBehavior: state.endBehavior, playbackSpeed: state.playbackSpeed, autoplayOnOpen: state.autoplayOnOpen, startupMode: state.startupMode, timelineHoverPreview: state.timelineHoverPreview, timelineHoverPreviewSize: state.timelineHoverPreviewSize, guidesMaster: state.guidesMaster, guideThirds: state.guideThirds, guideGolden: state.guideGolden, guideSpiral: state.guideSpiral, guideSpiralRotation: state.guideSpiralRotation, guideCenter: state.guideCenter, guideDiagonal: state.guideDiagonal, guideTriangle: state.guideTriangle, guideSymmetry: state.guideSymmetry, guideActionSafe: state.guideActionSafe, guideTitleSafe: state.guideTitleSafe, guideAspect: state.guideAspect, guideOpacity: state.guideOpacity, guideMaskStrength: state.guideMaskStrength, shortcuts: state.shortcuts };
  }

  function persistPreferences() {
    const preferences = preferenceData();
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    syncDesktopAppData(readWorkspaceLibrary(), preferences);
  }

  function syncDesktopAppData(workspaces = readWorkspaceLibrary(), preferences = preferenceData()) {
    if (!desktopAPI) return;
    desktopData = { ...(desktopData || {}), preferences, workspaces };
    desktopAPI.saveAppData({ preferences, workspaces });
  }

  function persistMediaSnapshot(key, snapshot) {
    if (!key) return;
    const library = readWorkspaceLibrary();
    library[key] = snapshot;
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(library));
    syncDesktopAppData(library);
  }

  function removeMediaSnapshot(key) {
    if (!key) return;
    const library = readWorkspaceLibrary();
    delete library[key];
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(library));
    syncDesktopAppData(library);
  }

  function persistCurrentWorkspaceNow() {
    try {
      persistPreferences();
      if (state.currentMediaKey) persistMediaSnapshot(state.currentMediaKey, workspaceData());
    } catch { toast('本地存储空间不足，请导出工作区'); }
  }

  function activateMediaWorkspace(meta) {
    state.currentMediaKey = mediaKey(meta);
    const library = readWorkspaceLibrary();
    let saved = library[state.currentMediaKey];
    if (!saved && meta?.mediaId && meta.mediaKind !== 'sequence') {
      const legacyKey = legacyMediaKey(meta);
      const legacy = library[legacyKey];
      if (legacy && sameMediaPath(legacy.fileMeta?.path, meta.path)) {
        saved = { ...legacy, fileMeta: { ...(legacy.fileMeta || {}), ...meta } };
        library[state.currentMediaKey] = saved;
        localStorage.setItem(WORKSPACES_KEY, JSON.stringify(library));
        syncDesktopAppData(library);
      }
    }
    state.fpsMode = saved ? (saved.fpsMode === 'source' ? 'source' : 'custom') : (meta?.mediaKind === 'video' ? 'source' : 'custom');
    state.fps = Number(saved?.fps) || Number(meta?.sourceFps || meta?.fps) || 24;
    state.bookmarks = saved?.bookmarks || [];
    state.annotations = saved?.annotations || [];
    state.annotationThumbnails = saved?.annotationThumbnails && typeof saved.annotationThumbnails === 'object' ? saved.annotationThumbnails : {};
    state.timelineZoom = Number(saved?.timelineZoom) || 1;
    state.loopInFrame = Number.isFinite(saved?.loopInFrame) ? saved.loopInFrame : null;
    state.loopOutFrame = Number.isFinite(saved?.loopOutFrame) ? saved.loopOutFrame : null;
    state.colorPreset = COLOR_PRESETS[saved?.colorPreset] ? saved.colorPreset : 'original';
    els.colorCanvas.classList.toggle('active', state.colorPreset !== 'original');
    state.selectedBookmarkIds = [];
    state.selectedAnnotationId = null;
    state.selectedAnnotationFrame = null;
    state.lastFrameContent = null;
    els.markerLayer.innerHTML = '';
    els.annotationMarkerLayer.innerHTML = '';
    els.fpsInput.value = state.fps;
    $('#hudFps').textContent = `${state.fps} FPS`;
    $('#propFps').textContent = `${state.fps} fps`;
    $('#colorPresetSelect').value = state.colorPreset;
    $('#colorPresetWarning').classList.toggle('show', state.colorPreset !== 'original');
    renderBookmarks();
    renderAnnotationList();
    syncNotes();
    updateCounts();
  }

  function saveWorkspace(manual = false) {
    if (!state.autosave && !manual) return;
    clearTimeout(state.saveTimer);
    const key = state.currentMediaKey;
    const snapshot = key ? workspaceData() : null;
    const preferences = preferenceData();
    state.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
        const library = readWorkspaceLibrary();
        if (key && snapshot) library[key] = snapshot;
        localStorage.setItem(WORKSPACES_KEY, JSON.stringify(library));
        syncDesktopAppData(library, preferences);
        if (manual) toast(key ? '当前视频工作区已保存' : '播放器设置已保存');
      }
      catch { toast('本地存储空间不足，请导出工作区'); }
    }, manual ? 0 : 180);
  }

  async function loadWorkspace() {
    try {
      const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (legacy?.fileMeta) {
        const legacyKey = mediaKey(legacy.fileMeta);
        const library = readWorkspaceLibrary();
        if (!library[legacyKey]) {
          library[legacyKey] = { version:'0.2', fileMeta:legacy.fileMeta, fps:legacy.fps || 24, bookmarks:legacy.bookmarks || [], annotations:legacy.annotations || [], timelineZoom:legacy.timelineZoom || 1, updatedAt:legacy.updatedAt || new Date().toISOString() };
          localStorage.setItem(WORKSPACES_KEY, JSON.stringify(library));
        }
        localStorage.removeItem(STORAGE_KEY);
      }
      const browserPreferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY)) || legacy || {};
      const browserWorkspaces = JSON.parse(localStorage.getItem(WORKSPACES_KEY)) || {};
      if (desktopAPI) {
        const saved = await desktopAPI.loadAppData();
        const savedPreferences = saved?.preferences && Object.keys(saved.preferences).length ? saved.preferences : browserPreferences;
        const savedWorkspaces = saved?.workspaces && Object.keys(saved.workspaces).length ? saved.workspaces : browserWorkspaces;
        desktopData = { ...(saved || {}), preferences: savedPreferences, workspaces: savedWorkspaces };
        syncDesktopAppData(savedWorkspaces, savedPreferences);
      }
      const preferences = desktopData?.preferences || browserPreferences;
      setAmbientEnabled(preferences.ambientEnabled !== false, false);
      state.autosave = preferences.autosave !== false;
      state.viewerScrubSensitivity = clamp(Number(preferences.viewerScrubSensitivity) || .3, .05, 3);
      state.lumaMode = preferences.lumaMode === true;
      state.lumaContrast = clamp(Number(preferences.lumaContrast) || 1, .5, 2);
      state.annotationSize = clamp(Math.round(Number(preferences.annotationSize) || 4), 1, 24);
      state.annotationColor = /^#[0-9a-f]{6}$/i.test(preferences.annotationColor || '') ? preferences.annotationColor : '#8b5cf6';
      state.quickAnnotationTool = ['select','brush','arrow','rectangle','text','eraser','circle','highlight'].includes(preferences.quickAnnotationTool) ? preferences.quickAnnotationTool : 'brush';
      state.endBehavior = ['stop','rewind','loop'].includes(preferences.endBehavior) ? preferences.endBehavior : 'stop';
      state.playbackSpeed = clamp(Number(preferences.playbackSpeed) || 1, .1, 4);
      state.autoplayOnOpen = preferences.autoplayOnOpen !== false;
      state.startupMode = preferences.startupMode === 'classic' ? 'classic' : 'clean';
      state.timelineHoverPreview = preferences.timelineHoverPreview !== false;
      state.timelineHoverPreviewSize = clamp(Math.round((Number(preferences.timelineHoverPreviewSize) || 196) / 2) * 2, 140, 320);
      state.guidesMaster = preferences.guidesMaster !== false;
      state.guideThirds = preferences.guideThirds === true; state.guideGolden = preferences.guideGolden === true; state.guideSpiral = preferences.guideSpiral === true; state.guideSpiralRotation = [0,90,180,270].includes(Number(preferences.guideSpiralRotation)) ? Number(preferences.guideSpiralRotation) : 0; state.guideCenter = preferences.guideCenter === true;
      state.guideDiagonal = preferences.guideDiagonal === true; state.guideTriangle = preferences.guideTriangle === true; state.guideSymmetry = preferences.guideSymmetry === true;
      state.guideActionSafe = preferences.guideActionSafe === true; state.guideTitleSafe = preferences.guideTitleSafe === true;
      state.guideAspect = ['off','16:9','1.85','2.39','4:3','1:1','9:16'].includes(preferences.guideAspect) ? preferences.guideAspect : 'off';
      state.guideOpacity = clamp(Number(preferences.guideOpacity) || .55,.1,1); state.guideMaskStrength = clamp(Number(preferences.guideMaskStrength) || .55,.1,.9);
      state.shortcuts = { ...DEFAULT_SHORTCUTS };
      if (preferences.shortcuts && typeof preferences.shortcuts === 'object') {
        Object.keys(DEFAULT_SHORTCUTS).forEach(action => {
          if (typeof preferences.shortcuts[action] === 'string' && preferences.shortcuts[action].length <= 32) state.shortcuts[action] = preferences.shortcuts[action];
        });
      }
      if (state.shortcuts.resetTimeline === 'Ctrl+Shift+0') state.shortcuts.resetTimeline = DEFAULT_SHORTCUTS.resetTimeline;
      const savedVolume = Number(preferences.volume);
      state.volume = Number.isFinite(savedVolume) ? clamp(savedVolume, 0, 1) : 1;
      state.muted = preferences.muted === true;
      state.previousVolume = state.volume || 1;
      state.fileMeta = null; state.fileName = ''; state.currentMediaKey = null; state.sourcePath = null;
      state.bookmarks = []; state.annotations = []; state.selectedBookmarkIds = [];
      els.fpsInput.value = state.fps;
      els.scrubSensitivity.value = state.viewerScrubSensitivity;
      els.scrubSensitivityValue.textContent = `${state.viewerScrubSensitivity.toFixed(2)} 帧/像素`;
      els.lumaContrast.value = Math.round(state.lumaContrast * 100);
      els.lumaContrastValue.textContent = `${Math.round(state.lumaContrast * 100)}%`;
      $('#radialAnnotationColor').value = state.annotationColor;
      document.documentElement.style.setProperty('--annotation-color',state.annotationColor);
      els.annotationSizeRange.value = state.annotationSize;
      els.endBehaviorSelect.value = state.endBehavior;
      setPlaybackSpeed(state.playbackSpeed);
      setTimelinePreviewSize(state.timelineHoverPreviewSize);
      renderShortcutEditor();
      setPanelOpen(false);
      setQuickAnnotationTool(state.quickAnnotationTool, false);
      updateAnnotationSizeLabel();
      $('#autosaveSwitch').classList.toggle('on', state.autosave);
      $('#autoplaySwitch').classList.toggle('on', state.autoplayOnOpen);
      $('#autoplaySwitch').setAttribute('aria-checked', String(state.autoplayOnOpen));
      $('#startupModeSelect').value = state.startupMode;
      $('#guideThirds').checked=state.guideThirds;$('#guideGolden').checked=state.guideGolden;$('#guideSpiral').checked=state.guideSpiral;$('#guideSpiralRotation').value=String(state.guideSpiralRotation);$('#guideCenter').checked=state.guideCenter;$('#guideDiagonal').checked=state.guideDiagonal;$('#guideTriangle').checked=state.guideTriangle;$('#guideSymmetry').checked=state.guideSymmetry;$('#guideActionSafe').checked=state.guideActionSafe;$('#guideTitleSafe').checked=state.guideTitleSafe;$('#guideAspect').value=state.guideAspect;$('#guideOpacity').value=Math.round(state.guideOpacity*100);$('#guideMaskStrength').value=Math.round(state.guideMaskStrength*100);renderCompositionGuides();
      $('#hoverPreviewSwitch').classList.toggle('on', state.timelineHoverPreview);
      $('#hoverPreviewSwitch').setAttribute('aria-checked', String(state.timelineHoverPreview));
      els.viewerStage.classList.toggle('luma-mode', state.lumaMode);
      $('#lumaBtn').classList.toggle('active', state.lumaMode);
      $('#lumaControl').classList.toggle('active', state.lumaMode);
      els.viewerStage.style.setProperty('--luma-contrast', state.lumaContrast);
      playback.volume = state.volume;
      playback.muted = state.muted;
      syncVolumeUI();
      renderBookmarks(); renderAnnotationList(); updateCounts();
    } catch { /* ignore invalid local data */ }
  }

  async function exportWorkspace() {
    if (desktopAPI) {
      const baseName = (state.fileName || 'vfx-player').replace(/\.[^.]+$/, '');
      try {
        const result = await desktopAPI.exportWorkspace(baseName, workspaceData());
        if (!result?.canceled) toast('工作区文件已导出');
      } catch { toast('工作区导出失败'); }
      return;
    }
    const blob = new Blob([JSON.stringify(workspaceData(), null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(state.fileName || 'vfx-player').replace(/\.[^.]+$/,'')}.vfxplayer.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('工作区 JSON 已导出');
  }

  async function requestOpenVideo() {
    if (!desktopAPI) { els.videoInput.click(); return; }
    try { openDesktopVideo(await desktopAPI.openVideo()); }
    catch { toast('无法打开系统文件选择器'); }
  }

  async function refreshRecentVideos() {
    const container = $('#recentMedia');
    if (!desktopAPI || !container) return;
    try {
      const recents = await desktopAPI.getRecentVideos();
      const list = $('#recentMediaList');
      list.innerHTML = '';
      container.hidden = !recents.length || !!playback.duration;
      recents.slice(0, 5).forEach(item => {
        const button = document.createElement('button');
        button.className = 'recent-media-item';
        const name = document.createElement('span'); name.textContent = item.name;
        const date = document.createElement('small'); date.textContent = new Date(item.lastOpened).toLocaleDateString();
        button.append(name, date);
        button.title = item.path;
        button.addEventListener('click', async () => openDesktopVideo(await desktopAPI.openRecentVideo(item.path)));
        list.appendChild(button);
      });
    } catch { container.hidden = true; }
  }

  function handleDesktopCommand(command) {
    if (command === 'save') saveWorkspace(true);
    else if (command === 'export') exportWorkspace();
    else if (command === 'toggle-play') playback.paused && !state.isReverse ? play() : pause();
    else if (command === 'clean-mode') setCleanMode(!state.cleanMode);
    else if (command === 'loop-in') setLoopPoint('in');
    else if (command === 'loop-out') setLoopPoint('out');
    else if (command === 'reset-view') resetViewerView();
    else if (command === 'shortcuts') { els.helpModal.classList.add('open'); els.helpModal.setAttribute('aria-hidden', 'false'); }
  }

  function applyDesktopWindowState(windowState) {
    if (!windowState) return;
    document.body.classList.toggle('window-maximized', !!windowState.maximized);
    document.body.classList.toggle('window-fullscreen', !!windowState.fullscreen);
    revealCleanControls();
    requestAnimationFrame(() => { resizeCanvas(); renderRuler(); updatePlaybackUI(); });
  }

  async function initializeDesktopRuntime() {
    if (!desktopAPI) return;
    document.body.classList.add('desktop-runtime');
    const version = await desktopAPI.getVersion().catch(() => '0.8.7');
    $('#runtimeLabel').textContent = `V${version}`;
    $('#runtimeLabel').title = `DESKTOP · V${version}`;
    desktopAPI.onOpenVideo(openDesktopVideo);
    desktopAPI.onCommand(handleDesktopCommand);
    desktopAPI.onWindowState(applyDesktopWindowState);
    applyDesktopWindowState(await desktopAPI.getWindowState().catch(() => null));
    $('#clearRecentBtn').addEventListener('click', async () => { await desktopAPI.clearRecentVideos(); refreshRecentVideos(); });
    const launchMedia = await desktopAPI.consumeLaunchMedia().catch(() => null);
    if (launchMedia) openDesktopVideo(launchMedia);
    else desktopAPI.initialMediaPresented?.();
    await refreshRecentVideos();
  }

  async function copyFrame(withAnnotations) {
    if (!playback.videoWidth) return;
    const c = document.createElement('canvas'); c.width=playback.videoWidth; c.height=playback.videoHeight;
    const ctx=c.getContext('2d'); ctx.drawImage(playback.currentFrameCanvas,0,0,c.width,c.height);
    if (withAnnotations) {
      const list=state.annotations.filter(a=>a.frame===currentFrame()&&!a.hidden);
      list.forEach(a=>drawShape(ctx,a,c.width,c.height));
    }
    c.toBlob(async blob => {
      try { await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]); toast(withAnnotations?'已复制带批注画面':'已复制当前帧'); }
      catch { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`frame-${currentFrame()}.png`; a.click(); toast('浏览器不允许复制，已下载图片'); }
    });
  }

  async function downloadFrame(withAnnotations = false) {
    if (!playback.videoWidth) return;
    const c = await playback.captureFrame();
    const ctx = c.getContext('2d');
    if (withAnnotations) state.annotations.filter(a => a.frame === currentFrame() && !a.hidden).forEach(a => drawShape(ctx, a, c.width, c.height));
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `frame-${String(sourceFrame(currentFrame())).padStart(5,'0')}.png`; a.click();
  }

  async function saveBinary(bytes, suggestedName) {
    if (desktopAPI) return desktopAPI.exportBinary(suggestedName, 'png', bytes);
    const blob = new Blob([bytes], { type: 'image/png' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = suggestedName; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    return { canceled: false };
  }

  async function exportCurrentAnnotatedFrame() {
    if (!playback.videoWidth) { toast('请先打开视频'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = playback.videoWidth; canvas.height = playback.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(playback.currentFrameCanvas, 0, 0, canvas.width, canvas.height);
    state.annotations.filter(annotation => annotation.frame === currentFrame() && !annotation.hidden).forEach(annotation => drawShape(context, annotation, canvas.width, canvas.height));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { toast('批注帧导出失败'); return; }
    const baseName = (state.fileName || 'astria').replace(/\.[^.]+$/, '');
    try {
      const result = await saveBinary(new Uint8Array(await blob.arrayBuffer()), `${baseName}-F${String(currentFrame()).padStart(5,'0')}-annotated.png`);
      if (!result?.canceled) toast('带批注画面已导出');
    } catch { toast('批注帧导出失败'); }
  }

  function showBookmarkMenu(x, y, id) {
    const menu = $('#bookmarkContextMenu'); state.contextBookmarkId = id;
    menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false');
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  }

  function hideBookmarkMenu() {
    const menu = $('#bookmarkContextMenu'); menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true');
  }

  function bookmarkMenuAction(action) {
    const b = state.bookmarks.find(item => item.id === state.contextBookmarkId); if (!b) return;
    if (action === 'jump') selectBookmark(b.id);
    else if (action === 'rename') { const value = prompt('书签标题', b.title); if (value?.trim()) b.title = value.trim(); }
    else if (action === 'tag') { const value = prompt('标签（使用逗号分隔）', b.tags.join(', ')); if (value !== null) b.tags = value.split(/[,，]/).map(t=>t.trim()).filter(Boolean); }
    else if (action === 'rating') { const value = prompt('评分（0–5）', b.rating); if (value !== null) b.rating = clamp(Math.round(Number(value)||0),0,5); }
    else if (action === 'favorite') b.favorite = !b.favorite;
    else if (action === 'duplicate') { const copy = {...b,id:uid(),title:`${b.title} 副本`,createdTime:new Date().toISOString(),updatedTime:new Date().toISOString()}; state.bookmarks.push(copy); state.selectedBookmarkIds=[copy.id]; }
    else if (action === 'screenshot') { selectBookmark(b.id); downloadFrame(true); }
    else if (action === 'delete') { state.selectedBookmarkIds=[b.id]; deleteSelection(); hideBookmarkMenu(); return; }
    b.updatedTime = new Date().toISOString(); renderBookmarks(); renderTimeline(); saveWorkspace(); hideBookmarkMenu();
  }

  function escapeHtml(value) { const d=document.createElement('div'); d.textContent=value; return d.innerHTML; }

  // Local line icons keep generated review controls consistent with the static toolbar.
  function reviewIcon(name) {
    const shapes = {
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
      jump: '<path d="M4 17v-5a4 4 0 0 1 4-4h12M15 3l5 5-5 5"/>',
      eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
      'eye-off': '<path d="m3 3 18 18M10 5.2 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 4M6 6C3.4 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M10 10a3 3 0 0 0 4 4"/>',
      trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[name] || ''}</svg>`;
  }

  function seekTimelineAt(clientX) {
    if (!playback.duration) return;
    const rect = els.timelineTrack.getBoundingClientRect();
    const frame = Math.round(clamp((clientX - rect.left) / rect.width, 0, 1) * lastFrame());
    if (state.timelineScrub?.lastFrame === frame) return;
    if (state.timelineScrub) state.timelineScrub.lastFrame = frame;
    updateProfessionalScrubTarget(frame);
  }

  function updateTimelineTooltip(e) {
    if (!playback.duration || !state.timelineHoverPreview || state.timelineScrub?.dragging || state.scrubController.active) {
      hideTimelinePreview();
      return;
    }
    const trackRect = els.timelineTrack.getBoundingClientRect();
    const ratio = clamp((e.clientX - trackRect.left) / trackRect.width, 0, 1);
    const frame = clamp(Math.round(ratio * lastFrame()), 0, lastFrame());
    // Seek inside the selected frame to avoid decoding the preceding boundary frame.
    const time = Math.min((frame + .25) / state.fps, Math.max(0, playback.duration - .001));
    els.timelineTooltip.dataset.frame = String(frame);
    const previewRect = els.timelineTooltip.getBoundingClientRect();
    const wrapRect = els.timelineWrap.getBoundingClientRect();
    const halfWidth = previewRect.width / 2;
    const left = Math.max(8, wrapRect.left) + halfWidth;
    const right = Math.min(innerWidth - 8, wrapRect.right) - halfWidth;
    els.timelineTooltip.style.left = `${clamp(e.clientX, Math.min(left, right), Math.max(left, right))}px`;
    els.timelineTooltip.style.top = `${Math.max(8, trackRect.top - previewRect.height - 8)}px`;
    $('b', els.timelineTooltip).textContent = `F ${String(sourceFrame(frame)).padStart(5,'0')}`;
    $('span', els.timelineTooltip).textContent = formatTimecode(frame / state.fps);
    els.timelineTooltip.classList.add('show');
    requestTimelinePreview(time, frame);
  }

  function beginProfessionalScrub() {
    const controller = state.scrubController;
    if (controller.active || !playback.duration) return;
    pause(); stopReverse(); clearTimeout(state.scrubPrefetchTimer);
    const frame = currentFrame();
    state.scrubInteraction += 1; state.scrubFinalizing = false;
    Object.assign(controller, { active: true, pointerTargetFrame: frame, targetFrame: frame, presentedFrame: frame, direction: 0, inFlight: false });
    hideTimelinePreview();
    if (showCachedFrame(frame, true)) state.scrubDisplayFrame = frame;
    ensureScrubDecoder(frame).then(() => pumpProfessionalScrub()).catch(() => pumpProfessionalScrub());
  }

  function updateProfessionalScrubTarget(frame) {
    const controller = state.scrubController;
    if (!controller.active) beginProfessionalScrub();
    const requested = clamp(Math.round(frame), 0, lastFrame());
    controller.pointerTargetFrame = requested;
    const presented = controller.presentedFrame ?? currentFrame();
    controller.targetFrame = clamp(requested, Math.max(0, presented - 4), Math.min(lastFrame(), presented + 4));
    pumpProfessionalScrub();
  }

  function presentProfessionalScrubFrame(frame) {
    if (!showCachedFrame(frame, true)) return false;
    state.scrubDisplayFrame = frame;
    state.scrubController.presentedFrame = frame;
    window.__astriaScrubTest?.trace.push(frame);
    updatePlaybackUI(frame / state.fps, frame);
    updateFrameContent(true);
    return true;
  }

  function pumpProfessionalScrub() {
    const controller = state.scrubController;
    if (!controller.active || controller.inFlight || state.scrubWorkerBusy || !playback.duration) return;
    const presented = controller.presentedFrame ?? currentFrame();
    const pointer = controller.pointerTargetFrame ?? presented;
    controller.targetFrame = clamp(pointer, Math.max(0, presented - 4), Math.min(lastFrame(), presented + 4));
    if (controller.targetFrame === presented) return;
    const direction = Math.sign(controller.targetFrame - presented), nextFrame = presented + direction;
    controller.direction = direction; controller.inFlight = true;
    const interaction = state.scrubInteraction, generation = state.frameCacheGeneration;
    state.scrubWorkerBusy = true;
    const work = (async () => {
      if (!state.frameCache.has(nextFrame)) {
        try { await positionScrubDecoder(nextFrame, generation); }
        catch {
          if (interaction !== state.scrubInteraction || generation !== state.frameCacheGeneration || !controller.active) return;
          await playback.seekFrameExact(nextFrame, state.fps);
          if (interaction !== state.scrubInteraction || generation !== state.frameCacheGeneration || !controller.active) return;
          state.scrubDecoderFrame = nextFrame;
          await cacheFrameFromMedia(playback, nextFrame, generation);
        }
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
      const latestPresented = controller.presentedFrame ?? currentFrame();
      const latestDirection = Math.sign((controller.pointerTargetFrame ?? latestPresented) - latestPresented);
      if (interaction === state.scrubInteraction && generation === state.frameCacheGeneration && controller.active &&
          latestPresented === presented && latestDirection === direction) presentProfessionalScrubFrame(nextFrame);
    })().catch(() => {
      if (interaction === state.scrubInteraction && controller.active) setStatus('逐帧预览暂时不可用');
    }).finally(() => {
      if (interaction === state.scrubInteraction) controller.inFlight = false;
      if (state.scrubWorkerPromise === work) { state.scrubWorkerPromise = null; state.scrubWorkerBusy = false; }
      if (interaction === state.scrubInteraction && controller.active) pumpProfessionalScrub();
    });
    state.scrubWorkerPromise = work;
  }

  async function endProfessionalScrub() {
    const controller = state.scrubController;
    if (!controller.active) return;
    const finalFrame = controller.presentedFrame ?? currentFrame();
    controller.active = false; controller.pointerTargetFrame = null; controller.targetFrame = finalFrame; controller.inFlight = false;
    const interaction = ++state.scrubInteraction;
    state.scrubFinalizing = true; state.scrubDisplayFrame = finalFrame;
    showCachedFrame(finalFrame, true); updatePlaybackUI(finalFrame / state.fps, finalFrame); updateFrameContent(true);
    const pending = state.scrubWorkerPromise;
    if (pending) await pending.catch(() => {});
    if (interaction !== state.scrubInteraction) return;
    try {
      playback.pause();
      await playback.seekFrameExact(finalFrame, state.fps);
      if (interaction !== state.scrubInteraction) return;
      state.scrubDisplayFrame = null; hideCachedFrame(); captureFrame(finalFrame); updateUI(true);
    } catch { if (interaction === state.scrubInteraction) setStatus('精确帧定位失败'); }
    finally {
      if (interaction === state.scrubInteraction) { state.scrubFinalizing = false; scheduleScrubPrefetch(); }
    }
  }

  function onPlaybackSeeked() {
    if (state.scrubController.active || state.scrubFinalizing) return;
    state.scrubDisplayFrame = null; hideCachedFrame(); captureFrame(); scheduleColorRender(); updateUI(true);
    if (state.reverseSeekInFlight) {
      state.reverseSeekInFlight = false;
      if (!hasLoopRange() && currentFrame() <= 0) { stopReverse(); setStatus('已到第一帧'); }
      else if (state.isReverse) state.reverseTimer = requestAnimationFrame(pumpReversePlayback);
    }
  }

  function beginTimelineScrub(e) {
    if (!playback.duration || e.button !== 0 || e.target.closest('.timeline-marker, .annotation-timeline-marker')) return;
    e.preventDefault();
    state.timelineScrub = { pointerId: e.pointerId, startX: e.clientX, lastFrame: null, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    els.timelineWrap.classList.add('scrubbing');
    els.ruler.classList.add('scrubbing');
  }

  function moveTimelineScrub(e) {
    if (!state.timelineScrub || e.pointerId !== state.timelineScrub.pointerId) return;
    e.preventDefault();
    if (!state.timelineScrub.dragging && Math.abs(e.clientX - state.timelineScrub.startX) < 4) return;
    if (!state.timelineScrub.dragging) { state.timelineScrub.dragging = true; beginProfessionalScrub(); }
    seekTimelineAt(e.clientX);
  }

  function endTimelineScrub(e) {
    if (!state.timelineScrub || e.pointerId !== state.timelineScrub.pointerId) return;
    hideTimelinePreview();
    const scrub = state.timelineScrub;
    state.timelineScrub = null;
    els.timelineWrap.classList.remove('scrubbing');
    els.ruler.classList.remove('scrubbing');
    if (scrub.dragging) endProfessionalScrub();
    else {
      const rect = els.timelineTrack.getBoundingClientRect();
      seekFrame(Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * lastFrame()));
    }
  }

  function cancelTimelineScrub(pointerId) {
    if (!state.timelineScrub || pointerId !== state.timelineScrub.pointerId) return;
    hideTimelinePreview();
    const scrub = state.timelineScrub;
    state.timelineScrub = null;
    els.timelineWrap.classList.remove('scrubbing');
    els.ruler.classList.remove('scrubbing');
    if (scrub.dragging) endProfessionalScrub();
  }

  function beginScrub(e) {
    if (state.pixelInspector && e.button === 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      togglePixelLock(e);
      return;
    }
    if (e.target.closest('.clean-window-controls')) return;
    if (!playback.duration || e.button !== 0) return;
    state.scrub={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startFrame:currentFrame(),lastFrame:currentFrame(),dragging:false};
    els.viewerStage.setPointerCapture(e.pointerId);
  }

  function moveScrub(e) {
    if (!state.scrub || e.pointerId !== state.scrub.pointerId) return;
    const px=e.clientX-state.scrub.startX;
    const movement=Math.hypot(px,e.clientY-state.scrub.startY);
    if(!state.scrub.dragging&&movement<4)return;
    if(!state.scrub.dragging){state.scrub.dragging=true;beginProfessionalScrub();els.viewerStage.classList.add('scrubbing-viewer');}
    e.preventDefault();
    const factor=e.altKey?1:(e.shiftKey?state.viewerScrubSensitivity*.2:state.viewerScrubSensitivity);
    const next=Math.round(state.scrub.startFrame+px*factor);
    state.scrub.lastFrame=clamp(next,0,lastFrame()); updateProfessionalScrubTarget(state.scrub.lastFrame);
  }

  function endScrub(e) {
    if (!state.scrub || (e?.pointerId !== undefined && e.pointerId !== state.scrub.pointerId)) return;
    const { dragging: wasDragging } = state.scrub;
    state.scrub=null;
    els.viewerStage.classList.remove('scrubbing-viewer');
    if (wasDragging) {
      endProfessionalScrub();
    } else if (e?.type !== 'pointercancel') {
      playback.paused&&!state.isReverse?play():pause();
      scheduleCleanControlsHide();
    }
  }

  function beginViewerPan(e) {
    if (e.button !== 1 || !playback.duration) return;
    e.preventDefault();
    state.viewerPanGesture = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, panX: state.viewerPan.x, panY: state.viewerPan.y };
    els.viewerStage.setPointerCapture(e.pointerId);
    els.viewerStage.classList.add('panning');
  }

  function moveViewerPan(e) {
    const gesture = state.viewerPanGesture;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    state.viewerPan.x = gesture.panX + e.clientX - gesture.startX;
    state.viewerPan.y = gesture.panY + e.clientY - gesture.startY;
    resizeCanvas();
  }

  function endViewerPan(e) {
    if (!state.viewerPanGesture || e.pointerId !== state.viewerPanGesture.pointerId) return;
    state.viewerPanGesture = null;
    els.viewerStage.classList.remove('panning');
  }

  function handleViewerWheel(e) {
    if (state.quickGesture?.drawing && state.quickGesture.tool !== 'eraser') {
      e.preventDefault(); adjustAnnotationSize(e.deltaY < 0 ? 1 : -1); return;
    }
    if (e.ctrlKey && playback.duration) {
      e.preventDefault(); zoomViewerAt(e.clientX, e.clientY, e.deltaY < 0 ? 1 : -1);
    }
  }

  function setPixelInspector(enabled) {
    state.pixelInspector = !!enabled;
    $('#pixelInspectorBtn').classList.toggle('active', state.pixelInspector);
    $('#pixelInspectorBtn').setAttribute('aria-pressed', String(state.pixelInspector));
    if (!state.pixelInspector) unlockPixelInspector(true);
    toast(state.pixelInspector ? '拾色已开启' : '拾色已关闭');
  }

  function samplePixelAt(e) {
    if (!state.pixelInspector || state.cleanMode || !playback.videoWidth || playback.readyState < 2) return null;
    const surface = els.mediaSurface.getBoundingClientRect();
    if (e.clientX < surface.left || e.clientX > surface.right || e.clientY < surface.top || e.clientY > surface.bottom) {
      return null;
    }
    const x = clamp(Math.floor((e.clientX - surface.left) / surface.width * playback.videoWidth), 0, playback.videoWidth - 1);
    const y = clamp(Math.floor((e.clientY - surface.top) / surface.height * playback.videoHeight), 0, playback.videoHeight - 1);
    if (!state.pixelSampleCanvas) { state.pixelSampleCanvas = document.createElement('canvas'); state.pixelSampleCanvas.width = state.pixelSampleCanvas.height = 1; }
    const context = state.pixelSampleCanvas.getContext('2d');
    try {
      const source = els.cacheCanvas.classList.contains('visible') ? els.cacheCanvas : els.video;
      const sourceWidth=source===els.video?playback.videoWidth:source.width,sourceHeight=source===els.video?playback.videoHeight:source.height;
      const sourceX=clamp(Math.floor(x/playback.videoWidth*sourceWidth),0,sourceWidth-1),sourceY=clamp(Math.floor(y/playback.videoHeight*sourceHeight),0,sourceHeight-1);
      context.drawImage(source, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
      const [r,g,b] = context.getImageData(0,0,1,1).data;
      const hex = `#${[r,g,b].map(value => value.toString(16).padStart(2,'0')).join('').toUpperCase()}`;
      const luma = Math.round(.2126*r + .7152*g + .0722*b);
      let view=transformViewRgb([r/255,g/255,b/255]);if(state.lumaMode){const value=.2126*view[0]+.7152*view[1]+.0722*view[2];view=[value,value,value];}view=view.map(value=>clamp((value-.5)*state.lumaContrast+.5,0,1));const [vr,vg,vb]=view.map(value=>Math.round(value*255));const viewHex=`#${[vr,vg,vb].map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase()}`;
      return { x, y, r, g, b, hex, luma, vr, vg, vb, viewHex, clientX: e.clientX, clientY: e.clientY };
    } catch { return null; }
  }

  function renderPixelSample(sample, locked = false) {
    if (!sample) return;
    $('b', els.pixelInspectorHud).textContent = sample.hex;
    $('.pixel-source', els.pixelInspectorHud).textContent = `Source RGB ${sample.r} ${sample.g} ${sample.b}`;
    $('.pixel-view', els.pixelInspectorHud).textContent = `View RGB ${sample.vr} ${sample.vg} ${sample.vb}`;
    $('small', els.pixelInspectorHud).textContent = `X ${sample.x} · Y ${sample.y} · L ${sample.luma}`;
    els.pixelInspectorHud.style.setProperty('--pixel-color', sample.hex);
    els.pixelInspectorHud.style.left = `${clamp(sample.clientX + 16, 8, innerWidth - 198)}px`;
    els.pixelInspectorHud.style.top = `${clamp(sample.clientY + 16, 8, innerHeight - 92)}px`;
    els.pixelInspectorHud.classList.toggle('locked', locked);
    els.pixelInspectorHud.classList.add('show');
    els.pixelInspectorHud.setAttribute('aria-hidden', 'false');
  }

  function unlockPixelInspector(hide = false) {
    state.pixelInspectorLocked = false;
    state.pixelSample = null;
    els.pixelInspectorHud.classList.remove('locked');
    if (hide) {
      els.pixelInspectorHud.classList.remove('show');
      els.pixelInspectorHud.setAttribute('aria-hidden', 'true');
    }
  }

  function togglePixelLock(e) {
    if (state.pixelInspectorLocked) {
      unlockPixelInspector(true);
      toast('像素取样已解除锁定');
      return;
    }
    const sample = samplePixelAt(e);
    if (!sample) return;
    state.pixelInspectorLocked = true;
    state.pixelSample = sample;
    renderPixelSample(sample, true);
    toast(`已锁定 ${sample.hex}`);
  }

  function inspectPixel(e) {
    if (!state.pixelInspector || state.pixelInspectorLocked) return;
    const sample = samplePixelAt(e);
    if (sample) renderPixelSample(sample);
    else {
      els.pixelInspectorHud.classList.remove('show');
      els.pixelInspectorHud.setAttribute('aria-hidden', 'true');
    }
  }

  async function copyPixelSample() {
    const sample = state.pixelSample;
    if (!sample) return;
    const text = `Source ${sample.hex}\nSource RGB ${sample.r}, ${sample.g}, ${sample.b}\nView ${sample.viewHex}\nView RGB ${sample.vr}, ${sample.vg}, ${sample.vb}\nPreset ${COLOR_PRESETS[state.colorPreset]}\nX ${sample.x}, Y ${sample.y}\nSource Luma ${sample.luma}`;
    try {
      await navigator.clipboard.writeText(text);
      toast(`像素信息已复制 · ${sample.hex}`);
    } catch { toast('无法访问系统剪贴板'); }
  }

  function collectContactCandidates() {
    const candidates=new Map();
    const add=(frame,kind,label)=>{frame=clamp(Math.round(frame),0,lastFrame());const current=candidates.get(frame);if(current){if(!current.kinds.includes(kind))current.kinds.push(kind);if(label&&!current.labels.includes(label))current.labels.push(label);}else candidates.set(frame,{frame,kinds:[kind],labels:label?[label]:[],selected:true});};
    if($('#contactBookmarks').checked)state.bookmarks.forEach(bookmark=>add(bookmark.frame,'书签',bookmark.title||'书签'));
    if($('#contactAnnotations').checked){const frames=[...new Set(state.annotations.map(annotation=>annotation.frame))];frames.forEach(frame=>{const types=[...new Set(state.annotations.filter(a=>a.frame===frame).map(a=>annotationName(a.type)))];add(frame,'批注',types.slice(0,3).join('、')||'批注');});}
    if($('#contactLoop').checked){if(hasLoopRange()){const count=clamp(Number($('#contactSampleCount').value)||12,4,24);for(let index=0;index<count;index++)add(state.loopInFrame+(state.loopOutFrame-state.loopInFrame)*(count===1?0:index/(count-1)),'I/O','均匀取样');}}
    state.contactCandidates=[...candidates.values()].sort((a,b)=>a.frame-b.frame);return state.contactCandidates;
  }
  function renderContactCandidates(){collectContactCandidates();els.contactFrameList.innerHTML='';if(!state.contactCandidates.length){els.contactFrameList.innerHTML='<div class="contact-frame-empty">当前来源中没有可用帧。可添加书签、批注，或先设置 I/O 区间。</div>';return;}state.contactCandidates.forEach(item=>{const label=document.createElement('label');label.className='contact-frame-item';label.innerHTML=`<input type="checkbox" checked><span><b>F ${String(sourceFrame(item.frame)).padStart(5,'0')}</b> · ${formatTimecode(item.frame/state.fps)}<br>${escapeHtml(item.labels.join(' · ')||item.kinds.join(' + '))}</span>`;$('input',label).addEventListener('change',event=>item.selected=event.target.checked);els.contactFrameList.appendChild(label);});}
  function openContactSheet(){if(!playback.duration){toast('请先打开视频');return;}$('#exportMenu').classList.remove('open');const hasAnnotations=state.annotations.length>0;$('#contactDrawAnnotations').checked=hasAnnotations;renderContactCandidates();els.contactSheetModal.classList.add('open');els.contactSheetModal.setAttribute('aria-hidden','false');}
  function closeContactSheet(){if(state.contactSheetBusy)return;els.contactSheetModal.classList.remove('open');els.contactSheetModal.setAttribute('aria-hidden','true');}
  function updateContactProgress(done,total,message){const progress=$('#contactProgress');progress.hidden=false;$('span',progress).textContent=message||`${done} / ${total}`;$('i',progress).style.width=`${total?done/total*100:0}%`;}
  function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encode failed')),'image/png'));}
  function drawContactLabel(ctx,item,x,y,width,height){ctx.fillStyle='#0d1115';ctx.fillRect(x,y,width,height);ctx.fillStyle='#e0e6ea';ctx.font=`600 ${Math.max(19,Math.round(width*.025))}px Inter, sans-serif`;ctx.fillText(`FRAME ${String(sourceFrame(item.frame)).padStart(5,'0')}`,x+18,y+31);ctx.fillStyle='#91a0ab';ctx.font=`${Math.max(15,Math.round(width*.019))}px ui-monospace, monospace`;ctx.fillText(formatTimecode(item.frame/state.fps),x+18,y+57);ctx.fillStyle='#71808b';ctx.font=`${Math.max(14,Math.round(width*.017))}px Inter, sans-serif`;const text=(item.labels.join(' · ')||item.kinds.join(' + ')).slice(0,80);ctx.fillText(text,x+18,y+height-14,width-36);}
  async function generateContactSheet(){
    const selected=state.contactCandidates.filter(item=>item.selected);if(!selected.length){toast('请至少选择一帧');return;}
    const source=playback.currentSrc||playback.src;if(!source)return;state.contactSheetBusy=true;state.contactSheetCancel=false;$('#generateContactSheetBtn').disabled=true;$('#cancelContactGenerationBtn').hidden=false;$('#closeContactSheetFooterBtn').disabled=true;
    const media=AstriaPlayback.create();media.muted=true;media.setProjectFps(state.fps);media.open(playback.media);const columns=clamp(Number($('#contactColumns').value)||4,2,5),pageWidth=[1920,2560,3840].includes(Number($('#contactWidth').value))?Number($('#contactWidth').value):3840,includeAnnotations=$('#contactDrawAnnotations').checked,pages=[];
    try{
      if(media.readyState<1)await waitForMediaEvent(media,'loadedmetadata',8000);const pageItems=24,padding=Math.round(pageWidth*.022),gap=Math.round(pageWidth*.007),cellWidth=Math.floor((pageWidth-padding*2-gap*(columns-1))/columns),imageHeight=Math.round(cellWidth*Math.min(1.2,media.videoHeight/Math.max(1,media.videoWidth))),labelHeight=Math.round(clamp(cellWidth*.19,72,142));
      for(let pageIndex=0;pageIndex<Math.ceil(selected.length/pageItems);pageIndex++){
        const items=selected.slice(pageIndex*pageItems,(pageIndex+1)*pageItems),rows=Math.ceil(items.length/columns),canvas=document.createElement('canvas');canvas.width=pageWidth;canvas.height=padding*2+rows*(imageHeight+labelHeight)+Math.max(0,rows-1)*gap;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#080b0e';ctx.fillRect(0,0,canvas.width,canvas.height);
        for(let index=0;index<items.length;index++){
          if(state.contactSheetCancel)throw new DOMException('Canceled','AbortError');const item=items[index],column=index%columns,row=Math.floor(index/columns),x=padding+column*(cellWidth+gap),y=padding+row*(imageHeight+labelHeight+gap);ctx.fillStyle='#030405';ctx.fillRect(x,y,cellWidth,imageHeight);
          try{await seekAuxiliaryVideo(media,Math.min(item.frame/state.fps,Math.max(0,media.duration-.001)));const scale=Math.min(cellWidth/media.videoWidth,imageHeight/media.videoHeight),dw=media.videoWidth*scale,dh=media.videoHeight*scale,dx=x+(cellWidth-dw)/2,dy=y+(imageHeight-dh)/2;ctx.drawImage(media.currentFrameCanvas,dx,dy,dw,dh);if(includeAnnotations)state.annotations.filter(a=>a.frame===item.frame&&!a.hidden).forEach(annotation=>{ctx.save();ctx.translate(dx,dy);drawShape(ctx,annotation,dw,dh);ctx.restore();});}catch{ctx.fillStyle='#242a30';ctx.fillRect(x,y,cellWidth,imageHeight);ctx.fillStyle='#89949d';ctx.textAlign='center';ctx.font=`${Math.round(cellWidth*.035)}px Inter`;ctx.fillText('FRAME UNAVAILABLE',x+cellWidth/2,y+imageHeight/2);ctx.textAlign='left';}
          drawContactLabel(ctx,item,x,y+imageHeight,cellWidth,labelHeight);updateContactProgress(pageIndex*pageItems+index+1,selected.length,`正在生成 · ${pageIndex*pageItems+index+1} / ${selected.length}`);
        }
        const blob=await canvasBlob(canvas),bytes=await blob.arrayBuffer(),base=(state.fileName||'Astria').replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*]/g,'-'),suffix=Math.ceil(selected.length/pageItems)>1?`-${String(pageIndex+1).padStart(2,'0')}`:'';pages.push({name:`${base}-contact-sheet${suffix}.png`,bytes});
      }
      if(state.contactSheetCancel)throw new DOMException('Canceled','AbortError');let result;if(desktopAPI?.exportBinaryBatch)result=await desktopAPI.exportBinaryBatch(pages);else{pages.forEach(page=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([page.bytes],{type:'image/png'}));link.download=page.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});result={canceled:false};}if(!result?.canceled){toast(`联系表已导出 · ${pages.length} 页`);els.contactSheetModal.classList.remove('open');els.contactSheetModal.setAttribute('aria-hidden','true');}
    }catch(error){if(error?.name==='AbortError')toast('已取消联系表生成');else{console.error(error);toast('联系表生成失败');}}
    finally{media.destroy();state.contactSheetBusy=false;$('#generateContactSheetBtn').disabled=false;$('#cancelContactGenerationBtn').hidden=true;$('#closeContactSheetFooterBtn').disabled=false;$('#contactProgress').hidden=true;}
  }

  function handlePlaybackEnded() {
    els.playBtn.classList.remove('playing');
    stopPlaybackUiLoop();
    if (state.endBehavior === 'loop') {
      playback.currentTime = hasLoopRange() ? state.loopInFrame / state.fps : 0;
      play();
    } else if (state.endBehavior === 'rewind') {
      playback.currentTime = 0;
      updateUI(true);
      setStatus('已返回第一帧');
    } else {
      updateUI(true);
      setStatus('播放结束');
    }
  }

  function bindEvents() {
    $('#cleanMuteBtn').addEventListener('click',()=>els.muteBtn.click());
    $('#cleanVolumeSlider').addEventListener('input',event=>{els.volumeSlider.value=event.target.value;els.volumeSlider.dispatchEvent(new Event('input'));});
    $('#cleanVolumeSlider').addEventListener('change',()=>persistPreferences());
    $('.bottom-dock').addEventListener('pointerleave',()=>scheduleCleanControlsHide());
    $('#ambientSwitch').addEventListener('click',()=>setAmbientEnabled(!ambient.enabled));
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(ambient.timer);ambient.timer=null;}else{ambient.lastSample=-Infinity;scheduleColorRender();}});
    playback.addEventListener('frame',event=>{if(event.detail?.seeked){ambient.lastSample=-Infinity;scheduleColorRender();}});
    ['#openVideoBtn','#emptyOpenBtn'].forEach(s=>$(s).addEventListener('click',requestOpenVideo));
    els.videoInput.addEventListener('change',()=>openVideo(els.videoInput.files[0]));
    els.viewerStage.addEventListener('dragover',e=>{e.preventDefault();els.viewerStage.classList.add('dragover');});
    els.viewerStage.addEventListener('dragleave',()=>els.viewerStage.classList.remove('dragover'));
    els.viewerStage.addEventListener('drop',e=>{e.preventDefault();els.viewerStage.classList.remove('dragover');openVideo(e.dataTransfer.files[0]);});
    playback.addEventListener('metadata',onMetadata);
    playback.addEventListener('frame',announceInitialMediaPresented,{once:true});
    playback.addEventListener('error',()=>{document.body.classList.remove('media-loading');announceInitialMediaPresented(true);setMediaReady(false);setStatus('视频载入失败');toast(playback.error?.message || '无法播放此视频，请检查编码格式');});
    playback.addEventListener('frame',()=>{if(!state.timelineScrub&&!state.scrub&&!state.scrubController.active&&!state.scrubFinalizing)updateUI();if(!playback.requestVideoFrameCallback){captureFrame();scheduleColorRender();}});
    playback.addEventListener('frame',event=>{if(event.detail?.seeked)onPlaybackSeeked();});
    playback.addEventListener('playing',()=>{hideCachedFrame();els.playBtn.classList.add('playing');setStatus('播放中');startPlaybackUiLoop();revealCleanControls();});
    playback.addEventListener('paused',()=>{els.playBtn.classList.remove('playing');stopPlaybackUiLoop();if(!state.isReverse)setStatus('已暂停');revealCleanControls();});
    playback.addEventListener('ended',handlePlaybackEnded);
    els.playBtn.addEventListener('click',()=>playback.paused&&!state.isReverse?play():pause());
    $('#jumpStartBtn').addEventListener('click',()=>seekFrame(0)); $('#stepBack5Btn').addEventListener('click',()=>step(-5));
    $('#stepBackBtn').addEventListener('click',()=>step(-1)); $('#stepForwardBtn').addEventListener('click',()=>step(1));
    $('#stepForward5Btn').addEventListener('click',()=>step(5)); $('#reverseBtn').addEventListener('click',()=>state.isReverse?stopReverse():reverse());
    els.speedRange.addEventListener('input',e=>setPlaybackSpeed(e.target.value));
    els.speedRange.addEventListener('change',()=>persistPreferences());
    els.speedNumber.addEventListener('change',e=>setPlaybackSpeed(e.target.value,true));
    $('#speedDownBtn').addEventListener('click',()=>setPlaybackSpeed(state.playbackSpeed-.05,true));
    $('#speedUpBtn').addEventListener('click',()=>setPlaybackSpeed(state.playbackSpeed+.05,true));
    $('#speedResetBtn').addEventListener('click',()=>setPlaybackSpeed(1,true));
    $('#autoplaySwitch').addEventListener('click',()=>{
      state.autoplayOnOpen = !state.autoplayOnOpen;
      $('#autoplaySwitch').classList.toggle('on', state.autoplayOnOpen);
      $('#autoplaySwitch').setAttribute('aria-checked', String(state.autoplayOnOpen));
      persistPreferences();
      toast(state.autoplayOnOpen ? '打开视频后将自动播放' : '打开视频后将保持暂停');
    });
    $('#startupModeSelect').addEventListener('change',e=>{
      state.startupMode = e.target.value === 'clean' ? 'clean' : 'classic';
      persistPreferences();
      toast(`下次启动默认使用${state.startupMode === 'clean' ? '纯净模式' : '经典模式'}`);
    });
    els.endBehaviorSelect.addEventListener('change',e=>{state.endBehavior=e.target.value;persistPreferences();toast(({stop:'播放结束后停在最后一帧',rewind:'播放结束后返回第一帧',loop:'已开启循环播放'})[state.endBehavior]);});
    els.fpsInput.addEventListener('change',()=>{state.fps=clamp(Number(els.fpsInput.value)||24,1,240);state.fpsMode='custom';playback.setProjectFps(state.fps);resetScrubDecoder();clearFrameCache();disposeTimelinePreview();state.bookmarks.forEach(b=>b.timestamp=b.frame/state.fps);els.fpsInput.value=state.fps;$('#hudFps').textContent=`${state.fps} FPS`;$('#propFps').textContent=`${state.fps} fps`;$('#propFrames').textContent=totalFrames().toLocaleString();renderBookmarks();renderTimeline();scheduleScrubPrefetch();saveWorkspace();});
    els.muteBtn.addEventListener('click',()=>{
      if (playback.muted || playback.volume === 0) {
        if (playback.volume === 0) playback.volume = state.previousVolume || 1;
        playback.muted = false;
      } else {
        state.previousVolume = playback.volume;
        playback.muted = true;
      }
      syncVolumeUI(); saveWorkspace();
    });
    els.volumeSlider.addEventListener('input',e=>{
      const volume = clamp(Number(e.target.value) / 100, 0, 1);
      playback.volume = volume;
      playback.muted = volume === 0;
      if (volume > 0) state.previousVolume = volume;
      syncVolumeUI();
    });
    els.volumeSlider.addEventListener('change',()=>saveWorkspace());
    els.viewerZoomSelect.addEventListener('change',e=>setViewerZoom(e.target.value));
    $('#viewerFitBtn').addEventListener('click',()=>resetViewerView());
    $('#fullscreenBtn').addEventListener('click',()=>{
      if (desktopAPI) { desktopAPI.toggleFullscreen().catch(() => {}); return; }
      if (document.fullscreenElement) document.exitFullscreen?.();
      else $('.viewer-column').requestFullscreen?.();
    });
    document.addEventListener('fullscreenchange',()=>{
      document.body.classList.toggle('window-fullscreen',!!document.fullscreenElement);
      revealCleanControls();
      scheduleLayoutRefresh();
    });
    $$('#windowMinimizeBtn, #cleanWindowMinimizeBtn').forEach(button=>button.addEventListener('click',e=>{e.stopPropagation();desktopAPI?.minimizeWindow();}));
    $$('#windowMaximizeBtn, #cleanWindowMaximizeBtn').forEach(button=>button.addEventListener('click',e=>{e.stopPropagation();desktopAPI?.toggleMaximizeWindow();}));
    $$('#windowCloseBtn, #cleanWindowCloseBtn').forEach(button=>button.addEventListener('click',e=>{e.stopPropagation();desktopAPI?.closeWindow();}));
    $('#cleanModeBtn').addEventListener('click',()=>setCleanMode(!state.cleanMode));
    $('#cleanModeExitBtn').addEventListener('click',()=>setCleanMode(false));
    const volumeDisclosure = $('#volumeDisclosure');
    const transportSettings = $('#transportSettings');
    transportSettings.addEventListener('toggle', () => { if (transportSettings.open) volumeDisclosure.open = false; });
    volumeDisclosure.addEventListener('toggle', () => { if (volumeDisclosure.open) transportSettings.open = false; });
    $('#lumaBtn').addEventListener('click',()=>{state.lumaMode=!state.lumaMode;els.viewerStage.classList.toggle('luma-mode',state.lumaMode);$('#lumaBtn').classList.toggle('active',state.lumaMode);$('#lumaControl').classList.toggle('active',state.lumaMode);scheduleColorRender();toast(state.lumaMode?'明暗检查已开启':'明暗检查已关闭');saveWorkspace();});
    els.lumaContrast.addEventListener('input',e=>{state.lumaContrast=Number(e.target.value)/100;els.lumaContrastValue.textContent=`${e.target.value}%`;els.viewerStage.style.setProperty('--luma-contrast',state.lumaContrast);scheduleColorRender();});
    els.lumaContrast.addEventListener('change',()=>saveWorkspace());
    $('#lumaResetBtn').addEventListener('click',()=>{state.lumaContrast=1;els.lumaContrast.value=100;els.lumaContrastValue.textContent='100%';els.viewerStage.style.setProperty('--luma-contrast',1);scheduleColorRender();saveWorkspace();toast('LUMA 对比度已恢复为 100%');});
    $('#pixelInspectorBtn').addEventListener('click',()=>setPixelInspector(!state.pixelInspector));
    ['colorViewTool','guideViewTool'].forEach(id=>$('#'+id).addEventListener('toggle',event=>{if(!event.target.open)return;['colorViewTool','guideViewTool'].filter(other=>other!==id).forEach(other=>$('#'+other).removeAttribute('open'));$('#transportSettings').removeAttribute('open');}));
    $('#colorPresetSelect').addEventListener('change',event=>setColorPreset(event.target.value));
    $('#guideSpiralRotation').addEventListener('change',event=>{state.guideSpiralRotation=Number(event.target.value);state.guideSpiral=true;state.guidesMaster=true;$('#guideSpiral').checked=true;renderCompositionGuides();persistPreferences();});
    $('#guideAspect').addEventListener('change',event=>{state.guideAspect=event.target.value;state.guidesMaster=true;renderCompositionGuides();persistPreferences();});
    $('#guideOpacity').addEventListener('input',event=>{state.guideOpacity=Number(event.target.value)/100;renderCompositionGuides();});$('#guideOpacity').addEventListener('change',persistPreferences);
    $('#guideMaskStrength').addEventListener('input',event=>{state.guideMaskStrength=Number(event.target.value)/100;renderCompositionGuides();});$('#guideMaskStrength').addEventListener('change',persistPreferences);

    document.addEventListener('pointerdown',event=>{if(!event.target.closest('#volumeDisclosure'))volumeDisclosure.open=false;});
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||(!transportSettings.open&&!volumeDisclosure.open))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(transportSettings.open){transportSettings.open=false;$('#transportSettings > summary').focus();}
      else{volumeDisclosure.open=false;$('#volumeDisclosure > summary').focus();}
    },true);
    [['guideThirds','guideThirds'],['guideGolden','guideGolden'],['guideSpiral','guideSpiral'],['guideCenter','guideCenter'],['guideDiagonal','guideDiagonal'],['guideTriangle','guideTriangle'],['guideSymmetry','guideSymmetry'],['guideActionSafe','guideActionSafe'],['guideTitleSafe','guideTitleSafe']].forEach(([id,key])=>$('#'+id).addEventListener('change',event=>{state[key]=event.target.checked;state.guidesMaster=true;renderCompositionGuides();persistPreferences();}));
    $('#hoverPreviewSwitch').addEventListener('click',()=>{state.timelineHoverPreview=!state.timelineHoverPreview;$('#hoverPreviewSwitch').classList.toggle('on',state.timelineHoverPreview);$('#hoverPreviewSwitch').setAttribute('aria-checked',String(state.timelineHoverPreview));if(!state.timelineHoverPreview)disposeTimelinePreview();else if(playback.duration)ensureTimelinePreviewVideo();persistPreferences();toast(state.timelineHoverPreview?'悬停帧预览已开启':'悬停帧预览已关闭');});
    $('#previewSizeRange').addEventListener('input',e=>setTimelinePreviewSize(e.target.value));
    $('#previewSizeRange').addEventListener('change',e=>setTimelinePreviewSize(e.target.value,true));
    $('#previewSizeNumber').addEventListener('input',e=>setTimelinePreviewSize(e.target.value));
    $('#previewSizeNumber').addEventListener('change',e=>setTimelinePreviewSize(e.target.value,true));
    $('#previewSizeDownBtn').addEventListener('click',()=>setTimelinePreviewSize(state.timelineHoverPreviewSize-2,true));
    $('#previewSizeUpBtn').addEventListener('click',()=>setTimelinePreviewSize(state.timelineHoverPreviewSize+2,true));
    $('#previewSizeResetBtn').addEventListener('click',()=>{setTimelinePreviewSize(196,true);toast('悬停大图尺寸已恢复为 196px');});
    $('#openDefaultAppsBtn').addEventListener('click',()=>desktopAPI?.openDefaultApps());
    [els.timelineWrap,els.ruler].forEach(surface=>{
      surface.addEventListener('pointerdown',beginTimelineScrub);
      surface.addEventListener('pointermove',moveTimelineScrub);
      surface.addEventListener('pointerup',endTimelineScrub);
      surface.addEventListener('pointercancel',endTimelineScrub);
      surface.addEventListener('lostpointercapture',e=>cancelTimelineScrub(e.pointerId));
    });
    els.timelineWrap.addEventListener('pointermove',updateTimelineTooltip);
    els.timelineWrap.addEventListener('pointerleave',()=>{if(!state.timelineScrub)hideTimelinePreview();});
    els.timelineWrap.addEventListener('scroll',()=>{hideTimelinePreview();syncRulerToTimeline();},{passive:true});
    [els.timelineWrap, els.ruler].forEach(surface=>surface.addEventListener('wheel',e=>{if(!e.ctrlKey||!playback.duration)return;e.preventDefault();state.timelineZoom=clamp(state.timelineZoom+(e.deltaY<0?.5:-.5),1,12);renderTimeline();saveWorkspace();},{passive:false}));
    $('#resetTimelineZoomBtn').addEventListener('click',()=>resetTimelineZoom());
    els.viewerStage.addEventListener('pointerdown',beginScrub); els.viewerStage.addEventListener('pointermove',moveScrub); els.viewerStage.addEventListener('pointerup',endScrub); els.viewerStage.addEventListener('pointercancel',endScrub);
    els.viewerStage.addEventListener('pointerdown',beginViewerPan); els.viewerStage.addEventListener('pointermove',moveViewerPan); els.viewerStage.addEventListener('pointerup',endViewerPan); els.viewerStage.addEventListener('pointercancel',endViewerPan);
    els.viewerStage.addEventListener('pointerdown',beginQuickAnnotation); els.viewerStage.addEventListener('pointermove',moveQuickAnnotation); els.viewerStage.addEventListener('pointerup',endQuickAnnotation); els.viewerStage.addEventListener('pointercancel',endQuickAnnotation);
    els.viewerStage.addEventListener('contextmenu',e=>e.preventDefault());
    els.viewerStage.addEventListener('wheel',handleViewerWheel,{passive:false});
    els.viewerStage.addEventListener('pointermove',inspectPixel);
    els.viewerStage.addEventListener('pointerleave',()=>{if(!state.pixelInspectorLocked)els.pixelInspectorHud.classList.remove('show');});
    $$('[data-quick-tool]').forEach(button=>button.addEventListener('click',e=>{e.stopPropagation();setQuickAnnotationTool(button.dataset.quickTool);hideAnnotationRadialMenu();}));
    $('#radialAnnotationColor').addEventListener('input',e=>{state.annotationColor=e.target.value;document.documentElement.style.setProperty('--annotation-color',e.target.value);});
    $('#radialAnnotationColor').addEventListener('change',()=>persistPreferences());
    els.annotationSizeRange.addEventListener('input',e=>{state.annotationSize=Number(e.target.value);updateAnnotationSizeLabel();persistPreferences();});
    $('#annotationSizeDown').addEventListener('click',e=>{e.stopPropagation();adjustAnnotationSize(-1);});
    $('#annotationSizeUp').addEventListener('click',e=>{e.stopPropagation();adjustAnnotationSize(1);});
    els.radialMenu.addEventListener('wheel',e=>{e.preventDefault();adjustAnnotationSize(e.deltaY<0?1:-1);},{passive:false});
    $('#clearFrameAnnotations').addEventListener('click',e=>{e.stopPropagation();const frame=currentFrame();const count=state.annotations.filter(a=>a.frame===frame).length;if(!count)return;pushAnnotationUndo();state.annotations=state.annotations.filter(a=>a.frame!==frame);delete state.annotationThumbnails[frame];if(state.selectedAnnotationFrame===frame){state.selectedAnnotationId=null;state.selectedAnnotationFrame=null;}hideAnnotationRadialMenu();refreshAnnotationUI();toast(`已清除此帧 ${count} 个批注内容`);});
    els.radialDismissLayer.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();hideAnnotationRadialMenu();});
    els.radialDismissLayer.addEventListener('contextmenu',e=>e.preventDefault());
    $('#toggleAnnotationsBtn').addEventListener('click',()=>{state.annotationVisible=!state.annotationVisible;$('#toggleAnnotationsBtn').textContent=state.annotationVisible?'全部隐藏':'全部显示';drawAnnotations();});
    $$('[data-annotation-scope]').forEach(btn=>btn.addEventListener('click',()=>{state.annotationScope=btn.dataset.annotationScope;$$('[data-annotation-scope]').forEach(item=>item.classList.toggle('active',item===btn));renderAnnotationList();}));
    $('#addBookmarkBtn').addEventListener('click',createBookmark); $('#bookmarkSearch').addEventListener('input',renderBookmarks); $('#sortSelect').addEventListener('change',renderBookmarks);
    $('#favoriteFilter').addEventListener('click',()=>{state.favoriteOnly=!state.favoriteOnly;$('#favoriteFilter').classList.toggle('active',state.favoriteOnly);renderBookmarks();});
    $('#listViewBtn').addEventListener('click',()=>{state.view='list';$('#listViewBtn').classList.add('active');$('#gridViewBtn').classList.remove('active');renderBookmarks();});
    $('#gridViewBtn').addEventListener('click',()=>{state.view='grid';$('#gridViewBtn').classList.add('active');$('#listViewBtn').classList.remove('active');renderBookmarks();});
    els.notes.addEventListener('input',()=>{const b=selectedBookmark();if(!b)return;b.notes=els.notes.value;b.updatedTime=new Date().toISOString();els.notesSaved.textContent='保存中…';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>{saveWorkspace();els.notesSaved.textContent='已保存';},400);});
    $('#autosaveSwitch').addEventListener('click',()=>{state.autosave=!state.autosave;$('#autosaveSwitch').classList.toggle('on',state.autosave);if(state.autosave)saveWorkspace();});
    els.scrubSensitivity.addEventListener('input',e=>{state.viewerScrubSensitivity=Number(e.target.value);els.scrubSensitivityValue.textContent=`${state.viewerScrubSensitivity.toFixed(2)} 帧/像素`;});
    els.scrubSensitivity.addEventListener('change',()=>saveWorkspace());
    $('#resetWorkspaceBtn').addEventListener('click',()=>{if(!confirm('确定清空当前视频的所有书签、批注、循环区间和笔记吗？'))return;state.bookmarks=[];state.annotations=[];state.loopInFrame=null;state.loopOutFrame=null;state.selectedBookmarkIds=[];state.selectedAnnotationId=null;state.selectedAnnotationFrame=null;removeMediaSnapshot(state.currentMediaKey);renderBookmarks();renderTimeline();renderAnnotationList();syncNotes();updateCounts();toast('当前视频工作区已清空');});
    $$('#bookmarkContextMenu [data-action]').forEach(btn=>btn.addEventListener('click',()=>bookmarkMenuAction(btn.dataset.action)));
    $$('#bookmarkContextMenu [data-color]').forEach(chip=>chip.addEventListener('click',()=>{const b=state.bookmarks.find(item=>item.id===state.contextBookmarkId);if(b){b.color=chip.dataset.color;b.updatedTime=new Date().toISOString();renderBookmarks();renderTimeline();saveWorkspace();}hideBookmarkMenu();}));

    $('#closeHelpBtn').addEventListener('click',()=>els.helpModal.classList.remove('open')); els.helpModal.addEventListener('click',e=>{if(e.target===els.helpModal)els.helpModal.classList.remove('open');});
    $$('#shortcutEditor [data-shortcut-action]').forEach(button=>button.addEventListener('click',()=>{
      if(state.shortcutRecording)finishShortcutRecording();
      state.shortcutRecording=button.dataset.shortcutAction;button.classList.add('recording');$('kbd',button).textContent='按下快捷键';
    }));
    $('#resetShortcutsBtn').addEventListener('click',()=>{state.shortcuts={...DEFAULT_SHORTCUTS};finishShortcutRecording();renderShortcutEditor();persistPreferences();toast('快捷键已恢复默认');});
    state.viewerResizeObserver = new ResizeObserver(scheduleLayoutRefresh);
    state.viewerResizeObserver.observe(els.viewerStage);
    window.addEventListener('resize',scheduleLayoutRefresh);
    document.addEventListener('pointermove',revealCleanControls,{passive:true});
    $('.radial-center').addEventListener('pointerdown',e=>{if(e.button!==0&&e.button!==2)return;e.preventDefault();e.stopPropagation();hideAnnotationRadialMenu();});
    $('.radial-center').addEventListener('contextmenu',e=>e.preventDefault());
    $('.radial-center').addEventListener('click',hideAnnotationRadialMenu);
    els.textInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();confirmTextAnnotation();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelTextAnnotation();}});
    $('#confirmAnnotationText').addEventListener('click',confirmTextAnnotation);
    $('#copyPixelBtn').addEventListener('click',copyPixelSample);
    $('#exportAnnotatedFrameBtn').addEventListener('click',exportCurrentAnnotatedFrame);
    $('.panel-tabs').addEventListener('click',e=>{const tab=e.target.closest('[data-panel]');if(tab)showPanel(tab.dataset.panel);});
    $('#togglePanelBtn').addEventListener('click',()=>setPanelOpen(!state.panelOpen));
    $('#closePanelBtn').addEventListener('click',()=>setPanelOpen(false));
    $('#saveBtn').addEventListener('click',()=>{closeClassicTopbarMenus();saveWorkspace(true);});
    $('#exportBtn').addEventListener('click',event=>{event.stopPropagation();setTopExportOpen(!$('#exportMenu').classList.contains('open'));});
    $('#exportWorkspaceMenuBtn').addEventListener('click',()=>{closeClassicTopbarMenus();exportWorkspace();});
    $('#contactSheetBtn').addEventListener('click',()=>{closeClassicTopbarMenus();openContactSheet();});
    $('#topMore').addEventListener('toggle',()=>{if(!$('#topMore').open)setTopExportOpen(false);});
    document.addEventListener('pointerdown',event=>{if(!event.target.closest('#topMore')){$('#topMore').open=false;setTopExportOpen(false);}});
    const closeContactSheet=()=>{state.contactSheetCancel=true;els.contactSheetModal.classList.remove('open');els.contactSheetModal.setAttribute('aria-hidden','true');};
    $('#closeContactSheetBtn').addEventListener('click',closeContactSheet);
    $('#closeContactSheetFooterBtn').addEventListener('click',closeContactSheet);
    els.contactSheetModal.addEventListener('click',e=>{if(e.target===els.contactSheetModal)closeContactSheet();});
    $('#generateContactSheetBtn').addEventListener('click',generateContactSheet);
    $('#cancelContactGenerationBtn').addEventListener('click',()=>{state.contactSheetCancel=true;});
    ['contactBookmarks','contactAnnotations','contactLoop','contactSampleCount'].forEach(id=>$('#'+id).addEventListener('change',renderContactCandidates));
    $('#contactSelectAllBtn').addEventListener('click',()=>{const selected=state.contactCandidates.some(item=>!item.selected);state.contactCandidates.forEach(item=>item.selected=selected);$$('input',els.contactFrameList).forEach(input=>input.checked=selected);});
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('#bookmarkContextMenu'))hideBookmarkMenu();if(!e.target.closest('#annotationTextEditor')&&state.pendingTextAnnotation)cancelTextAnnotation();if(!e.target.closest('#transportSettings'))$('#transportSettings').removeAttribute('open');if(!e.target.closest('.top-tool-popover')){$('#colorViewTool').removeAttribute('open');$('#guideViewTool').removeAttribute('open');}if(!e.target.closest('#exportMenu')&&!e.target.closest('#exportBtn'))setTopExportOpen(false);});
    $('#helpBtn').addEventListener('click',()=>{closeClassicTopbarMenus();renderShortcutEditor();els.helpModal.classList.add('open');els.helpModal.setAttribute('aria-hidden','false');});
    window.addEventListener('blur',hideTimelinePreview);
    els.timelineWrap.addEventListener('wheel',hideTimelinePreview,{passive:true});
    const topbar = $('.topbar');
    // Keep existing controls and their event handlers when consolidating the header.
    $('.top-center').prepend($('#openVideoBtn'));
    const mediaInfo = document.createElement('details');
    mediaInfo.className = 'header-media-info';
    const mediaSummary = document.createElement('summary');
    mediaSummary.textContent = '媒体信息';
    mediaInfo.append(mediaSummary, $('#mediaInfoTop'));
    $('.top-more-menu').append(mediaInfo);
    const reviewMenu = $('#reviewMenu');
    const syncActiveReviewTools = () => {
      const active = [
        ['灰度', state.lumaMode, () => $('#lumaBtn').click()],
        ['拾色', state.pixelInspector, () => $('#pixelInspectorBtn').click()],
        ['色彩', state.colorPreset !== 'original', () => setColorPreset('original')],
        ['构图', state.guidesMaster && [...els.guides.classList].some(c => c.startsWith('show-')), () => toggleCompositionGuides()]
      ];
      const host = $('#activeReviewTools');
      const key = active.filter(a => a[1]).map(a => a[0]).join(',');
      if (host.dataset.active === key) return;
      host.dataset.active = key;
      host.replaceChildren();
      for (const [label, enabled, disable] of active) {
        if (!enabled) continue;
        const button = document.createElement('button');
        button.textContent = `${label} ×`; button.title = `关闭${label}`;
        button.setAttribute('aria-label', `关闭${label}`);
        button.addEventListener('click', disable); host.append(button);
      }
    };
    new MutationObserver(syncActiveReviewTools).observe(topbar, {subtree:true, attributes:true, attributeFilter:['class']});
    new MutationObserver(syncActiveReviewTools).observe(els.guides, {attributes:true, attributeFilter:['class']});
    new MutationObserver(syncActiveReviewTools).observe(els.colorCanvas, {attributes:true, attributeFilter:['class']});
    syncActiveReviewTools();
    reviewMenu.addEventListener('toggle', () => {
      if (reviewMenu.open) $('#topMore').open = false;
      else $$('#reviewMenu details[open]').forEach(item => { item.open = false; });
    });
    $('#topMore').addEventListener('toggle', () => { if ($('#topMore').open) reviewMenu.open = false; });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#reviewMenu')) reviewMenu.open = false;
      if (!event.target.closest('#topMore')) $('#topMore').open = false;
    });
    const hideControlsOutsideWindow = () => {
      if (!state.cleanMode) return;
      clearTimeout(state.cleanControlsTimer);
      document.body.classList.add('clean-pointer-outside');
      document.body.classList.remove('clean-controls-visible');
      hideTimelinePreview();
    };
    desktopAPI?.onWindowPointer?.(({ inside }) => {
      classicWindowOutside = !inside;
      if (!inside) { classicPointerInside = false; refreshClassicTopbar(); }
      if (!inside) hideControlsOutsideWindow();
      else {
        document.body.classList.remove('clean-pointer-outside');
        revealCleanControls();
      }
    });
    desktopAPI?.onTitlebarHover(({ inside, x, y }) => {
      if(state.cleanMode)return;
      if(inside){const target=document.elementFromPoint(x,y);if(target)updateClassicTopbar({clientX:x,clientY:y,target,nativePointer:true});}
      else{classicPointerInside=false;refreshClassicTopbar();}
    });
    topbar.addEventListener('pointerenter', updateClassicTopbar);
    topbar.addEventListener('pointerleave', event => {
      if (nativeClassicPointer) return;
      // Re-evaluate the same coordinates, not the element that just lost hover.
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (target) updateClassicTopbar({ clientX: event.clientX, clientY: event.clientY, target });
      else { classicPointerInside = false; refreshClassicTopbar(); }
    });
    topbar.addEventListener('focusin', refreshClassicTopbar);
    topbar.addEventListener('focusout', () => queueMicrotask(refreshClassicTopbar));
    $$('.topbar details').forEach(menu => menu.addEventListener('toggle', refreshClassicTopbar));
    new MutationObserver(refreshClassicTopbar).observe($('#exportMenu'), { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('blur', () => {

      classicWindowOutside = true; classicPointerInside = false; closeClassicTopbarMenus(); refreshClassicTopbar();
    });
    document.documentElement.addEventListener('pointerenter', updateClassicTopbar);
    document.addEventListener('pointermove',updateClassicTopbar,{passive:true});
    document.addEventListener('pointerdown',updateClassicTopbar,{passive:true});
    document.documentElement.addEventListener('pointerenter',()=>{
      document.body.classList.remove('clean-pointer-outside');
      revealCleanControls();
    });
    document.documentElement.addEventListener('pointerleave',event=>{
      if (event.relatedTarget) return;
      if (!nativeClassicPointer) {
        classicWindowOutside = true; classicPointerInside = false; refreshClassicTopbar();
      }
      if (state.cleanMode) {
        hideControlsOutsideWindow();
      } else scheduleCleanControlsHide();
    });
    $$('.transport, .timeline-panel, .clean-window-controls').forEach(surface=>{
      surface.addEventListener('pointerenter',revealCleanControls);
      surface.addEventListener('pointerleave',()=>scheduleCleanControlsHide());
      surface.addEventListener('focusin',revealCleanControls);
      surface.addEventListener('focusout',()=>queueMicrotask(scheduleCleanControlsHide));
    });
    $$('.transport details').forEach(menu=>menu.addEventListener('toggle',revealCleanControls));
    window.addEventListener('beforeunload',persistCurrentWorkspaceNow);
    document.addEventListener('keydown',handleShortcut);
  }

  function handleShortcut(e) {
    const typing=/INPUT|TEXTAREA/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable;
    if (state.shortcutRecording) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { finishShortcutRecording(); return; }
      const shortcut = shortcutFromEvent(e);
      if (!shortcut) return;
      const reserved = new Set(['Ctrl+O','Ctrl+S','Ctrl+F','Ctrl+C','Ctrl+Shift+C','Ctrl+Z','Ctrl+A','Delete','Escape','ArrowLeft','ArrowRight','Shift+ArrowLeft','Shift+ArrowRight','J','K','L','Shift+I','Shift+O']);
      if (reserved.has(shortcut)) { toast('该快捷键由系统操作保留'); finishShortcutRecording(); return; }
      finishShortcutRecording(shortcut); return;
    }
    if (e.key === 'Escape' && !state.cleanMode && $('.topbar').querySelector('details[open], .export-menu.open')) {
      e.preventDefault(); closeClassicTopbarMenus();
      if ($('.topbar').contains(document.activeElement)) document.activeElement.blur();
      refreshClassicTopbar(); return;
    }
    if (e.key==='Escape'&&els.radialMenu.classList.contains('open')){e.preventDefault();hideAnnotationRadialMenu();return;}
    if (e.key==='Escape'&&state.pendingTextAnnotation){e.preventDefault();cancelTextAnnotation();return;}
    if (e.key==='Escape'&&state.pixelInspectorLocked){e.preventDefault();unlockPixelInspector(true);toast('像素取样已解除锁定');return;}
    if (e.key==='Escape'&&state.cleanMode){e.preventDefault();setCleanMode(false);return;}
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();requestOpenVideo();return;}
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveWorkspace(true);return;}
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();showPanel('bookmarks');setPanelOpen(true);$('#bookmarkSearch').focus();return;}
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c'&&!typing){
      e.preventDefault();
      if (!e.shiftKey && state.pixelInspector && state.pixelInspectorLocked && state.pixelSample) void copyPixelSample();
      else copyFrame(e.shiftKey);
      return;
    }
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!typing){e.preventDefault();undoAnnotation();return;}
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&!typing){e.preventDefault();state.selectedBookmarkIds=state.bookmarks.map(b=>b.id);renderBookmarks();renderTimeline();return;}
    if (typing) { if(e.key==='Escape')document.activeElement.blur(); return; }
    const shortcut = shortcutFromEvent(e);
    const action = Object.keys(state.shortcuts).find(name => state.shortcuts[name] === shortcut);
    if (action && SHORTCUT_ACTIONS[action]) { e.preventDefault(); SHORTCUT_ACTIONS[action](); return; }
    if(e.key==='ArrowLeft'){e.preventDefault();step(e.shiftKey?-5:-1);}
    else if(e.key==='ArrowRight'){e.preventDefault();step(e.shiftKey?5:1);}
    else if(e.key.toLowerCase()==='i'&&e.shiftKey){e.preventDefault();clearLoopPoint('in');}
    else if(e.key.toLowerCase()==='o'&&e.shiftKey){e.preventDefault();clearLoopPoint('out');}
    else if(e.key.toLowerCase()==='j')reverse(); else if(e.key.toLowerCase()==='k')pause(); else if(e.key.toLowerCase()==='l')play();
    else if(e.key==='F1'){e.preventDefault();renderShortcutEditor();els.helpModal.classList.add('open');}
    else if(e.key==='Delete')deleteSelection(); else if(e.key==='Escape'){els.helpModal.classList.remove('open');}
  }

  await loadWorkspace(); void preloadBuiltInColorLuts(); bindEvents(); setMediaReady(false); renderBookmarks(); renderAnnotationList(); syncNotes(); updateUI();
  await initializeDesktopRuntime();
  if (window.__astriaPlayback) {
    window.__astriaScrubTest = {
      trace: [],
      begin: beginProfessionalScrub,
      target: updateProfessionalScrubTarget,
      end: endProfessionalScrub,
      snapshot: () => ({ ...state.scrubController, fps: state.fps, fpsMode: state.fpsMode, displayFrame: state.scrubDisplayFrame, lastFrame: lastFrame() })
    };
    window.__astriaReady = true;
  }
})();
