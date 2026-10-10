import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions } from './helpers/browser.mjs';
import { makeItem } from '../src/game/model.js';
import { openFixturePacks } from './helpers/sorting-stacks.mjs';

const output = 'test-results/room-sorting-performance-20261009';
await fs.mkdir(output, { recursive: true });
const state = freshState();
state.settings.motion = false;
state.settings.sound = false;
state.items = Array.from({ length: 8 }, () => makeItem('pack'));
openFixturePacks(
  state,
  state.items.slice(0, 5).map((item) => item.id),
  () => 0.999,
);
state.items.forEach((item, index) => {
  item.isNew = false;
  item.pose3d = {
    position: [-4 + index * 1.2, 0.09, -3],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  };
});
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/room-resource-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><link rel="stylesheet" href="/src/ui/styles/base.css"><link rel="stylesheet" href="/src/ui/styles/world3d.css"><link rel="stylesheet" href="/src/ui/styles/space.css"><main id="fixture" class="unboxing-space"></main>',
    }),
  );
  await page.goto('http://127.0.0.1:5173/room-resource-fixture.html');
  await page.evaluate(async (state) => {
    const { createWorld3D } = await import('/src/scene/world3d.js');
    const { createCardFinishes } = await import('/src/ui/card-finishes.js');
    window.resourceState = state;
    const host = document.querySelector('#fixture');
    window.resourceFinishes = createCardFinishes(host, () => state.settings);
    window.resourceWorld = createWorld3D(host, { state, save() {}, sound() {}, toast() {} });
  }, state);
  await page.waitForFunction(
    () =>
      document.querySelector('canvas[data-presented="true"]') &&
      window.resourceWorld.physics.bodies.every(
        (body) =>
          body.type !== body.constructor.DYNAMIC || body.sleepState === body.constructor.SLEEPING,
      ),
  );
  const before = await page.evaluate(async () => {
    const world = window.resourceWorld;
    const stack = world.tableStacks[0];
    window.retainedBody = stack.body;
    window.retainedTop = stack.visual.children[0];
    window.retainedCards = new Map(world.cards.map((card) => [card.id, card.mesh]));
    world.inspectStack(stack);
    await world.inspector.ready;
    await new Promise(requestAnimationFrame);
    return { ...world.stats };
  });
  // Remove exposed rear cards while the original top remains in place.
  for (let index = 0; index < 4; index++) {
    await page.locator('.inspect-card').first().press('Enter');
    await page.locator('[data-route-one="warehouse"]').click();
  }
  const hidden = await page.evaluate(async () => {
    const world = window.resourceWorld;
    const stack = world.tableStacks[0];
    await new Promise(requestAnimationFrame);
    const first = { ...world.stats };
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      ...world.stats,
      idleRenders: world.stats.renders - first.renders,
      idleTicks: world.stats.ticks - first.ticks,
      sameBody: stack.body === window.retainedBody,
      sameTop: stack.visual.children[0] === window.retainedTop,
      sameLogicalCards: world.cards.every(
        (card) => card.mesh === window.retainedCards.get(card.id),
      ),
      count: stack.data.cards.length,
      mass: stack.body.mass,
      halfExtents: stack.body.shapes[0].halfExtents.toArray(),
      expectedExtents: stack.size.map((value) => value / 2),
    };
  });
  assert.equal(hidden.renders, before.renders, 'covered room must not submit GPU frames');
  assert.equal(hidden.stackBodies, before.stackBodies, 'routing must reuse the collision body');
  assert.equal(hidden.count, 46);
  assert.ok(hidden.sameBody && hidden.sameTop && hidden.sameLogicalCards);
  assert.deepEqual(hidden.halfExtents, hidden.expectedExtents);
  assert.equal(hidden.mass, 46 * 0.002);
  assert.equal(hidden.idleRenders, 0);
  assert.equal(hidden.idleTicks, 0, 'pending room changes must not spin behind the inspector');
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 84 })
    .toFile(`${output}/sorting-resources.webp`);
  await page.locator('.inspect-card').first().press('Enter');
  await page.locator('.inspect-reorder').click();
  const reordered = await page.evaluate(() => {
    const world = window.resourceWorld;
    const stack = world.tableStacks[0];
    return {
      sameBody: stack.body === window.retainedBody,
      changedTop: stack.visual.children[0] !== window.retainedTop,
      count: stack.data.cards.length,
    };
  });
  assert.ok(reordered.sameBody && reordered.changedTop);
  assert.equal(reordered.count, 46);
  await page.locator('.inspect-return').click();
  await page.waitForFunction(
    () =>
      !document.querySelector('.card-inspector,.inspect-transition-layer') &&
      window.resourceWorld.stats.renders > 1,
  );
  const returned = await page.evaluate(async () => {
    const world = window.resourceWorld;
    await new Promise(requestAnimationFrame);
    return { ...world.snapshot(), frame: world.frame };
  });
  assert.ok(returned.performance.renders > hidden.renders);
  assert.equal(returned.stacks[0].count, 46);
  assert.ok(returned.stacks[0].visible && returned.stacks[0].sleeping);
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 84 })
    .toFile(`${output}/room-resources.webp`);
  const uploads = await page.evaluate(() => {
    const world = window.resourceWorld;
    const batch = world.batches[0];
    batch.records[1].body.position.x += 0.01;
    const changed = batch.update();
    const ranges = batch.meshes.map((mesh) =>
      mesh.instanceMatrix.updateRanges.map((range) => ({ ...range })),
    );
    const idle = batch.update();
    world.needsRender = true;
    return { changed, idle, ranges };
  });
  assert.ok(uploads.changed);
  assert.equal(uploads.idle, false);
  assert.ok(
    uploads.ranges.every(
      (ranges) => ranges.length === 1 && ranges[0].start === 16 && ranges[0].count === 16,
    ),
    JSON.stringify(uploads),
  );
  await page.evaluate(() => {
    window.resourceFinishes.dispose();
    window.resourceWorld.dispose();
  });
  await page.waitForTimeout(80);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/resources.json`,
    JSON.stringify(
      { before, hidden, reordered, returned: returned.performance, uploads, errors },
      null,
      2,
    ),
  );
  console.log(
    'Room resources passed: covered rendering and idle ticks stop; collision body, unchanged top and logical cards are retained; return restores latest stack; one-item instance upload is bounded.',
  );
} finally {
  await browser.close();
}
