import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import { purchase, openPacks, validateState } from '../src/game/model.js';
import { CARD_PRINTS } from '../src/game/card-data.js';
import { getCardPrice } from '../src/game/card-prices.js';
import { marketCards } from '../src/game/card-market.js';
import { sellWarehouse, warehouseSaleEntries } from '../src/game/sales.js';
import { jihuanshePrices } from '../src/generated/jihuanshe-prices.js';
import { sumMoney, toCents, fromCents } from '../src/game/money.js';

const output = 'test-results/losp-card2-20261010/prices';
const audit = JSON.parse(
  await fs.readFile('outputs/card-prices-20261010/losp-filled-prices-audit.json'),
);
const priced = audit.rows.filter((row) => row.price > 0);
const excluded = audit.rows.filter((row) => row.price === 0).map((row) => row.id);
const expected = Object.fromEntries(priced.map((row) => [row.id, row.price]));
const desktop = process.env.YGO_USER_PRICES_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const report = {
  passed: false,
  source: '用户定价',
  priced: priced.length,
  excluded,
  checks: [],
  errors: [],
};
await fs.mkdir(output, { recursive: true });
let app;
try {
  assert.deepEqual(audit.errors, []);
  assert.equal(priced.length, 328);
  assert.equal(excluded.length, 0);
  assert.equal(jihuanshePrices.source, '用户定价');
  assert.deepEqual([...jihuanshePrices.excludedPrintIds].sort(), [...excluded].sort());
  assert.deepEqual(
    marketCards()
      .map((card) => card.id)
      .sort(),
    Object.keys(expected).sort(),
  );
  assert.equal(CARD_PRINTS.length, 328);
  for (const row of priced) assert.equal(getCardPrice(row.id), row.price, row.id);
  for (const id of excluded) assert.equal(getCardPrice(id), null, id);
  const transactionState = freshState();
  transactionState.coins = 1e9;
  for (const row of priced) {
    const before = transactionState.coins;
    assert.equal(purchase(transactionState, 'card', 1, row.id).cost, row.price);
    assert.equal(toCents(before) - toCents(transactionState.coins), toCents(row.price));
    const entry = warehouseSaleEntries(transactionState).find((entry) => entry.printId === row.id);
    assert.ok(entry, row.id);
    assert.equal(
      sellWarehouse(transactionState, [{ key: entry.key, quantity: 1 }]).value,
      row.price,
    );
    assert.equal(transactionState.coins, before);
  }
  validateState(transactionState);
  report.checks.push('328项与用户表逐规格一致，每项实际购买和出售金额准确；10项LOSP恢复报价');

  const packCoins = transactionState.coins;
  const packs = purchase(transactionState, 'bonus', 2);
  assert.equal(packs.cost, 144);
  assert.equal(packs.bonusCount, 0);
  assert.equal(transactionState.coins, packCoins - 144);
  assert.equal(sellWarehouse(transactionState, [{ key: 'item:bonus', quantity: 2 }]).value, 144);
  assert.equal(transactionState.coins, packCoins);
  validateState(transactionState);

  const normal = 'LOCR-JP001-UR';
  const overframe = 'LOCR-JP001-UR-OF';
  const numbered = 'LOCR-JP001-GMR';
  const special = 'LOSP-JP011-PSER-OF';
  const state = freshState();
  state.coins = 500000;
  state.settings = { ...state.settings, motion: false, sound: false, music: false };
  const specialPacks = purchase(state, 'bonus', 5).items;
  const stack = openPacks(
    state,
    specialPacks.map((item) => item.id),
  ).stack;
  // This isolated price test keeps only cards so unrelated falling packages cannot alter reload snapshots.
  state.items = [];
  state.containers = [];
  stack.pose3d = { position: [0, 0.09, 1.35], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
  const stackValue = sumMoney(stack.cards.map((card) => expected[card.printId]));
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(output, `profile-${Date.now()}`),
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
      window.setContentSize(1440, 900);
      window.show();
      window.focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.addInitScript((state) => {
    if (!sessionStorage.getItem('user-prices-seeded')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      sessionStorage.setItem('user-prices-seeded', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const loadedPrices = await page.evaluate(async () => {
    const { jihuanshePrices } = await import(
      new URL('./src/generated/jihuanshe-prices.js', location.href).href
    );
    return {
      source: jihuanshePrices.source,
      excluded: jihuanshePrices.excludedPrintIds,
      entries: Object.fromEntries(
        Object.entries(jihuanshePrices.entries).map(([id, quote]) => [id, quote.price]),
      ),
    };
  });
  assert.equal(loadedPrices.source, '用户定价');
  assert.deepEqual(loadedPrices.entries, expected);
  assert.deepEqual([...loadedPrices.excluded].sort(), [...excluded].sort());
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'jhs');
  assert.equal(await page.locator('[data-market-count]').textContent(), '328');
  const catalog = new Set();
  const pageCount = Math.ceil(priced.length / 20);
  for (let index = 0; index < pageCount; index++) {
    const products = await page.locator('.jhs-product').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.dataset.rarity,
        price: node.querySelector('strong').textContent,
        disabled: node.disabled,
      })),
    );
    for (const product of products) {
      catalog.add(product.id);
      assert.equal(Number(product.price.replaceAll(',', '')), expected[product.id], product.id);
      assert.equal(product.disabled, false, product.id);
    }
    if (index < pageCount - 1) await page.locator('[data-action="market-next"]').click();
  }
  assert.deepEqual([...catalog].sort(), Object.keys(expected).sort());
  assert.ok(await page.locator('[data-action="market-next"]').isDisabled());
  await page.locator('#market-search').fill('LOSP');
  assert.equal(await page.locator('.jhs-product').count(), 10);
  report.checks.push('生产报价直接加载：328项分页价格全部正确，LOSP十项可以搜索和购买');

  let expectedCoins = state.coins;
  for (const [id, quantity] of [
    [normal, 2],
    [overframe, 2],
    [numbered, 1],
    [special, 2],
  ]) {
    await page.locator('#market-search').fill(id);
    const product = page.locator(`.jhs-product[data-rarity="${id}"]`);
    assert.equal(
      Number((await product.locator('strong').textContent()).replaceAll(',', '')),
      expected[id],
    );
    await product.click();
    assert.equal(
      Number(
        (await page.locator('.checkout-product strong').textContent())
          .split(' / ')[0]
          .replaceAll(',', ''),
      ),
      expected[id],
    );
    await page.locator('#checkout-quantity').fill(String(quantity));
    assert.equal(
      Number((await page.locator('#checkout-total').textContent()).replaceAll(',', '')),
      expected[id] * quantity,
    );
    await page.locator('[data-action="buy"]').click();
    expectedCoins = fromCents(toCents(expectedCoins) - toCents(expected[id] * quantity));
    const snapshot = await saved();
    assert.equal(snapshot.coins, expectedCoins);
    assert.equal(
      Number((await page.locator('#coins').textContent()).replaceAll(',', '')),
      expectedCoins,
    );
    assert.equal(snapshot.cards[id], (state.cards[id] ?? 0) + quantity);
    await page.locator('[data-action="close"]').click();
  }
  report.checks.push('普通UR与UR-OF分别结账；高价GMR和LOSP扣款入仓正确');
  await page.locator('#market-search').fill('LOSP');
  for (const width of [1440, 390]) {
    if (desktop)
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
        width,
      );
    else await page.setViewportSize({ width, height: 900 });
    const layout = await page
      .locator('.jhs-app')
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `${width}: ${JSON.stringify(layout)}`);
    await sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(`${output}/${prefix}-market-${width}.jpg`);
  }
  if (desktop)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
    );
  else await page.setViewportSize({ width: 1440, height: 900 });
  await openPhoneApp(page, 'tao');
  assert.equal(
    await page.locator('.tao-product[data-kind="bonus"] .product-price strong').textContent(),
    '72',
  );
  await page.locator('.tao-product[data-kind="bonus"]').click();
  assert.ok((await page.locator('.modal-kicker').textContent()).includes('LOSP'));
  await page.locator('#checkout-quantity').fill('2');
  assert.equal(await page.locator('#checkout-total').textContent(), '144');
  await page.locator('[data-action="buy"]').click();
  expectedCoins -= 144;
  assert.equal((await saved()).coins, expectedCoins);
  assert.equal((await saved()).items.filter((item) => item.kind === 'bonus').length, 2);
  await page.locator('[data-action="close"]').click();
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .jpeg({ quality: 85 })
    .toFile(`${output}/${prefix}-special-pack.jpg`);
  await navigatePage(page, 'warehouse');
  await page.locator('[data-action="warehouse-mode"][data-mode="sales"]').click();
  for (const [id, quantity] of [
    [normal, 2],
    [overframe, 1],
    [numbered, 1],
    [special, 1],
  ]) {
    const key =
      id === numbered
        ? `number:${(await saved()).numberedCards.find((card) => card.printId === id).id}`
        : `card:${id}`;
    const row = page.locator(`[data-sale-row="${key}"]`);
    await row.locator('[data-sale-quantity]').fill(String(quantity));
    await row.locator('[data-sale-select]').check();
  }
  const packRow = page.locator('[data-sale-row="item:bonus"]');
  assert.ok((await packRow.textContent()).includes('72'));
  await packRow.locator('[data-sale-quantity]').fill('2');
  await packRow.locator('[data-sale-select]').check();
  const warehouseValue = sumMoney([
    expected[normal] * 2,
    expected[overframe],
    expected[numbered],
    expected[special],
    144,
  ]);
  assert.equal(
    Number(
      (await page.locator('[data-sale-summary]').textContent()).split(' · ')[1].replaceAll(',', ''),
    ),
    warehouseValue,
  );
  await page.locator('[data-action="sale-batch"]').click();
  expectedCoins = fromCents(toCents(expectedCoins) + toCents(warehouseValue));
  assert.equal((await saved()).coins, expectedCoins);
  assert.equal((await saved()).items.length, 0);
  report.checks.push(
    '特别包72/包、两包144实际购买与批售准确；LOSP单卡、普通UR与UR-OF分别使用对应价格',
  );

  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  await page.locator('.world-stack').first().press('Enter');
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  const selectedId = await page.locator('.inspect-card.selected').getAttribute('data-card');
  const selected = stack.cards.find((card) => card.id === selectedId);
  assert.equal(
    Number((await page.locator('.inspect-selected-price').textContent()).replaceAll(',', '')),
    expected[selected.printId],
  );
  await page.locator('.inspect-return').click();
  await page.locator('.card-inspector').waitFor({ state: 'detached' });
  const point = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api.projectPoint(api.snapshot().stacks[0].position);
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  assert.ok(
    (await page.locator('[data-sell-stack]').textContent())
      .replaceAll(',', '')
      .includes(String(stackValue)),
  );
  await page.locator('[data-sell-stack]').click();
  expectedCoins = fromCents(toCents(expectedCoins) + toCents(stackValue));
  const snapshot = await saved();
  assert.equal(snapshot.coins, expectedCoins);
  assert.equal(snapshot.cardStacks.length, 0);
  validateState(snapshot);
  await page.reload();
  await page.locator('.home-menu').waitFor();
  assert.deepEqual(await saved(), snapshot);
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'jhs');
  assert.equal(await page.locator('[data-market-count]').textContent(), '328');
  assert.ok(await page.locator('.jhs-product:enabled').count());
  report.checks.push('整理页单价、右键整堆总价和出售准确；重载后报价与存档持续生效');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  await fs.writeFile(`${output}/${prefix}.json`, JSON.stringify(report, null, 2));
  await app?.close();
}
console.log(
  `User card prices ${prefix}: ${report.checks.length} checks passed, ${report.priced} priced, ${report.excluded.length} excluded.`,
);
