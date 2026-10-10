import { browserOptions, navigatePage, dragAlbumCard } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
await fs.mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('.home-menu');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.waitForTimeout(1100);
  await page.screenshot({ path: 'test-results/home.png' });
  await page.locator('.tile-settings').click();
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('[data-action="setting-toggle"][data-setting="motion"]').click();
  await navigatePage(page, 'open');
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('.world-object').count(), 6);
  await page.screenshot({ path: 'test-results/space.png' });
  await page.locator('.object-case').press('Enter');
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal(await page.locator('.object-box').count(), 26);
  await page.locator('.object-box').first().press('Enter');
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal(await page.locator('.object-pack').count(), 18);
  await page.locator('.object-pack').first().press('Enter');
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal(await page.locator('.world-stack').count(), 1);

  await page.waitForTimeout(650);
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector('canvas')
          .world3D.snapshot()
          .cards.filter((c) => c.revealed).length,
    ),
    4,
  );
  await page.screenshot({ path: 'test-results/reveal.png' });
  await page.locator('.world-stack').press('Enter');
  await page.locator('[data-route-all="collection"]').click();
  await page.locator('.space-return').click();
  await page.locator('.tile-album').click();
  assert.ok((await page.locator('.tray-card').count()) > 0);
  await dragAlbumCard(page, '.tray-card', '[data-slot="0"]');
  assert.equal(await page.locator('.album-slot.owned').count(), 1);
  await dragAlbumCard(page, '.tray-card', '[data-album-drop="warehouse"]');
  await page.screenshot({ path: 'test-results/album.png' });
  await page.locator('[data-action="navigate"][data-page="shop"]').click();
  await page.screenshot({ path: 'test-results/phone.png' });
  await page.locator('.phone-apps [data-app="jhs"]').click();
  await page.screenshot({ path: 'test-results/jhs.png' });
  assert.equal(await page.locator('.jhs-product').count(), 0);
  assert.equal(await page.locator('.jhs-app [data-action="checkout"]').count(), 0);
  assert.ok(await page.locator('.jhs-app .phone-empty').isVisible());
  await navigatePage(page, 'warehouse');
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  assert.equal(data.coins, 10000);
  assert.equal(
    Object.values(data.cards).reduce((a, b) => a + b, 0),
    4,
  );
  await page.locator('.warehouse-card [data-action="card-detail"]').first().click();
  await page.locator('[data-action="favorite"]').click();
  await page.locator('[data-action="close"]').click();
  await page.locator('[data-filter="favorites"]').click();
  assert.equal(await page.locator('.warehouse-card').count(), 1);
  await page.screenshot({ path: 'test-results/warehouse.png' });
  await page.locator('[data-action="navigate"][data-page="shop"]').click();
  await page.locator('.phone-home-button').click();
  await page.locator('.phone-apps [data-app="tao"]').click();
  await page.screenshot({ path: 'test-results/tao.png' });
  await page.locator('.tao-product[data-kind="box"]').click();
  await page.locator('[data-action="buy"]').click();
  await page.locator('.success-modal [data-action="close"]').click();
  await page.locator('.phone-home-button').click();
  await page.locator('.phone-apps [data-app="q"]').click();
  await page.screenshot({ path: 'test-results/qxin.png' });
  await page.locator('.q-product-card [data-action="checkout"]').click();
  await page.locator('[data-action="buy"]').click();
  await page.locator('[data-action="success-open"]').click();
  const end = await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  assert.equal(end.coins, 6860);
  assert.equal(end.items.filter((i) => i.kind === 'case').length, 1);
  assert.deepEqual(end.opened, { case: 1, box: 1, pack: 1, bonus: 0 });
  await page.reload();
  assert.equal(await page.locator('#coins').innerText(), '6,860');
  await page.locator('.tile-settings').click();
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.locator('[data-section="settings-save"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  const downloadWait = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadWait;
  await download.saveAs('test-results/export.json');
  assert.equal(JSON.parse(await fs.readFile('test-results/export.json', 'utf8')).coins, 6860);
  await page.locator('#import-file').setInputFiles('test-results/export.json');
  await page.locator('#confirm-import').click();
  assert.equal(await page.locator('#coins').innerText(), '6,860');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'test-results/home-1366.png' });
  await page.locator('.tile-shop').click();
  await page.screenshot({ path: 'test-results/phone-1366.png' });
  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('input[data-setting="brightness"]').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).settings.brightness,
    ),
    21,
  );
  assert.equal(
    await page
      .locator('[data-setting="music"],[data-setting="musicVolume"],[data-action="toggle-music"]')
      .count(),
    0,
  );
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mobile.newPage();
  await mp.goto('http://127.0.0.1:5173');
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: 'test-results/mobile-home.png', fullPage: true });
  const mobileHome = await mp.locator('.home').boundingBox(),
    mobileSettings = await mp.locator('.tile-settings').boundingBox(),
    mobileMenu = await mp.locator('.home-menu').boundingBox();
  assert.ok(mobileSettings.y + mobileSettings.height <= mobileHome.y + mobileHome.height);
  assert.ok(
    mobileSettings.x >= 0 && mobileSettings.x + mobileSettings.width <= 390,
    '倾斜菜单在窄屏内完整显示',
  );
  await mp.locator('.tile-shop').click();
  await mp.screenshot({ path: 'test-results/mobile-phone.png', fullPage: true });
  assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mp.evaluate(() => document.body.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'UI 验证通过：物品拖拽、拆箱→拆盒→开包→正面卡片→收藏、空单卡市场、两种包装购买、标记、设置生效、刷新存档、导出导入、桌面与手机布局。',
  );
} finally {
  await browser.close();
}
