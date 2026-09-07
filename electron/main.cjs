const { app, BrowserWindow, dialog, ipcMain, Menu, shell, screen } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

require('./file-associations.cjs')(process.argv);
if (require('electron-squirrel-startup')) app.quit();
if (process.platform === 'win32') {
  app.setAppUserModelId('com.astria.player');
  // Keep video and the interactive transport in one DirectComposition path.
  // Chromium's video overlay promotion can otherwise jump for one frame when
  // a control changes its pressed, focused, or open state.
  // Chromium reads this GPU workaround by its exact underscore-separated name.
  app.commandLine.appendSwitch('disable_direct_composition_video_overlays');
}

const formats = require('../media-formats.js');
const { MediaCatalog } = require('./media-catalog.cjs');
const { MediaService } = require('./media-service.cjs');
const VIDEO_EXTENSIONS = new Set(formats.selectable.map(ext => '.' + ext));
let catalog, mediaService;
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
let initialMediaPresented = false;
let initialShowFallback = null;
const isSmokeTest = process.argv.includes('--smoke-test');
if (isSmokeTest) app.setPath('userData', path.resolve('.cache/desktop-smoke-profile'));

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindowReadyToShow) return;
  if (deferInitialWindowShow && !initialMediaPresented) return;
  if (initialShowFallback) clearTimeout(initialShowFallback);
  initialShowFallback = null;
  mainWindow.show();
}

class DesktopStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, preferences: {}, workspaces: {}, recentVideos: [] };
    this.writeQueue = Promise.resolve();
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (saved && typeof saved === 'object') {
        this.data = {
          version: 1,
          preferences: saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {},
          workspaces: saved.workspaces && typeof saved.workspaces === 'object' ? saved.workspaces : {},
          recentVideos: Array.isArray(saved.recentVideos) ? saved.recentVideos.slice(0, 12) : []
        };
      }
    } catch { /* first run or invalid legacy data */ }
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  updateWorkspaceData(payload) {
    if (!payload || typeof payload !== 'object') return;
    const next = {
      preferences: payload.preferences && typeof payload.preferences === 'object' ? payload.preferences : {},
      workspaces: payload.workspaces && typeof payload.workspaces === 'object' ? payload.workspaces : {}
    };
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024 * 1024) return;
    this.data.preferences = next.preferences;
    this.data.workspaces = next.workspaces;
    this.save();
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
    const tempPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
        await fsp.writeFile(tempPath, payload, 'utf8');
        await fsp.rename(tempPath, this.filePath);
      })
      .catch(error => console.error('Unable to persist desktop data:', error));
    return this.writeQueue;
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
  try { return await catalog.describe(filePath); }
  catch (error) { console.warn('Unable to open local media:', error.message); return null; }
}

async function registerRecent(media) {
  if (!media) return;
  store.addRecent(media);
  if (process.platform === 'win32' || process.platform === 'darwin') app.addRecentDocument(media.path);
  rebuildMenu();
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
  const media = await describeVideo(result.filePaths[0]);
  await registerRecent(media);
  return media;
}

async function openRecentVideo(filePath) {
  const media = await describeVideo(filePath);
  if (!media) {
    store.removeRecent(filePath);
    rebuildMenu();
    return { error: 'missing' };
  }
  await registerRecent(media);
  return media;
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
  deferInitialWindowShow = !isSmokeTest && Boolean(pendingLaunchPath);
  mainWindowReadyToShow = false;
  initialMediaPresented = !deferInitialWindowShow;
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
    roundedCorners: true,
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
    else if (deferInitialWindowShow && !initialMediaPresented) {
      initialShowFallback = setTimeout(() => {
        initialMediaPresented = true;
        revealMainWindow();
      }, 4000);
    } else revealMainWindow();
  });
  mainWindow.webContents.once('did-finish-load', broadcastWindowState);
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach(eventName => mainWindow.on(eventName, broadcastWindowState));
  ['unmaximize', 'leave-full-screen'].forEach(eventName => mainWindow.on(eventName, () => setTimeout(fitCleanVideoWindow, 0)));
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
  // Native drag regions do not deliver DOM pointer moves. This only reports
  // hover for the auto-hidden toolbar; Windows owns all movement and sizing.
  const titlebarWindow = mainWindow;
  let titlebarWasInside = false;
  let windowWasInside = null;
  const titlebarHoverTimer = setInterval(() => {
    if (titlebarWindow.isDestroyed()) return;
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
  }, 40);
  mainWindow.on('closed', () => {
    clearInterval(titlebarHoverTimer);
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
  ipcMain.handle('vfx:window-close', () => { mainWindow?.close(); return true; });
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
    await fsp.writeFile(result.filePath, JSON.stringify(payload?.data || {}, null, 2), 'utf8');
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
    await catalog.initialize();
    mediaService = new MediaService(app, catalog, () => mainWindow);
    registerIpc();
    rebuildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true;
    Promise.resolve(mediaService?.dispose()).then(() => catalog?.dispose()).finally(() => app.quit());
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
