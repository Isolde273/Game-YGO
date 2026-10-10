import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const smokeTest = process.env.YGO_SMOKE_TEST === '1';
const executableName = path.basename(process.execPath).replace(/\.exe$/i, '');
const gameTitle = executableName.toLowerCase() === 'electron' ? '游戏王开盒模拟器' : executableName;
app.setName('YGO Duel Archive');
app.setPath(
  'userData',
  smokeTest
    ? path.resolve(
        process.env.YGO_SMOKE_USERDATA ?? path.join(dir, '../../test-results/desktop-profile'),
      )
    : path.join(app.getPath('appData'), 'YGO-Duel-Archive'),
);
const logPath = path.join(app.getPath('userData'), 'startup.log');
function log(message) {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* A log write failure must not prevent launching the game. */
  }
}
function fail(error) {
  const message = error instanceof Error ? error.stack : String(error);
  log(`ERROR ${message}`);
  dialog.showErrorBox(
    `${gameTitle} · 启动失败`,
    `游戏未能正常启动。请保留完整的绿色版文件夹后重试。\n\n${error.message ?? error}\n\n诊断日志：${logPath}`,
  );
  app.quit();
}
let win,
  restoreRequested = false;
function showGame() {
  if (!win || win.isDestroyed()) {
    restoreRequested = true;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    log('Second launch: restoring game window');
    showGame();
  });
  app
    .whenReady()
    .then(async () => {
      log(`Starting ${app.getVersion()}`);
      win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        show: !smokeTest,
        title: gameTitle,
        backgroundColor: '#030d32',
        autoHideMenuBar: true,
        icon: path.join(dir, '../public/assets/application-icon.ico'),
        webPreferences: {
          preload: path.join(dir, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: !smokeTest,
        },
      });
      win.on('ready-to-show', () => {
        if (!smokeTest || restoreRequested) showGame();
      });
      win.on('closed', () => {
        win = null;
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.on('page-title-updated', (event) => event.preventDefault());
      win.webContents.on('will-navigate', (event, url) => {
        if (url !== win.webContents.getURL()) event.preventDefault();
      });
      ipcMain.handle('toggle-fullscreen', () => {
        win.setFullScreen(!win.isFullScreen());
        return win.isFullScreen();
      });
      ipcMain.handle('quit-game', () => {
        setImmediate(() => win?.close());
        return true;
      });
      win.webContents.on('render-process-gone', (_event, details) =>
        fail(new Error(`游戏页面退出：${details.reason}`)),
      );
      await win.loadFile(path.join(dir, '../index.html'));
      log('Home page loaded');
    })
    .catch(fail);
  app.on('window-all-closed', () => app.quit());
}
