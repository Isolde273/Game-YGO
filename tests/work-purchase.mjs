import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp, closePurchase } from './helpers/browser.mjs';
import { validateState } from '../src/game/model.js';

const output = 'test-results/work1s-pickup-after-spread-20261010/work';
await fs.mkdir(output, { recursive: true });
const desktop = process.env.YGO_WORK_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const state = freshState();
state.settings = { ...state.settings, sound: false, music: false, motion: false };
const report = { passed: false, checks: [], errors: [] };
let app;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(output, `work-profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.addInitScript((state) => {
    if (!sessionStorage.getItem('work-seeded')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      sessionStorage.setItem('work-seeded', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  await page.clock.install({ time: new Date('2026-10-10T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-10T08:00:01Z'));
  await navigatePage(page, 'shop');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const button = page.locator('[data-action="work"]');
  assert.ok(await button.isEnabled());
  await button.click();
  assert.equal((await saved()).coins, state.coins + 500);
  assert.equal(await page.locator('[data-phone-coins]').textContent(), '10,500');
  assert.equal(await page.locator('#coins').textContent(), '10,500');
  assert.equal(await button.getAttribute('aria-label'), '打工，冷却1秒');
  assert.ok(await button.isDisabled());
  assert.equal(await page.locator('[data-work-countdown]').textContent(), '1s');
  await button.dispatchEvent('click');
  assert.equal((await saved()).coins, state.coins + 500);
  await page.reload();
  await page.locator('.home-menu').waitFor();
  await navigatePage(page, 'shop');
  assert.ok(await button.isDisabled());
  await openPhoneApp(page, 'tao');
  await page.locator('.phone-home-button').click();
  await page.waitForFunction(
    () => !document.querySelector('#phone-content')?.dataset.localTransition,
  );
  assert.ok(await button.isDisabled());
  const readyAt = (await saved()).workReadyAt;
  const now = await page.evaluate(() => Date.now());
  await page.clock.runFor(readyAt - now - 1);
  assert.ok(await button.isDisabled());
  await page.clock.runFor(1);
  assert.ok(await button.isEnabled());
  assert.equal(await button.getAttribute('aria-label'), '打工，获得500');
  await button.click();
  assert.equal((await saved()).coins, state.coins + 1000);
  validateState(await saved());
  report.checks.push('打工500与1s边界、连续触发拒绝、重载和切换应用保持冷却、金额与提示同步');

  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    const layout = await page
      .locator('.phone-dock')
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1);
    if (width !== 360) {
      await page.evaluate(() => document.fonts.ready);
      await sharp(await page.screenshot())
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86 })
        .toFile(`${output}/${prefix}-work-${width}.jpg`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPhoneApp(page, 'tao');
  for (const [kind, price] of [
    ['box', 325],
    ['pack', 22],
    ['bonus', 72],
  ]) {
    assert.equal(
      await page.locator(`.tao-product[data-kind="${kind}"] .product-price strong`).textContent(),
      String(price),
    );
    await page.locator(`.tao-product[data-kind="${kind}"]`).click();
    assert.equal(await page.locator('#checkout-total').textContent(), String(price));
    await page.locator('#checkout-quantity').fill('2');
    assert.equal(await page.locator('#checkout-total').textContent(), String(price * 2));
    await page.locator('[data-action="close"]').click();
  }
  await openPhoneApp(page, 'q');
  assert.equal(await page.locator('.chat-product strong').textContent(), '7,999');
  await page.locator('[data-action="checkout"]').click();
  assert.equal(await page.locator('#checkout-total').textContent(), '7,999');
  const before = (await saved()).coins;
  await page.locator('[data-action="buy"]').click();
  assert.equal((await saved()).coins, before - 7999);
  await page.locator('.success-modal [data-action="close"]').click();
  await closePurchase(page);
  validateState(await saved());
  report.checks.push('箱7999/盒325/包22：商品标价、订单数量合计、实际扣款；1440/390/360px打工布局');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`${prefix}: 箱盒包价格与打工验证通过`);
} finally {
  await fs.writeFile(`${output}/${prefix}-work.json`, JSON.stringify(report, null, 2));
  await app?.close();
}
