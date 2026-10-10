import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp, closePurchase } from './helpers/browser.mjs';
import { freshState, validateState } from '../src/game/model.js';

const output = 'test-results/no-music-return-sound-20261010';
await fs.mkdir(output, { recursive: true });
const desktop = process.env.YGO_AUDIO_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const state = freshState();
state.settings = { ...state.settings, music: true, musicVolume: 100, sound: false, motion: false };
const report = { passed: false, checks: [], mediaRequests: [], errors: [] };
const assertStarter = (state) => {
  assert.equal(state.coins, 500);
  assert.equal(state.items.filter((item) => item.kind === 'box').length, 3);
  assert.equal(state.items.filter((item) => item.kind === 'bonus').length, 1);
  assert.equal(state.items.length, 4);
  validateState(structuredClone(state));
};
assertStarter(state);
let app;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(output, `profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900);
      window.show();
      window.focus();
    });
    await page.context().setOffline(true);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('quit-game');
      ipcMain.handle('quit-game', () => true);
    });
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => {
    if (/background\.m4a|p3r-back\.wav/.test(request.url()))
      report.mediaRequests.push(request.url());
  });
  await page.addInitScript((state) => {
    if (!sessionStorage.getItem('disabled-audio-seeded')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      sessionStorage.setItem('disabled-audio-seeded', '1');
    }
    window.disabledAudioProbe = { tracks: 0, mediaPlays: 0, sources: 0 };
    const OriginalAudio = window.Audio;
    window.Audio = class extends OriginalAudio {
      constructor(...args) {
        super(...args);
        disabledAudioProbe.tracks++;
      }
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      disabledAudioProbe.mediaPlays++;
      return play.apply(this, args);
    };
    const Context = window.AudioContext || window.webkitAudioContext;
    const create = Context.prototype.createBufferSource;
    Context.prototype.createBufferSource = function (...args) {
      disabledAudioProbe.sources++;
      return create.apply(this, args);
    };
    if (!window.desktop) window.close = () => {};
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  assertStarter(await saved());
  assert.equal(await page.locator('#coins').textContent(), '500');
  for (const target of ['album', 'warehouse', 'open', 'shop']) {
    if (target === 'shop') await navigatePage(page, 'home');
    await navigatePage(page, target);
    assert.equal(await page.locator('[data-action="toggle-music"]').count(), 0);
  }
  for (const name of ['jhs', 'tao', 'q']) await openPhoneApp(page, name);
  await closePurchase(page);
  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.equal(
    await page.locator('[data-setting="music"],[data-setting="musicVolume"]').count(),
    0,
  );
  assert.equal(await page.locator('#settings-audio [data-setting]').count(), 4);
  await sharp(await page.screenshot())
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(`${output}/${prefix}-settings.jpg`);
  assert.deepEqual(
    await page.evaluate(() => ({
      tracks: disabledAudioProbe.tracks,
      plays: disabledAudioProbe.mediaPlays,
    })),
    { tracks: 0, plays: 0 },
  );
  assert.deepEqual(report.mediaRequests, []);
  report.checks.push(
    '即使旧档背景音乐为开启，也不创建播放器、不加载音乐；主栏和设置中音乐控件已移除',
  );

  await page.locator('[data-setting="sound"]').click();
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).settings.sound,
  );
  // Suppress the allowed five navigation hovers while checking silent returns.
  await page.evaluate(() =>
    document.addEventListener('pointerover', (event) => event.stopImmediatePropagation(), true),
  );
  const silence = async (action) => {
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      disabledAudioProbe.sources = 0;
    });
    await action();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => disabledAudioProbe.sources), 0);
  };
  await silence(() => page.keyboard.press('Escape'));
  await silence(() => navigatePage(page, 'home'));
  await silence(() => page.locator('.tile-exit').click());
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'tao');
  await silence(() => page.locator('.phone-home-button').click());
  await page.waitForFunction(
    () => !document.querySelector('#phone-content')?.dataset.localTransition,
  );
  await silence(() => closePurchase(page));
  report.checks.push('Esc返回、主页返回、退出、手机返回及收起手机均无音效；其他音效保持启用');

  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-save"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('[data-action="reset"]').click();
  await page.locator('[data-action="confirm-reset"]').click();
  await page.locator('.home-menu').waitFor();
  assertStarter(await saved());
  assert.equal(await page.locator('#coins').textContent(), '500');
  await page.reload();
  await page.locator('.home-menu').waitFor();
  assertStarter(await saved());
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  assert.equal(await page.locator('.object-box').count(), 3);
  assert.equal(await page.locator('.object-bonus').count(), 1);
  report.checks.push('新开局、重置与重载均为500、三盒LOCR、一包特别包；开盒空间显示赠品');
  assert.deepEqual(report.mediaRequests, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  await fs.writeFile(`${output}/${prefix}.json`, JSON.stringify(report, null, 2));
  await app?.close();
}
console.log(`Disabled music and starter ${prefix}: ${report.checks.length} checks passed.`);
