import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage, closePurchase, openPhoneApp } from './helpers/browser.mjs';

const output = 'test-results/purchase-overlay';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { checks: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = freshState();
  state.settings.sound = false;
  await page.addInitScript((s) => {
    if (!localStorage.getItem('purchase-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('purchase-fixture', '1');
    }
  }, state);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  // The standalone settings screen has no purchase entry in the current UI.
  for (const origin of ['home', 'album', 'warehouse', 'open']) {
    if (origin !== 'home') await navigatePage(page, origin);
    if (origin === 'open') await page.waitForSelector('canvas[data-presented="true"]');
    await page.waitForFunction(
      () => !document.getAnimations().some((a) => a.effect?.target?.closest?.('#app')),
    );
    const before = (await page.locator('#app').innerHTML()).replace(/ style="[^"]*"/g, '');
    await page.evaluate(() => {
      window.purchaseBackground = document.querySelector('#app main');
      window.purchaseCanvas = document.querySelector('canvas');
    });
    if (origin === 'open') await page.locator('.world-phone').press('Enter');
    else if (origin === 'home') await page.locator('.tile-shop').click();
    else await page.locator('.mini-nav [data-page="shop"]').click();
    await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
    assert.ok(
      (await page.locator('#app').innerHTML()).replace(/ style="[^"]*"/g, '') === before,
      `${origin}: background changed`,
    );
    assert.equal(
      await page.evaluate(() => window.purchaseBackground === document.querySelector('#app main')),
      true,
    );
    assert.equal(await page.evaluate(() => document.body.dataset.page), origin);
    assert.equal(await page.locator('.room-portal-layer,.transition-screen-bridge').count(), 0);
    assert.equal(await page.locator('#app').evaluate((el) => el.inert), true);
    if (origin === 'open') {
      assert.equal(
        await page.evaluate(() => window.purchaseCanvas === document.querySelector('canvas')),
        true,
      );
      await openPhoneApp(page, 'tao');
      await page.locator('.tao-product[data-kind="pack"]').click();
      await page.locator('[data-action="buy"]').click();
      await page.locator('.success-modal [data-action="close"]').click();
    }
    await closePurchase(page);
    assert.equal(await page.locator('#app').evaluate((el) => el.inert), false);
    if (origin === 'open') {
      assert.equal(
        await page.evaluate(() => window.purchaseCanvas === document.querySelector('canvas')),
        true,
      );
      assert.equal(
        await page.locator('.world-object').count(),
        7,
        'New purchase appears in the existing scene',
      );
    }
    await navigatePage(page, 'home');
  }
  report.checks.push(
    'All four purchase-entry backgrounds retained while the phone is open; original canvas retained on return; new purchases synchronize into the existing room',
  );
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('.tile-shop').click();
    await page.setViewportSize({ ...size, height: size.height - 20 });
    await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
    await sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(`${output}/phone-${size.width}.jpg`);
    await closePurchase(page);
    await page.locator('.tile-shop').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
    await closePurchase(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  report.checks.push(
    'Resize and live reduced motion release input and clean temporary tracks; desktop and narrow-screen pickup and return',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report));
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
