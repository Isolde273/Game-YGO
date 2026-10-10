import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { freshState, purchase, validateState, PRODUCTS } from '../src/game/model.js';
import { boxPacks } from '../src/game/collation.js';
import { SIZES, PACK_STEP } from '../src/scene/packing.js';
import { browserOptions, navigatePage, closePurchase } from './helpers/browser.mjs';

const desktop = process.env.YGO_BULK_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const output = 'test-results/tooltip-bulk-open-20261010';
await fs.mkdir(output, { recursive: true });
const fixture = freshState();
fixture.settings = { ...fixture.settings, sound: false, motion: false };
purchase(fixture, 'pack', 15);
const boxes = fixture.items.filter((item) => item.kind === 'box');
const packs = fixture.items.filter((item) => item.kind === 'pack');
const bonus = fixture.items.find((item) => item.kind === 'bonus');
fixture.items.forEach((item) => {
  item.isNew = false;
  item.angle = 0;
  item.pose3d =
    item.kind === 'box'
      ? {
          position: [-4 + boxes.indexOf(item) * 2.2, SIZES.box[1] / 2 + 0.044, -3.1],
          quaternion: [0, 0, 0, 1],
        }
      : {
          position: [
            item.kind === 'bonus' ? 4.2 : 2.3,
            0.1 + Math.max(0, packs.indexOf(item)) * PACK_STEP,
            -1.4,
          ],
          quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        };
});
validateState(structuredClone(fixture));
const report = { passed: false, checks: [], errors: [] };
let app;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(output, `bulk-profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.addInitScript((fixture) => {
    if (!sessionStorage.getItem('bulk-seeded')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(fixture));
      sessionStorage.setItem('bulk-seeded', '1');
    }
  }, fixture);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const snapshot = () =>
    page.evaluate(() => document.querySelector('#world canvas').world3D.snapshot());
  const idle = () =>
    page.waitForFunction(
      () => document.querySelector('#world canvas').world3D.snapshot().animations.length === 0,
    );
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  const counts = (cards) => cards.map((card) => `${card.printId}:${card.serial ?? ''}`).sort();
  async function menu(id) {
    const point = await page.evaluate(
      (id) => document.querySelector('#world canvas').world3D.projectItem(id),
      id,
    );
    assert.equal(
      await page.evaluate(
        (point) => document.querySelector('#world canvas').world3D.hitAt(point.x, point.y),
        point,
      ),
      id,
    );
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.locator('.pack-actions').waitFor();
  }

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.locator('.currency').hover();
    await page.locator('#loan-tooltip').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#loan-tooltip').textContent(), '可贷款：1,500');
    const rect = await page.locator('#loan-tooltip').boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
    await shot(`tooltip-${width}`);
    await page.mouse.move(3, 3);
    assert.equal(await page.locator('#loan-tooltip').isVisible(), false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigatePage(page, 'shop');
  await page.locator('.phone-dock > span').hover();
  assert.equal(await page.locator('#loan-tooltip').isVisible(), false);
  await closePurchase(page);
  report.checks.push('实际浮层在桌面及390px可见且不溢出，移开即隐藏，购买资金无浮层');

  await navigatePage(page, 'open');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await menu(bonus.id);
  assert.equal(await page.locator('[data-count="10"]').isDisabled(), true);
  assert.equal(await page.locator('[data-count="5"]').isDisabled(), true);
  await page.keyboard.press('Escape');
  await menu(boxes[0].id);
  assert.equal(await page.locator('[data-open-all]').textContent(), '全部打开');
  await shot('box-menu');
  await page.locator('[data-open-all]').click();
  let state = await saved();
  assert.equal(state.opened.box, 1);
  assert.equal(state.opened.pack, PRODUCTS.box.count);
  assert.equal(state.cardStacks.length, 1);
  assert.deepEqual(
    counts(state.cardStacks[0].cards),
    counts(boxPacks(boxes[0].seal).flatMap((pack) => pack.cards)),
  );
  validateState(structuredClone(state));
  await idle();
  assert.equal((await snapshot()).cards.length, PRODUCTS.box.count * PRODUCTS.pack.count);
  assert.ok(!(await snapshot()).objects.some((item) => item.id === boxes[0].id));
  report.checks.push('右键卡盒全部打开自动完成拆盒及15包动画，保存完整60张并保留预定卡面');

  const top = () =>
    snapshot().then(
      (view) =>
        view.objects
          .filter((item) => item.kind === 'pack')
          .sort((a, b) => b.position[1] - a.position[1])[0].id,
    );
  await menu(await top());
  assert.ok((await page.locator('[data-count="1"]').innerText()).startsWith('打开 1 包'));
  assert.equal(await page.locator('[data-count="10"]').isDisabled(), false);
  await shot('pack-menu');
  await page.locator('[data-count="10"]').click();
  await idle();
  state = await saved();
  assert.equal(state.items.filter((item) => item.kind === 'pack').length, 5);
  assert.equal(state.opened.pack, PRODUCTS.box.count + 10);
  assert.equal((await snapshot()).cards.length, (PRODUCTS.box.count + 10) * PRODUCTS.pack.count);
  await menu(await top());
  assert.equal(await page.locator('[data-count="10"]').isDisabled(), true);
  assert.equal(await page.locator('[data-count="5"]').isDisabled(), false);
  await page.locator('[data-count="5"]').click();
  await idle();
  await menu(bonus.id);
  await page.locator('[data-count="1"]').click();
  await idle();
  state = await saved();
  assert.equal(state.opened.pack, PRODUCTS.box.count + 15);
  assert.equal(state.opened.bonus, 1);
  validateState(structuredClone(state));
  report.checks.push('打开10包准确消耗10包，不足10包禁用；原5包和改名后的1包仍可操作');

  await menu(boxes[1].id);
  await page.locator('[data-count="1"]').click();
  await idle();
  state = await saved();
  assert.equal(state.items.filter((item) => item.kind === 'pack').length, PRODUCTS.box.count);
  assert.equal(state.opened.pack, PRODUCTS.box.count + 15);
  await menu(boxes[2].id);
  await page.locator('[data-open-all]').click();
  await navigatePage(page, 'home');
  await page.reload();
  await page.locator('.home-menu').waitFor();
  state = await saved();
  assert.equal(state.opened.box, 3);
  assert.equal(state.opened.pack, PRODUCTS.box.count * 2 + 15);
  assert.equal(state.items.filter((item) => item.kind === 'pack').length, PRODUCTS.box.count);
  validateState(structuredClone(state));
  await navigatePage(page, 'open');
  await page.locator('canvas[data-ready="true"]').waitFor();
  assert.equal(
    (await snapshot()).cards.length,
    (PRODUCTS.box.count * 2 + 15) * PRODUCTS.pack.count + PRODUCTS.bonus.count,
  );
  await shot('full-open-restored');
  report.checks.push('普通打开卡盒仍保留15封包；全部打开动画期间离开并重载不会丢卡或重复发卡');
  const stack = state.cardStacks.at(-1);
  assert.equal(stack.cards.length, PRODUCTS.box.count * PRODUCTS.pack.count);
  const point = await page.evaluate((id) => {
    const world = document.querySelector('#world canvas').world3D;
    const cards = world.snapshot().cards;
    return world.projectCard(cards.findLastIndex((card) => card.stackId === id));
  }, stack.id);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.locator('[data-store-stack]').click();
  state = await saved();
  assert.ok(!state.cardStacks.some((item) => item.id === stack.id));
  assert.equal(
    (await snapshot()).cards.length,
    (PRODUCTS.box.count + 15) * PRODUCTS.pack.count + PRODUCTS.bonus.count,
  );
  validateState(structuredClone(state));
  report.checks.push('整盒60张卡堆可右键全部入仓，桌面清理及存档校验通过');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`Bulk opening ${prefix}: ${report.checks.length} checks passed.`);
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  await fs.writeFile(`${output}/${prefix}.json`, JSON.stringify(report, null, 2));
  await app?.close();
}
