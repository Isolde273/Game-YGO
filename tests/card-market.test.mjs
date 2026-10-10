import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { purchase, validateState, addCards } from '../src/game/model.js';
import { CARD_PRINTS, getCardView } from '../src/game/card-data.js';
import { jihuanshePrices } from '../src/generated/jihuanshe-prices.js';
import { marketCards, availableCardQuantity } from '../src/game/card-market.js';
import { numberedReservations } from '../src/game/collation.js';
import { sellWarehouse, sellStack, stackSaleValue } from '../src/game/sales.js';
import { toCents, fromCents, multiplyMoney, sumMoney, isMoney } from '../src/game/money.js';
import { saleSelectionSummary } from '../src/ui/pages/warehouse-sales.js';
import { getCardPrice } from '../src/game/card-prices.js';

const regular = CARD_PRINTS.find((p) => p.rarity === 'SR').id;
const numbered = CARD_PRINTS.find((p) => p.rarity === 'GMR').id;
// Synthetic transaction fixtures only. No source prices are written by these tests.
const realEntries = jihuanshePrices.entries;
const realExclusions = jihuanshePrices.excludedPrintIds;
test.beforeEach(() => {
  jihuanshePrices.entries = {};
  jihuanshePrices.excludedPrintIds = [];
});
test.after(() => {
  jihuanshePrices.entries = realEntries;
  jihuanshePrices.excludedPrintIds = realExclusions;
});
const quote = (id, price) => {
  jihuanshePrices.entries[id] = { price, sourceUrl: 'test-fixture' };
};

test('明确排除的规格不进入市场，不提供免费交易，也不删除已有卡牌', () => {
  const excluded = CARD_PRINTS.find((p) => p.id.startsWith('LOSP-')).id;
  jihuanshePrices.excludedPrintIds = [excluded];
  quote(excluded, 7);
  assert.equal(getCardPrice(excluded), null);
  assert.ok(marketCards().every((card) => card.id !== excluded));
  const state = freshState();
  addCards(state, excluded, 1);
  const before = structuredClone(state);
  assert.equal(availableCardQuantity(state, excluded), 0);
  assert.throws(() => purchase(state, 'card', 1, excluded), /暂无报价/);
  assert.throws(() => sellWarehouse(state, [{ key: `card:${excluded}`, quantity: 1 }]), /暂无报价/);
  assert.deepEqual(state, before);
});

test('金额以整数分运算，小数存档可恢复，非法精度与溢出拒绝', () => {
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(multiplyMoney(0.29, 3), 0.87);
  assert.equal(fromCents(toCents(1e12)), 1e12);
  for (const value of [NaN, Infinity, -1, 0.001, 1e12 + 1]) assert.equal(isMoney(value), false);
  assert.throws(() => sumMoney([1e12, 0.01]));
  assert.throws(() => multiplyMoney(1, 1.5));
  const state = freshState();
  state.coins = 100.29;
  assert.deepEqual(validateState(structuredClone(state)), state);
});

test('单卡市场完整覆盖328规格，分类/罕贵度/名称/卡号组合筛选', () => {
  const all = marketCards();
  assert.equal(all.length, 328);
  assert.equal(new Set(all.map((card) => card.id)).size, CARD_PRINTS.length);
  for (const cardType of ['monster', 'spell', 'trap']) {
    const cards = marketCards({ cardType, rarity: 'PSER' });
    assert.ok(cards.length);
    assert.ok(cards.every((c) => c.card.cardType === cardType && c.rarity === 'PSER'));
    const first = cards[0];
    assert.ok(
      marketCards({ cardType, rarity: 'PSER', search: first.name }).some((c) => c.id === first.id),
    );
    assert.ok(marketCards({ search: first.code }).some((c) => c.id === first.id));
  }
  assert.equal(marketCards({ search: '不存在的单卡名称' }).length, 0);
});

test('按价排序缺失价格放末尾，缺价与旧占位卡不能购买或出售', () => {
  quote(regular, 4.25);
  quote(numbered, 6.5);
  assert.equal(marketCards({ order: 'price-asc' })[0].id, regular);
  assert.equal(marketCards({ order: 'price-desc' })[0].id, numbered);
  const state = freshState();
  addCards(state, regular, 1);
  delete jihuanshePrices.entries[regular];
  const before = structuredClone(state);
  assert.throws(() => purchase(state, 'card', 1, regular), /暂无报价/);
  assert.throws(() => purchase(state, 'card', 1, 'SR'), /规格不存在/);
  assert.throws(() => sellWarehouse(state, [{ key: `card:${regular}`, quantity: 1 }]), /暂无报价/);
  assert.deepEqual(state, before);
  assert.equal(getCardView(regular).price, null);
});

