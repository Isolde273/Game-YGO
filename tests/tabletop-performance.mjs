import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { makeItem, openPacks } from '../src/game/model.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const state = freshState();
state.items = Array.from({ length: 94 }, () => makeItem('pack'));
for (let i = 0; i < 6; i++) {
  const r = openPacks(
    state,
    state.items.slice(0, 5).map((p) => p.id),
    () => 0.9,
  );
  r.stack.pose3d.position = [(i - 2.5) * 1.3, 0.147, 4];
}
state.items.forEach((p, i) => {
  p.isNew = false;
  p.angle = 0;
  p.pose3d = {
    position: [((i % 8) - 3.5) * 1.7, 0.07, (Math.floor(i / 8) - 3.5) * 1.0],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  };
});
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (s) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s)),
    state,
  );
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForTimeout(2500);
  const result = await page.evaluate(async () => {
    const world = document.querySelector('canvas').world3D,
      times = [],
      initial = world.snapshot().performance;
    let prev = performance.now();
    const start = prev;
    await new Promise((resolve) => {
      function frame(now) {
        times.push(now - prev);
        prev = now;
        if (now - start > 4000) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    times.sort((a, b) => a - b);
    const s = world.snapshot();
    return {
      frames: times.length,
      medianFrameMs: times[Math.floor(times.length * 0.5)],
      p95FrameMs: times[Math.floor(times.length * 0.95)],
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      objects: s.objects.length,
      cards: s.cards.length,
      initial,
      final: s.performance,
    };
  });
  assert.equal(result.objects, 64);
  assert.equal(result.cards, 300);
  assert.ok(result.drawCalls < 200);
  assert.equal(result.final.matrixUpdates, result.initial.matrixUpdates);
  assert.equal(result.final.physicsSteps, result.initial.physicsSteps);
  assert.equal(result.final.renders, result.initial.renders);
  // Measure a live camera gesture too: idle suspension alone must not hide a heavy active renderer.
  const active = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas'),
      times = [];
    let previous = performance.now();
    for (let i = 0; i < 120; i++)
      await new Promise((resolve) =>
        requestAnimationFrame((now) => {
          times.push(now - previous);
          previous = now;
          canvas.dispatchEvent(
            new WheelEvent('wheel', { deltaY: i % 2 ? 3 : -3, bubbles: true, cancelable: true }),
          );
          resolve();
        }),
      );
    times.sort((a, b) => a - b);
    return {
      medianFrameMs: times[60],
      p95FrameMs: times[114],
      renders: canvas.world3D.snapshot().performance.renders,
    };
  });
  result.active = active;
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/tabletop-stress.png' });
  await fs.writeFile(
    'test-results/tabletop-performance-after.json',
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
