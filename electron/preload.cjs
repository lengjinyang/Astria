const { contextBridge, ipcRenderer, sharedTexture, webUtils } = require('electron');

let resolveInitialWindowShown;
const initialWindowShown = new Promise(resolve => { resolveInitialWindowShown = resolve; });
ipcRenderer.once('vfx:initial-window-shown', () => resolveInitialWindowShown(true));

const textureCallbacks = new Map();
if (sharedTexture) sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, id, metadata = {}) => {
  let frame = null;
  try {
    frame = importedSharedTexture.getVideoFrame();
    for (const callback of textureCallbacks.get(id) || []) await callback(frame, metadata);
  } finally {
    try { frame?.close(); }
    finally { importedSharedTexture.release(); }
  }
});

const on = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  isDesktop: true,
  browseDirectory: directory => ipcRenderer.invoke('vfx:browse-directory', directory),
  chooseDirectory: () => ipcRenderer.invoke('vfx:choose-directory'),
  startupMark: name => ipcRenderer.send('vfx:startup-mark', name),
  platform: process.platform,
  media: Object.freeze({
    create: () => ipcRenderer.invoke('media:create'),
    open: (id, mediaId, fps, startTime = 0, openToken = 0) => ipcRenderer.invoke('media:open', id, mediaId, fps, startTime, openToken),
    play: id => ipcRenderer.invoke('media:play', id),
    pause: id => ipcRenderer.invoke('media:pause', id),
    stop: id => ipcRenderer.invoke('media:stop', id),
    seek: (id, seconds, mediaId) => ipcRenderer.invoke('media:seek', id, seconds, mediaId),
    step: (id, direction) => ipcRenderer.invoke('media:step', id, direction),
    tracks: id => ipcRenderer.invoke('media:tracks', id),
    trackSettings: id => ipcRenderer.invoke('media:trackSettings', id),
    configureTrack: (id,key,value) => ipcRenderer.invoke('media:configureTrack',id,key,value),
    addSubtitle: id => ipcRenderer.invoke('media:addSubtitle',id),
    setSpeed: (id, speed) => ipcRenderer.invoke('media:setSpeed', id, speed),
    setVolume: (id, volume) => ipcRenderer.invoke('media:setVolume', id, volume),
    setMuted: (id, muted) => ipcRenderer.invoke('media:setMuted', id, muted),
    setOutputTarget: (id, target) => ipcRenderer.invoke('media:setOutputTarget', id, target),
    requestSourceFrame: (id, request) => ipcRenderer.invoke('media:requestSourceFrame', id, request),
    captureFrame: id => ipcRenderer.invoke('media:captureFrame', id),
    destroy: id => ipcRenderer.invoke('media:destroy', id),
    destroyAll: () => ipcRenderer.invoke('media:destroyAll'),
    onState: callback => on('media:state', callback),
    onFrame: callback => on('media:frame', callback),
    onSharedTextureFrame: (id, callback) => {
      if (typeof callback !== 'function') return () => {};
      if (!textureCallbacks.has(id)) textureCallbacks.set(id, new Set());
      textureCallbacks.get(id).add(callback);
      return () => { textureCallbacks.get(id)?.delete(callback); if (!textureCallbacks.get(id)?.size) textureCallbacks.delete(id); };
    }
  }),
  describeDroppedFile: file => ipcRenderer.invoke('vfx:describe-dropped-file', webUtils.getPathForFile(file)),
  openVideo: () => ipcRenderer.invoke('vfx:open-video'),
  openRecentVideo: filePath => ipcRenderer.invoke('vfx:open-recent-video', filePath),
  getRecentVideos: () => ipcRenderer.invoke('vfx:get-recent-videos'),
  clearRecentVideos: () => ipcRenderer.invoke('vfx:clear-recent-videos'),
  consumeLaunchMedia: () => ipcRenderer.invoke('vfx:consume-launch-media'),
  whenWindowShown: () => initialWindowShown,
  rendererReady: () => ipcRenderer.send('vfx:renderer-ready'),
  initialMediaPresented: () => ipcRenderer.send('vfx:initial-media-presented', { reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches }),
  loadAppData: () => ipcRenderer.invoke('vfx:load-app-data'),
  saveAppData: data => ipcRenderer.send('vfx:save-app-data', data),
  loadMediaWorkspace: key => ipcRenderer.invoke('vfx:load-media-workspace', key),
  loadMediaLaunchState: key => ipcRenderer.invoke('vfx:load-media-launch-state', key),
  savePreferences: preferences => ipcRenderer.send('vfx:save-preferences', preferences),
  saveMediaWorkspace: (key, workspace) => ipcRenderer.invoke('vfx:save-media-workspace', key, workspace),
  deleteMediaWorkspace: key => ipcRenderer.invoke('vfx:delete-media-workspace', key),
  exportWorkspace: (suggestedName, data) => ipcRenderer.invoke('vfx:export-workspace', { suggestedName, data }),
  exportBinary: (suggestedName, extension, bytes) => ipcRenderer.invoke('vfx:export-binary', { suggestedName, extension, bytes }),
  exportBinaryBatch: files => ipcRenderer.invoke('vfx:export-binary-batch', { files }),
  openDefaultApps: () => ipcRenderer.invoke('vfx:open-default-apps'),
  setWindowTitle: title => ipcRenderer.send('vfx:set-window-title', title),
  getVersion: () => ipcRenderer.invoke('vfx:get-version'),
  chooseComparison: () => ipcRenderer.invoke('vfx:choose-comparison'),
  setAlwaysOnTop: value => ipcRenderer.invoke('vfx:set-always-on-top',value),
  getWindowState: () => ipcRenderer.invoke('vfx:get-window-state'),
  fitVideoWindow: options => ipcRenderer.invoke('vfx:fit-video-window', options),
  minimizeWindow: () => ipcRenderer.invoke('vfx:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('vfx:window-toggle-maximize'),
  beginWindowResize: (edge, point) => ipcRenderer.send('vfx:window-resize-begin', edge, point),
  updateWindowResize: point => ipcRenderer.send('vfx:window-resize-update', point),
  endWindowResize: () => ipcRenderer.send('vfx:window-resize-end'),
  closeWindow: () => ipcRenderer.invoke('vfx:window-close'),
  rendererCloseReady: () => ipcRenderer.send('vfx:renderer-close-ready'),
  toggleFullscreen: () => ipcRenderer.invoke('vfx:toggle-fullscreen'),
  onOpenVideo: callback => on('vfx:open-video-from-system', callback),
  onCommand: callback => on('vfx:command', callback),
  onTitlebarHover: callback => on('vfx:titlebar-hover', callback),
  onWindowPointer: callback => on('vfx:window-pointer', callback),
  onWindowInteraction: callback => on('vfx:window-interaction', callback),
  onWindowState: callback => on('vfx:window-state', callback),
  onPrepareClose: callback => on('vfx:prepare-close', callback),
  onMediaProbe: callback => on('vfx:media-probe', callback)
}));
