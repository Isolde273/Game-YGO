import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeItem, openItem, openPacks } from '../src/game/model.js';
import { volume, volumesOverlap } from '../src/scene/tabletop.js';
import { SIZES, CARD_SIZE, CARD_STEP } from '../src/scene/packing.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const errors = [],
  report = {};
const state = freshState();
state.settings.sound = false;
state.settings.motion = false;
openItem(state, state.items.find((i) => i.kind === 'case').id);
state.items.push(...Array.from({ length: 60 }, () => makeItem('pack')), makeItem('case'));
for (let i = 0; i < 3; i++)
  openPacks(
    state,
    state.items
      .filter((i) => i.kind === 'pack')
      .slice(0, 5)
      .map((i) => i.id),
    () => 0.9,
  );
const identities = (s) => ({
  items: s.items.map((i) => [i.id, i.kind, i.containerId ?? null, i.slotIndex ?? null]),
  containers: s.containers.map((c) => c.id),
  stacks: s.cardStacks.map((s) => [s.id, s.cards]),
  cards: s.cards,
  collection: s.collection,
  coins: s.coins,
  opened: s.opened,
  history: s.history,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  await page.addInitScript((s) => {
    if (!localStorage.getItem('organize-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('organize-fixture', '1');
    }
  }, state);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
    snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
  const enter = async () => {
    await page.locator('.tile-open').click();
    await page.waitForSelector('canvas[data-presented="true"]');
    await page.waitForFunction(
      () =>
        document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
    );
  };
  await page.goto('http://127.0.0.1:5173');
  await enter();
  const button = page.locator('[data-action="organize-space"]');
  await button.click();
  assert.equal(await page.locator('#toast').innerText(), '桌面已整理');
  let saved = await stored(),
    s = await snap();
  assert.deepEqual(identities(saved), identities(state));
  assert.ok(saved.items.every((i) => !i.isNew));
  assert.equal(s.objects.length, state.items.length);
  assert.ok(s.objects.filter((o) => !o.containerId).every((o) => o.sleeping && o.velocity === 0));
  const boxes = s.objects.map((o) => ({
    id: o.id,
    v: volume(o.position, o.quaternion, SIZES[o.kind]),
  }));
  for (const stack of s.stacks)
    boxes.push({
      id: stack.id,
      v: volume(stack.position, stack.quaternion, [
        CARD_SIZE[0],
        CARD_SIZE[1],
        Math.max(0.004, stack.count * CARD_STEP),
      ]),
    });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      assert.equal(volumesOverlap(boxes[i].v, boxes[j].v), false, `objects overlap ${i}, ${j}`);
  const obstacles = s.tabletop.obstacles.map((o) => volume(o.position, o.quaternion, o.size));
  for (const b of boxes) {
    assert.ok(
      b.v.bounds.min.x >= -s.tabletop.halfWidth &&
        b.v.bounds.max.x <= s.tabletop.halfWidth &&
        b.v.bounds.min.z >= -s.tabletop.halfDepth &&
        b.v.bounds.max.z <= s.tabletop.halfDepth,
    );
    if (!s.objects.find((o) => o.id === b.id)?.containerId)
      for (const o of obstacles)
        assert.equal(volumesOverlap(b.v, o), false, 'fixed prop or carton penetration');
  }
  const poses = () => ({
      items: saved.items.map((i) => [i.id, i.pose3d]),
      containers: saved.containers,
      stacks: saved.cardStacks.map((s) => [s.id, s.pose3d]),
    }),
    firstPoses = poses();
  await button.click();
  saved = await stored();
  assert.deepEqual(poses(), firstPoses);
  await page.waitForTimeout(100);
  const a = (await snap()).performance;
  await page.waitForTimeout(200);
  const b = (await snap()).performance;
  assert.equal(b.ticks, a.ticks);
  assert.equal(b.renders, a.renders);
  await fs.mkdir('test-results/room-organize', { recursive: true });
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .png()
    .toFile('test-results/room-organize/desktop.png');
  assert.equal(
    await page.locator('.desk-pile-tag,.desk-hover-info,.desk-status,.desk-phone-button').count(),
    0,
  );
  // Holding any pointer disables tidy, including blank/right-button gestures.
  await page.mouse.move(1000, 770);
  await page.mouse.down({ button: 'right' });
  assert.equal(await button.isDisabled(), true);
  await page.mouse.up({ button: 'right' });
  assert.equal(await button.isEnabled(), true);
  await page.locator('.world-stack').first().press('Enter');
  assert.equal(await button.isVisible(), false);
  await page.keyboard.press('Escape');
  await button.click();
  saved = await stored();
  assert.deepEqual(identities(saved), identities(state));
  await page.locator('.space-return').click();
  await page.reload();
  await enter();
  assert.deepEqual(identities(await stored()), identities(state));
  s = await snap();
  assert.equal(s.objects.length, state.items.length);
  assert.equal(s.stacks.length, 3);
  await button.click();
  saved = await stored();
  assert.deepEqual(poses(), firstPoses);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await button.click();
    const rects = await page
      .locator('.space-return,.space-organize,.space-coins')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { x: r.x, right: r.right, y: r.y, bottom: r.bottom };
        }),
      );
    assert.ok(rects.every((r) => r.x >= 0 && r.right <= width));
    assert.ok(rects[0].right < rects[1].x && rects[1].right < rects[2].x);
    report[width] = rects;
  }
  await sharp(await page.screenshot())
    .resize({ width: 360 })
    .png()
    .toFile('test-results/room-organize/narrow.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  const pack = s.objects.find((o) => o.kind === 'pack');
  await page.locator(`[data-item="${pack.id}"]`).press('Enter');
  assert.equal(await button.isDisabled(), true);
  await page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
  );
  await button.click();
  s = await snap();
  assert.equal(
    s.stacks.reduce((n, c) => n + c.count, 0),
    160,
  );
  assert.equal((await stored()).opened.pack, state.opened.pack + 1);
  assert.deepEqual(errors, []);
  report.passed = true;
  report.items = state.items.length;
  report.pendingCards = 150;
  report.errors = errors;
  await fs.writeFile('test-results/room-organize/report.json', JSON.stringify(report, null, 2));
  console.log(
    '整理验证通过：混合物品／箱内归属／150 张卡、无穿透、数量不变、连续点击、真空闲休眠、刷新恢复、拿取与拆封禁用、390/360px。',
  );
} finally {
  await browser.close();
}
