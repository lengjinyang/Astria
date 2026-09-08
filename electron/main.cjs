const { app, BrowserWindow, dialog, ipcMain, Menu, shell, screen } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');

require('./file-associations.cjs')(process.argv);
if (require('electron-squirrel-startup')) app.quit();
if (process.platform === 'win32') {
  app.setAppUserModelId('com.astria.player');
  // Keep video and the interactive transport in one DirectComposition path.
  // Chromium's video overlay promotion can otherwise jump for one frame when
  // a control changes its pressed, focused, or open state.
  // Chromium reads this GPU workaround by its exact underscore-separated name.
  app.commandLine.appendSwitch('disable_direct_composition_video_overlays');
  // Native move/resize needs the compositor alive; media presentation itself
  // is suspended explicitly while the window is minimized.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

const formats = require('../media-formats.js');
const { MediaCatalog } = require('./media-catalog.cjs');
const { MediaService } = require('./media-service.cjs');
const VIDEO_EXTENSIONS = new Set(formats.selectable.map(ext => '.' + ext));
let catalog, mediaService;
let catalogReady = Promise.resolve();
const MIME_BY_EXTENSION = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.ogv': 'video/ogg', '.ogg': 'video/ogg',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska'
};

let mainWindow = null;
let store = null;
let pendingLaunchPath = findMediaArgument(process.argv);
let deferInitialWindowShow = false;
let mainWindowReadyToShow = false;
let rendererUiReady = false;
let initialMediaPresented = false;
let initialShowFallback = null;
let manualWindowResize = null;
let mediaProbeSerial = 0;
let rendererCloseReadyHandler = null;
const isSmokeTest = process.argv.includes('--smoke-test');
if (isSmokeTest) app.setPath('userData', path.resolve('.cache/desktop-smoke-profile'));

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindowReadyToShow || !rendererUiReady) return;
  if (deferInitialWindowShow && !initialMediaPresented) return;
  if (initialShowFallback) clearTimeout(initialShowFallback);
  initialShowFallback = null;
  mainWindow.show();
}

class DesktopStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.workspaceDirectory = path.join(path.dirname(filePath), 'workspaces');
    this.data = { version: 2, preferences: {}, recentVideos: [] };
    this.pendingWrites = new Map();
    this.workspaceSaves = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (saved && typeof saved === 'object') {
        this.data = {
          version: 2,
          preferences: saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {},
          recentVideos: Array.isArray(saved.recentVideos) ? saved.recentVideos.slice(0, 12) : []
        };
        if (saved.workspaces && typeof saved.workspaces === 'object') this.migrateWorkspaces(saved.workspaces);
      }
    } catch { /* first run or invalid legacy data */ }
  }

  workspacePath(key) {
    const digest = createHash('sha256').update(String(key)).digest('hex');
    return path.join(this.workspaceDirectory, `${digest}.json`);
  }

  launchStatePath(key) {
    const digest = createHash('sha256').update(String(key)).digest('hex');
    return path.join(this.workspaceDirectory, `${digest}-launch.json`);
  }

  thumbnailDirectory(key) {
    const digest = createHash('sha256').update(String(key)).digest('hex');
    return path.join(this.workspaceDirectory, `${digest}-assets`);
  }

  thumbnailTokenFile(value) {
    if (typeof value !== 'string' || !value.startsWith('astria-thumb:')) return null;
    const file = value.slice(13);
    return file && path.basename(file) === file && /^[a-zA-Z0-9_-]+\.(?:jpg|png|webp)$/.test(file) ? file : null;
  }

  async externalizeThumbnails(key, workspace) {
    const copy = structuredClone(workspace);
    const directory = this.thumbnailDirectory(key);
    const used = new Set();
    const storeThumbnail = async (value, name) => {
      if (typeof value !== 'string' || !value) return value;
      if (value.startsWith('astria-thumb:')) {
        const file = this.thumbnailTokenFile(value);
        if (!file) return '';
        used.add(file);
        return `astria-thumb:${file}`;
      }
      if (value.startsWith('file:')) {
        try {
          const source = fileURLToPath(value);
          const sourceDirectory = path.dirname(source);
          const sameDirectory = process.platform === 'win32'
            ? sourceDirectory.toLowerCase() === directory.toLowerCase()
            : sourceDirectory === directory;
          if (sameDirectory) { const file = path.basename(source); used.add(file); return `astria-thumb:${file}`; }
        } catch { /* invalid file URLs are left untouched */ }
        return value;
      }
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!match) return value;
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
      const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
      const file = `${safeName}-${createHash('sha256').update(match[2]).digest('hex').slice(0, 12)}.${extension}`;
      used.add(file);
      await fsp.mkdir(directory, { recursive: true });
      await fsp.writeFile(path.join(directory, file), Buffer.from(match[2], 'base64'));
      return `astria-thumb:${file}`;
    };
    for (const bookmark of copy.bookmarks || []) bookmark.thumbnail = await storeThumbnail(bookmark.thumbnail, `bookmark-${bookmark.id || bookmark.frame}`);
    for (const [frame, value] of Object.entries(copy.annotationThumbnails || {})) copy.annotationThumbnails[frame] = await storeThumbnail(value, `annotation-${frame}`);
    copy.playbackPoster = await storeThumbnail(copy.playbackPoster, 'playback-poster');
    return { workspace: copy, used };
  }

  async cleanupThumbnailAssets(key, used) {
    const directory = this.thumbnailDirectory(key);
    try {
      for (const name of await fsp.readdir(directory)) {
        if (!used.has(name)) await fsp.unlink(path.join(directory, name)).catch(() => {});
      }
    } catch { /* no asset directory yet */ }
  }

  async resolveThumbnails(key, workspace) {
    const copy = structuredClone(workspace);
    const directory = this.thumbnailDirectory(key);
    const resolve = value => {
      if (typeof value !== 'string' || !value.startsWith('astria-thumb:')) return value;
      const file = this.thumbnailTokenFile(value);
      return file ? pathToFileURL(path.join(directory, file)).href : '';
    };
    for (const bookmark of copy.bookmarks || []) bookmark.thumbnail = resolve(bookmark.thumbnail);
    for (const [frame, value] of Object.entries(copy.annotationThumbnails || {})) copy.annotationThumbnails[frame] = resolve(value);
    copy.playbackPoster = resolve(copy.playbackPoster);
    return copy;
  }

  async portableWorkspace(workspace) {
    const copy = structuredClone(workspace);
    const inline = async value => {
      if (typeof value !== 'string' || !value.startsWith('file:')) return value;
      try {
        const source = fileURLToPath(value);
        const relative = path.relative(this.workspaceDirectory, source);
        if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return value;
        const extension = path.extname(source).toLowerCase();
        const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
        return `data:${mime};base64,${(await fsp.readFile(source)).toString('base64')}`;
      } catch { return ''; }
    };
    for (const bookmark of copy.bookmarks || []) bookmark.thumbnail = await inline(bookmark.thumbnail);
    for (const [frame, value] of Object.entries(copy.annotationThumbnails || {})) copy.annotationThumbnails[frame] = await inline(value);
    copy.playbackPoster = await inline(copy.playbackPoster);
    return copy;
  }

  migrateWorkspaces(workspaces) {
    try {
      fs.mkdirSync(this.workspaceDirectory, { recursive: true });
      for (const [key, workspace] of Object.entries(workspaces)) {
        const target = this.workspacePath(key);
        if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify({ key, workspace }), 'utf8');
      }
      this.save();
    } catch (error) { console.error('Unable to migrate workspace data:', error); }
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  updateWorkspaceData(payload) {
    if (!payload || typeof payload !== 'object') return;
    this.updatePreferences(payload.preferences);
  }

  updatePreferences(preferences) {
    if (!preferences || typeof preferences !== 'object') return;
    const serialized = JSON.stringify(preferences);
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) return;
    this.data.preferences = preferences;
    this.save();
  }

  async loadWorkspace(key) {
    if (typeof key !== 'string' || !key || key.length > 2048) return null;
    try {
      const saved = JSON.parse(await fsp.readFile(this.workspacePath(key), 'utf8'));
      return saved?.key === key && saved.workspace && typeof saved.workspace === 'object' ? this.resolveThumbnails(key, saved.workspace) : null;
    } catch { return null; }
  }

  async loadLaunchState(key) {
    if (typeof key !== 'string' || !key || key.length > 2048) return null;
    try {
      const saved = JSON.parse(await fsp.readFile(this.launchStatePath(key), 'utf8'));
      return saved?.key === key && saved.state && typeof saved.state === 'object' ? this.resolveThumbnails(key, saved.state) : null;
    } catch { return null; }
  }

  saveWorkspace(key, workspace) {
    if (typeof key !== 'string' || !key || key.length > 2048 || !workspace || typeof workspace !== 'object') return false;
    let snapshot;
    try { snapshot = structuredClone(workspace); }
    catch { return false; }
    const target = this.workspacePath(key);
    let entry = this.workspaceSaves.get(target);
    if (!entry) {
      entry = { latest: null, waiters: [], running: null, lastUsed: new Set(), hasPersisted: false };
      this.workspaceSaves.set(target, entry);
    }
    entry.latest = snapshot;
    return new Promise(resolve => {
      entry.waiters.push(resolve);
      if (entry.running) return;
      entry.running = (async () => {
        while (true) {
          while (entry.latest !== null) {
            const current = entry.latest;
            const waiters = entry.waiters.splice(0);
            entry.latest = null;
            let saved = false;
            try {
              const compact = await this.externalizeThumbnails(key, current);
              const payload = JSON.stringify({ key, workspace: compact.workspace });
              if (Buffer.byteLength(payload, 'utf8') <= 64 * 1024 * 1024) {
                const written = await this.scheduleWrite(target, payload);
                if (written) {
                  const launchState = {
                    playbackPosition: Number.isFinite(Number(compact.workspace.playbackPosition)) ? Math.max(0, Number(compact.workspace.playbackPosition)) : 0,
                    playbackPoster: compact.workspace.playbackPoster || '',
                    fps: Number(compact.workspace.fps) || 24,
                    fpsMode: compact.workspace.fpsMode === 'custom' ? 'custom' : 'source',
                    fpsModeExplicit: compact.workspace.fpsModeExplicit === true,
                    mediaKind: compact.workspace.mediaKind || 'video',
                    sourceFrameOffset: Number(compact.workspace.sourceFrameOffset) || 0
                  };
                  await this.scheduleWrite(this.launchStatePath(key), JSON.stringify({ key, state: launchState }));
                  entry.lastUsed = compact.used;
                  entry.hasPersisted = true;
                  saved = true;
                }
              }
            } catch (error) { console.error('Unable to persist media workspace:', error); }
            waiters.forEach(done => done(saved));
          }
          if (entry.hasPersisted) await this.cleanupThumbnailAssets(key, entry.lastUsed);
          if (entry.latest === null) break;
          // A newer snapshot arrived while cleanup was yielding; persist it
          // before retiring this per-media queue.
        }
      })().finally(() => {
        entry.running = null;
        this.workspaceSaves.delete(target);
      });
    });
  }

  async deleteWorkspace(key) {
    if (typeof key !== 'string' || !key || key.length > 2048) return false;
    const target = this.workspacePath(key);
    const pending = this.workspaceSaves.get(target)?.running;
    if (pending) await pending.catch(() => {});
    await fsp.unlink(target).catch(() => {});
    await fsp.unlink(this.launchStatePath(key)).catch(() => {});
    await fsp.rm(this.thumbnailDirectory(key), { recursive: true, force: true }).catch(() => {});
    return true;
  }

  addRecent(media) {
    const normalized = path.normalize(media.path);
    this.data.recentVideos = [
      { path: normalized, name: media.name, lastOpened: new Date().toISOString() },
      ...this.data.recentVideos.filter(item => path.normalize(item.path) !== normalized)
    ].slice(0, 12);
    this.save();
  }

  removeRecent(filePath) {
    const normalized = path.normalize(filePath);
    this.data.recentVideos = this.data.recentVideos.filter(item => path.normalize(item.path) !== normalized);
    this.save();
  }

  clearRecent() {
    this.data.recentVideos = [];
    this.save();
  }

  save() {
    const payload = JSON.stringify(this.data, null, 2);
    return this.scheduleWrite(this.filePath, payload);
  }

  scheduleWrite(target, payload) {
    let entry = this.pendingWrites.get(target);
    if (!entry) {
      entry = { latest: null, running: null };
      this.pendingWrites.set(target, entry);
    }
    entry.latest = payload;
    if (!entry.running) {
      entry.running = (async () => {
        while (entry.latest !== null) {
          const current = entry.latest; entry.latest = null;
          const tempPath = `${target}.${process.pid}.tmp`;
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.writeFile(tempPath, current, 'utf8');
          await fsp.rename(tempPath, target);
        }
        return true;
      })().catch(error => { console.error('Unable to persist desktop data:', error); return false; }).finally(() => {
        entry.running = null;
        if (entry.latest !== null) this.scheduleWrite(target, entry.latest);
        else this.pendingWrites.delete(target);
      });
    }
    return entry.running;
  }
}

