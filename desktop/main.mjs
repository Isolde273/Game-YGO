import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { startLocalBrowser } from './local-browser.mjs';
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
  restoreRequested = false,
  browserServer;
function showGame() {
  if (browserServer) {
    shell.openExternal(browserServer.url);
    return;
  }
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
      if (process.argv.includes('--browser')) {
        browserServer = await startLocalBrowser(path.join(dir, '..'), (url) =>
          smokeTest ? Promise.resolve() : shell.openExternal(url),
        );
        win = new BrowserWindow({
          width: 520,
          height: 260,
          title: `${gameTitle} · 浏览器版`,
          show: !smokeTest,
          autoHideMenuBar: true,
          backgroundColor: '#030d32',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        win.webContents.setWindowOpenHandler(({ url }) => {
          if (url === browserServer.url) shell.openExternal(url);
          return { action: 'deny' };
        });
        await win.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>body{background:#030d32;color:#eef6ff;font:16px "Microsoft YaHei",sans-serif;padding:20px}a,button{color:#06174e;background:#39d9fa;padding:10px;border:0;text-decoration:none;cursor:pointer}</style>
<h2>浏览器版已启动</h2><p>关闭此窗口将停止浏览器版。</p>
<a href="${browserServer.url}" target="_blank">重新打开游戏</a>
<button onclick="window.close()">退出浏览器版</button></html>`),
        );
        win.on('closed', () => {
          win = null;
        });
        log(`Local browser edition: ${browserServer.url}`);
        return;
      }
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
  app.on('before-quit', () => browserServer?.server.close());
}
