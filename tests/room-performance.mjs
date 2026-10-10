import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { makeItem, purchase, openBoxFully } from '../src/game/model.js';
import { SIZES, CARD_STEP } from '../src/scene/packing.js';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright');
const mode = process.env.YGO_PERF_VARIANT ?? process.argv[2] ?? 'current',
  output = process.env.YGO_PERF_OUTPUT ?? 'test-results/room-performance',
  browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1.5,
    }),
    state = freshState();
  state.settings.motion = false;
  state.settings.sound = false;
  purchase(state, 'box', 3);
  for (const box of state.items.filter((item) => item.kind === 'box'))
    openBoxFully(state, box.id, () => 0.9);
  state.cardStacks.forEach((stack, i) => {
    stack.pose3d.position = [(i - 2.5) * 1.1, 0.044 + (stack.cards.length * CARD_STEP) / 2, 5.8];
  });
  state.items = Array.from({ length: 64 }, () => makeItem('pack'));
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.YGO_PROFILE_BASELINE === '1') {
    const baseline = 'D:/Game-YGO-backups/20261010-room-sorting-performance';
    for (const name of ['world3d', 'packages3d']) {
      const body = await fs.readFile(`${baseline}/src/scene/${name}.js`, 'utf8');
      await page.route(`**/src/scene/${name}.js`, (route) =>
        route.fulfill({ contentType: 'application/javascript', body }),
      );
    }
  }
  await page.addInitScript(
    (s) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s)),
    state,
  );
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  await page.locator('[data-action="organize-space"]').click();
  await page.waitForTimeout(100);
  const sample = async (name, duration = 2400) =>
    page.evaluate(
      async ({ name, duration }) => {
        const canvas = document.querySelector('canvas'),
          api = canvas.world3D,
          base = api.snapshot(),
          times = [],
          start = performance.now();
        let previous = start,
          n = 0,
          writes = 0;
        const storageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (...args) {
          writes++;
          return storageSet.apply(this, args);
        };
        await new Promise((resolve) => {
          const tick = (now) => {
            times.push(now - previous);
            previous = now;
            n++;
            if (name === 'zoom')
              canvas.dispatchEvent(
                new WheelEvent('wheel', {
                  deltaY: n % 2 ? 6 : -6,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            if (now - start < duration) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        Storage.prototype.setItem = storageSet;
        const end = api.snapshot(),
          sorted = times.slice(3).sort((a, b) => a - b),
          elapsed = performance.now() - start;
        return {
          name,
          durationMs: Math.round(elapsed),
          rafFps: +((times.length / elapsed) * 1000).toFixed(1),
          renderedFps: +(
            ((end.performance.renders - base.performance.renders) / elapsed) *
            1000
          ).toFixed(1),
          worldTicks: end.performance.ticks - base.performance.ticks,
          p95FrameMs: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
          meanFrameMs: +(sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2),
          framesOver33ms: sorted.filter((t) => t > 33.4).length,
          renders: end.performance.renders - base.performance.renders,
          physicsSteps: end.performance.physicsSteps - base.performance.physicsSteps,
          storageWrites: writes,
          drawCalls: end.drawCalls,
          triangles: end.triangles,
          stats: end.performance,
        };
      },
      { name, duration },
    );
  const results = [await sample('idle', 700), await sample('zoom')];
  await page.locator('.object-pack').first().press('Shift+Enter');
  assert.ok(
    await page.evaluate(
      () => document.querySelector('canvas').world3D.snapshot().animations.length > 0,
    ),
  );
  results.push(await sample('opening', 3500));
  assert.deepEqual(errors, []);
  await fs.mkdir(output, { recursive: true });
  const report = { mode, viewport: '1920x1080', dpr: 1.5, results, errors };
  await fs.writeFile(`${output}/${mode}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      mode,
      errors,
      results: results.map(
        ({
          name,
          rafFps,
          renderedFps,
          worldTicks,
          p95FrameMs,
          meanFrameMs,
          framesOver33ms,
          renders,
          storageWrites,
          drawCalls,
          triangles,
          stats,
        }) => ({
          name,
          rafFps,
          renderedFps,
          worldTicks,
          p95FrameMs,
          meanFrameMs,
          framesOver33ms,
          renders,
          storageWrites,
          drawCalls,
          triangles,
          cpuFrameMs: stats.frameMs,
          quality: stats.quality,
        }),
      ),
    }),
  );
} finally {
  await browser.close();
}