function findMediaArgument(argv) {
  const args = Array.isArray(argv) ? argv.slice(app.isPackaged ? 1 : 2) : [];
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue;
    const resolved = path.resolve(arg);
    if (resolved !== process.execPath && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

async function describeVideo(filePath) {
  if (!filePath) return null;
  try { await catalogReady; return await catalog.describe(filePath); }
  catch (error) { console.warn('Unable to open local media:', error.message); return null; }
}

async function registerRecent(media) {
  if (!media) return;
  store.addRecent(media);
  if (process.platform === 'win32' || process.platform === 'darwin') app.addRecentDocument(media.path);
  rebuildMenu();
}

function beginMediaProbe(filePath) {
  const requestId = String(++mediaProbeSerial);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vfx:media-probe', { requestId, name: path.basename(filePath) });
  }
  return requestId;
}

function tagMediaProbeResult(media, requestId) {
  return media && typeof media === 'object' ? { ...media, _openRequestId: requestId } : media;
}

async function openVideoDialog() {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开视频',
    properties: ['openFile'],
    filters: [
      { name: '视频文件', extensions: [...VIDEO_EXTENSIONS].map(ext => ext.slice(1)) },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const requestId = beginMediaProbe(result.filePaths[0]);
  const media = await describeVideo(result.filePaths[0]);
  await registerRecent(media);
  return tagMediaProbeResult(media, requestId);
}

async function openRecentVideo(filePath) {
  const requestId = beginMediaProbe(filePath);
  const media = await describeVideo(filePath);
  if (!media) {
    store.removeRecent(filePath);
    rebuildMenu();
    return { error: 'missing', _openRequestId: requestId };
  }
  await registerRecent(media);
  return tagMediaProbeResult(media, requestId);
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vfx:command', command);
}

function sendMedia(media) {
  if (!media || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('vfx:open-video-from-system', media);
}

function getWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false, fullscreen: false, taskbarSafeBottom: 0 };
  return {
    maximized: mainWindow.isMaximized(),
    fullscreen: mainWindow.isFullScreen(),
    taskbarSafeBottom: 0
  };
}

function broadcastWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vfx:window-state', getWindowState());
}

