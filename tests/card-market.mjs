import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import { installPriceFixtures } from './helpers/card-prices.mjs';
import { validateState } from '../src/game/model.js';
import { CARD_PRINTS, getCardView } from '../src/game/card-data.js';
import { numberedReservations } from '../src/game/collation.js';
import { jihuanshePrices } from '../src/generated/jihuanshe-prices.js';

const output = 'test-results/card-market-pipeline-20261010';
await fs.mkdir(output, { recursive: true });
const desktop = process.env.YGO_MARKET_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const report = {
  passed: false,
  syntheticQuotes: true,
  realQuoteCoverage: `${Object.keys(jihuanshePrices.entries).length}/328`,
  checks: [],
  errors: [],
};
const state = freshState();
state.settings = { ...state.settings, motion: false, sound: false, music: false };
const regular = CARD_PRINTS.find((p) => p.rarity === 'SR');
const gmr = CARD_PRINTS.find((p) => p.rarity === 'GMR');
let app;
try {
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
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      w.focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.addInitScript((state) => {
    if (!sessionStorage.getItem('market-seeded')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      sessionStorage.setItem('market-seeded', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  await installPriceFixtures(page, {});
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'jhs');
  assert.equal(await page.locator('[data-market-count]').textContent(), '328');
  const catalog = new Set();
  for (let i = 0; i < 17; i++) {
    for (const id of await page
      .locator('.jhs-product')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.rarity)))
      catalog.add(id);
    assert.ok((await page.locator('.jhs-product').count()) <= 20);
    assert.equal(await page.locator('.jhs-product:enabled').count(), 0);
    if (i < 16) await page.locator('[data-action="market-next"]').click();
  }
  assert.deepEqual([...catalog].sort(), CARD_PRINTS.map((p) => p.id).sort());
  assert.ok(await page.locator('[data-action="market-next"]').isDisabled());
  assert.deepEqual(await saved(), state);
  report.checks.push('全部328规格分页完整，缺价禁用，未写入测试价格');
  for (const type of ['monster', 'spell', 'trap']) {
    await page.locator('#market-card-type').selectOption(type);
    const ids = await page
      .locator('.jhs-product')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.rarity));
    assert.ok(ids.length && ids.every((id) => getCardView(id).card.cardType === type));
    assert.ok((await page.locator('.market-pagination span').textContent()).startsWith('1 /'));
  }
  await page.locator('#market-card-type').selectOption('all');
  await page.locator('#market-search').fill('没有这张卡');
  assert.equal(await page.locator('.jhs-product').count(), 0);
  assert.equal(await page.locator('[data-market-count]').textContent(), '0');
  assert.equal(
    await page.locator('#market-search').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.locator('#market-search').fill('');
  for (const width of [1440, 390, 360]) {
    if (desktop)
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
        width,
      );
    else await page.setViewportSize({ width, height: 900 });
    const layout = await page
      .locator('.jhs-app')
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, JSON.stringify({ width, ...layout }));
    assert.ok(await page.locator('#market-rarity').isVisible());
    assert.ok(await page.locator('[data-action="market-next"]').isVisible());
    assert.equal(await page.locator('.phone-empty').count(), 0);
    if (width !== 360)
      await sharp(await page.screenshot())
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(`${output}/${prefix}-market-${width}.jpg`);
  }
  report.checks.push('三类筛选、空搜索、光标保留、分页重置及1440/390/360布局');
  await installPriceFixtures(page, { [regular.id]: 0.29, [gmr.id]: 1.25 });
  await page.locator('#market-order').selectOption('price-asc');
  assert.equal(await page.locator('.jhs-product').first().getAttribute('data-rarity'), regular.id);
  await page.locator(`.jhs-product[data-rarity="${regular.id}"]`).click();
  assert.equal(await page.locator('.checkout-product strong').textContent(), '0.29 / 张');
  await page.locator('#checkout-quantity').fill('3');
  assert.equal(await page.locator('#checkout-total').textContent(), '0.87');
  await page.locator('[data-action="buy"]').click();
  assert.equal((await saved()).coins, 9999.13);
  assert.equal((await saved()).cards[regular.id], 3);
  await page.locator('[data-action="close"]').click();
  await page.locator('#market-order').selectOption('price-desc');
  await page.locator(`.jhs-product[data-rarity="${gmr.id}"]`).click();
  const expected = [];
  const reserved = numberedReservations(state);
  for (let serial = 1; serial <= 100 && expected.length < 2; serial++)
    if (!reserved.has(`${gmr.id}:${serial}`)) expected.push(serial);
  await page.locator('#checkout-quantity').fill('2');
  await page.locator('[data-action="buy"]').click();
  assert.equal((await saved()).coins, 9996.63);
  assert.deepEqual(
    (await saved()).numberedCards.filter((c) => c.printId === gmr.id).map((c) => c.serial),
    expected,
  );
  await page.locator('[data-action="close"]').click();
  report.checks.push('合成报价夹具：小数结账扣款、普通卡入仓、GMR避开封存编号');
  await navigatePage(page, 'warehouse');
  await page.locator('[data-action="warehouse-mode"][data-mode="sales"]').click();
  const row = page.locator(`[data-sale-row="card:${regular.id}"]`);
  await row.locator('[data-sale-quantity]').fill('2');
  await row.locator('[data-sale-select]').check();
  assert.equal(await page.locator('[data-sale-summary]').textContent(), '已选 2 件 · 0.58');
  await page.locator('[data-action="sale-batch"]').click();
  assert.equal((await saved()).coins, 9997.21);
  const snapshot = await saved();
  validateState(snapshot);
  await page.reload();
  await page.locator('.home-menu').waitFor();
  await installPriceFixtures(page, {});
  assert.deepEqual(await saved(), snapshot);
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'jhs');
  assert.equal(await page.locator('.jhs-product:enabled').count(), 0);
  report.checks.push('合成报价夹具：仓库使用同一单价出售，精度与重载守恒；夹具不持久化');
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
  `Card market ${prefix}: ${report.checks.length} checks passed; real quotes ${report.realQuoteCoverage}.`,
);
