import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';
import { makeItem } from '../src/game/model.js';
import { openFixturePacks } from './helpers/sorting-stacks.mjs';

const output = process.env.YGO_PERF_OUTPUT ?? 'test-results/direct-opening-storage-20261009';
await fs.mkdir(output, { recursive: true });
const state = freshState();
state.settings.sound = false;
state.settings.motion = false;
state.items = Array.from({ length: 5 }, () => makeItem('pack'));
openFixturePacks(
  state,
  state.items.map((item) => item.id),
  () => 0.999,
);
const errors = [];
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  if (process.env.YGO_PERF_BASELINE === '1') {
    const baselineRoot =
      process.env.YGO_PERF_BASELINE_ROOT ?? 'D:/Game-YGO-backups/20261009-direct-opening-storage';
    for (const module of ['card-finishes', 'card-inspector', 'card-finish-batch']) {
      const body = await fs
        .readFile(`${baselineRoot}/src/ui/${module}.js`, 'utf8')
        .catch((error) => {
          if (module === 'card-finish-batch' && error.code === 'ENOENT') return null;
          throw error;
        });
      if (!body) continue;
      await page.route(`**/src/ui/${module}.js`, (route) =>
        route.fulfill({ contentType: 'application/javascript', body }),
      );
    }
  }
  await page.route('**/sorting-performance.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><link rel="stylesheet" href="/src/ui/styles/base.css"><link rel="stylesheet" href="/src/ui/styles/world3d.css"><link rel="stylesheet" href="/src/ui/styles/space.css"><main id="fixture" class="unboxing-space" style="height:100vh"></main>',
    }),
  );
  await page.goto('http://127.0.0.1:5173/sorting-performance.html');
  await page.evaluate(async (state) => {
    const { createCardInspector } = await import('/src/ui/card-inspector.js');
    const { createCardFinishes } = await import('/src/ui/card-finishes.js');
    const host = document.querySelector('#fixture');
    window.perfFinishes = createCardFinishes(host, () => state.settings);
    window.perfInspector = createCardInspector(host, state, state.cardStacks[0], {
      save() {},
      sound() {},
      onRoute() {},
      onClose() {},
    });
    await window.perfInspector.ready;
  }, state);
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.inspect-card .card-finish-canvas[data-ready="true"]').length ===
      50,
  );
  const card = page.locator('.inspect-card').last();
  await page.evaluate(() => {
    const measure = Element.prototype.getBoundingClientRect;
    window.perfCardBounds = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.inspect-card')) window.perfCardBounds++;
      return measure.call(this);
    };
  });
  const rect = await card.boundingBox();
  const hover = await page.evaluate(async () => {
    const card = document.querySelector('.inspect-card:last-child');
    const rect = card.getBoundingClientRect();
    const before = window.perfFinishes.stats();
    const intervals = [];
    let previous = performance.now();
    for (let i = 0; i < 25; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
      card.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: rect.x + rect.width * (0.25 + (i % 3) * 0.2),
          clientY: rect.y + rect.height * 0.4,
        }),
      );
    }
    const after = window.perfFinishes.stats();
    return {
      mean: intervals.slice(3).reduce((a, b) => a + b, 0) / (intervals.length - 3),
      draws: after.draws - before.draws,
      pixels: after.pixels - before.pixels,
      copies:
        after.copies === undefined ? after.draws - before.draws : after.copies - before.copies,
      submissions:
        after.submissions === undefined
          ? after.draws - before.draws
          : after.submissions - before.submissions,
    };
  });
  const retainedStrip = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const card = document.querySelector('.inspect-card');
    const canvas = card.querySelector('canvas');
    const sample = () =>
      Array.from(canvas.getContext('2d').getImageData(1, 2, 3, canvas.height - 4).data);
    const cropped = sample();
    window.perfCropped = canvas.toDataURL();
    await window.perfFinishes.prepare(card);
    const full = sample();
    window.perfFull = canvas.toDataURL();
    return Math.max(...cropped.map((value, index) => Math.abs(value - full[index])));
  });
  if (retainedStrip > 2) {
    for (const [name, key] of [
      ['crop', 'perfCropped'],
      ['full', 'perfFull'],
    ]) {
      const data = await page.evaluate((key) => window[key], key);
      await fs.writeFile(
        `test-results/room-sorting-performance-20261009/atlas-${name}.png`,
        Buffer.from(data.split(',')[1], 'base64'),
      );
    }
  }
  assert.ok(retainedStrip <= 2, `cropped finish differs from full rendering by ${retainedStrip}`);
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  await page.waitForTimeout(150);
  await page.mouse.down();
  const result = await page.evaluate(async () => {
    const card = document.querySelector('.inspect-card:last-child');
    const rect = card.getBoundingClientRect();
    const before = window.perfFinishes.stats();
    const samples = [];
    const boundsBefore = window.perfCardBounds;
    let previous = performance.now();
    for (let i = 0; i < 90; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      samples.push(now - previous);
      previous = now;
      card.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: rect.x + rect.width / 2 + Math.sin(i / 7) * 100,
          clientY: rect.y + rect.height / 2 + Math.cos(i / 7) * 65,
        }),
      );
    }
    const after = window.perfFinishes.stats();
    const sorted = samples.slice(5).sort((a, b) => a - b);
    return {
      frames: sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      draws: after.draws - before.draws,
      cardBoundsReads: window.perfCardBounds - boundsBefore,
      before,
      after,
    };
  });
  await page.evaluate(() => window.perfInspector.escape());
  await page.mouse.up();
  const variant = process.env.YGO_PERF_VARIANT ?? 'current';
  await fs.writeFile(
    `${output}/drag-${variant}.json`,
    JSON.stringify({ ...result, hover, retainedStrip, errors }, null, 2),
  );
  assert.deepEqual(errors, []);
  assert.ok(result.draws > 10, 'moving foil must stay live');
  console.log(
    JSON.stringify({
      variant,
      frames: result.frames,
      p50: result.p50,
      p95: result.p95,
      mean: result.mean,
      draws: result.draws,
      pixels: result.after.pixels,
      hover,
    }),
  );
} finally {
  await browser.close();
}