test('单卡购买精确扣款并入仓，无效数量/贷款额度不足不改变存档', () => {
  quote(regular, 0.29);
  const state = freshState();
  state.coins = 1;
  const result = purchase(state, 'card', 3, regular);
  assert.equal(result.cost, 0.87);
  assert.equal(state.coins, 0.13);
  assert.equal(state.cards[regular], 3);
  assert.equal(state.collection[regular], 0);
  assert.deepEqual(validateState(structuredClone(state)), state);
  for (const quantity of [0, 1.5, 100]) {
    const before = structuredClone(state);
    assert.throws(() => purchase(state, 'card', quantity, regular));
    assert.deepEqual(state, before);
  }
  state.coins = -3 * state.maxCoins + 0.2;
  const before = structuredClone(state);
  assert.throws(() => purchase(state, 'card', 1, regular), /实在贷不动了/);
  assert.deepEqual(state, before);
  state.cards[regular] = 1e9;
  assert.equal(availableCardQuantity(state, regular), 0);
});

test('GMR购买避开拥有与封存编号，耗尽时整单拒绝', () => {
  quote(numbered, 1.25);
  const state = freshState();
  const reserved = numberedReservations(state);
  const expected = [];
  for (let serial = 1; serial <= 100 && expected.length < 2; serial++)
    if (!reserved.has(`${numbered}:${serial}`)) expected.push(serial);
  const result = purchase(state, 'card', 2, numbered);
  assert.deepEqual(
    result.items.map((c) => c.serial),
    expected,
  );
  assert.deepEqual(validateState(structuredClone(state)), state);
  const after = numberedReservations(state);
  const remaining = [];
  for (let serial = 1; serial <= 100; serial++)
    if (!after.has(`${numbered}:${serial}`)) remaining.push(serial);
  addCards(state, numbered, remaining.length, remaining);
  assert.equal(availableCardQuantity(state, numbered), 0);
  const before = structuredClone(state);
  assert.throws(() => purchase(state, 'card', 1, numbered), /库存不足/);
  assert.deepEqual(state, before);
});

test('混合实际单价出售和整堆总价，小数准确且缺价原子拒绝', () => {
  quote(regular, 0.29);
  quote(numbered, 1.25);
  const state = freshState();
  addCards(state, regular, 4);
  addCards(state, numbered, 1, [1]);
  const sale = sellWarehouse(state, [
    { key: 'item:pack', quantity: 1 },
    { key: `card:${regular}`, quantity: 2 },
  ]);
  assert.equal(sale.value, 22.58);
  state.cardStacks.push({
    id: 'fixture-stack',
    cards: [
      { id: 'regular-fixture', printId: regular, rarity: 'SR' },
      { ...state.numberedCards[0] },
    ],
  });
  assert.equal(stackSaleValue(state.cardStacks[0]), 1.54);
  delete jihuanshePrices.entries[numbered];
  const before = structuredClone(state);
  assert.throws(() => sellStack(state, 'fixture-stack'), /暂无报价/);
  assert.deepEqual(state, before);
  quote(numbered, 1.25);
  assert.equal(sellStack(state, 'fixture-stack').value, 1.54);
  assert.equal(state.coins, 10024.12);
});

test('出售摘要在无效数量/缺价/金额溢出时禁用，不在渲染中抛错', () => {
  quote(regular, 2.35);
  const entries = [{ key: 'r', kind: 'cards', printId: regular, quantity: 3 }];
  assert.deepEqual(saleSelectionSummary(entries, new Set(['r']), new Map()), {
    valid: true,
    quantity: 3,
    total: 7.05,
  });
  for (const amount of [0, 4, NaN, 1.5])
    assert.equal(
      saleSelectionSummary(entries, new Set(['r']), new Map([['r', amount]])).valid,
      false,
    );
  quote(regular, 1e12);
  assert.equal(saleSelectionSummary(entries, new Set(['r']), new Map()).valid, false);
  delete jihuanshePrices.entries[regular];
  assert.equal(saleSelectionSummary(entries, new Set(['r']), new Map()).valid, false);
});
