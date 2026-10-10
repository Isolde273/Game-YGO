import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { makeItem } from '../src/game/model.js';
import { openFixturePacks as openPacks } from './helpers/sorting-stacks.mjs';
import { SIZES, CARD_STEP } from '../src/scene/packing.js';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1.5,
    }),
    state = freshState(),
    errors = [];
  state.settings.sound = false;
  state.items = Array.from({ length: 94 }, () => makeItem('pack'));
  for (let i = 0; i < 6; i++) {
    const result = openPacks(
      state,
      state.items.slice(0, 5).map((p) => p.id),
      () => 0.9,
    );
    result.stack.pose3d.position = [(i - 2.5) * 1.1, 0.084 + (50 * CARD_STEP) / 2, 1.35];
  }
  state.items.forEach((p, i) => {
    p.isNew = false;
    p.pose3d = {
      position: [
        ((i % 8) - 3.5) * 1.18,
        0.044 + SIZES.pack[2] / 2,
        (Math.floor(i / 8) - 3.5) * 2.12,
      ],
      quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    };
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (s) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s)),
    state,
  );
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  await page.locator('[data-action="organize-space"]').click();
  await page.waitForTimeout(400);
  const result = await page.evaluate(async () => {
    const api = document.querySelector('canvas').world3D,
      before = api.snapshot(),
      frames = [],
      cycles = [];
    let measuring = true,
      last = 0;
    const sample = (now) => {
      if (last) frames.push(now - last);
      last = now;
      if (measuring) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const until = (check) =>
      new Promise((resolve) => {
        const tick = () => (check() ? resolve() : requestAnimationFrame(tick));
        tick();
      });
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      document.querySelector('.world-stack').click();
      await until(() => document.querySelector('.card-inspector')?.dataset.phase === 'open');
      const entered = performance.now();
      document.querySelector('.inspect-return').click();
      await until(() => !document.querySelector('.card-inspector,.inspect-transition-layer'));
      cycles.push({
        enterMs: Math.round(entered - start),
        returnMs: Math.round(performance.now() - entered),
      });
    }
    measuring = false;
    const end = api.snapshot(),
      sorted = frames.slice(3).sort((a, b) => a - b);
    return {
      cycles,
      p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      framesOver33ms: sorted.filter((t) => t > 33.4).length,
      frames: sorted.length,
      renders: end.performance.renders - before.performance.renders,
      worldTicks: end.performance.ticks - before.performance.ticks,
      cards: end.cards.length,
      objects: end.objects.length,
      layers: document.querySelectorAll('.inspect-transition-layer').length,
    };
  });
  assert.equal(result.cards, 300);
  assert.equal(result.objects, 64);
  assert.equal(result.layers, 0);
  assert.deepEqual(errors, []);
  await fs.mkdir('test-results/inspector-transitions', { recursive: true });
  await fs.writeFile(
    'test-results/inspector-transitions/performance.json',
    JSON.stringify({ viewport: '1920x1080', dpr: 1.5, ...result, errors }, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
