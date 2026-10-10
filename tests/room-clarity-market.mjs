import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import {
  makeItem,
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
} from '../src/game/model.js';
import { makeCardRecord } from '../src/game/card-data.js';
import { PLACEHOLDER_BACKUP_KEY } from '../src/game/save-storage.js';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';

const desktop = process.env.YGO_CLARITY_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const output = 'test-results/clarity-placeholder-20261009';
await fs.mkdir(output, { recursive: true });
const fixture = freshState();
fixture.settings.sound = false;
fixture.items = ['box', 'pack'].map((kind, i) => ({
  ...makeItem(kind),
  isNew: false,
  pose3d: {
    position: [-2 + i * 3, kind === 'box' ? 1.2 : 0.09, -1.5],
    quaternion: kind === 'box' ? [0, 0, 0, 1] : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  },
}));
addCards(fixture, 'UR', 3);
transferWarehouseToTray(fixture, 'UR', 1);
moveBinderCard(fixture, { printId: 'UR' }, 0);
addCards(fixture, 'LOCR-JP001-SER', 3);
transferWarehouseToTray(fixture, 'LOCR-JP001-SER', 1);
addCards(fixture, 'LOCR-JP001-UR', 2);
fixture.cardStacks.push({
  id: 'clarity-stack',
  cards: [
    makeCardRecord('UR', 'old-card'),
    makeCardRecord('LOCR-JP001-SER', 'real-1'),
    makeCardRecord('LOCR-JP001-UR', 'real-2'),
  ],
  pose3d: { position: [0, 0.12, 2.2], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
});
validateState(structuredClone(fixture));
const raw = JSON.stringify(fixture);
const report = { desktop, errors: [], focus: [] };
let application;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await application.firstWindow();
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.context().setOffline(true);
  } else {
    application = await chromium.launch({ ...browserOptions, headless: true });
    page = await application.newPage({ deviceScaleFactor: 2 });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.addInitScript((raw) => {
    if (!localStorage.getItem('clarity-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', raw);
      localStorage.setItem('clarity-fixture', '1');
    }
  }, raw);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 90 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), PLACEHOLDER_BACKUP_KEY),
    raw,
  );
  report.retirement = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
  );
  assert.equal(report.retirement.cards.UR, 0);
  assert.deepEqual(
    report.retirement.cardStacks[0].cards.map((c) => c.id),
    ['real-1', 'real-2'],
  );
  assert.deepEqual(report.retirement.items, fixture.items);
  await navigatePage(page, 'shop');
  assert.equal(await page.locator('.phone-apps [data-app="jhs"]').count(), 1);
  await openPhoneApp(page, 'jhs');
  assert.equal(await page.locator('.jhs-app [data-action="checkout"],.jhs-product').count(), 20);
  assert.equal(await page.locator('.jhs-app img').count(), 20);
  assert.equal(await page.locator('.jhs-app [data-market-count]').textContent(), '328');
  assert.equal(await page.locator('.jhs-app [data-action="checkout"]:disabled').count(), 20);
  await shot('full-market-unquoted');
  await page.locator('.phone-home-button').click();
  await page.waitForFunction(
    () => !document.querySelector('#phone-content').dataset.localTransition,
  );
  await page.mouse.move(10, 10);
  await page.locator('.phone-apps [data-app="jhs"]').focus();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement,
      css = getComputedStyle(el);
    return {
      keyboardVisible: el.matches(':focus-visible'),
      outlineColor: css.outlineColor,
      outlineWidth: css.outlineWidth,
      outlineStyle: css.outlineStyle,
    };
  });
  assert.equal(focus.keyboardVisible, true);
  assert.equal(focus.outlineStyle, 'none');
  report.focus.push(focus);
  await shot('purchase-focus');
  await openPhoneApp(page, 'tao');
  await page.locator('.tao-product').first().focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle),
    'none',
  );
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  await page.locator('.world-stack').press('Enter');
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  assert.equal(await page.locator('.inspect-card').count(), 2);
  report.sidePanels = await page.locator('.card-destination').evaluateAll((panels) =>
    panels.map((panel) => ({
      images: panel.querySelectorAll('img').length,
      cardBackgrounds: [...panel.querySelectorAll('*')]
        .map((el) => getComputedStyle(el).backgroundImage)
        .filter((bg) => bg.includes('url(')),
      occupied: panel.querySelector('.destination-preview').classList.contains('has-cards'),
    })),
  );
  assert.ok(
    report.sidePanels.every(
      (panel) => panel.images === 0 && panel.cardBackgrounds.length === 0 && panel.occupied,
    ),
  );
  await shot('sorting');
  await page.keyboard.press('Escape');
  await page.locator('.card-inspector').waitFor({ state: 'detached' });
  await page.evaluate(async () => {
    const { createWorld3D } = await import(new URL('./src/scene/world3d.js', location.href));
    const state = JSON.parse(localStorage.getItem('ygo-duel-archive-v1'));
    const host = document.createElement('main');
    host.id = 'clarity-room';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '1000' });
    document.body.append(host);
    const w = (window.clarityWorld = createWorld3D(host, {
      state,
      save() {},
      sound() {},
      toast() {},
      navigate() {},
    }));
    await w.ready;
    w.setNavigationPaused(true);
    w.renderer.setDrawingBufferSize(host.clientWidth, host.clientHeight, w.quality.ratio);
    w.renderSize = null;
    w.target.set(-0.4, 0.2, -1.3);
    w.orbit.distance = 6;
    w.updateCamera();
    w.renderer.render(w.scene, w.camera);
    w.canvas.style.removeProperty('visibility');
    // Reproduce the old minimum resolution on the same scene for visual comparison.
    w.renderer.setDrawingBufferSize(host.clientWidth, host.clientHeight, 0.6);
    w.renderer.render(w.scene, w.camera);
  });
  await shot('old-resolution');
  report.activeQuality = await page.evaluate(() => {
    const w = window.clarityWorld;
    for (let i = 0; i < 40; i++) w.quality.observe(80);
    w.resize();
    w.renderer.setDrawingBufferSize(w.host.clientWidth, w.host.clientHeight, w.quality.ratio);
    w.renderSize = null;
    w.renderer.render(w.scene, w.camera);
    const sample = {
      ratio: w.quality.ratio,
      width: w.canvas.width,
      height: w.canvas.height,
      cssWidth: w.canvas.clientWidth,
      cssHeight: w.canvas.clientHeight,
    };
    w.setNavigationPaused(false);
    return sample;
  });
  assert.ok(report.activeQuality.width >= report.activeQuality.cssWidth);
  assert.ok(report.activeQuality.height >= report.activeQuality.cssHeight);
  await page.waitForFunction(() => {
    const w = window.clarityWorld;
    return w.quality.ratio === w.quality.ceiling && !w.needsRender;
  });
  report.restoredQuality = await page.evaluate(() => {
    const w = window.clarityWorld;
    w.setNavigationPaused(true);
    return {
      ratio: w.quality.ratio,
      ceiling: w.quality.ceiling,
      width: w.canvas.width,
      height: w.canvas.height,
    };
  });
  assert.ok(report.restoredQuality.ratio >= 1);
  await shot('full-resolution');
  await page.evaluate(() => {
    window.clarityWorld.dispose();
    document.querySelector('#clarity-room').remove();
  });
  assert.deepEqual(report.errors, []);
  report.retirement = { legacyCount: 0, realCount: 5, originalBackedUp: true };
  report.passed = true;
  console.log(
    `Clarity ${prefix}: native-pixel floor, idle restoration, placeholder retirement/backup, neutral sorting sides, full market with unavailable quotes and keyboard focus passed.`,
  );
} finally {
  await fs.writeFile(`${output}/${prefix}-report.json`, JSON.stringify(report, null, 2));
  await application?.close();
}