function rebuildMenu() {
  const recents = store?.data.recentVideos || [];
  const recentSubmenu = recents.length
    ? recents.map(item => ({ label: item.name, sublabel: item.path, click: async () => sendMedia(await openRecentVideo(item.path)) }))
    : [{ label: '暂无最近视频', enabled: false }];
  recentSubmenu.push({ type: 'separator' }, {
    label: '清除最近记录',
    enabled: recents.length > 0,
    click: () => { store.clearRecent(); app.clearRecentDocuments(); rebuildMenu(); }
  });

  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开视频…', accelerator: 'CmdOrCtrl+O', click: async () => sendMedia(await openVideoDialog()) },
        { label: '最近打开', submenu: recentSubmenu },
        { type: 'separator' },
        { label: '保存工作区', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: '导出工作区…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('export') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '播放',
      submenu: [
        { label: '播放 / 暂停', click: () => sendCommand('toggle-play') },
        { label: '纯净模式', click: () => sendCommand('clean-mode') },
        { type: 'separator' },
        { label: '设置 A 点', click: () => sendCommand('loop-in') },
        { label: '设置 B 点', click: () => sendCommand('loop-out') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'togglefullscreen', label: '切换全屏' },
        { type: 'separator' },
        { label: '复原画面比例', click: () => sendCommand('reset-view') },
        { role: 'zoomIn', label: '放大界面' },
        { role: 'zoomOut', label: '缩小界面' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键', accelerator: 'F1', click: () => sendCommand('shortcuts') },
        { type: 'separator' },
        { label: `Astria ${app.getVersion()}`, enabled: false }
      ]
    }
  ];
  if (process.platform === 'darwin') template.unshift({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let cleanVideoRatio = null;
let videoWindowInsets = { bottom: 0, side: 0 };
let classicWindowBounds = null;
function fitCleanVideoWindow(requestedWidth) {
  if (!cleanVideoRatio || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isFullScreen() || mainWindow.isMinimized()) return;
  const bounds = mainWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const maxWidth = Math.floor(area.width * .9), maxHeight = Math.floor(area.height * .9);
  const content = mainWindow.getContentBounds();
  const zoom = mainWindow.webContents.getZoomFactor();
  const extraWidth = bounds.width - content.width + videoWindowInsets.side * zoom;
  const extraHeight = bounds.height - content.height + videoWindowInsets.bottom * zoom;
  const pictureWidth = Math.max(1, Math.min((requestedWidth || bounds.width) - extraWidth, maxWidth - extraWidth, (maxHeight - extraHeight) * cleanVideoRatio));
  const width = Math.round(pictureWidth + extraWidth);
  const height = Math.round(pictureWidth / cleanVideoRatio + extraHeight);
  mainWindow.setMinimumSize(Math.min(320, width), Math.min(180, height));
  mainWindow.setBounds({ width, height,
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, bounds.x + (bounds.width - width) / 2))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, bounds.y + (bounds.height - height) / 2))) });
}

