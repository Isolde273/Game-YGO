import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeItem } from '../src/game/model.js';
import { PACK_STEP, SIZES } from '../src/scene/packing.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  state = freshState(),
  yaw = 0.2,
  flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const spots = [
  [-3.8, 0.904, -1.2],
  [1, 0.804, -1.2],
  [4, 0.804, -1.2],
  [-2, 0.07, 3],
  [0, 0.07, 3],
  [2, 0.07, 3],
];
state.items.forEach((item, i) => {
  item.isNew = false;
  item.angle = 0;
  item.pose3d = {
    position: spots[i],
    quaternion: item.kind === 'pack' ? flat : [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  };
});
state.items.forEach((i) => (i.pose3d.position[1] = 0.044 + (i.pose3d.position[1] - 0.044) * 1.5));
await page.addInitScript((s) => {
  if (!localStorage.getItem('inplace-fixture')) {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
    localStorage.setItem('inplace-fixture', '1');
  }
}, state);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
const snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
const point = (id) =>
  page.evaluate((id) => document.querySelector('canvas').world3D.projectItem(id), id);
const close = (a, b, epsilon = 1e-5) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} should equal ${b}`);
const open = async (id) => {
  const p = await point(id);
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), p),
    id,
  );
  await page.mouse.dblclick(p.x, p.y);
};
const wait = () =>
  page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
  );
const onPad = (stack) => {
  assert.ok(
    stack.position[0] >= -2.9 &&
      stack.position[0] <= 2.9 &&
      stack.position[2] >= -0.55 &&
      stack.position[2] <= 3.25 &&
      stack.position[1] >= 0.084,
  );
};
const stationary = async (id, position, quaternion) => {
  const observations = await page.evaluate(async (id) => {
    const w = document.querySelector('canvas').world3D,
      seen = [];
    while (true) {
      const a = w.snapshot().animations.find((a) => a.id === id);
      if (!a) break;
      seen.push({ position: a.position, quaternion: a.quaternion });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return seen;
  }, id);
  assert.ok(observations.length > 2);
  for (const o of observations) {
    o.position.forEach((n, i) => close(n, position[i]));
    o.quaternion.forEach((n, i) => close(n, quaternion[i]));
  }
  return observations.length;
};
const result = { requirements: [], samples: 0 };
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  const carton = (await snap()).objects.find((o) => o.kind === 'case');
  await open(carton.id);
  result.samples += await stationary(carton.id, carton.position, carton.quaternion);
  let s = await snap();
  const container = s.containers[0];
  container.position.forEach((n, i) => close(n, carton.position[i]));
  const visible = await page.evaluate(() => {
    const w = document.querySelector('canvas').world3D;
    return w
      .snapshot()
      .objects.filter((o) => o.containerId)
      .map((o) => {
        const p = w.projectItem(o.id);
        return { id: o.id, slot: o.slotIndex, x: p.x, y: p.y, hit: w.hitAt(p.x, p.y) };
      });
  });
  assert.equal(visible.length, 12);
  assert.ok(
    visible.every((o) => o.hit === o.id),
    JSON.stringify(visible),
  );
  await page.mouse.move(1300, 800);
  await page.screenshot({ path: 'test-results/inplace-carton-all12.png' });
  result.requirements.push('stationary carton; all twelve boxes visible and directly pickable');
  const box = s.objects.find((o) => o.id === state.items[1].id),
    beforeItems = new Set((await save()).items.map((i) => i.id));
  await open(box.id);
  result.samples += await stationary(box.id, box.position, box.quaternion);
  s = await snap();
  const packs = s.objects
    .filter((o) => o.kind === 'pack' && !beforeItems.has(o.id))
    .sort((a, b) => a.position[1] - b.position[1]);
  assert.equal(packs.length, 10);
  packs.forEach((p, i) => {
    close(p.position[0], box.position[0]);
    close(p.position[2], box.position[2]);
    if (i) close(p.position[1] - packs[i - 1].position[1], PACK_STEP);
  });
  assert.equal(await page.locator('.desk-pile-tag').count(), 0);
  await page.screenshot({ path: 'test-results/inplace-ten-pack-stack.png' });
  result.requirements.push(
    'stationary box; ten packs stacked at its original X/Z with real thickness',
  );
  const upper = packs.at(-1);
  await open(upper.id);
  result.samples += await stationary(upper.id, upper.position, upper.quaternion);
  const ten = (await snap()).stacks.find((s) => s.count === 10);
  assert.ok(ten);
  onPad(ten);
  assert.equal((await save()).opened.pack, 1);
  result.requirements.push('stationary single pack; ten cards finish on the white pad');
  // Clear the produced cards, then cut the upper five packs in the same pile.
  await page.locator(`[data-stack="${ten.id}"]`).press('Enter');
  await page.locator('[data-warehouse-picker]').click();
  await page.locator('[data-route-confirm="warehouse"]').click();
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  const remaining = (await snap()).objects
    .filter((o) => packs.some((p) => p.id === o.id))
    .sort((a, b) => b.position[1] - a.position[1]);
  const p = await point(remaining[0].id);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.locator('.pack-actions [data-count="5"]').click();
  await wait();
  const fifty = (await snap()).stacks.find((s) => s.count === 50);
  assert.ok(fifty);
  onPad(fifty);
  await page.screenshot({ path: 'test-results/inplace-fifty-stack.png' });
  result.requirements.push('stationary five-pack scissors produces fifty cards on the white pad');
  // Interrupt a second box opening: its already committed pile must restore at the original location.
  const other = (await snap()).objects.find((o) => o.id === state.items[2].id);
  await open(other.id);
  const committed = await save(),
    newPacks = committed.items.filter(
      (i) => i.kind === 'pack' && Math.abs(i.pose3d?.position[0] - other.position[0]) < 0.001,
    );
  assert.equal(newPacks.length, 10);
  await page.locator('.space-return').click();
  await page.reload();
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  const restored = (await snap()).objects.filter((o) => newPacks.some((p) => p.id === o.id));
  assert.equal(restored.length, 10);
  restored.forEach((o) => {
    close(o.position[0], other.position[0]);
    close(o.position[2], other.position[2]);
  });
  assert.equal((await save()).opened.box, 2);
  assert.equal((await snap()).stacks.find((s) => s.id === fifty.id).count, 50);
  result.requirements.push(
    'interrupted opening and reload preserve exact pile position and counts',
  );
  await page.mouse.move(1320, 800);
  await page.screenshot({ path: 'test-results/inplace-final-desktop.png' });
  assert.equal(await page.locator('.desk-status,.desk-hover-info,.desk-phone-button').count(), 0);
  assert.equal(
    (await page.locator('.desk-help').innerText()).replace(/\s+/g, ' ').trim(),
    '双击 拆封 右键 批量操作卡包和卡堆 滚轮 缩放',
  );
  await page.setViewportSize({ width: 600, height: 800 });
  await page.screenshot({ path: 'test-results/inplace-final-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  result.requirements.push('floating labels are absent and top operation hints remain responsive');
  const scattered = freshState();
  scattered.items = Array.from({ length: 5 }, (_, i) => {
    const item = makeItem('pack');
    item.isNew = false;
    item.pose3d = { position: [(i - 2) * 1.6, 0.044 + SIZES.pack[2] / 2, 1], quaternion: flat };
    return item;
  });
  await page.locator('.space-return').click();
  await page.addInitScript((s) => {
    if (!localStorage.getItem('scattered-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('scattered-fixture', '1');
    }
  }, scattered);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  await page.locator('.object-pack').first().press('Shift+Enter');
  assert.equal((await snap()).animations.length, 5);
  const actors = (await snap()).animations;
  actors.forEach((a) => {
    const origin = scattered.items.find((i) => i.id === a.id).pose3d;
    a.position.forEach((n, i) => close(n, origin.position[i]));
  });
  await wait();
  const split = (await snap()).stacks;
  assert.equal(split.length, 5);
  assert.ok(split.every((s) => s.count === 10));
  split.forEach(onPad);
  assert.equal((await save()).opened.pack, 5);
  result.requirements.push(
    'five scattered packages stay separate and produce five separate stacks on the white pad',
  );
  assert.deepEqual(errors, []);
  result.passed = true;
  result.visible = visible;
  result.errors = errors;
  await fs.writeFile('test-results/inplace-opening.json', JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      requirements: result.requirements,
      samples: result.samples,
      visibleBoxes: visible.length,
      errors,
    }),
  );
} catch (error) {
  await fs.writeFile('test-results/inplace-failure.json', JSON.stringify(await snap(), null, 2));
  await page.screenshot({ path: 'test-results/inplace-failure.png' });
  throw error;
} finally {
  await browser.close();
}
