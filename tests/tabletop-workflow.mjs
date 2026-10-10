import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeItem, openPacks } from '../src/game/model.js';
import { volume, volumesOverlap } from '../src/scene/tabletop.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const state = freshState(),
  flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  yaw = 0.38;
const spots = [
  [-5, 0.904, -1],
  [-1, 0.804, -2],
  [3, 0.804, -2],
  [-3, 0.07, 3],
  [0, 0.07, 3],
  [3, 0.07, 3],
];
state.items.forEach((item, i) => {
  item.isNew = false;
  item.angle = 0;
  item.pose3d = {
    position: spots[i],
    quaternion: item.kind === 'pack' ? flat : [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  };
});
const stackPack = makeItem('pack');
state.items.push(stackPack);
const { stack } = openPacks(state, [stackPack.id], () => 0.9);
stack.pose3d.position = [-5, 0.064, 4];
await page.addInitScript((s) => {
  if (!localStorage.getItem('tabletop-fixture')) {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
    localStorage.setItem('tabletop-fixture', '1');
  }
}, state);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
const snapshot = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
const item = async (id) => (await snapshot()).objects.find((o) => o.id === id);
const point = async (id) =>
  page.evaluate((id) => {
    const w = document.querySelector('canvas').world3D,
      s = w.snapshot(),
      i = s.cards.findIndex((c) => c.stackId === id);
    return i >= 0 ? w.projectCard(i) : w.projectItem(id);
  }, id);
const hold = async (id, destination) => {
  const p = await point(id),
    target = await page.evaluate(
      (p) => document.querySelector('canvas').world3D.projectPoint(p),
      destination,
    );
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), p),
    id,
    'visible object must be pickable',
  );
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 16 });
  assert.ok((await snapshot()).held.includes(id));
};
const settle = async (id) =>
  page.waitForFunction(
    (id) => {
      const s = document.querySelector('canvas').world3D.snapshot(),
        o = [...s.objects, ...s.stacks].find((o) => o.id === id);
      return o?.sleeping;
    },
    id,
    { timeout: 12000 },
  );
const sameQuaternion = (a, b) =>
  assert.ok(Math.abs(a.reduce((v, n, i) => v + n * b[i], 0)) > 1 - 1e-8);
