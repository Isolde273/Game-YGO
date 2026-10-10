import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTS,
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  openPacks,
  openItem,
  makeItem,
  warehouseCount,
  validateState,
} from '../src/game/model.js';
import { CARD_PRINTS } from '../src/game/card-data.js';
import {
  saleUnitPrice,
  warehouseSaleEntries,
  sellWarehouse,
  sellStack,
} from '../src/game/sales.js';

import { jihuanshePrices } from '../src/generated/jihuanshe-prices.js';
// Synthetic quotes for this isolated test process.
const realPrices = {
  entries: jihuanshePrices.entries,
  excludedPrintIds: jihuanshePrices.excludedPrintIds,
};
jihuanshePrices.entries = {};
jihuanshePrices.excludedPrintIds = [];
test.after(() => Object.assign(jihuanshePrices, realPrices));
for (const p of CARD_PRINTS)
  jihuanshePrices.entries[p.id] = { price: 100, sourceUrl: 'test-fixture' };

const normal = CARD_PRINTS.find((p) => !p.legacy && p.rarity === 'SR').id;
const numbered = CARD_PRINTS.find((p) => !p.legacy && p.rarity === 'GMR').id;
const restored = (s) => assert.deepEqual(validateState(structuredClone(s)), s);

test('混合出售按商品和卡牌单价计价，保护收藏、桌面、封存与其他库存，存档可恢复', () => {
  const s = freshState();
  addCards(s, normal, 8);
  transferWarehouseToTray(s, normal, 3);
  moveBinderCard(s, { printId: normal }, 0);
  openPacks(s, [s.items.find((i) => i.kind === 'pack').id]);
  const protectedData = JSON.stringify([s.collection, s.binder, s.cardStacks, s.collation]);
  const coins = s.coins,
    cards = s.cards[normal];
  const result = sellWarehouse(s, [
    { key: 'item:box', quantity: 1 },
    { key: `card:${normal}`, quantity: 2 },
  ]);
  assert.equal(saleUnitPrice({ kind: 'cards', printId: normal }), 100);
  assert.equal(result.value, 525);
  assert.equal(s.coins, coins + 525);
  assert.equal(s.cards[normal], cards - 2);
  assert.equal(s.items.filter((i) => i.kind === 'box').length, 1);
  assert.equal(JSON.stringify([s.collection, s.binder, s.cardStacks, s.collation]), protectedData);
  restored(s);
});

test('整批无效、重复、超库存和超余额的交易原子拒绝', () => {
  const s = freshState();
  for (const order of [
    null,
    [],
    [null],
    [
      { key: 'item:pack', quantity: 1 },
      { key: 'missing', quantity: 1 },
    ],
    [
      { key: 'item:box', quantity: 1 },
      { key: 'item:box', quantity: 1 },
    ],
    [{ key: 'item:pack', quantity: 4 }],
    [{ key: 'item:pack', quantity: 1.5 }],
    [{ key: 'item:pack', quantity: 0 }],
  ]) {
    const before = JSON.stringify(s);
    assert.throws(() => sellWarehouse(s, order));
    assert.equal(JSON.stringify(s), before);
  }
  s.coins = 1e12 - 10;
  const before = JSON.stringify(s);
  assert.throws(() => sellWarehouse(s, [{ key: 'item:pack', quantity: 1 }]));
  assert.equal(JSON.stringify(s), before);
});

test('编号卡只能出售仓库中选定实体，收藏、暂存、桌面编号都保留', () => {
  const s = freshState();
  const records = addCards(s, numbered, 5, [1, 2, 3, 4, 5]);
  transferWarehouseToTray(s, numbered, 2);
  moveBinderCard(s, { printId: numbered }, 0);
  s.cardStacks.push({
    id: 'number-stack',
    cards: [{ ...records[2] }],
    pose3d: { position: [0, 0.1, 0] },
  });
  delete s.cardStacks[0].cards[0].inCollection;
  const entries = warehouseSaleEntries(s).filter((e) => e.printId === numbered);
  assert.deepEqual(
    entries.map((e) => e.serial),
    [4, 5],
  );
  sellWarehouse(s, [{ key: entries[1].key, quantity: 1 }]);
  assert.deepEqual(
    s.numberedCards.map((c) => c.serial),
    [1, 2, 3, 4],
  );
  assert.equal(warehouseCount(s, numbered), 1);
  restored(s);
});

test('桌面整堆出售移除精确编号、增加总价、保留邻堆，不能重复出售', () => {
  const s = freshState();
  const records = addCards(s, numbered, 2, [21, 22]);
  addCards(s, normal, 3);
  transferWarehouseToTray(s, normal, 1);
  s.cardStacks.push({
    id: 'sale-stack',
    cards: [{ ...records[0] }, { id: 'normal-one', printId: normal, rarity: 'SR' }],
    pose3d: { position: [0, 0.1, 0] },
  });
  delete s.cardStacks[0].cards[0].inCollection;
  s.cardStacks.push({
    id: 'keep-stack',
    cards: [{ ...records[1] }],
    pose3d: { position: [2, 0.1, 0] },
  });
  delete s.cardStacks[1].cards[0].inCollection;
  const coins = s.coins,
    neighbor = JSON.stringify(s.cardStacks[1]);
  assert.equal(sellStack(s, 'sale-stack').value, 200);
  assert.equal(s.coins, coins + 200);
  assert.equal(JSON.stringify(s.cardStacks[0]), neighbor);
  assert.deepEqual(
    s.numberedCards.map((c) => c.serial),
    [22],
  );
  assert.equal(s.cards[normal], 2);
  restored(s);
  const before = JSON.stringify(s);
  assert.throws(() => sellStack(s, 'sale-stack'));
  assert.equal(JSON.stringify(s), before);
});

test('出售未拆封各类商品和箱内子盒，保留有子盒的箱壳、清理空壳', () => {
  const s = freshState();
  s.items.push(makeItem('bonus'));
  const container = openItem(s, s.items.find((i) => i.kind === 'case').id).container;
  sellWarehouse(s, [{ key: 'item:box', quantity: 3 }]);
  assert.ok(s.containers.some((c) => c.id === container.id));
  const remaining = warehouseSaleEntries(s).filter((e) => e.itemIds);
  const coins = s.coins;
  const value = remaining.reduce((n, e) => n + e.quantity * saleUnitPrice(e), 0);
  sellWarehouse(
    s,
    remaining.map((e) => ({ key: e.key, quantity: e.quantity })),
  );
  assert.equal(s.coins, coins + value);
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.containers, []);
  restored(s);
  const sealed = freshState();
  sellWarehouse(sealed, [{ key: 'item:case', quantity: 1 }]);
  restored(sealed);
});
