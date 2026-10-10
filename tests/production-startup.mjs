import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const executable = path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe');
const env = { ...process.env };
delete env.YGO_SMOKE_TEST;
delete env.YGO_SMOKE_USERDATA;
delete env.ELECTRON_RUN_AS_NODE;
// Use the actual production mode without changing any game progress.
let electron;
let previousStorage;
try {
  for (let launch = 0; launch < 2; launch++) {
    electron = await _electron.launch({ executablePath: executable, env, timeout: 30000 });
    const page = await electron.firstWindow();
    await page.waitForSelector('.home-menu');
    assert.equal(await page.locator('.menu-tile').count(), 6);
    const actual = await electron.evaluate(({ app, BrowserWindow }) => ({
      visible: BrowserWindow.getAllWindows()[0].isVisible(),
      profile: app.getPath('userData'),
      appData: app.getPath('appData'),
    }));
    assert.equal(actual.visible, true);
    assert.equal(actual.profile, path.join(actual.appData, 'YGO-Duel-Archive'));
    await page.waitForFunction(() =>
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    );
    const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    if (launch) assert.deepEqual(storage, previousStorage);
    previousStorage = storage;
    // Exercise the real double-click launcher from a different working directory,
    // with poisoned development variables and an existing hidden game window.
    await electron.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.minimize();
      w.hide();
    });
    const launched = spawnSync(
      process.env.ComSpec,
      ['/d', '/c', `call "${path.resolve('启动游戏.cmd')}"`],
      {
        cwd: os.tmpdir(),
        env: {
          ...env,
          ELECTRON_RUN_AS_NODE: '1',
          YGO_SMOKE_TEST: '1',
          YGO_SMOKE_USERDATA: path.resolve('test-results/should-not-be-created'),
        },
        encoding: 'utf8',
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 10000,
      },
    );
    assert.equal(launched.status, 0, launched.stderr || launched.stdout);
    await electron.evaluate(async ({ BrowserWindow }) => {
      for (let i = 0; i < 60; i++) {
        const w = BrowserWindow.getAllWindows()[0];
        if (w.isVisible() && !w.isMinimized()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('重复启动未能恢复游戏窗口');
    });
    assert.deepEqual(
      await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))),
      storage,
    );

    await page.screenshot({ path: 'test-results/production-startup.png' });
    await electron.close();
    electron = null;
  }
  console.log('正式启动验证通过：正常存档路径、窗口可见、主页与离线图片加载、重启后进度未改变。');
} finally {
  if (electron) await electron.close();
}
