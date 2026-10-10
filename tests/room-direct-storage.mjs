import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import { makeItem, openPacks, warehouseCount } from '../src/game/model.js';
import { CARD_STEP, SIZES } from '../src/scene/packing.js';

const desktop = process.env.YGO_STORAGE_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const output = 'test-results/direct-opening-storage-20261009';
await fs.mkdir(output, { recursive: true });
await fs.mkdir('test-results/stack-context-storage-20261009', { recursive: true });
const state = freshState();
state.settings.sound = false;
state.items = Array.from({ length: 7 }, () => makeItem('pack'));
const { stack } = openPacks(
  state,
  state.items.slice(0, 5).map((item) => item.id),
);
stack.pose3d = {
  position: [0, 0.084 + (stack.cards.length * CARD_STEP) / 2, 1.35],
  quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
};
const remainingStack = openPacks(state, [state.items[0].id]).stack;
remainingStack.pose3d = {
  position: [2, 0.084 + (remainingStack.cards.length * CARD_STEP) / 2, 1.35],
  quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
};
state.items[0].isNew = false;
state.items[0].pose3d = {
  position: [-3, 0.084 + SIZES.pack[2] / 2, -2],
  quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
};
const originalCards = structuredClone(state.cards);
const initialWarehouse = warehouseCount(state);
const errors = [];
let app;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${output}/storage-profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((state) => {
    if (!localStorage.getItem('direct-storage-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('direct-storage-fixture', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  const positions = () =>
    page.evaluate(() => {
      const api = document.querySelector('canvas').world3D,
        state = api.snapshot();
      const top = api.projectPoint(state.stacks[0].position);
      const quad = state.entrances.warehouse.quad;
      return {
        top,
        warehouse: {
          x: quad.reduce((sum, p) => sum + p[0], 0) / 4,
          y: quad.reduce((sum, p) => sum + p[1], 0) / 4,
        },
      };
    });
  let points = await positions();
  assert.ok((await page.locator('.desk-help').innerText()).includes('批量操作卡包和卡堆'));
  await page.mouse.click(points.top.x, points.top.y, { button: 'right' });
  await page.locator('[data-store-stack]').waitFor();
  assert.equal(await page.locator('.card-inspector').count(), 0);
  assert.equal(warehouseCount(await saved()), initialWarehouse);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-store-stack]').count(), 0);
  await page.mouse.move(points.top.x, points.top.y);
  await page.mouse.down();
  await page.mouse.move(points.warehouse.x, points.warehouse.y, { steps: 10 });
  await page.locator('.stack-storage-drop.is-active').waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator('.stack-storage-drop').count(), 0);
  assert.equal((await saved()).cardStacks[0].cards.length, stack.cards.length);
  assert.equal(warehouseCount(await saved()), initialWarehouse);
  points = await positions();
  await page.mouse.move(points.top.x, points.top.y);
  await page.mouse.down();
  await page.mouse.move(points.warehouse.x, points.warehouse.y, { steps: 10 });
  await page.locator('.stack-storage-drop.is-active').waitFor();
  await sharp(await page.screenshot())
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(`${output}/${prefix}-warehouse-hover.webp`);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.world-stack').length === 1);
  const stored = await saved();
  assert.equal(stored.cardStacks.length, 1);
  assert.deepEqual(stored.cardStacks[0].cards, remainingStack.cards);
  assert.equal(warehouseCount(stored), initialWarehouse + stack.cards.length);
  assert.deepEqual(stored.cards, originalCards);
  assert.deepEqual(stored.collection, state.collection);
  assert.equal(stored.coins, state.coins);
  assert.deepEqual(
    stored.items.map((item) => item.id),
    state.items.map((item) => item.id),
  );
  assert.equal((await snap()).cards.length, remainingStack.cards.length);
  assert.equal(await page.locator('.card-inspector,.stack-storage-drop').count(), 0);
  await page.reload();
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  assert.equal((await snap()).stacks.length, 1);
  assert.equal(warehouseCount(await saved()), initialWarehouse + stack.cards.length);
  const stackPoint = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api.projectPoint(api.snapshot().stacks[0].position);
  });
  await page.mouse.click(stackPoint.x, stackPoint.y, { button: 'right' });
  await page.locator('[data-store-stack]').waitFor();
  assert.equal(await page.locator('.card-inspector').count(), 0);
  await sharp(await page.screenshot())
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(`test-results/stack-context-storage-20261009/${prefix}-stack-menu.webp`);
  await page.locator('[data-store-stack]').click();
  await page.waitForFunction(() => document.querySelectorAll('.world-stack').length === 0);
  const contextStored = await saved();
  assert.equal(
    warehouseCount(contextStored),
    initialWarehouse + stack.cards.length + remainingStack.cards.length,
  );
  assert.deepEqual(contextStored.cards, originalCards);
  assert.deepEqual(contextStored.collection, state.collection);
  assert.equal(contextStored.coins, state.coins);
  assert.deepEqual(
    contextStored.items.map((item) => item.id),
    state.items.map((item) => item.id),
  );
  assert.equal((await snap()).cards.length, 0);
  assert.equal(await page.locator('.card-inspector,.pack-actions').count(), 0);
  const packPoint = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api.projectItem(api.snapshot().objects[0].id);
  });
  await page.mouse.click(packPoint.x, packPoint.y, { button: 'right' });
  await page.locator('.pack-actions [data-count="1"]').waitFor();
  assert.equal(await page.locator('[data-store-stack]').count(), 0);
  await page.keyboard.press('Escape');
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const help = await page.locator('.desk-help').boundingBox();
    assert.ok(
      help.x >= 0 && help.x + help.width <= width,
      `help overflows at ${width}px: ${JSON.stringify(help)}`,
    );
    const spans = await page.locator('.desk-help > span').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    );
    assert.ok(
      spans.every((rect) => rect.left >= 0 && rect.right <= width),
      `help text overflows at ${width}px: ${JSON.stringify(spans)}`,
    );
    if (width === 360)
      await sharp(await page.screenshot())
        .webp({ quality: 82 })
        .toFile(`test-results/stack-context-storage-20261009/${prefix}-help-narrow.webp`);
  }
  await page.reload();
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  assert.equal((await snap()).stacks.length, 0);
  assert.equal(
    warehouseCount(await saved()),
    initialWarehouse + stack.cards.length + remainingStack.cards.length,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/${prefix}-storage-report.json`,
    JSON.stringify(
      {
        cancelPreserved: true,
        count: stack.cards.length,
        allStored: true,
        retainedInventory: true,
        reloaded: true,
        contextMenuStored: remainingStack.cards.length,
        contextCancelPreserved: true,
        packMenuPreserved: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `Direct storage ${prefix}: drag target/cancel, stack context menu/cancel/storage, pack menu, narrow help, inventory conservation and reload passed.`,
  );
} finally {
  await app?.close();
}
