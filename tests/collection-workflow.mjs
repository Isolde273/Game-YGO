import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import {
  RARITIES,
  validateState,
  cardCount,
  trayCount,
  warehouseCount,
  addCards,
} from '../src/game/model.js';
import { fixturePrintId } from './helpers/sorting-stacks.mjs';
const printIds = Object.fromEntries(RARITIES.map((r) => [r.id, fixturePrintId(r.id)]));
const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  sharp = require('sharp');
const output = 'test-results/collection-redesign';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const errors = [],
  checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  const fixture = freshState();
  fixture.settings.sound = false;
  fixture.settings.motion = false;
  for (const r of RARITIES) addCards(fixture, printIds[r.id], 10);
  await page.addInitScript((s) => {
    if (!localStorage.getItem('collection-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('collection-fixture', '1');
    }
  }, fixture);
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-warehouse').click();
  const stored = async () =>
    validateState(
      await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
    );
  const shot = async (name) => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await sharp(await page.screenshot({ style: '#toast { visibility: hidden; }' }))
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(`${output}/${name}.jpg`);
  };
  const idle = () =>
    page.waitForFunction(
      () =>
        !document.querySelector('.book-outgoing') &&
        !document.querySelector('.book-turn-layer') &&
        document.querySelectorAll('.album-studio').length <= 1 &&
        !document.querySelector('.album-book')?.inert &&
        !document.querySelector('#app').inert,
    );
  const jump = async (n) => {
    await idle();
    await page.locator('#album-jump').fill(String(n));
    await page.locator('#album-jump').press('Enter');
    await page.waitForFunction(
      (pageNumber) =>
        document.querySelector('#app .left-page')?.getAttribute('aria-label') ===
        `第 ${Math.floor((pageNumber - 1) / 2) * 2 + 1} 页`,
      n,
    );
    await idle();
  };
  const center = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const r = await locator.boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const drag = async (from, to) => {
    const a = await center(from);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 10, a.y, { steps: 2 });
    const b = await center(to);
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(40);
  };
  await shot('warehouse-desktop');
  const before = await stored();
  await page.locator(`[data-transfer-quantity="${printIds.UR}"]`).fill('11');
  await page.locator('.rarity-UR [data-action="warehouse-transfer"]:not([data-all])').click();
  assert.deepEqual(await stored(), before);
  await page.locator(`[data-transfer-quantity="${printIds.UR}"]`).fill('3');
  await page.locator('.rarity-UR [data-action="warehouse-transfer"]:not([data-all])').click();
  for (const r of ['N', 'SR', 'SER', 'PSER'])
    await page.locator(`.rarity-${r === 'N' ? 'CR' : r} [data-all]`).click();
  let s = await stored();
  assert.equal(warehouseCount(s, printIds.UR), 7);
  assert.equal(trayCount(s), 43);
  assert.equal(cardCount(s), 50);
  await page.locator('.stock-collection-link').click();
  assert.equal(await page.locator('.album-slot').count(), 12);
  assert.equal(await page.locator('.album-slot.owned').count(), 0);
  const beforeClicks = await stored();
  await page.locator(`.tray-card[data-rarity="${printIds.N}"]`).click();
  await page.locator('[data-slot="0"]').click();
  assert.deepEqual(await stored(), beforeClicks);
  assert.equal(await page.locator('.is-selected,[data-album-command]').count(), 0);
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.N}"]`),
    page.locator('[data-slot="0"]'),
  );
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.UR}"]`),
    page.locator('[data-slot="11"]'),
  );
  assert.equal((await stored()).binder.slots[11].rarity, 'UR');
  await drag(page.locator('[data-slot="0"]'), page.locator('[data-slot="11"]'));
  s = await stored();
  assert.equal(s.binder.slots[0].rarity, 'UR');
  assert.equal(s.binder.slots[11].rarity, 'CR');
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.PSER}"]`),
    page.locator('[data-slot="0"]'),
  );
  assert.equal((await stored()).binder.slots[0].rarity, 'PSER');
  assert.equal(trayCount(await stored(), printIds.UR), 3);
  checks.push(
    'warehouse quantities/all, invalid transfer atomicity, clicks preserve inventory, mouse drag and occupied pocket exchange',
  );
  // Carry a card across a spread by holding it over the next-page control.
  const start = await center(page.locator('[data-slot="0"]'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y);
  const pager = await center(page.locator('[data-action="album-next"]'));
  await page.mouse.move(pager.x, pager.y, { steps: 10 });
  await page
    .waitForFunction(() => document.querySelector('[data-slot="12"]'), null, { timeout: 5000 })
    .catch(async (error) => {
      await shot('drag-debug');
      console.log(
        await page.evaluate(() => ({
          ghost: !!document.querySelector('.album-drag-ghost'),
          status: document.querySelector('#album-drag-status').textContent,
          next: document
            .querySelector('[data-action="album-next"]')
            .getBoundingClientRect()
            .toJSON(),
          scrollY,
          selected: document.querySelector('.album-slot.is-selected')?.dataset.slot,
        })),
      );
      throw error;
    });
  const next = await center(page.locator('[data-slot="14"]'));
  await page.mouse.move(next.x, next.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(40);
  assert.equal((await stored()).binder.slots[14].rarity, 'PSER');
  assert.equal((await stored()).binder.slots[0], undefined);
  await drag(page.locator('[data-slot="14"]'), page.locator('.collection-tray'));
  assert.equal((await stored()).binder.slots[14], undefined);
  checks.push('holding a card flips pages; dragging it out restores the tray');
  await jump(1);
  await drag(page.locator('[data-slot="11"]'), page.locator('.collection-tray'));
  await jump(100);
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.N}"]`),
    page.locator('[data-slot="599"]'),
  );
  assert.equal((await stored()).binder.slots[599].rarity, 'CR');
  await page.reload();
  await page.locator('.tile-album').click();
  assert.equal(await page.locator('[data-slot="599"].owned').count(), 1);
  assert.equal(await page.locator('[data-action="album-next"]').isDisabled(), true);
  for (let n = 1; n <= 100; n++) {
    await jump(n);
    const first = Math.floor((n - 1) / 2) * 2 + 1;
    assert.deepEqual(
      await page.locator('.book-page:not(.book-outgoing *)').evaluateAll((els) =>
        els.map((el) => ({
          page: el.getAttribute('aria-label'),
          slots: el.querySelectorAll('.album-slot').length,
        })),
      ),
      [
        { page: `第 ${first} 页`, slots: 6 },
        { page: `第 ${first + 1} 页`, slots: 6 },
      ],
    );
  }
  await page.locator('#album-jump').fill('101');
  await page.locator('#album-jump').press('Enter');
  assert.equal((await stored()).binder.page, 99);
  checks.push(
    'all 100 physical pages have six pockets, page 100/slot 600 is usable and reload restores positions',
  );
  await jump(1);
  for (const [r, slot] of [
    ['N', 0],
    ['SR', 1],
    ['UR', 2],
    ['SER', 6],
    ['PSER', 7],
  ]) {
    await drag(
      page.locator(`.tray-card[data-rarity="${printIds[r]}"]`),
      page.locator(`[data-slot="${slot}"]`),
    );
  }
  for (const [width, height] of [
    [1440, 900],
    [1095, 615],
    [1366, 768],
    [1920, 1080],
    [1000, 700],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const a = document.querySelector('.album-book').getBoundingClientRect(),
        b = document.querySelector('.collection-dock').getBoundingClientRect();
      return {
        overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
        overflow: document.documentElement.scrollWidth > innerWidth,
        slots: [...document.querySelectorAll('.album-slot')].map((el) => {
          const r = el.getBoundingClientRect();
          return r.width >= 40 && r.left >= 0 && r.right <= innerWidth;
        }),
      };
    });
    assert.equal(layout.overlap, false, `binder/tray overlap at ${width}`);
    assert.equal(layout.overflow, false, `overflow at ${width}`);
    assert.ok(layout.slots.every(Boolean), `pockets at ${width}`);
    if (width === 1440) await shot('album-desktop');
    if (width === 390) {
      await page.locator('.binder-stage').scrollIntoViewIfNeeded();
      await shot('album-mobile');
      await page.locator('.collection-dock').scrollIntoViewIfNeeded();
      await shot('tray-mobile');
    }
  }
  // A real touch pointer uses the same drag path, with native scrolling disabled only on cards.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.binder-stage').scrollIntoViewIfNeeded();
  const touchStart = await center(page.locator('[data-slot="0"]')),
    touchEnd = await center(page.locator('[data-slot="4"]'));
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: touchStart.x, y: touchStart.y, id: 1 }],
  });
  for (let i = 1; i <= 8; i++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: touchStart.x + ((touchEnd.x - touchStart.x) * i) / 8,
          y: touchStart.y + ((touchEnd.y - touchStart.y) * i) / 8,
          id: 1,
        },
      ],
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(50);
  assert.equal((await stored()).binder.slots[4].rarity, 'CR');
  await drag(page.locator('[data-slot="4"]'), page.locator('[data-album-drop="warehouse"]'));
  assert.equal((await stored()).binder.slots[4], undefined);
  assert.equal(warehouseCount(await stored(), printIds.N), 1);
  const trayN = trayCount(await stored(), printIds.N);
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.N}"]`),
    page.locator('[data-album-drop="warehouse"]'),
  );
  assert.equal(trayCount(await stored(), printIds.N), trayN - 1);
  assert.equal(warehouseCount(await stored(), printIds.N), 2);
  checks.push(
    'eight layouts keep tray separate; touch drag and return-to-warehouse preserve card totals',
  );
  // Verify insertion/removal animations and both reduced-motion settings.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.mini-nav [data-page="settings"]').click();
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('[data-setting="motion"]').click();
  await navigatePage(page, 'album');
  await idle();
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.N}"]`),
    page.locator('[data-slot="3"]'),
  );
  assert.equal(await page.locator('.album-flight[data-kind="insert"]').count(), 1);
  await page.waitForTimeout(500);
  await drag(page.locator('[data-slot="3"]'), page.locator('.collection-tray'));
  assert.equal(await page.locator('.album-flight[data-kind="remove"]').count(), 1);
  await page.waitForTimeout(500);
  const warehouseBefore = warehouseCount(await stored(), printIds.N);
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.N}"]`),
    page.locator('[data-album-drop="warehouse"]'),
  );
  assert.equal(warehouseCount(await stored(), printIds.N), warehouseBefore + 1);
  assert.equal(await page.locator('.album-flight[data-kind="warehouse"]').count(), 1);
  const warehouseFlight = await page
    .locator('.album-flight[data-kind="warehouse"]')
    .evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation.pause();
      animation.currentTime = 220;
      return new DOMMatrixReadOnly(getComputedStyle(element).transform).a;
    });
  assert.ok(warehouseFlight > 0 && warehouseFlight < 1, 'Card shrinks toward the warehouse icon');
  await shot('warehouse-drop');
  await page
    .locator('.album-flight[data-kind="warehouse"]')
    .evaluate((element) => element.getAnimations()[0].finish());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await drag(
    page.locator(`.tray-card[data-rarity="${printIds.N}"]`),
    page.locator('[data-slot="3"]'),
  );
  assert.equal(await page.locator('.album-flight').count(), 0);
  const cancelBefore = await stored();
  const cancelStart = await center(page.locator('[data-slot="3"]'));
  await page.mouse.move(cancelStart.x, cancelStart.y);
  await page.mouse.down();
  await page.mouse.move(cancelStart.x + 25, cancelStart.y + 15);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await stored(), cancelBefore);
  assert.equal(await page.locator('.album-drag-ghost,.is-selected').count(), 0);
  checks.push(
    'insert/remove flights are visible; reduced motion and Escape cancel remain functional',
  );
  // Complete the actual tabletop → tray route through the existing card inspector.
  const trayBefore = trayCount(await stored());
  await page.locator('.mini-nav [data-page="open"]').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await idle();
  await page.locator('[data-action="organize-space"]').click();
  await page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
  );
  await page.locator('.object-pack').first().press('Enter');
  await page
    .waitForFunction(
      () =>
        document.querySelector('canvas').world3D.snapshot().cards.length === 4 &&
        document.querySelector('canvas').world3D.snapshot().animations.length === 0,
      null,
      { timeout: 10000 },
    )
    .catch(async (error) => {
      console.log(
        await page.evaluate(() => {
          const s = document.querySelector('canvas').world3D.snapshot();
          return {
            cards: s.cards.length,
            animations: s.animations,
            objects: s.objects.map((o) => o.kind),
            modal: document.querySelector('#overlay').textContent,
          };
        }),
      );
      await shot('table-debug');
      throw error;
    });
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  await page.locator('[data-route-all="collection"]').click();
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  await page.locator('.space-return').click();
  await page.locator('.tile-album').click();
  await idle();
  s = await stored();
  assert.equal(trayCount(s), trayBefore + 4);
  assert.equal(s.cardStacks.length, 0);
  assert.equal(cardCount(s), 54);
  checks.push('tabletop inspector sends cards into tray without occupying pockets');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify({ passed: true, checks, errors }, null, 2),
  );
  console.log(`收藏册与仓库通过：${checks.length} 组流程、100 页、桌面/触摸拖放、存档与库存守恒。`);
} finally {
  await browser.close();
}
