import { freshState } from './helpers/starter-state.mjs';
import { ROOM_PHI } from '../src/scene/room-view.js';
import { browserOptions, dragAlbumCard } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { warehouseCount, PRODUCTS } from '../src/game/model.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cardsPerPack = PRODUCTS.pack.count;
const state = freshState(),
  spots = [
    [-4, 0.902, -0.4],
    [0, 0.804, -2],
    [3, 0.804, -2],
    [-1, 0.068, 3],
    [1, 0.068, 3],
    [3, 0.068, 3],
  ];
state.items.forEach((item, i) => {
  item.isNew = false;
  item.angle = 0;
  item.pose3d = {
    position: spots[i],
    quaternion: item.kind === 'pack' ? [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1],
  };
});
state.spaceView = { orbit: { theta: 0.8, phi: 0.5, distance: 22 }, target: [2, 1, 3] };
state.items.forEach((i) => {
  if (i.pose3d) i.pose3d.position[1] = 0.044 + (i.pose3d.position[1] - 0.044) * 1.5;
});
await page.addInitScript((s) => {
  if (!localStorage.getItem('room-fixture')) {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
    localStorage.setItem('room-fixture', '1');
  }
}, state);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
const idle = () =>
  page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
  );
const sorting = () => page.waitForSelector('.card-inspector[data-phase="open"]');
const returned = () =>
  page.waitForFunction(() => !document.querySelector('.card-inspector,.inspect-transition-layer'));
const point = (id) =>
  page.evaluate((id) => document.querySelector('canvas').world3D.projectItem(id), id);
