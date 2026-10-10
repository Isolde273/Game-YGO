import { freshState } from './helpers/starter-state.mjs';
import { browserOptions, openPhoneApp, navigatePage, closePurchase } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RARITIES, moveBinderCard, addCards, transferWarehouseToTray } from '../src/game/model.js';
import { fixturePrintId } from './helpers/sorting-stacks.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const errors = [],
  layouts = [];
const sizes = [
  [1440, 900],
  [1095, 615],
  [1366, 768],
  [1920, 1080],
  [1000, 700],
  [768, 1024],
  [390, 844],
  [360, 800],
];
await fs.mkdir('test-results', { recursive: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const fixture = freshState();
  fixture.settings.motion = false;
  fixture.settings.sound = false;
  for (const rarity of RARITIES) {
    const printId = fixturePrintId(rarity.id);
    addCards(fixture, printId, 4);
    transferWarehouseToTray(fixture, printId, 1);
    moveBinderCard(fixture, { printId }, RARITIES.indexOf(rarity));
  }
  await page.addInitScript((state) => {
    if (!localStorage.getItem('ui-layout-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('ui-layout-fixture', '1');
    }
  }, fixture);
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const home = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      buttons: [...document.querySelectorAll('.menu-tile')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom };
      }),
      bottom: document.querySelector('.home').getBoundingClientRect().bottom,
      actions: (() => {
        const row = document.querySelector('.home-menu-actions');
        return {
          width: row.offsetWidth,
          settings: row.querySelector('.tile-settings').offsetWidth,
          exit: row.querySelector('.tile-exit').offsetWidth,
          gap: parseFloat(getComputedStyle(row).columnGap),
          escapeHint: document.querySelector('.home-save').textContent.includes('ESC'),
        };
      })(),
    }));
    assert.ok(home.width <= width, `Home overflow at ${width}`);
    assert.ok(Math.abs(home.actions.settings / home.actions.width - 0.75) < 0.003);
    assert.ok(Math.abs(home.actions.exit / home.actions.width - 0.2) < 0.003);
    assert.equal(home.actions.escapeHint, false);
    assert.ok(
      home.buttons.every((r) => r.left >= 0 && r.right <= width && r.bottom <= home.bottom),
      `Home controls clipped at ${width}: ${JSON.stringify(home)}`,
    );
    if ([1440, 390].includes(width))
      await page.screenshot({ path: `test-results/interfaces-home-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.tile-album').click();
  const shot = async (name, width) => {
    if ([1440, 390].includes(width)) {
      await page.mouse.move(1, 1);
      await page.screenshot({
        path: `test-results/interfaces-${name}-${width}.png`,
        fullPage: true,
      });
    }
  };
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const name of ['album', 'warehouse', 'shop', 'settings']) {
      await navigatePage(page, name);
      if (name === 'shop') await page.locator('.phone-home-button').click();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        [...document.images].every((img) => img.complete && img.naturalWidth > 0),
      );
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        navigation: [...document.querySelectorAll('.mini-nav button')].map((el) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
        })),
        current: document.querySelectorAll('.mini-nav [aria-current="page"]').length,
      }));
      assert.ok(layout.document <= width && layout.body <= width, `${name} overflow at ${width}`);
      assert.equal(layout.current, name === 'settings' ? 0 : 1);
      if (name === 'settings') {
        assert.equal(await page.locator('.topbar,.mini-nav,.workspace-rail,.footer').count(), 0);
        assert.deepEqual(await page.locator('.settings-page').boundingBox(), {
          x: 0,
          y: 0,
          width,
          height,
        });
      }
      assert.ok(
        layout.navigation.every((r) => r.left >= 0 && r.right <= width),
        `${name} navigation at ${width}`,
      );
      if (name === 'shop') {
        const phone = await page.locator('.phone').boundingBox(),
          stage = await page.locator('.shop-stage').boundingBox();
        assert.ok(
          phone.x >= stage.x && phone.x + phone.width <= stage.x + stage.width,
          `Phone sides at ${width}`,
        );
        assert.ok(
          phone.y >= stage.y && phone.y + phone.height <= stage.y + stage.height,
          `Phone top/bottom at ${width}: ${JSON.stringify({ phone, stage })}`,
        );
        await page.locator('.phone-apps [data-app="jhs"]').click();
        assert.equal(await page.locator('.jhs-product').count(), 20);
        await openPhoneApp(page, 'tao');
        await page.locator('.tao-product').last().click();
        assert.equal(await page.locator('.checkout-modal').count(), 1);
        await shot('checkout', width);
        await page.keyboard.press('Escape');
        await page.locator('.phone-home-button').click();
      }
      await shot(name, width);
      layouts.push({ page: name, width, height, overflow: false });
    }
    await page.locator('[data-section="settings-save"]').click();
    await page.waitForFunction(() => !document.body.dataset.settingsTransition);
    await page.locator('.settings-actions [data-action="reset"]').click();
    await page.locator('.modal-close').click();
    await navigatePage(page, 'shop');
    for (const app of ['jhs', 'tao', 'q']) {
      await openPhoneApp(page, app);
      await shot(app, width);
      assert.equal(
        await page
          .locator('[data-action="app-tab"], .app-bottom-nav, .app-history, .app-wallet')
          .count(),
        0,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigatePage(page, 'album');
  await page.locator('[data-action="album-next"]').click();
  assert.equal(await page.locator('.future-slot').count(), 12);
  await shot('album-empty', 1440);
  await page.locator('[data-action="album-prev"]').click();
  await navigatePage(page, 'warehouse');
  await page.locator('[data-action="card-detail"]').first().click();
  await shot('card-detail', 1440);
  await page.keyboard.press('Escape');
  await navigatePage(page, 'open');
  await page.waitForSelector('canvas[data-ready="true"]');
  const packId = await page.locator('.object-pack').first().getAttribute('data-item');
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('canvas')
        .world3D.snapshot()
        .objects.some((item) => item.id === id),
    packId,
  );
  await page.locator('.object-pack').first().press('Enter');
  await page.waitForFunction(() => {
    const scene = document.querySelector('canvas').world3D.snapshot();
    return scene.animations.length === 0 && scene.cards.length === 4;
  });
  await shot('table', 1440);
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  for (const [width, height] of [
    [1440, 900],
    [1000, 700],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    const buttons = await page
      .locator('.card-inspector button:not(.inspect-card)')
      .evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent,
            inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          };
        }),
      );
    assert.ok(
      buttons.every((button) => button.inside),
      `Inspector controls at ${width}: ${JSON.stringify(buttons)}`,
    );
    await shot('inspector', width);
  }
  await page.locator('[data-route-all="collection"]').click();
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  assert.equal(await page.locator('.card-inspector').count(), 0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/interfaces-layout.json',
    JSON.stringify(
      {
        sizes,
        layouts,
        errors,
        phoneApps: 3,
        inspectorWidths: [1440, 1000, 390, 360],
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    '界面检查通过：8 种尺寸、收藏册翻页、仓库、手机三应用且无订单/钱包、弹窗与整理卡牌。',
  );
} finally {
  await browser.close();
}
