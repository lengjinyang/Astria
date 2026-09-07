const { contextBridge, ipcRenderer, sharedTexture, webUtils } = require('electron');

const textureCallbacks = new Map();
if (sharedTexture) sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, id) => {
  const frame = importedSharedTexture.getVideoFrame();
  try { for (const callback of textureCallbacks.get(id) || []) await callback(frame); }
  finally { frame.close(); importedSharedTexture.release(); }
});

const on = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  media: Object.freeze({
    create: () => ipcRenderer.invoke('media:create'),
    open: (id, mediaId, fps) => ipcRenderer.invoke('media:open', id, mediaId, fps),
    play: id => ipcRenderer.invoke('media:play', id),
    pause: id => ipcRenderer.invoke('media:pause', id),
    seek: (id, seconds) => ipcRenderer.invoke('media:seek', id, seconds),
    step: (id, direction) => ipcRenderer.invoke('media:step', id, direction),
    setSpeed: (id, speed) => ipcRenderer.invoke('media:setSpeed', id, speed),
    setVolume: (id, volume) => ipcRenderer.invoke('media:setVolume', id, volume),
    setMuted: (id, muted) => ipcRenderer.invoke('media:setMuted', id, muted),
    captureFrame: id => ipcRenderer.invoke('media:captureFrame', id),
    destroy: id => ipcRenderer.invoke('media:destroy', id),
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
  initialMediaPresented: () => ipcRenderer.send('vfx:initial-media-presented'),
  loadAppData: () => ipcRenderer.invoke('vfx:load-app-data'),
  saveAppData: data => ipcRenderer.send('vfx:save-app-data', data),
  exportWorkspace: (suggestedName, data) => ipcRenderer.invoke('vfx:export-workspace', { suggestedName, data }),
  exportBinary: (suggestedName, extension, bytes) => ipcRenderer.invoke('vfx:export-binary', { suggestedName, extension, bytes }),
  exportBinaryBatch: files => ipcRenderer.invoke('vfx:export-binary-batch', { files }),
  openDefaultApps: () => ipcRenderer.invoke('vfx:open-default-apps'),
  setWindowTitle: title => ipcRenderer.send('vfx:set-window-title', title),
  getVersion: () => ipcRenderer.invoke('vfx:get-version'),
  getWindowState: () => ipcRenderer.invoke('vfx:get-window-state'),
  fitVideoWindow: options => ipcRenderer.invoke('vfx:fit-video-window', options),
  startWindowDrag: point => ipcRenderer.send('vfx:window-drag-start', point),
  moveWindowDrag: point => ipcRenderer.send('vfx:window-drag-move', point),
  endWindowDrag: point => ipcRenderer.send('vfx:window-drag-end', point),
  minimizeWindow: () => ipcRenderer.invoke('vfx:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('vfx:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('vfx:window-close'),
  toggleFullscreen: () => ipcRenderer.invoke('vfx:toggle-fullscreen'),
  onOpenVideo: callback => on('vfx:open-video-from-system', callback),
  onCommand: callback => on('vfx:command', callback),
  onTitlebarHover: callback => on('vfx:titlebar-hover', callback),
  onWindowPointer: callback => on('vfx:window-pointer', callback),
  onWindowInteraction: callback => on('vfx:window-interaction', callback),
  onWindowState: callback => on('vfx:window-state', callback)
}));
