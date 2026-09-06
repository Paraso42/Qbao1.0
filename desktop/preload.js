// Qbao 桌面端预加载脚本
// 职责：解析主进程注入的运行时配置 → window.__QBAO_RUNTIME__；暴露桌面能力桥。
const { contextBridge, ipcRenderer } = require('electron');

let runtime = null;
try {
  const arg = process.argv.find(a => a.startsWith('--qbao-runtime='));
  if (arg) runtime = JSON.parse(decodeURIComponent(arg.slice('--qbao-runtime='.length)));
} catch (e) {
  console.error('[preload] runtime 解析失败', e);
}
if (!runtime) runtime = { apiBase: '', isDesktop: true, updateChannel: 'stable', serverLabel: '' };
runtime.isDesktop = true;

contextBridge.exposeInMainWorld('__QBAO_RUNTIME__', Object.freeze(runtime));
contextBridge.exposeInMainWorld('__qbaoDesktop', Object.freeze({
  getVersion: () => ipcRenderer.invoke('qbao:get-version'),
  getAppInfo: () => ipcRenderer.invoke('qbao:get-app-info'),
  setAutoStart: (enabled) => ipcRenderer.invoke('qbao:set-auto-start', enabled),
  setServer: (url, label) => ipcRenderer.invoke('qbao:save-server', url, label),
  checkForUpdates: () => ipcRenderer.invoke('qbao:check-updates'),
  quitAndInstall: () => ipcRenderer.invoke('qbao:quit-and-install'),
  // v3.35：更新信息 / 自动检查开关 / 历史版本自助回退下载
  getUpdateInfo: () => ipcRenderer.invoke('qbao:get-update-info'),
  setAutoCheck: (enabled) => ipcRenderer.invoke('qbao:set-auto-check', enabled),
  downloadVersion: (args) => ipcRenderer.invoke('qbao:download-version', args),
  onRollbackProgress: (cb) => {
    ipcRenderer.on('qbao:rollback-progress', (_e, s) => { try { cb(s); } catch (err) {} })
  },
  // P1.3：凭据安全存储（safeStorage，主进程加密；renderer 无明文落盘）
  secretAvailable: () => ipcRenderer.invoke('qbao:secret-available'),
  secretSave: (name, value) => ipcRenderer.invoke('qbao:secret-save', name, value),
  secretLoad: (name) => ipcRenderer.invoke('qbao:secret-load', name),
  secretRemove: (name) => ipcRenderer.invoke('qbao:secret-remove', name),
  openExternal: (url) => ipcRenderer.invoke('qbao:open-external', url),
  // v3.38：打开游戏门户子窗口（本地附属静态站）
  openGames: () => ipcRenderer.invoke('qbao:open-games'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('qbao:update-status', (_e, s) => { try { cb(s); } catch (err) {} });
  }
}));