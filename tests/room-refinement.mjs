import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeItem, openItem, openPacks } from '../src/game/model.js';
import { MODEL_SCALE, SIZES, CARD_SIZE, CARD_STEP } from '../src/scene/packing.js';
import { CARD_PAD_QUATERNION } from '../src/scene/card-pad.js';
import { volume, volumesOverlap } from '../src/scene/tabletop.js';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  sharp = require('sharp');
const browser = await chromium.launch({ ...browserOptions, headless: true }),
  errors = [],
  report = {};
try {
  const state = freshState();
  state.settings.motion = false;
  state.settings.sound = false;
  state.items.push(...Array.from({ length: 5 }, () => makeItem('pack')));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  await page.addInitScript((s) => {
    if (!localStorage.getItem('refinement-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('refinement-fixture', '1');
    }
  }, state);
  const snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot()),
    stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
    enter = async () => {
      await page.locator('.tile-open').click();
      await page.waitForSelector('canvas[data-presented="true"]');
      await page.waitForFunction(
        () =>
          document.querySelector('#page-transition').hidden &&
          !document.querySelector('#app').inert,
      );
    },
    idle = () =>
      page.waitForFunction(
        () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
      );
  await page.goto('http://127.0.0.1:5173');
  await enter();
  await page.locator('[data-action="organize-space"]').click();
  assert.equal(await page.locator('#toast').innerText(), '桌面已整理');
  const ui = async () => {
    assert.equal(
      await page.locator('.desk-status,.desk-pile-tag,.desk-hover-info,.desk-phone-button').count(),
      0,
    );
    assert.equal(
      (await page.locator('.desk-help').innerText()).replace(/\s+/g, ' ').trim(),
      '双击 拆封 右键 批量操作卡包和卡堆 滚轮 缩放',
    );
    const h = await page.locator('.desk-help').boundingBox();
    assert.ok(h.y < 120);
  };
  await ui();
  assert.deepEqual((await snap()).sizes, SIZES);
  const geometry = await page.evaluate(async () => {
    const T = await import('./src/vendor/three.module.js'),
      { createPackageLibrary } = await import('./src/scene/packages3d.js'),
      library = await createPackageLibrary();
    const dimensions = {};
    for (const kind of ['case', 'box', 'pack'])
      dimensions[kind] = new T.Box3()
        .setFromObject(library.create(kind))
        .getSize(new T.Vector3())
        .toArray();
    dimensions.card = new T.Box3()
      .setFromObject(library.createCard('PSER'))
      .getSize(new T.Vector3())
      .toArray();
    library.dispose();
    return dimensions;
  });
  for (const kind of ['case', 'box', 'pack'])
    for (let i = 0; i < 2; i++) assert.ok(Math.abs(geometry[kind][i] - SIZES[kind][i]) < 0.006);
  assert.ok(
    Math.abs(geometry.card[0] - CARD_SIZE[0]) < 0.001 &&
      Math.abs(geometry.card[1] - CARD_SIZE[1]) < 0.001,
  );
  report.dimensions = geometry;
  const point = await page.evaluate(() => {
    const w = document.querySelector('canvas').world3D;
    return w
      .snapshot()
      .objects.filter((o) => o.kind === 'pack')
      .map((o) => ({ id: o.id, ...w.projectItem(o.id) }))
      .find((p) => w.hitAt(p.x, p.y) === p.id);
  });
  assert.ok(point);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.locator('.space-selection>span').count(), 0);
  assert.ok(await page.locator('.desk-help').isVisible());
  await ui();
  await page.keyboard.press('Escape');
  await page.locator('.object-pack').first().press('Enter');
  await idle();
  await page.locator('.object-pack').first().press('Shift+Enter');
  await idle();
  let s = await snap();
  assert.equal(s.cards.length, 60);
  assert.equal(
    s.stacks.reduce((n, c) => n + c.count, 0),
    60,
  );
  const boxes = s.stacks.map((c) =>
      volume(c.position, c.quaternion, [CARD_SIZE[0], CARD_SIZE[1], c.count * CARD_STEP]),
    ),
    pad = s.tabletop.cardPad;
  for (const b of boxes)
    assert.ok(
      b.bounds.min.x >= pad.x0 &&
        b.bounds.max.x <= pad.x1 &&
        b.bounds.min.z >= pad.z0 &&
        b.bounds.max.z <= pad.z1 &&
        b.bounds.min.y >= pad.top,
    );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      assert.equal(volumesOverlap(boxes[i], boxes[j]), false);
  const pose = await stored();
  await page.locator('[data-action="organize-space"]').click();
  await ui();
  await fs.mkdir('test-results/room-refinement', { recursive: true });
  await page.waitForTimeout(200);
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 82 })
    .toFile('test-results/room-refinement/desktop.webp');
  const phone = (await snap()).phone.screen;
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), phone),
    'phone',
  );
  await page.mouse.click(phone.x, phone.y);
  await page.waitForFunction(
    () =>
      document.body.dataset.page === 'shop' && document.querySelector('#page-transition').hidden,
  );
  await page.locator('[data-action="home"]').first().click();
  await enter();
  assert.equal((await snap()).cards.length, 60);
  assert.equal((await stored()).coins, pose.coins);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await ui();
    const rects = await page
      .locator('.space-return,.space-organize,.space-coins,.desk-help')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      );
    assert.ok(rects.every((r) => r.left >= 0 && r.right <= width));
    report[width] = rects;
  }
  await sharp(await page.screenshot())
    .webp({ quality: 82 })
    .toFile('test-results/room-refinement/narrow.webp');
  await page.locator('.space-return').click();
  await page.reload();
  await enter();
  assert.equal((await snap()).cards.length, 60);
  await ui();
  // A save created before the size change keeps ownership and migrates only once.
  const old = freshState();
  delete old.spaceModelScale;
  old.settings.motion = false;
  old.settings.sound = false;
  old.items.push(...Array.from({ length: 5 }, () => makeItem('pack')));
  openItem(old, old.items.find((i) => i.kind === 'case').id);
  openPacks(
    old,
    old.items
      .filter((i) => i.kind === 'pack')
      .slice(0, 5)
      .map((i) => i.id),
    () => 0.9,
  );
  old.items.forEach((i) => (i.isNew = false));
  old.containers.forEach((c) => (c.pose3d.position = [0, 0.902, 0.5]));
  old.cardStacks.forEach(
    (c) => (c.pose3d.position = [0, 0.044 + (c.cards.length * 0.0041) / 2, 3]),
  );
  const legacy = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  legacy.on('pageerror', (e) => errors.push(e.message));
  await legacy.addInitScript((s) => {
    if (!localStorage.getItem('legacy-size-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('legacy-size-fixture', '1');
    }
  }, old);
  await legacy.goto('http://127.0.0.1:5173');
  await legacy.locator('.tile-open').click();
  await legacy.waitForSelector('canvas[data-presented="true"]');
  await legacy.waitForFunction(() => document.querySelector('#page-transition').hidden);
  const migrated = await legacy.evaluate(() =>
    JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
  );
  assert.equal(migrated.spaceModelScale, MODEL_SCALE);
  assert.deepEqual(
    migrated.items.map((i) => i.id),
    old.items.map((i) => i.id),
  );
  assert.deepEqual(
    migrated.cardStacks.map((c) => c.cards),
    old.cardStacks.map((c) => c.cards),
  );
  assert.equal(migrated.containers.length, 1);
  await legacy.locator('.space-return').click();
  await legacy.reload();
  await legacy.locator('.tile-open').click();
  await legacy.waitForSelector('canvas[data-presented="true"]');
  const again = await legacy.evaluate(() =>
    JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
  );
  assert.deepEqual(again.containers, migrated.containers);
  assert.deepEqual(again.cardStacks, migrated.cardStacks);
  assert.deepEqual(errors, []);
  report.passed = true;
  report.pendingCards = 60;
  report.errors = errors;
  await fs.writeFile('test-results/room-refinement/report.json', JSON.stringify(report, null, 2));
  console.log(
    '开卡空间调整验证通过：1.5 倍模型与碰撞、白色卡垫与单包/五包落卡、整理分区、浮层移除、顶部操作提示、手机点击、窄屏、旧存档单次迁移。',
  );
} finally {
  await browser.close();
}