const result = { requirements: [] };
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  const initial = await saved(),
    pack = state.items[3],
    box = state.items[1];
  const p = await point(pack.id);
  await page.mouse.click(p.x, p.y);
  assert.deepEqual((await saved()).opened, initial.opened);
  assert.equal((await snapshot()).animations.length, 0);
  const before = await item(box.id);
  await hold(box.id, [1, before.position[1], 0]);
  sameQuaternion((await item(box.id)).quaternion, before.quaternion);
  assert.deepEqual((await saved()).opened, initial.opened);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual((await item(box.id)).position, before.position);
  sameQuaternion((await item(box.id)).quaternion, before.quaternion);
  result.requirements.push(
    'single click selects; hold preserves rotation and sealed state; Escape restores position',
  );

  await hold(pack.id, [before.position[0], 0.07, before.position[2]]);
  sameQuaternion((await item(pack.id)).quaternion, flat);
  await page.mouse.up();
  await settle(pack.id);
  const stacked = await item(pack.id),
    base = await item(box.id),
    a = volume(base.position, base.quaternion, (await snapshot()).sizes.box),
    b = volume(stacked.position, stacked.quaternion, (await snapshot()).sizes.pack);
  assert.ok(b.bounds.min.y > a.bounds.max.y - 0.008);
  assert.equal(volumesOverlap(a, b, 0.008), false);
  assert.ok(stacked.position[1] > 1.5);
  await page.screenshot({ path: 'test-results/tabletop-stacked.png' });
  result.requirements.push('pack rests on rotated box with distinct vertical volumes');

  const stackBefore = (await snapshot()).stacks.find((s) => s.id === stack.id);
  await hold(stack.id, [-3, stackBefore.position[1], 4]);
  sameQuaternion((await snapshot()).stacks.find((s) => s.id === stack.id).quaternion, flat);
  await page.mouse.up();
  await settle(stack.id);
  const movedStack = (await snapshot()).stacks.find((s) => s.id === stack.id);
  assert.equal(movedStack.count, 10);
  assert.ok(Math.abs(movedStack.position[0] - stackBefore.position[0]) > 1);
  assert.equal(await page.locator('.card-inspector').count(), 0);
  assert.equal((await saved()).cardStacks[0].cards.length, 10);
  await page.locator('.world-stack').press('Enter');
  assert.equal(await page.locator('.inspect-card').count(), 10);
  await page.keyboard.press('Escape');
  result.requirements.push('whole stack drags; click/Enter opens all ten cards');

  // Moving a support wakes the object above, which falls instead of remaining suspended.
  await hold(box.id, [1, base.position[1], -2]);
  await page.mouse.up();
  await settle(box.id);
  await settle(pack.id);
  assert.ok((await item(pack.id)).position[1] < 0.15);
  result.requirements.push('removing a support drops the upper object back to the desk');
  const carton = await item(state.items[0].id),
    upperBox = await item(state.items[2].id);
  await hold(upperBox.id, [carton.position[0], upperBox.position[1], carton.position[2]]);
  sameQuaternion((await item(upperBox.id)).quaternion, upperBox.quaternion);
  await page.mouse.up();
  await settle(upperBox.id);
  const boxOnCarton = await item(upperBox.id);
  assert.ok(boxOnCarton.position[1] > 2.4);
  assert.equal(
    volumesOverlap(
      volume(carton.position, carton.quaternion, (await snapshot()).sizes.case),
      volume(boxOnCarton.position, boxOnCarton.quaternion, (await snapshot()).sizes.box),
      0.008,
    ),
    false,
  );
  result.requirements.push('rotated box stacks on carton without penetrating its volume');
  const keyboardPack = await point(state.items[5].id),
    opened = (await saved()).opened.pack;
  await page.mouse.click(keyboardPack.x, keyboardPack.y);
  await page.keyboard.press('Enter');
  assert.equal((await saved()).opened.pack, opened + 1);
  await page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
  );
  result.requirements.push('Enter opens a mouse-selected package exactly once');
  const durable = await saved(),
    phone = (await snapshot()).phone.screen;
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), phone),
    'phone',
  );
  await page.mouse.click(phone.x, phone.y);
  assert.equal(await page.locator('body').getAttribute('data-page'), 'shop');
  await page.locator('.phone-apps [data-app="tao"]').click();
  await page.locator('.tao-product[data-kind="pack"]').click();
  await page.locator('[data-action="buy"]').click();
  await page.locator('[data-action="success-open"]').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  assert.equal((await saved()).items.length, durable.items.length + 1);
  assert.deepEqual((await saved()).cardStacks[0].pose3d, durable.cardStacks[0].pose3d);
  result.requirements.push(
    'actual phone screen navigates to shopping and purchase returns to desk with saved layout',
  );
  await page.locator('.space-return').click();
  await page.reload();
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  const restored = (await snapshot()).stacks.find((s) => s.id === stack.id);
  assert.deepEqual(restored.position, durable.cardStacks[0].pose3d.position);
  sameQuaternion(restored.quaternion, durable.cardStacks[0].pose3d.quaternion);
  assert.equal(restored.count, 10);
  await page.waitForFunction(() =>
    document
      .querySelector('canvas')
      .world3D.snapshot()
      .objects.every((o) => o.sleeping),
  );
  await page.setViewportSize({ width: 600, height: 800 });
  await page.screenshot({ path: 'test-results/tabletop-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/tabletop-final.png' });
  assert.deepEqual(errors, []);
  result.requirements.push('reload preserves stack pose and card count; narrow viewport fits');
  result.passed = true;
  result.errors = errors;
  await fs.writeFile('test-results/tabletop-workflow.json', JSON.stringify(result, null, 2));
  console.log('PASS: ' + result.requirements.join('; '));
} catch (error) {
  await fs.writeFile(
    'test-results/tabletop-failure.json',
    JSON.stringify(await snapshot(), null, 2),
  );
  await page.screenshot({ path: 'test-results/tabletop-failure.png' });
  throw error;
} finally {
  await browser.close();
}
