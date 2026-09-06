// Qbao 桌面端主进程
// 职责：窗口管理、单实例、运行时配置注入、系统级操作（打开外链/更新）、凭据安全存储。
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupUpdater } = require('./updater');

let mainWindow = null;
let recreatingWindow = false; // save-server 重建窗口期间阻止 window-all-closed 退出应用

function loadRuntimeConfig() {
  // 优先级：环境变量 > config.local.json（开发者） > 用户设置（应用内配置） > config.json（仓库默认）
  let cfg = { apiBase: '', serverLabel: '', updateChannel: 'stable' };
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))); } catch (e) { console.warn('[desktop] config.json 读取失败，使用默认'); }
  try { const us = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); cfg = Object.assign(cfg, us); } catch (e) { /* 用户尚未配置 */ }
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'))); } catch (e) { /* 本地覆盖不存在，忽略 */ }
  if (process.env.QBAO_API_BASE) cfg.apiBase = process.env.QBAO_API_BASE;
  if (!cfg.apiBase) console.warn('[desktop] 未配置 apiBase，应用内首次运行可设置服务器地址');
  return cfg;
}

function createWindow() {
  const runtime = loadRuntimeConfig();
  const runtimeArg = '--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: runtime.apiBase, serverLabel: runtime.serverLabel, updateChannel: runtime.updateChannel, isDesktop: true }));
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'Qbao',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [runtimeArg],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 开发模式: 加载 Vite dev server（app/ 为 Vue+Vite 工程，ES modules 需要 HTTP 服务）；
  // 打包后: __dirname=resources/app.asar → asar 内 app/（builder 将 ../app/dist 映射为 app/）。
  const indexHtml = path.join(__dirname, 'app', 'index.html');
  let devFallbackTried = false;
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // 开发模式：vite dev server 未启动时回退到本地构建产物（app/dist/index.html）
    if (!app.isPackaged && !devFallbackTried && typeof url === 'string' && url.startsWith('http')) {
      devFallbackTried = true;
      mainWindow.loadFile(path.join(__dirname, '..', 'app', 'dist', 'index.html')).catch(() => {});
      return;
    }
    console.error('[desktop] 页面加载失败:', code, desc, url || indexHtml);
    if (process.env.QBAO_SMOKE) { app.exit(1); return; }
    dialog.showErrorBox('Qbao 加载失败', '页面加载失败 (' + code + '): ' + desc);
  });
  if (app.isPackaged) {
    mainWindow.loadFile(indexHtml);
  } else {
    const devUrl = process.env.QBAO_DEV_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => { /* did-fail-load 统一处理回退 */ });
  }
  if (process.env.QBAO_SMOKE) {
    mainWindow.webContents.on('did-finish-load', () => { console.log('[desktop] SMOKE_OK'); setTimeout(() => app.exit(0), 1500); });
  }
  // T21: 窗口安全 — 外部链接一律交系统浏览器（校验协议），禁止应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // T21: 导航防护 — 只允许本地页面（file:// 打包产物）与开发模式 dev URL，其余一律拦截
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = (app.isPackaged && url.startsWith('file://'))
      || (!app.isPackaged && /^http:\/\/(localhost|127\.0\.0\.1):5173/.test(url));
    if (!allowed) event.preventDefault();
  });
  recreatingWindow = false;
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // 隐藏默认 File/Edit 菜单（应用内自带导航）
    app.setAppUserModelId('com.paraso42.qbao'); // Windows 通知/任务栏分组所需的 AppUserModelID
    const runtime = loadRuntimeConfig();
    createWindow();
    // v3.35：更新源跟随用户配置的服务器（generic feed），运行时注入 runtime 供 updater 使用
    setupUpdater(() => mainWindow, runtime);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (recreatingWindow) return; if (process.platform !== 'darwin') app.quit(); });
}

// 系统级 IPC
ipcMain.handle('qbao:get-version', () => app.getVersion());
ipcMain.handle('qbao:save-server', async (_e, url, label) => {
  let apiBase = String(url || '').trim();
  if (!apiBase) return { ok: false, error: '地址为空' };
  if (!/^https?:\/\//.test(apiBase)) return { ok: false, error: '地址需以 http:// 或 https:// 开头' };
  if (!/\/api\/v1\/?$/.test(apiBase)) apiBase = apiBase.replace(/\/+$/, '') + '/api/v1';
  const settings = { apiBase, serverLabel: String(label || '服务器') };
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2));
  } catch (e) { return { ok: false, error: e.message }; }
  recreatingWindow = true;
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.destroy();
  setTimeout(() => { if (!BrowserWindow.getAllWindows().length) createWindow(); }, 300);
  return { ok: true };
});
ipcMain.handle('qbao:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  return true;
});

