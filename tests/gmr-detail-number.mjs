import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import { freshState } from './helpers/starter-state.mjs';
import {
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
} from '../src/game/model.js';
import { CARD_PRINTS, getCardView, makeCardRecord } from '../src/game/card-data.js';
import { createArchiveScreens } from '../src/ui/screens.js';

const output = process.env.YGO_DETAIL_OUTPUT || 'test-results/gmr-detail-number-20261010';
const desktopRoot = process.env.YGO_DETAIL_DESKTOP_ROOT;
const prefix = desktopRoot ? path.basename(desktopRoot) : 'browser';
const print = CARD_PRINTS.find((p) => p.cardId === 'LOCR-JP002' && p.rarity === 'GMR');
assert.ok(print, 'Use the exact card in the reported screenshot');
await fs.mkdir(output, { recursive: true });
const fixture = (multiple) => {
  const state = freshState();
  state.items = [];
  state.settings.motion = false;
  state.settings.sound = false;
  const serials = multiple ? [1, 2, 37, 88] : [1];
  addCards(state, print.id, serials.length, serials);
  if (multiple) {
    transferWarehouseToTray(state, print.id);
    moveBinderCard(state, { printId: print.id }, 0);
    const pending = state.numberedCards.find((c) => c.serial === 2);
    state.cardStacks.push({
      id: crypto.randomUUID(),
      cards: [makeCardRecord(print.id, pending.id, pending.serial)],
      pose3d: { position: [0, 0.09, 1.35] },
    });
  }
  addCards(state, CARD_PRINTS.find((p) => p.style === 'SR').id);
  return validateState(state);
};
// Unowned catalogue previews must not invent a numbered identity.
const screens = createArchiveScreens({ icon: () => '', asset: (p) => p });
const unowned = screens.cardDetail({ state: freshState(), r: getCardView(print.id) });
assert.ok(!unowned.includes('data-finish-serial'));
assert.ok(!unowned.includes('class="gmr-serial"'));

const env = {
  ...process.env,
  YGO_SMOKE_TEST: '1',
  YGO_SMOKE_USERDATA: path.resolve(output, `${prefix}-profile-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const application = desktopRoot
  ? await _electron.launch({
      executablePath: path.resolve(desktopRoot, `${path.basename(desktopRoot)}.exe`),
      env,
    })
  : await chromium.launch({ ...browserOptions, headless: true });
const errors = [];
const results = [];
try {
  const page = desktopRoot
    ? await application.firstWindow()
    : await application.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 220));
  });
  if (desktopRoot) {
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(1440, 900);
      win.show();
      win.focus();
    });
    await page.context().setOffline(true);
  } else await page.goto('http://127.0.0.1:5173');
  const ready = async (selector) => {
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.dataset.ready === 'true',
      selector,
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
  };
  const inventory = () =>
    page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('ygo-duel-archive-v1'));
      return {
        cards: s.cards,
        collection: s.collection,
        numberedCards: s.numberedCards,
        binder: s.binder,
        cardStacks: s.cardStacks,
      };
    });
  for (const multiple of [false, true]) {
    const state = fixture(multiple),
      expected = multiple ? 37 : 1;
    await page.addInitScript((state) => {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
    }, state);
    await page.reload();
    await page.locator('.home-menu').waitFor();
    await navigatePage(page, 'warehouse');
    const before = await inventory();
    const row = page.locator(`.warehouse-card:has([data-rarity="${print.id}"])`);
    await row.locator('[data-action="warehouse-preview"]').click();
    await ready('.inventory-preview-art .card-finish-canvas');
    assert.equal(await row.locator('img').getAttribute('data-finish-serial'), String(expected));
    assert.equal(
      await page.locator('.inventory-preview-art img').getAttribute('data-finish-serial'),
      String(expected),
    );
    // Both actual warehouse entry points must preserve the visible identity.
    for (const button of [
      row.locator('[data-action="card-detail"]'),
      page.locator('.inventory-preview > [data-action="card-detail"]'),
    ]) {
      await button.click();
      await ready('.detail-card .card-finish-canvas');
      assert.equal(
        await page.locator('.detail-card img').getAttribute('data-finish-serial'),
        String(expected),
      );
      assert.equal(
        await page
          .locator('.detail-card .gmr-serial')
          .evaluate((el) => getComputedStyle(el).opacity),
        '0',
      );
      const pixels = await page.locator('.detail-card .card-finish-canvas').evaluate((canvas) => {
        const x = Math.floor((canvas.width * 35) / 590),
          y = Math.floor((canvas.height * 812) / 860);
        const w = Math.floor((canvas.width * 145) / 590),
          h = Math.floor((canvas.height * 28) / 860);
        const data = canvas.getContext('2d').getImageData(x, y, w, h).data;
        let visible = 0,
          dark = 0;
        for (let i = 0; i < data.length; i += 4) {
          const luminance = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
          if (luminance > 60) visible++;
          if (luminance < 30) dark++;
        }
        return { visible, dark, area: w * h };
      });
      assert.ok(
        pixels.visible > pixels.area * 0.05,
        'Real material contains visible numbered glyphs, not an empty black plaque',
      );
      assert.ok(pixels.dark > pixels.area * 0.4, 'Plaque keeps a dark background');
      if (!multiple) {
        await sharp(await page.screenshot())
          .resize({ width: 1280 })
          .webp({ quality: 88 })
          .toFile(`${output}/${prefix}-001-detail.webp`);
        const face = await page
          .locator('.detail-card .card-finish-canvas')
          .evaluate((canvas) => canvas.toDataURL('image/png'));
        const bitmap = sharp(Buffer.from(face.split(',')[1], 'base64'));
        const metadata = await bitmap.metadata();
        await bitmap
          .extract({
            left: Math.floor((metadata.width * 24) / 590),
            top: Math.floor((metadata.height * 805) / 860),
            width: Math.ceil((metadata.width * 190) / 590),
            height: Math.ceil((metadata.height * 42) / 860),
          })
          .resize({ width: 760 })
          .png()
          .toFile(`${output}/${prefix}-001-number.png`);
      }
      results.push({ multiple, expected, pixels });
      await page.keyboard.press('Escape');
    }
    const normal = page.locator('.warehouse-card:not(.rarity-GMR)').first();
    await normal.locator('[data-action="card-detail"]').click();
    await ready('.detail-card .card-finish-canvas');
    assert.equal(await page.locator('.detail-card img').getAttribute('data-finish-serial'), null);
    assert.equal(await page.locator('.detail-card .gmr-serial').count(), 0);
    await page.keyboard.press('Escape');
    assert.deepEqual(
      await inventory(),
      before,
      'Preview and details do not change card ownership or location',
    );
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/${prefix}-verification.json`,
    JSON.stringify(
      { results, unownedNotNumbered: true, inventoryUnchanged: true, errors },
      null,
      2,
    ),
  );
  console.log(
    `GMR detail ${prefix}: actual 001/100 and warehouse 037/100 visible in both detail entry points; collection/pending excluded; unowned/ordinary cards and inventory preserved.`,
  );
} finally {
  await application.close();
}
