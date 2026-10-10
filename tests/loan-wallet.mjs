import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { freshState, validateState } from '../src/game/model.js';
import { CARD_PRINTS } from '../src/game/card-data.js';
import { getCardPrice } from '../src/game/card-prices.js';
import { browserOptions, navigatePage, openPhoneApp, closePurchase } from './helpers/browser.mjs';

const output = 'test-results/tooltip-bulk-open-20261010/loan';
const desktop = process.env.YGO_LOAN_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const state = freshState();
state.settings = { ...state.settings, sound: false, motion: false };
const report = { passed: false, checks: [], errors: [] };
await fs.mkdir(output, { recursive: true });
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
    if (!sessionStorage.getItem('loan-seeded')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      sessionStorage.setItem('loan-seeded', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  async function loanTip(selector, text) {
    await page.locator(selector).hover();
    await page.locator('#loan-tooltip').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#loan-tooltip').textContent(), text);
  }
  await loanTip('.currency', '可贷款：1,500');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  async function screenshot(name) {
    await sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(`${output}/${prefix}-${name}.jpg`);
  }
  async function buy(kind, quantity, coins, id) {
    const product = id ? `.jhs-product[data-rarity="${id}"]` : `.tao-product[data-kind="${kind}"]`;
    await page.locator(product).click();
    assert.equal(await page.locator('.order-total [data-loan-balance]').count(), 0);
    await page.locator('#checkout-quantity').fill(String(quantity));
    await page.locator('[data-action="buy"]').click();
    assert.equal((await saved()).coins, coins);
    await page.locator('.success-modal [data-action="close"]').click();
  }
  async function denied(kind, quantity, id) {
    const product = id ? `.jhs-product[data-rarity="${id}"]` : `.tao-product[data-kind="${kind}"]`;
    const before = await saved();
    await page.locator(product).click();
    await page.locator('#checkout-quantity').fill(String(quantity));
    await page.locator('[data-action="buy"]').click();
    assert.equal(await page.locator('#checkout-error').textContent(), '实在贷不动了');
    assert.deepEqual(await saved(), before);
  }
  await navigatePage(page, 'shop');
  assert.equal(await page.locator('.purchase-overlay [data-loan-balance]').count(), 0);
  await page.locator('.phone-dock > span').hover();
  assert.equal(await page.locator('#loan-tooltip').isVisible(), false);
  await openPhoneApp(page, 'tao');
  await buy('box', 4, -800);
  assert.equal(await page.locator('#coins').textContent(), '-800');
  await denied('box', 3);
  await screenshot('loan-error');
  await page.locator('.checkout-modal [data-action="close"]').click();
  await buy('box', 2, -1450);
  await denied('bonus', 1);
  await page.locator('.checkout-modal [data-action="close"]').click();
  report.checks.push('包装可贷款；超出-1500显示实在贷不动了且订单不改变存档');

  await openPhoneApp(page, 'jhs');
  const id = CARD_PRINTS.find((p) => p.rarity === 'SR' && getCardPrice(p.id) === 0.5).id;
  await page.locator('#market-search').fill(id);
  assert.equal(await page.locator('.jhs-product strong').textContent(), '0.5');
  await buy('card', 99, -1499.5, id);
  await buy('card', 1, -1500, id);
  await denied('card', 1, id);
  await page.locator('.checkout-modal [data-action="close"]').click();
  await closePurchase(page);
  assert.equal((await saved()).maxCoins, 500);
  await page.reload();
  await page.locator('.home-menu').waitFor();
  assert.equal((await saved()).coins, -1500);
  assert.equal((await saved()).maxCoins, 500);
  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-save"]').click();
  const exportPath = path.resolve(output, `${prefix}-loan-save.json`);
  if (desktop) {
    await app.evaluate(({ BrowserWindow }, exportPath) => {
      globalThis.loanDownloadPromise = new Promise((resolve, reject) => {
        BrowserWindow.getAllWindows()[0].webContents.session.once(
          'will-download',
          (_event, item) => {
            item.setSavePath(exportPath);
            item.once('done', (_event, status) =>
              status === 'completed' ? resolve(status) : reject(new Error(status)),
            );
          },
        );
      });
    }, exportPath);
    await page.locator('[data-action="export"]').click();
    assert.equal(await app.evaluate(() => globalThis.loanDownloadPromise), 'completed');
  } else {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloadPromise;
    await download.saveAs(exportPath);
  }
  const exported = JSON.parse(await fs.readFile(exportPath));
  assert.equal(exported.coins, -1500);
  assert.equal(exported.maxCoins, 500);
  validateState(structuredClone(exported));
  await page.locator('#import-file').setInputFiles(exportPath);
  await page.locator('#confirm-import').click();
  assert.equal((await saved()).coins, -1500);
  assert.equal((await saved()).maxCoins, 500);
  report.checks.push('单卡准确贷到边界，超限拒绝；重载和实际导出/导入保留负资金与历史最高');

  await navigatePage(page, 'shop');
  assert.equal(await page.locator('[data-phone-coins]').textContent(), '-1,500');
  assert.equal(await page.locator('.purchase-overlay [data-loan-balance]').count(), 0);
  await screenshot('negative-phone');
  await page.locator('[data-action="work"]').click();
  assert.equal((await saved()).coins, -1000);
  assert.equal((await saved()).maxCoins, 500);
  await navigatePage(page, 'warehouse');
  await page.locator('[data-action="warehouse-mode"][data-mode="sales"]').click();
  const row = page.locator('[data-sale-row="item:box"]');
  await row.locator('[data-sale-quantity]').fill('6');
  await row.locator('[data-sale-select]').check();
  await page.locator('[data-action="sale-batch"]').click();
  assert.equal((await saved()).coins, 950);
  assert.equal((await saved()).maxCoins, 950);
  await loanTip('.currency', '可贷款：2,850');
  await screenshot('loan-tooltip');
  await page.reload();
  await page.locator('.home-menu').waitFor();
  assert.equal((await saved()).maxCoins, 950);
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'tao');
  await buy('box', 11, -2625);
  await denied('box', 1);
  validateState(await saved());
  report.checks.push('打工偿债、出售更新最高950并保留；重新购买按-2850新下限执行');
  await page.locator('.checkout-modal [data-action="close"]').click();
  await closePurchase(page);
  await navigatePage(page, 'home');
  await navigatePage(page, 'open');
  await loanTip('.space-coins', '可贷款：2,850');
  assert.equal(
    await page.locator('.space-coins').evaluate((el) => getComputedStyle(el).pointerEvents),
    'auto',
  );
  await navigatePage(page, 'home');
  await page.evaluate(() => sessionStorage.removeItem('loan-seeded'));
  await page.reload();
  await page.locator('.home-menu').waitFor();
  await navigatePage(page, 'shop');
  await page.locator('[data-action="work"]').click();
  assert.equal((await saved()).maxCoins, 1000);
  assert.equal(await page.locator('#loan-tooltip').isVisible(), false);
  await closePurchase(page);
  await loanTip('.currency', '可贷款：3,000');
  report.checks.push(
    '资金悬浮浮层在主页与开盒可见，购买页和订单没有提示；负资金显示总额度，打工增加额度后刷新',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`Loan wallet ${prefix}: ${report.checks.length} checks passed.`);
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  await fs.writeFile(`${output}/${prefix}.json`, JSON.stringify(report, null, 2));
  await app?.close();
}