// —— v3.38 游戏空间门户（附属静态站）——
// 子窗口加载本地 games/index.html（dev: ../app/dist/games/；打包: app/games/），
// webPreferences 与主窗口一致（contextIsolation + sandbox + preload），
// 门户经既有 qbao:secret-load 通道读取登录态（不新增密钥面）。
let gamesWindow = null;
ipcMain.handle('qbao:open-games', () => {
  if (gamesWindow && !gamesWindow.isDestroyed()) {
    gamesWindow.show();
    gamesWindow.focus();
    return { ok: true };
  }
  const runtime = loadRuntimeConfig();
  const runtimeArg = '--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: runtime.apiBase, serverLabel: runtime.serverLabel, updateChannel: runtime.updateChannel, isDesktop: true }));
  const portalHtml = app.isPackaged
    ? path.join(__dirname, 'app', 'games', 'index.html')
    : path.join(__dirname, '..', 'app', 'dist', 'games', 'index.html');
  gamesWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 480,
    minHeight: 400,
    title: 'Qbao 游戏空间',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [runtimeArg],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  gamesWindow.loadFile(portalHtml).catch(() => {});
  // 安全策略与主窗口一致：外链交系统浏览器；导航仅限本地页面；关窗即置空引用
  gamesWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  gamesWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  gamesWindow.on('closed', () => { gamesWindow = null; });
  return { ok: true };
});
// 应用信息（版本/服务器/自启状态），供「设置 → 桌面端」页展示
ipcMain.handle('qbao:get-app-info', () => {
  const runtime = loadRuntimeConfig();
  let autoStart = false;
  try { autoStart = app.getLoginItemSettings().openAtLogin; } catch (e) { /* 忽略 */ }
  return { version: app.getVersion(), apiBase: runtime.apiBase, serverLabel: runtime.serverLabel, autoStart, updateChannel: runtime.updateChannel };
});
// 开机自启开关（Windows 写入注册表 Run 键；仅打包版有意义，开发模式同样可切换）
ipcMain.handle('qbao:set-auto-start', (_e, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
    return { ok: true, autoStart: app.getLoginItemSettings().openAtLogin };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// —— P1.3 凭据安全存储（safeStorage / Windows DPAPI）——
// renderer 不落明文：token / AI Key 经此通道加密后写 userData/secrets.json。
function secretsFilePath() {
  return path.join(app.getPath('userData'), 'secrets.json');
}
function readSecretsFile() {
  try { return JSON.parse(fs.readFileSync(secretsFilePath(), 'utf8')) || {} } catch (e) { return {} }
}
function writeSecretsFile(map) {
  try { fs.writeFileSync(secretsFilePath(), JSON.stringify(map)); return true } catch (e) { return false }
}
function secretName(name) {
  return 'qbao_secret_' + String(name || '').replace(/[^a-zA-Z0-9_:.-]/g, '_');
}
ipcMain.handle('qbao:secret-available', () => {
  try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; }
});
ipcMain.handle('qbao:secret-save', (_e, name, value) => {
  try {
    if (typeof name !== 'string' || typeof value !== 'string') return { ok: false, error: '参数错误' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'safeStorage 不可用' };
    const map = readSecretsFile();
    map[secretName(name)] = safeStorage.encryptString(value).toString('base64');
    if (!writeSecretsFile(map)) return { ok: false, error: '写入 secrets.json 失败' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('qbao:secret-load', (_e, name) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'safeStorage 不可用' };
    const map = readSecretsFile();
    const b64 = map[secretName(name)];
    if (!b64) return { ok: false, code: 'not_found' };
    return { ok: true, value: safeStorage.decryptString(Buffer.from(b64, 'base64')) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('qbao:secret-remove', (_e, name) => {
  try {
    const map = readSecretsFile();
    if (map[secretName(name)]) {
      delete map[secretName(name)];
      writeSecretsFile(map);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});