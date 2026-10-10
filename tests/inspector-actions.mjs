import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeItem } from '../src/game/model.js';
import { openFixturePacks as openPacks, fixturePrintId } from './helpers/sorting-stacks.mjs';
import { CARD_STEP } from '../src/scene/packing.js';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  sharp = require('sharp');
const output = 'test-results/inspector-actions';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    state = freshState(),
    errors = [],
    report = { checks: [] };
  state.settings.sound = false;
  state.items = Array.from({ length: 5 }, () => makeItem('pack'));
  let i = 0;
  const result = openPacks(
    state,
    state.items.map((c) => c.id),
    () => [0, 0.6, 0.9, 0.97, 0.999][i++ % 5],
  );
  result.stack.pose3d = {
    position: [0, 0.084 + (50 * CARD_STEP) / 2, 1.35],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  };
  await page.addInitScript((s) => {
    if (!localStorage.getItem('actions-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('actions-fixture', '1');
    }
  }, state);
  page.on('pageerror', (e) => errors.push(e.message));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const enter = async () => {
    await page.locator('.tile-open').click();
    await page.waitForSelector('canvas[data-presented="true"]');
    await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  };
  const inspect = async () => {
    await page.locator('.world-stack').press('Enter');
    await page.waitForSelector('.card-inspector[data-phase="open"]');
  };
  const returned = () =>
    page.waitForFunction(
      () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
    );
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(`${output}/${name}.webp`);
  await page.goto('http://127.0.0.1:5173');
  await enter();
  await inspect();
  const before = (await saved()).cardStacks[0].cards.map((c) => c.id),
    first = page.locator('.inspect-card').first(),
    back = await first.boundingBox(),
    front = await page.locator('.inspect-card').last().boundingBox();
  await page.mouse.move(back.x + 2, back.y + back.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(front.x + front.width * 0.5, front.y + front.height * 0.45, { steps: 12 });
  assert.equal(
    await page
      .locator('.inspect-card-stage')
      .evaluate((e) => e.classList.contains('front-drop-active')),
    true,
  );
  await shot('drag-to-front');
  await page.mouse.up();
  assert.equal(await page.locator('.inspect-card').last().getAttribute('data-card'), before[0]);
  assert.deepEqual(
    (await saved()).cardStacks[0].cards.map((c) => c.id),
    [...before.slice(1), before[0]],
  );
  assert.equal((await saved()).cards[fixturePrintId('N')], 10);
  assert.equal((await saved()).collection[fixturePrintId('N')], 0);
  report.checks.push('drag an exposed rear card to the front; relative order and totals preserved');
  assert.equal(await page.locator('.inspect-reorder').isDisabled(), true);
  await page.waitForTimeout(200);
  const buttonOrder = (await saved()).cardStacks[0].cards.map((c) => c.id),
    rearButton = await page.locator('.inspect-card').first().boundingBox();
  await page
    .locator('.inspect-card')
    .first()
    .click({ position: { x: 2, y: rearButton.height * 0.4 } });
  assert.equal(await page.locator('.inspect-reorder').isDisabled(), false);
  await page.locator('.inspect-reorder').click();
  assert.deepEqual(
    (await saved()).cardStacks[0].cards.map((c) => c.id),
    [...buttonOrder.slice(1), buttonOrder[0]],
  );
  assert.equal(await page.locator('.inspect-reorder').isDisabled(), true);
  report.checks.push(
    'selected rear card moves forward with the button; front-card action disabled',
  );
  const keyboard = page.locator('.inspect-card').nth(6),
    keyboardId = await keyboard.getAttribute('data-card');
  await keyboard.press('Home');
  assert.equal(await page.locator('.inspect-card').last().getAttribute('data-card'), keyboardId);
  await page.keyboard.press('Escape');
  await returned();
  await page.locator('.space-return').click();
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  await page.reload();
  await enter();
  await inspect();
  assert.equal(await page.locator('.inspect-card').last().getAttribute('data-card'), keyboardId);
  report.checks.push('keyboard reorder, return and reload preserve the chosen front card');
  const all = (await saved()).cardStacks[0].cards.map((c) => c.id),
    box = await page.locator('.inspect-card').first().boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(720, 110, { steps: 10 });
  await page.mouse.up();
  assert.deepEqual(
    (await saved()).cardStacks[0].cards.map((c) => c.id),
    all,
  );
  await page.locator('[data-warehouse-picker]').click();
  assert.equal(
    (await page.locator('[data-warehouse-picker]').innerText()).replace(/\s+/g, ' ').trim(),
    '入仓 →',
  );
  await page.locator('[data-rarity-select="none"]').click();
  assert.equal(await page.locator('[data-route-confirm]').isDisabled(), true);
  await page.locator('[data-warehouse-rarity="SR"] input').check();
  await page.locator('[data-warehouse-rarity="UR"] input').check();
  assert.match(await page.locator('[data-route-confirm]').innerText(), /20 张/);
  await shot('rarity-selection');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.warehouse-route-picker').isHidden(), true);
  assert.equal(await page.locator('.card-inspector').count(), 1);
  await page.locator('[data-warehouse-picker]').click();
  const flightCount = await page.evaluate(() => {
    document.querySelector('[data-route-confirm]').click();
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('.inspect-route-flight'))
      .forEach((a) => a.pause());
    return document.querySelectorAll('.inspect-route-flight').length;
  });
  assert.ok(flightCount > 0);
  await shot('warehouse-flight');
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('.inspect-route-flight'))
      .forEach((a) => a.play()),
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('.card-inspector') ||
      document.querySelector('.card-inspector').dataset.phase === 'open',
  );
  assert.equal(await page.locator('.inspect-card').count(), 30);
  const partial = await saved();
  assert.equal(
    partial.cardStacks[0].cards.some((c) => ['SR', 'UR'].includes(c.rarity)),
    false,
  );
  assert.equal(
    Object.values(partial.cards).reduce((a, b) => a + b, 0),
    50,
  );
  assert.equal(
    Object.values(partial.collection).reduce((a, b) => a + b, 0),
    0,
  );
  report.checks.push(
    'empty selection disabled; SR/UR only route 20 cards; other rarities remain pending; Escape closes the picker first',
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('[data-warehouse-picker]').click();
  assert.equal(await page.locator('[data-warehouse-rarity="SR"] input').isDisabled(), true);
  assert.equal(await page.locator('[data-route-confirm]').isDisabled(), true);
  await page.locator('[data-rarity-select="all"]').click();
  assert.match(await page.locator('[data-route-confirm]').innerText(), /30 张/);
  await shot('rarity-selection-narrow');
  const rects = await page
    .locator('.warehouse-route-picker button,.warehouse-route-picker label')
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
  assert.ok(
    rects.every((r) => r.left >= 0 && r.right <= 360 && r.top >= 0 && r.bottom <= 800),
    JSON.stringify(rects),
  );
  const finalFlightCount = await page.evaluate(() => {
    document.querySelector('[data-route-confirm]').click();
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('.inspect-route-flight'))
      .forEach((a) => a.pause());
    return document.querySelectorAll('.inspect-route-flight').length;
  });
  assert.ok(finalFlightCount > 0);
  await shot('warehouse-flight');
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('.inspect-route-flight'))
      .forEach((a) => a.play()),
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('.card-inspector') ||
      document.querySelector('.card-inspector').dataset.phase === 'open',
  );
  await returned();
  assert.equal((await saved()).cardStacks.length, 0);
  assert.equal(await page.locator('.world-stack').count(), 0);
  report.checks.push(
    '360px picker controls remain visible; disabled empty rarities; select all routes the remaining 30 without ghosts',
  );
  assert.deepEqual(errors, []);
  report.passed = true;
  report.errors = errors;
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
