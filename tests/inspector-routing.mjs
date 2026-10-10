import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import { makeItem, openPacks, warehouseCount, trayCount } from '../src/game/model.js';
import { CARD_STEP } from '../src/scene/packing.js';

const desktop = process.env.YGO_INSPECTOR_DESKTOP === '1';
const output = 'test-results/inspector-routing';
const prefix = desktop ? 'desktop' : 'browser';
await fs.mkdir(output, { recursive: true });
const state = freshState();
state.settings.sound = false;
state.items = Array.from({ length: 5 }, () => makeItem('pack'));
const { stack } = openPacks(
  state,
  state.items.map((item) => item.id),
);
stack.pose3d = {
  position: [0, 0.084 + (stack.cards.length * CARD_STEP) / 2, 1.35],
  quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
};
const initialWarehouse = warehouseCount(state);
const initialTray = trayCount(state);
const errors = [];
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
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900);
      window.show();
      window.focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  } else {
    application = await chromium.launch({ ...browserOptions, headless: true });
    page = await application.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((state) => {
    if (!localStorage.getItem('routing-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('routing-fixture', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  await page.locator('.world-stack').press('Enter');
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  await page.evaluate(async () => {
    window.routingRear = document.querySelector('.inspect-card:nth-last-child(2)');
    window.routingImage = window.routingRear.querySelector('img');
    window.routingRects = new Map(
      [...document.querySelectorAll('.inspect-card')].map((el) => {
        const rect = el.getBoundingClientRect();
        return [el.dataset.card, [rect.x, rect.y, rect.width, rect.height]];
      }),
    );
    await window.routingImage.decode();
  });
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  const pauseFlights = (selector) =>
    page.evaluate(async (selector) => {
      if (selector) document.querySelector(selector).click();
      window.routingTracks = document
        .getAnimations()
        .filter((animation) =>
          animation.effect?.target?.matches('.inspect-route-flight, .card-destination'),
        );
      window.routingTracks.forEach((animation) => animation.pause());
      await Promise.all(window.routingTracks.map((animation) => animation.ready));
      window.routingTracks.forEach((animation) => {
        const timing = animation.effect.getTiming();
        animation.currentTime = Number(timing.delay) + Number(timing.duration) * 0.5;
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, selector);
  const finishFlights = () =>
    page.evaluate(() => window.routingTracks.forEach((animation) => animation.finish()));
  const finishFirstFlight = () =>
    page.evaluate(async () => {
      const first = window.routingTracks.find((animation) =>
        animation.effect?.target?.matches('.inspect-route-flight'),
      );
      first.finish();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Number(getComputedStyle(first.effect.target).opacity);
    });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));

  const fixedPositions = () =>
    page.evaluate(() => {
      const deltas = [...document.querySelectorAll('.inspect-card')].map((el) => {
        const rect = el.getBoundingClientRect();
        const before = window.routingRects.get(el.dataset.card);
        return Math.max(
          ...[rect.x, rect.y, rect.width, rect.height].map((n, i) => Math.abs(n - before[i])),
        );
      });
      return Math.max(0, ...deltas);
    });
  await pauseFlights('[data-route-one="warehouse"]');
  await shot('single-middle');
  assert.equal(await page.locator('.card-inspector').evaluate((el) => el.inert), false);
  assert.ok((await fixedPositions()) < 0.5, 'remaining cards moved during the first flight');
  const singleFinishedOpacity = await finishFirstFlight();
  const rear = await page.locator('.inspect-card').first().boundingBox();
  const target = await page.locator('.destination-collection .destination-preview').boundingBox();
  await page.mouse.move(rear.x + 2, rear.y + rear.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await pauseFlights();
  assert.equal(await page.locator('.inspect-card').count(), stack.cards.length - 2);
  assert.equal(await page.locator('.inspect-route-flight').count(), 2);
  assert.equal(trayCount(await saved()), initialTray + 1);
  assert.ok((await fixedPositions()) < 0.5, 'remaining cards moved during overlapping flights');
  await page.locator('.inspect-card').last().press('ArrowLeft');
  const selectionDuringFlight = await page.evaluate(
    () => document.querySelector('.inspect-card.selected').dataset.card,
  );
  await shot('concurrent-flights');
  await finishFlights();
  await page.waitForFunction(() => !document.querySelector('.inspect-route-flight'));
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  assert.equal(
    await page.locator('.inspect-card.selected').getAttribute('data-card'),
    selectionDuringFlight,
  );
  const settledPositionDelta = await fixedPositions();
  assert.ok(settledPositionDelta < 0.5, 'remaining cards compacted after flights ended');
  const single = await page.evaluate(() => ({
    retainedCard: window.routingRear === document.querySelector('.inspect-card:last-child'),
    retainedImage: window.routingImage === document.querySelector('.inspect-card:last-child img'),
    decoded: window.routingImage.complete && window.routingImage.naturalWidth > 0,
    count: document.querySelectorAll('.inspect-card').length,
  }));
  assert.equal(warehouseCount(await saved()), initialWarehouse + 1);
  await page.locator('.inspect-card').last().press('ArrowLeft');
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.card),
    await page
      .locator('.inspect-card')
      .nth(stack.cards.length - 4)
      .getAttribute('data-card'),
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.card),
    await page.locator('.inspect-card').last().getAttribute('data-card'),
  );

  await pauseFlights('[data-route-one="warehouse"]');
  await pauseFlights('[data-route-one="warehouse"]');
  assert.equal(await page.locator('.inspect-route-flight').count(), 2);
  const reorderedId = await page.locator('.inspect-card').first().getAttribute('data-card');
  await page.locator('.inspect-card').first().press('Home');
  assert.equal(await page.locator('.inspect-card').last().getAttribute('data-card'), reorderedId);
  assert.equal(await page.locator('.inspect-route-flight').count(), 2);
  assert.equal(
    await page.evaluate(() =>
      window.routingTracks
        .filter((a) => a.effect.target.matches('.inspect-route-flight'))
        .every((a) => a.playState === 'paused'),
    ),
    true,
  );
  await page.locator('.inspect-return').click();
  await page.waitForFunction(
    () =>
      !document.querySelector('.card-inspector,.inspect-transition-layer,.inspect-route-flight'),
  );
  assert.equal((await saved()).cardStacks[0].cards.length, stack.cards.length - 4);
  assert.equal(warehouseCount(await saved()), initialWarehouse + 3);
  assert.equal(trayCount(await saved()), initialTray + 1);
  await page.locator('.world-stack').press('Enter');
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  assert.equal(await page.locator('.inspect-card').last().getAttribute('data-card'), reorderedId);

  await page.locator('[data-warehouse-picker]').click();
  await pauseFlights('[data-route-confirm="warehouse"]');
  const all = await page.evaluate(() => ({
    originals: document.querySelectorAll('.inspect-card').length,
    visibleOriginals: [...document.querySelectorAll('.inspect-card')].filter(
      (card) => getComputedStyle(card).visibility !== 'hidden',
    ).length,
    flights: document.querySelectorAll('.inspect-route-flight').length,
  }));
  await shot('all-middle');
  const allFinishedOpacity = await finishFirstFlight();
  await finishFlights();
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  assert.equal((await saved()).cardStacks.length, 0);
  assert.equal(warehouseCount(await saved()), initialWarehouse + stack.cards.length - 1);
  assert.equal(trayCount(await saved()), initialTray + 1);
  assert.equal(await page.locator('.world-stack').count(), 0);
  await page.reload();
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  assert.equal(await page.locator('.world-stack').count(), 0);
  assert.equal(warehouseCount(await saved()), initialWarehouse + stack.cards.length - 1);
  const report = {
    single,
    all,
    singleFinishedOpacity,
    allFinishedOpacity,
    settledPositionDelta,
    concurrentDrag: true,
    preservedSelection: true,
    concurrentReorderAndClose: true,
    errors,
  };
  await fs.writeFile(`${output}/${prefix}-report.json`, JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(
    single.retainedCard && single.retainedImage && single.decoded,
    `single route replaced the decoded rear card: ${JSON.stringify(single)}`,
  );
  assert.equal(single.count, stack.cards.length - 2);
  assert.equal(all.visibleOriginals, 0, `routed cards remain visible: ${JSON.stringify(all)}`);
  assert.equal(all.originals, 0);
  assert.ok(all.flights > 0 && all.flights <= 8);
  assert.ok(
    singleFinishedOpacity < 0.001,
    'finished single flight flashed at its starting position',
  );
  assert.ok(
    allFinishedOpacity < 0.001,
    'finished staggered flight reappeared behind remaining flights',
  );
  console.log(
    `Inspector ${prefix} routing passed: fixed remaining slots, concurrent drag/selection, retained surfaces, no bulk ghosts, totals and reload.`,
  );
} finally {
  await application?.close();
}