function createWindow() {
  // Wait for the renderer's first complete layout, but not for video decode.
  // This avoids exposing BrowserWindow's plain background during startup.
  deferInitialWindowShow = false;
  mainWindowReadyToShow = false;
  rendererUiReady = false;
  initialMediaPresented = true;
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#10161d',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    title: 'Astria',
    frame: process.platform !== 'win32',
    roundedCorners: false,
    hasShadow: process.platform !== 'win32',
    thickFrame: process.platform !== 'win32',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'), { query: isSmokeTest ? { smoke:'1' } : {} });
  mainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true;
    if (isSmokeTest) { mainWindow.maximize(); broadcastWindowState(); }
    initialShowFallback = setTimeout(() => {
      rendererUiReady = true;
      initialMediaPresented = true;
      revealMainWindow();
    }, 4000);
    revealMainWindow();
  });
  mainWindow.webContents.once('did-finish-load', broadcastWindowState);
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach(eventName => mainWindow.on(eventName, broadcastWindowState));
  ['unmaximize', 'leave-full-screen'].forEach(eventName => mainWindow.on(eventName, () => setTimeout(fitCleanVideoWindow, 0)));
  mainWindow.on('minimize', () => mediaService?.setPresentationSuspended(true));
  mainWindow.on('restore', () => mediaService?.setPresentationSuspended(false));
  let windowInteractionActive = false;
  let windowInteractionTimer = null;
  const reportWindowInteraction = () => {
    if (!windowInteractionActive) {
      windowInteractionActive = true;
      mediaService?.setWindowInteraction(true);
      mainWindow.webContents.send('vfx:window-interaction', true);
    }
    clearTimeout(windowInteractionTimer);
    windowInteractionTimer = setTimeout(() => {
      windowInteractionActive = false;
      mediaService?.setWindowInteraction(false);
      if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('vfx:window-interaction', false);
    }, 150);
  };
  mainWindow.on('will-move', reportWindowInteraction);
  mainWindow.on('will-resize', reportWindowInteraction);
  mainWindow.on('resized', () => {
    clearTimeout(windowInteractionTimer);
    windowInteractionTimer = null;
    if (windowInteractionActive) {
      mediaService?.setWindowInteraction(false);
      mainWindow.webContents.send('vfx:window-interaction', false);
    }
    windowInteractionActive = false;
  });
  if (isSmokeTest) {
    mainWindow.webContents.on('console-message', event => console.log('RENDERER', event.message));
    mainWindow.webContents.once('did-finish-load', async () => {
      try { await require('../scripts/desktop-smoke.cjs')(mainWindow, catalog, app); }
      catch (error) {
        console.error('VFX_SMOKE_TEST_FAILED', error);
        await mediaService.dispose(); await catalog.dispose(); app.exit(1);
      }
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  const closingWindow = mainWindow;
  let closeApproved = false;
  let closeRequested = false;
  let closeFallback = null;
  const finishWindowClose = () => {
    if (closeApproved) return;
    closeApproved = true;
    clearTimeout(closeFallback);
    closeFallback = null;
    if (!closingWindow.isDestroyed()) closingWindow.close();
  };
  const closeReadyHandler = sender => {
    if (sender === closingWindow.webContents) finishWindowClose();
  };
  rendererCloseReadyHandler = closeReadyHandler;
  closingWindow.on('close', event => {
    if (closeApproved) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    closeFallback = setTimeout(finishWindowClose, 3000);
    try { closingWindow.webContents.send('vfx:prepare-close'); }
    catch { finishWindowClose(); }
  });
  // Native drag regions do not deliver DOM pointer moves. This only reports
  // hover for the auto-hidden toolbar; Windows owns all movement and sizing.
  const titlebarWindow = mainWindow;
  let titlebarWasInside = false;
  let windowWasInside = null;
  const titlebarHoverTimer = setInterval(() => {
    if (titlebarWindow.isDestroyed() || windowInteractionActive) return;
    if (!titlebarWindow.isVisible() || titlebarWindow.isMinimized() || !titlebarWindow.isFocused()) {
      if (windowWasInside) titlebarWindow.webContents.send('vfx:window-pointer', { inside: false });
      if (titlebarWasInside) titlebarWindow.webContents.send('vfx:titlebar-hover', { inside: false, x: 0, y: 0 });
      windowWasInside = false; titlebarWasInside = false;
      return;
    }
    const bounds = titlebarWindow.getContentBounds();
    const cursor = screen.getCursorScreenPoint();
    const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
    const windowInside = titlebarWindow.isVisible() && !titlebarWindow.isMinimized() && x >= 0 && x < bounds.width && y >= 0 && y < bounds.height;
    if (windowInside !== windowWasInside) {
      titlebarWindow.webContents.send('vfx:window-pointer', { inside: windowInside });
      windowWasInside = windowInside;
    }
    const zoom = titlebarWindow.webContents.getZoomFactor();
    // Cover both renderer reveal/hold boundaries at every UI zoom level.
    const inside = titlebarWindow.isFocused() && windowInside && y / zoom < 120;
    if (inside || titlebarWasInside) titlebarWindow.webContents.send('vfx:titlebar-hover', { inside, x: x / zoom, y: y / zoom });
    titlebarWasInside = inside;
  }, 80);
  mainWindow.on('closed', () => {
    manualWindowResize = null;
    if (rendererCloseReadyHandler === closeReadyHandler) rendererCloseReadyHandler = null;
    clearTimeout(closeFallback);
    clearInterval(titlebarHoverTimer);
    clearTimeout(windowInteractionTimer);
    if (initialShowFallback) clearTimeout(initialShowFallback);
    initialShowFallback = null;
    mainWindowReadyToShow = false;
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('vfx:describe-dropped-file', async (event, filePath) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('访问被拒绝');
    const media = await describeVideo(filePath); await registerRecent(media); return media;
  });
  ipcMain.handle('vfx:open-video', openVideoDialog);
  ipcMain.handle('vfx:open-recent-video', (_event, filePath) => openRecentVideo(filePath));
  ipcMain.handle('vfx:get-recent-videos', () => store.snapshot().recentVideos);
  ipcMain.handle('vfx:clear-recent-videos', () => { store.clearRecent(); app.clearRecentDocuments(); rebuildMenu(); return true; });
  ipcMain.handle('vfx:load-app-data', () => store.snapshot());
  ipcMain.handle('vfx:load-media-workspace', (event, key) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('访问被拒绝');
    return store.loadWorkspace(key);
  });
  ipcMain.handle('vfx:load-media-launch-state', (event, key) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('访问被拒绝');
    return store.loadLaunchState(key);
  });
  ipcMain.on('vfx:save-preferences', (event, preferences) => {
    if (event.sender === mainWindow?.webContents && event.senderFrame === mainWindow.webContents.mainFrame) store.updatePreferences(preferences);
  });
  ipcMain.handle('vfx:save-media-workspace', (event, key, workspace) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('访问被拒绝');
    return store.saveWorkspace(key, workspace);
  });
  ipcMain.handle('vfx:delete-media-workspace', (event, key) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('访问被拒绝');
    return store.deleteWorkspace(key);
  });
  ipcMain.handle('vfx:get-version', () => app.getVersion());
  ipcMain.handle('vfx:get-window-state', getWindowState);
  ipcMain.handle('vfx:fit-video-window', (event, options) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
    if (options?.enabled === false) {
      cleanVideoRatio = null;
      mainWindow.setMinimumSize(980, 680);
      if (classicWindowBounds && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) mainWindow.setBounds(classicWindowBounds);
      classicWindowBounds = null;
      return true;
    }
    const { width, height } = options || {};
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width / height < .05 || width / height > 20) return false;
    if (!cleanVideoRatio) classicWindowBounds = mainWindow.getNormalBounds();
    cleanVideoRatio = width / height;
    const oldSide = videoWindowInsets.side;
    videoWindowInsets = {
      bottom: Math.max(0, Math.min(100, Number(options.bottomInset) || 0)),
      side: Math.max(0, Math.min(600, Number(options.sideInset) || 0))
    };
    if (options.resizeWindow !== false) {
      fitCleanVideoWindow(mainWindow.getBounds().width + (videoWindowInsets.side - oldSide) * mainWindow.webContents.getZoomFactor());
    }
    return true;
  });
  ipcMain.handle('vfx:open-default-apps', async () => {
    if (process.platform !== 'win32') return false;
    await shell.openExternal('ms-settings:defaultapps');
    return true;
  });
  ipcMain.handle('vfx:window-minimize', () => { mainWindow?.minimize(); return true; });
  ipcMain.handle('vfx:window-toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return getWindowState();
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return getWindowState();
  });
  ipcMain.on('vfx:window-resize-begin', (event, edge, point) => {
    const allowedEdges = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
    if (process.platform !== 'win32' || event.sender !== mainWindow?.webContents || !allowedEdges.has(edge) ||
        mainWindow.isMaximized() || mainWindow.isFullScreen() || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    manualWindowResize = { edge, point: { x: point.x, y: point.y }, bounds: mainWindow.getBounds() };
  });
  ipcMain.on('vfx:window-resize-update', (event, point) => {
    if (event.sender !== mainWindow?.webContents || !manualWindowResize || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    const { edge, point: start, bounds } = manualWindowResize;
    const [minimumWidth, minimumHeight] = mainWindow.getMinimumSize();
    const dx = point.x - start.x, dy = point.y - start.y;
    const next = { ...bounds };
    if (edge.includes('e')) next.width = Math.max(minimumWidth, Math.round(bounds.width + dx));
    if (edge.includes('s')) next.height = Math.max(minimumHeight, Math.round(bounds.height + dy));
    if (edge.includes('w')) {
      next.width = Math.max(minimumWidth, Math.round(bounds.width - dx));
      next.x = bounds.x + bounds.width - next.width;
    }
    if (edge.includes('n')) {
      next.height = Math.max(minimumHeight, Math.round(bounds.height - dy));
      next.y = bounds.y + bounds.height - next.height;
    }
    mainWindow.setBounds(next);
  });
  ipcMain.on('vfx:window-resize-end', event => {
    if (event.sender === mainWindow?.webContents) manualWindowResize = null;
  });
  ipcMain.handle('vfx:window-close', () => { mainWindow?.close(); return true; });
  ipcMain.on('vfx:renderer-close-ready', event => rendererCloseReadyHandler?.(event.sender));
  ipcMain.handle('vfx:toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return getWindowState();
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return getWindowState();
  });
  ipcMain.handle('vfx:consume-launch-media', async () => {
    const launchPath = pendingLaunchPath;
    pendingLaunchPath = null;
    const media = await describeVideo(launchPath);
    await registerRecent(media);
    return media;
  });
  ipcMain.on('vfx:renderer-ready', event => {
    if (event.sender !== mainWindow?.webContents) return;
    rendererUiReady = true;
    revealMainWindow();
  });
  ipcMain.on('vfx:initial-media-presented', () => {
    if (!deferInitialWindowShow) return;
    initialMediaPresented = true;
    revealMainWindow();
  });
  ipcMain.handle('vfx:export-workspace', async (_event, payload) => {
    const suggestedName = String(payload?.suggestedName || 'astria').replace(/[<>:"/\\|?*]/g, '-');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Astria 工作区',
      defaultPath: suggestedName.endsWith('.vfxplayer.json') ? suggestedName : `${suggestedName}.vfxplayer.json`,
      filters: [{ name: 'Astria 工作区', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const portable = await store.portableWorkspace(payload?.data || {});
    await fsp.writeFile(result.filePath, JSON.stringify(portable, null, 2), 'utf8');
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('vfx:export-binary', async (_event, payload) => {
    const extension = 'png';
    const suggestedName = String(payload?.suggestedName || 'astria-export.png').replace(/[<>:"/\\|?*]/g, '-');
    const raw = payload?.bytes;
    const bytes = ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : raw instanceof ArrayBuffer ? Buffer.from(raw) : null;
    if (!bytes || !bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Invalid export payload');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出带批注画面',
      defaultPath: suggestedName.toLowerCase().endsWith(`.${extension}`) ? suggestedName : `${suggestedName}.${extension}`,
      filters: [{ name: 'PNG 图像', extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fsp.writeFile(result.filePath, bytes);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('vfx:export-binary-batch', async (_event, payload) => {
    const files = Array.isArray(payload?.files) ? payload.files : [];
    if (!files.length || files.length > 64) throw new Error('Invalid batch export payload');
    let totalBytes = 0;
    const validated = files.map((file, index) => {
      const safeName = String(file?.name || `astria-contact-sheet-${index + 1}.png`).replace(/[<>:"/\\|?*]/g, '-');
      if (!safeName.toLowerCase().endsWith('.png') || safeName === '.png') throw new Error('Invalid export filename');
      const raw = file?.bytes;
      const bytes = ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : raw instanceof ArrayBuffer ? Buffer.from(raw) : null;
      if (!bytes || !bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Invalid export file');
      totalBytes += bytes.length;
      return { name: safeName, bytes };
    });
    if (totalBytes > 512 * 1024 * 1024) throw new Error('Batch export is too large');
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择 Contact Sheet 导出文件夹', properties: ['openDirectory','createDirectory'] });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const directory = result.filePaths[0];
    await Promise.all(validated.map(file => fsp.writeFile(path.join(directory, file.name), file.bytes)));
    return { canceled: false, directory, files: validated.map(file => file.name) };
  });
  ipcMain.on('vfx:save-app-data', (_event, payload) => store.updateWorkspaceData(payload));
  ipcMain.on('vfx:set-window-title', (_event, title) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const safeTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 180) : 'Astria';
    mainWindow.setTitle(safeTitle);
  });
}

const hasSingleInstanceLock = isSmokeTest || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event, argv) => {
    const mediaPath = findMediaArgument(argv);
    if (mediaPath) sendMedia(await openRecentVideo(mediaPath));
    else if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) openRecentVideo(filePath).then(sendMedia);
    else pendingLaunchPath = filePath;
  });

  app.whenReady().then(async () => {
    const storePath = path.join(app.getPath('userData'), 'app-data.json');
    if (!fs.existsSync(storePath)) {
      const legacyCandidates = ['VFX Player','vfx-player'].map(folder => path.join(app.getPath('appData'), folder, 'app-data.json'));
      const legacyPath = legacyCandidates.find(candidate => fs.existsSync(candidate));
      if (legacyPath) {
        try { await fsp.mkdir(path.dirname(storePath), { recursive: true }); await fsp.copyFile(legacyPath, storePath); }
        catch { /* a rename should never prevent Astria from starting */ }
      }
    }
    store = new DesktopStore(storePath);
    catalog = new MediaCatalog(path.join(app.getPath('cache'), 'Astria', 'sequences'));
    catalogReady = catalog.initialize();
    void catalogReady.catch(error => console.warn('Unable to initialize sequence cache:', error.message));
    mediaService = new MediaService(app, catalog, () => mainWindow);
    registerIpc();
    rebuildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true;
    Promise.resolve(mediaService?.dispose())
      .then(async () => { try { await catalogReady; } catch { /* initialization failure must not block exit */ } return catalog?.dispose(); })
      .finally(() => app.quit());
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
