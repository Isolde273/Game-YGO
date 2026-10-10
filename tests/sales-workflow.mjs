import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import { addCards, transferWarehouseToTray, openPacks, validateState } from '../src/game/model.js';
import { CARD_PRINTS, getCardView } from '../src/game/card-data.js';

import { installPriceFixtures } from './helpers/card-prices.mjs';

const output = process.env.YGO_SALES_OUTPUT || 'test-results/sale-card-type-20261010';
await fs.mkdir(output, { recursive: true });
const desktop = process.env.YGO_SALES_DESKTOP === '1';
const state = freshState();
state.history.push({ text: '领取补给 · 100 元', date: new Date().toISOString() });
state.settings = { ...state.settings, motion: false, music: false, sound: false };
const regular = CARD_PRINTS.find((p) => !p.legacy && p.rarity === 'PSER');
const gmr = CARD_PRINTS.find((p) => !p.legacy && p.rarity === 'GMR');
const categoryPrints = ['monster', 'spell', 'trap'].map((type) =>
  CARD_PRINTS.find((p) => p.rarity === 'PSER' && getCardView(p.id).card?.cardType === type),
);
const [, spell, trap] = categoryPrints;
addCards(state, regular.id, 8);
addCards(state, spell.id, 3);
addCards(state, trap.id, 3);
transferWarehouseToTray(state, regular.id, 2);
addCards(state, gmr.id, 3, [17, 18, 19]);
transferWarehouseToTray(state, gmr.id, 1);
const stack = openPacks(state, [state.items.find((i) => i.kind === 'pack').id]).stack;
stack.pose3d = { position: [0, 0.09, 1.35], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
const stackId = stack.id;
const fixturePrices = Object.fromEntries(CARD_PRINTS.map((p, i) => [p.id, (i + 1) / 100]));
fixturePrices[regular.id] = 0.29;
fixturePrices[gmr.id] = 1.25;
const stackValue =
  stack.cards.reduce((cents, card) => cents + Math.round(fixturePrices[card.printId] * 100), 0) /
  100;
const warehouseValue = 45.83; // 2×0.29 + 1×1.25 + 2×22; synthetic card quotes.
let browser, context, app, page;
const errors = [],
  checks = [];
try {
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(output, `desktop-sales-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector('.home-menu'));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });
    await page.context().setOffline(true);
  } else {
    browser = await chromium.launch(browserOptions);
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    (state) =>
      localStorage.setItem(
        'ygo-duel-archive-v1',
        sessionStorage.getItem('sale-snapshot') ?? JSON.stringify(state),
      ),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  await installPriceFixtures(page, fixturePrices);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const checkMoneyUI = async () => {
    assert.equal(await page.locator('.card-counter').count(), 0);
    assert.equal(
      await page.locator('[data-action="gift"],[data-action="refill"],.currency .plus').count(),
      0,
    );
    const labels = await page
      .locator(
        '.currency,.space-coins,.inspect-selected-price,.phone-dock,.wallet-card,.product-price,.q-product-card,.receipt-sheet,.sale-batch,.sale-row,.app-history,.supply-action,#toast',
      )
      .evaluateAll((nodes) =>
        nodes
          .map((node) =>
            [
              node.textContent,
              ...[node, ...node.querySelectorAll('[title],[aria-label]')].map(
                (el) => `${el.title ?? ''} ${el.getAttribute('aria-label') ?? ''}`,
              ),
            ].join(' '),
          )
          .join(' '),
      );
    assert.ok(!/余额|元|游戏币/.test(labels), `monetary UI still contains labels: ${labels}`);
  };
  await checkMoneyUI();
  assert.equal(await page.locator('.currency').first().locator('small').count(), 0);
  assert.ok(
    (await page.locator('.currency svg image').first().getAttribute('href')) ===
      './public/assets/currency.webp',
  );
  checks.push('主页图标和无单位余额');
  assert.ok(
    await page.evaluate(async () => {
      const image = new Image();
      image.src = document.querySelector('.currency svg image').getAttribute('href');
      await image.decode();
      return image.naturalWidth > 0;
    }),
  );
  await navigatePage(page, 'warehouse');
  assert.ok(
    (
      await page.locator('.warehouse-product img').evaluateAll((images) => images.map((i) => i.src))
    ).some((s) => s.endsWith('locr-box-warehouse.webp')),
  );
  await page.locator('[data-action="warehouse-mode"][data-mode="sales"]').click();
  assert.deepEqual(await page.locator('#sale-card-type option').allTextContents(), [
    '全部',
    '怪兽卡',
    '魔法卡',
    '陷阱卡',
  ]);
  for (const [i, type] of ['monster', 'spell', 'trap'].entries()) {
    await page.locator('#sale-card-type').selectOption(type);
    const keys = await page
      .locator('.sale-row')
      .evaluateAll((rows) => rows.map((row) => row.dataset.saleRow));
    assert.ok(keys.includes(`card:${categoryPrints[i].id}`));
    assert.ok(keys.every((key) => !key.startsWith('item:')));
    for (const other of categoryPrints.filter((p) => p !== categoryPrints[i])) {
      assert.ok(!keys.includes(`card:${other.id}`));
    }
  }
  await page.locator('#sale-card-type').selectOption('all');
  assert.ok(await page.locator('[data-sale-row="item:box"]').count());
  await page.locator('#sale-kind').selectOption('cards');
  await page.locator('#sale-rarity').selectOption('PSER');
  await page.locator('#sale-card-type').selectOption('monster');
  const regularRow = page.locator(`[data-sale-row="card:${regular.id}"]`);
  await regularRow.locator('[data-sale-quantity]').fill('2');
  assert.equal(await regularRow.locator('[data-sale-value]').textContent(), '0.58');
  await regularRow.locator('[data-sale-select]').check();
  assert.equal(await page.locator('[data-sale-summary]').textContent(), '已选 2 件 · 0.58');
  await regularRow.locator('[data-sale-quantity]').fill('99');
  assert.ok(await page.locator('[data-action="sale-batch"]').isDisabled());
  const invalidBefore = await saved();
  await regularRow.locator('[data-action="sale-one"]').click();
  assert.deepEqual(await saved(), invalidBefore);
  await regularRow.locator('[data-sale-quantity]').fill('2');
  await page.locator('[data-action="sale-batch"]').click();
  await checkMoneyUI();
  let current = await saved();
  assert.equal(current.coins, state.coins + 0.58);
  assert.equal(current.cards[regular.id], state.cards[regular.id] - 2);
  assert.equal(current.cards[spell.id], state.cards[spell.id]);
  assert.equal(current.cards[trap.id], state.cards[trap.id]);
  assert.deepEqual(current.collection, state.collection);
  checks.push('单卡数量、总价、超量拒绝、批量出售及收藏保护');
  await page.locator('[data-action="sale-select-all"]').click();
  await page.locator('#sale-card-type').selectOption('spell');
  assert.equal(await page.locator('[data-sale-select]:checked').count(), 0);
  assert.ok(await page.locator('[data-action="sale-batch"]').isDisabled());
  await page.locator('#sale-search').fill(getCardView(spell.id).code);
  assert.equal(await page.locator('.sale-row').count(), 1);
  assert.ok(await page.locator(`[data-sale-row="card:${spell.id}"]`).count());
  await page.locator('#sale-rarity').selectOption('SR');
  assert.equal(await page.locator('.sale-row').count(), 0);
  assert.ok(await page.locator('[data-action="sale-select-all"]').isDisabled());
  await page.locator('#sale-card-type').selectOption('all');
  await page.locator('#sale-search').fill('');
  checks.push('怪兽/魔法/陷阱类别与类型、罕贵度、搜索共同筛选；切换清空选择，批量出售保留其他类别');
  await page.locator('#sale-rarity').selectOption('GMR');
  await page.locator('#sale-search').fill('019/100');
  assert.equal(await page.locator('.sale-row').count(), 1);
  assert.ok((await page.locator('.sale-row').textContent()).includes('019/100'));
  await page.locator('[data-action="sale-select-all"]').click();
  await page.locator('#sale-search').fill('018/100');
  assert.equal(await page.locator('[data-sale-select]:checked').count(), 0);
  await page.locator('#sale-search').fill('019/100');
  await page.locator('[data-action="sale-one"]').click();
  current = await saved();
  assert.deepEqual(
    current.numberedCards.filter((c) => c.printId === gmr.id).map((c) => c.serial),
    [17, 18],
  );
  checks.push('编号搜索、筛选清空选择、精确编号出售');
  await page.locator('#sale-rarity').selectOption('all');
  await page.locator('#sale-search').fill('');
  await page.locator('#sale-kind').selectOption('pack');
  await page.locator('[data-action="sale-select-all"]').click();
  await page.locator('[data-action="sale-batch"]').click();
  current = await saved();
  assert.equal(current.items.filter((i) => i.kind === 'pack').length, 0);
  assert.equal(current.items.filter((i) => i.kind === 'box').length, 2);
  assert.equal(current.coins, state.coins + warehouseValue);
  checks.push('筛选批量出售保留未选物品');
  await page.locator('#sale-kind').selectOption('all');
  for (const width of [1440, 820, 640, 390, 360]) {
    if (desktop)
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
        width,
      );
    else await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    const layout = await page
      .locator('.warehouse-sales')
      .evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(
      layout.scrollWidth <= layout.width + 2,
      `${width}: sale UI overflow ${JSON.stringify(layout)}`,
    );
    for (const row of await page.locator('.sale-row').all()) {
      const size = await row.evaluate((el) => ({ w: el.clientWidth, s: el.scrollWidth }));
      assert.ok(size.s <= size.w + 2, `${width}: row overflow`);
    }
    assert.ok(await page.locator('#sale-card-type').isVisible());
    if ([1440, 390].includes(width)) {
      await page.evaluate(() => document.fonts.ready);
      await sharp(await page.screenshot())
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86 })
        .toFile(`${output}/${desktop ? 'desktop' : 'browser'}-sales-${width}.jpg`);
    }
  }
  checks.push('1440/820/640/390/360宽度出售布局无横向溢出');
  if (desktop)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
    );
  else await page.setViewportSize({ width: 1440, height: 900 });
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  await page.locator('.world-stack').first().press('Enter');
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  const price = page.locator('.inspect-selected-price');
  let selectedId = await page.locator('.inspect-card.selected').getAttribute('data-card');
  assert.equal(
    (await price.textContent()).trim(),
    String(fixturePrices[stack.cards.find((card) => card.id === selectedId).printId]),
  );
  assert.equal(await price.locator('svg image').count(), 1);
  assert.ok(await price.isVisible());
  await checkMoneyUI();
  const priceLayout = await price.evaluate((el) => ({
    gap: getComputedStyle(el).gap,
    height: el.getBoundingClientRect().height,
  }));
  assert.equal(priceLayout.gap, '10px');
  assert.ok(priceLayout.height >= 23);
  await page.locator('.inspect-card').first().press('Enter');
  selectedId = await page.locator('.inspect-card.selected').getAttribute('data-card');
  assert.equal(
    (await price.textContent()).trim(),
    String(fixturePrices[stack.cards.find((card) => card.id === selectedId).printId]),
  );
  checks.push('合成不同单价的整理页售价图标、间距与选卡同步');
  await page.locator('.inspect-return').click();
  await page.locator('.card-inspector').waitFor({ state: 'detached' });
  const point = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api.projectPoint(api.snapshot().stacks[0].position);
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  assert.ok((await page.locator('[data-sell-stack]').textContent()).includes(`${stackValue}`));
  await page.locator('[data-sell-stack]').click();
  await checkMoneyUI();
  assert.equal(await page.locator('.world-stack').count(), 0);
  current = await saved();
  assert.ok(!current.cardStacks.some((s) => s.id === stackId));
  assert.equal(current.coins, state.coins + warehouseValue + stackValue);
  assert.deepEqual(current.collection, state.collection);
  validateState(current);
  checks.push('右键整堆售价、出售、场景移除、余额与存档');
  await page.evaluate(() =>
    sessionStorage.setItem('sale-snapshot', localStorage.getItem('ygo-duel-archive-v1')),
  );
  await page.reload();
  await page.locator('.home-menu').waitFor();
  assert.deepEqual(await saved(), current);
  await navigatePage(page, 'shop');
  await checkMoneyUI();
  for (const app of ['tao', 'q']) {
    await openPhoneApp(page, app);
    await checkMoneyUI();
    await page.locator('[data-action="checkout"]').first().click();
    await checkMoneyUI();
    await page.locator('#checkout-quantity').fill('2');
    await checkMoneyUI();
    await page.locator('[data-action="close"]').click();
    assert.equal(
      await page.locator('[data-action="app-tab"], .app-history, .app-wallet').count(),
      0,
    );
  }
  await navigatePage(page, 'settings');
  await page.locator('[data-action="settings-section"][data-section="settings-save"]').click();
  await checkMoneyUI();
  assert.deepEqual(await page.locator('#settings-save .archive-stat > span').allTextContents(), [
    '已开卡包',
  ]);
  assert.deepEqual(
    await page
      .locator('#settings-save [data-action]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.action)),
    ['export', 'import', 'reset'],
  );
  checks.push('顶部卡牌计数已移除；开卡、出售、购买/订单/历史/钱包、补给与无障碍提示没有货币标签');
  assert.deepEqual(errors, []);
  checks.push('刷新恢复与无运行错误');
  await fs.writeFile(
    `${output}/${desktop ? 'desktop' : 'browser'}-sales.json`,
    JSON.stringify({ passed: true, checks, errors }, null, 2),
  );
  console.log(`Sales ${desktop ? 'desktop offline' : 'browser'}: ${checks.length} checks passed.`);
} finally {
  await app?.close();
  await browser?.close();
}