const click = async (id, options = { clickCount: 2 }) => {
  const p = await point(id);
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), p),
    id,
  );
  await page.mouse.click(p.x, p.y, options);
};
const dragCard = async (destination, index = null) => {
  const card =
      index === null
        ? page.locator('.inspect-card').last()
        : page.locator('.inspect-card').nth(index),
    box = await card.boundingBox(),
    target = await page.locator(`[data-destination="${destination}"]`).boundingBox();
  await page.mouse.move(box.x + (index === null ? box.width * 0.6 : 2), box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      !document.querySelector('.card-inspector') ||
      document.querySelector('.card-inspector').dataset.phase !== 'routing',
  );
};
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  const view = await snap();
  assert.equal(view.orbit.theta, 0);
  assert.equal(view.orbit.phi, ROOM_PHI);
  assert.deepEqual(view.target, [0, 0.04, 0]);
  // Open two packages and a box while all three actors are still running.
  await click(state.items[3].id);
  await click(state.items[4].id);
  await click(state.items[1].id);
  assert.equal((await snap()).animations.length, 3);
  await page.screenshot({ path: 'test-results/room-concurrent.png' });
  await idle();
  let s = await snap();
  assert.equal(s.stacks.length, 2);
  assert.equal(s.cards.length, cardsPerPack * 2);
  assert.ok(s.cards.every((c) => c.position[0] === 0 && c.position[1] === 0 && c.revealed));
  let saved = await stored();
  assert.equal(saved.cardStacks.length, 2);
  assert.equal(
    Object.values(saved.collection).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(saved.opened.pack, 2);
  await page.screenshot({ path: 'test-results/room-table-stacks.png' });
  // A table stack is directly clickable even with other sealed objects present.
  const stackPoint = await page.evaluate(
    (index) => document.querySelector('canvas').world3D.projectCard(index),
    cardsPerPack - 1,
  );
  assert.equal(
    await page.evaluate(
      (p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y),
      stackPoint,
    ),
    s.stacks[0].id,
  );
  await page.mouse.click(stackPoint.x, stackPoint.y);
  await page.waitForSelector('.card-inspector');
  assert.equal(await page.locator('.inspect-card').count(), cardsPerPack);
  await sorting();
  await page.screenshot({ path: 'test-results/room-inspector.png' });
  await dragCard('collection');
  assert.equal(await page.locator('.inspect-card').count(), cardsPerPack - 1);
  await dragCard('warehouse');
  assert.equal(await page.locator('.inspect-card').count(), cardsPerPack - 2);
  // Cancel a drag on blank space, then close and return to the same eight cards.
  const card = await page.locator('.inspect-card').last().boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(720, 130, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator('.inspect-card').count(), cardsPerPack - 2);
  await page.keyboard.press('Escape');
  await returned();
  assert.equal(await page.locator('.card-inspector').count(), 0);
  assert.equal((await snap()).stacks[0].count, cardsPerPack - 2);
  await page.locator('.world-stack').first().press('Enter');
  await page.locator('[data-route-all="collection"]').click();
  await returned();
  assert.equal(await page.locator('.card-inspector').count(), 0);
  await page.locator('.world-stack').first().press('Enter');
  await page.locator('[data-warehouse-picker]').click();
  await page.locator('[data-route-confirm="warehouse"]').click();
  await returned();
  saved = await stored();
  assert.equal(saved.cardStacks.length, 0);
  assert.equal(
    Object.values(saved.collection).reduce((a, b) => a + b, 0),
    cardsPerPack - 1,
  );
  assert.equal(
    Object.values(saved.cards).reduce((a, b) => a + b, 0),
    cardsPerPack * 2,
  );
  // Multiple selection and deterministic group movement.
  const packs = await page.evaluate(() => {
    const w = document.querySelector('canvas').world3D;
    return w
      .snapshot()
      .objects.filter((o) => o.kind === 'pack')
      .filter((o) => {
        const p = w.projectItem(o.id);
        return w.hitAt(p.x, p.y) === o.id;
      })
      .slice(0, 2);
  });
  assert.equal(packs.length, 2);
  await page.keyboard.down('Control');
  for (const p of packs) await click(p.id, { clickCount: 1 });
  await page.keyboard.up('Control');
  assert.equal((await snap()).selected.length, 2);
  const dragPoint = await point(packs[0].id),
    beforeMove = (await snap()).objects.filter((o) => packs.some((p) => p.id === o.id));
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 55, dragPoint.y + 25, { steps: 8 });
  await page.mouse.up();
  await idle();
  await page.waitForFunction(
    (ids) =>
      document
        .querySelector('canvas')
        .world3D.snapshot()
        .objects.filter((o) => ids.includes(o.id))
        .every((o) => o.sleeping),
    packs.map((p) => p.id),
  );
  const afterMove = (await snap()).objects.filter((o) => packs.some((p) => p.id === o.id));
  assert.ok(afterMove.every((o) => o.velocity === 0 && o.sleeping));
  assert.ok(afterMove.some((o, i) => Math.abs(o.position[0] - beforeMove[i].position[0]) > 0.1));
  await page.locator('.space-selection button').first().click();
  assert.equal((await snap()).animations.filter((a) => a.kind === 'pack').length, 2);
  await idle();
  // Fixed front camera ignores every drag gesture; only wheel changes distance.
  const fixed = await snap();
  for (const button of ['left', 'right', 'middle']) {
    await page.mouse.move(1100, 700);
    await page.mouse.down({ button });
    await page.mouse.move(1180, 740, { steps: 8 });
    await page.mouse.up({ button });
  }
  let fixedAfter = await snap();
  assert.deepEqual(fixedAfter.camera, fixed.camera);
  assert.deepEqual(fixedAfter.target, fixed.target);
  await page.mouse.wheel(0, -220);
  fixedAfter = await snap();
  assert.ok(fixedAfter.orbit.distance < fixed.orbit.distance);
  assert.equal(fixedAfter.orbit.theta, 0);
  assert.equal(fixedAfter.orbit.phi, ROOM_PHI);
  // Open carton, hover one box, then drag it out following the pointer without rotation.
  await click(state.items[0].id);
  await idle();
  const inside = (await snap()).objects.filter((o) => o.containerId);
  const visible = await page.evaluate(
    (ids) => {
      const w = document.querySelector('canvas').world3D;
      return ids
        .map((id) => ({ id, ...w.projectItem(id) }))
        .find((p) => w.hitAt(p.x, p.y) === p.id);
    },
    inside.map((o) => o.id),
  );
  assert.ok(visible);
  const boxBefore = (await snap()).objects.find((o) => o.id === visible.id);
  await page.mouse.move(visible.x, visible.y);
  await page.waitForTimeout(350);
  const hovered = (await snap()).objects.find((o) => o.id === visible.id);
  assert.ok(hovered.position[1] > boxBefore.position[1] + 0.2);
  assert.deepEqual(hovered.quaternion, boxBefore.quaternion);
  await page.screenshot({ path: 'test-results/room-hover-box.png' });
  const boxPoint = await point(visible.id);
  await page.mouse.move(boxPoint.x, boxPoint.y);
  await page.mouse.down();
  await page.mouse.move(boxPoint.x + 255, boxPoint.y + 210, { steps: 10 });
  await page.waitForTimeout(450);
  const extracting = (await snap()).animations.find((a) => a.kind === 'extract');
  assert.ok(extracting);
  assert.deepEqual(extracting.quaternion, boxBefore.quaternion);
  // Resolve a drop outside the carton in world space for the current overhead camera.
  const dropPoint = await page.evaluate((position) => {
    const w = document.querySelector('canvas').world3D;
    return w.projectPoint([
      position[0] + 14,
      position[1] + w.snapshot().sizes.box[1] / 2,
      position[2] + 4,
    ]);
  }, hovered.position);
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 12 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/room-extract-held.png' });
  await page.mouse.up();
  await idle();
  const placed = (await snap()).objects.find((o) => o.id === visible.id);
  assert.equal(placed.containerId, undefined);
  assert.ok(placed.velocity === 0 && placed.sleeping);
  assert.deepEqual(placed.quaternion, boxBefore.quaternion);
  assert.equal((await stored()).opened.box, 1);
  await page.waitForTimeout(1500);
  assert.deepEqual(
    (await snap()).objects.find((o) => o.id === visible.id).position,
    placed.position,
  );
  // Two boxes also open in parallel while existing card stacks remain on the table.
  await page.locator(`[data-item="${visible.id}"]`).press('Enter');
  await page.locator(`[data-item="${state.items[2].id}"]`).press('Enter');
  assert.equal((await snap()).animations.filter((a) => a.kind === 'box').length, 2);
  await idle();
  assert.equal((await stored()).opened.box, 3);
  // Unsorted stacks and selected destinations survive leaving, reload and a narrow layout.
  const pending = (await stored()).cardStacks;
  assert.equal(pending.length, 2);
  await page.locator('.space-return').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  await page.locator('.tile-album').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  assert.ok((await page.locator('.tray-card').count()) > 0);
  await dragAlbumCard(page, '.tray-card', '[data-slot="0"]');
  assert.equal(await page.locator('.album-slot.owned').count(), 1);
  await page.locator('[data-page="warehouse"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  assert.equal(warehouseCount(await stored()), cardsPerPack + 1);
  assert.ok((await page.locator('.warehouse-card').count()) > 0);
  await page.reload();
  await page.locator('[data-action="home"]').first().click();
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  assert.equal((await snap()).stacks.length, 2);
  assert.equal((await snap()).orbit.distance, fixedAfter.orbit.distance);
  await page.locator('.world-stack').first().press('Enter');
  await page.setViewportSize({ width: 600, height: 800 });
  await sorting();
  await page.screenshot({ path: 'test-results/room-inspector-narrow.png' });
  await dragCard('collection');
  assert.equal(await page.locator('.inspect-card').count(), cardsPerPack - 1);
  await page.keyboard.press('Escape');
  await returned();
  await page.setViewportSize({ width: 1440, height: 900 });
  const beforeBatchStacks = new Set((await snap()).stacks.map((s) => s.id));
  await page.locator('.object-pack').first().press('Shift+Enter');
  await page.waitForFunction(() =>
    document
      .querySelector('canvas')
      .world3D.snapshot()
      .animations.some((a) => a.kind === 'pack' && a.method === 'tear'),
  );
  assert.ok((await snap()).animations.every((a) => a.method !== 'scissors'));
  await page.screenshot({ path: 'test-results/room-five-tear.png' });
  await idle();
  assert.ok((await snap()).cards.every((c) => c.position[0] === 0 && c.position[1] === 0));
  const batchStacks = (await snap()).stacks.filter((s) => !beforeBatchStacks.has(s.id));
  assert.equal(
    batchStacks.reduce((count, stack) => count + stack.count, 0),
    cardsPerPack * 5,
  );
  const inspectedBatch = batchStacks.at(-1);
  await page.locator(`[data-stack="${inspectedBatch.id}"]`).press('Enter');
  await sorting();
  assert.equal(await page.locator('.inspect-card').count(), inspectedBatch.count);
  await page.screenshot({ path: 'test-results/room-fifty-inspector.png' });
  const middleId = await page.locator('.inspect-card').nth(3).getAttribute('data-card');
  await dragCard('collection', 3);
  assert.equal(await page.locator(`.inspect-card[data-card="${middleId}"]`).count(), 0);
  assert.equal(await page.locator('.inspect-card').count(), inspectedBatch.count - 1);
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/room-fifty-narrow.png' });
  await dragCard('warehouse');
  assert.equal(await page.locator('.inspect-card').count(), inspectedBatch.count - 2);
  await page.locator('[data-warehouse-picker]').click();
  await page.locator('[data-route-confirm="warehouse"]').click();
  // Leave while two pack actors are running; both results were committed once.
  await returned();
  const pendingBefore = (await stored()).cardStacks.length;
  await page.locator('.object-pack').first().press('Enter');
  await page.locator('.object-pack').first().press('Enter');
  assert.equal((await snap()).animations.filter((a) => a.kind === 'pack').length, 2);
  await page.locator('.space-return').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  const interrupted = await stored();
  assert.equal(interrupted.cardStacks.length, pendingBefore + 2);
  const total = Object.values(interrupted.cards).reduce((a, b) => a + b, 0);
  await page.reload();
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  assert.equal((await snap()).stacks.length, pendingBefore + 2);
  assert.equal(
    Object.values((await stored()).cards).reduce((a, b) => a + b, 0),
    total,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/room-workflow.json',
    JSON.stringify(
      {
        passed: true,
        requirements: [
          'concurrent packages and boxes',
          'multi-select group drag and open',
          'aligned persistent table stacks',
          'front inspector left fan',
          'individual and all routing',
          'hover lift',
          'fixed front zoom',
          'stable extraction',
          'destination and pending recovery',
          'narrow drag',
          'fifty-card inspector and underlying card drag',
          'parallel interruption recovery',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    '新开卡流程验证通过：并行拆封、多选拖动、桌面整叠、点击整理、单张与整叠分配、悬停抬盒、稳定拖出、固定正面缩放、存档与窄屏拖卡。',
  );
} catch (error) {
  await fs.writeFile(
    'test-results/room-failure.json',
    JSON.stringify(
      await page.evaluate(
        () =>
          document.querySelector('canvas')?.world3D.snapshot() ?? {
            page: document.body.dataset.page,
          },
      ),
      null,
      2,
    ),
  );
  await page.screenshot({ path: 'test-results/room-failure.png' });
  throw error;
} finally {
  await browser.close();
}
