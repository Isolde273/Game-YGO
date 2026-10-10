import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, purchase, openPacks, validateState, SAVE_KEY } from '../src/game/model.js';
import { getCardPrice } from '../src/game/card-prices.js';
import { CARD_PRINTS } from '../src/game/card-data.js';
import { sellWarehouse, sellStack, stackSaleValue } from '../src/game/sales.js';
import { performWork } from '../src/game/work.js';
import { MAX_MONEY, isMoney } from '../src/game/money.js';
import {
  quotePurchase,
  quoteIncome,
  balanceFromCents,
  balanceToCents,
} from '../src/game/wallet.js';
import { readStoredState, writeStoredState } from '../src/game/save-storage.js';

test('贷款下限包含历史最高资金的负三倍，越界一分拒绝且不改状态', () => {
  const state = freshState();
  assert.equal(state.maxCoins, 500);
  assert.deepEqual(quotePurchase(state, 2000), { coins: -1500, maxCoins: 500 });
  const before = structuredClone(state);
  assert.throws(() => quotePurchase(state, 2000.01), /实在贷不动了/);
  assert.deepEqual(state, before);
  assert.equal(isMoney(-1), false);
  assert.throws(() => quotePurchase(state, -1));
  assert.throws(() => quoteIncome(state, -1));
});

test('包装与单卡都允许贷到边界，失败不扣款、不发卡、不降低最高记录', () => {
  const packs = freshState();
  packs.coins = packs.maxCoins = 540;
  assert.equal(purchase(packs, 'bonus', 30).cost, 2160);
  assert.equal(packs.coins, -1620);
  assert.equal(packs.maxCoins, 540);
  const before = structuredClone(packs);
  assert.throws(() => purchase(packs, 'pack', 1), /实在贷不动了/);
  assert.deepEqual(packs, before);
  assert.deepEqual(validateState(structuredClone(packs)), packs);

  const cards = freshState();
  const id = CARD_PRINTS.find((p) => p.rarity === 'SR' && getCardPrice(p.id) === 0.5).id;
  const price = getCardPrice(id);
  assert.ok(price > 0);
  cards.coins = balanceFromCents(-150000 + balanceToCents(price));
  purchase(cards, 'card', 1, id);
  assert.equal(cards.coins, -1500);
  assert.equal(cards.cards[id], 1);
  const cardSnapshot = structuredClone(cards);
  assert.throws(() => purchase(cards, 'card', 1, id), /实在贷不动了/);
  assert.deepEqual(cards, cardSnapshot);
});

test('打工与仓库出售可以偿债，超过历史最高后扩大额度', () => {
  const state = freshState();
  state.coins = -1500;
  performWork(state, 1000);
  assert.equal(state.coins, -1000);
  assert.equal(state.maxCoins, 500);
  sellWarehouse(state, [{ key: 'item:box', quantity: 3 }]);
  assert.equal(state.coins, -25);
  assert.equal(state.maxCoins, 500);
  performWork(state, 3000);
  performWork(state, 5000);
  performWork(state, 7000);
  assert.equal(state.coins, 1475);
  assert.equal(state.maxCoins, 1475);
  assert.deepEqual(quotePurchase(state, 5900), { coins: -4425, maxCoins: 1475 });
  assert.deepEqual(validateState(structuredClone(state)), state);
});

test('桌面整堆出售支持负资金，存档写入、重载保留负数与最高值', () => {
  const state = freshState();
  const stack = openPacks(state, [state.items.find((item) => item.kind === 'bonus').id]).stack;
  state.coins = -1500;
  const value = stackSaleValue(stack);
  sellStack(state, stack.id);
  assert.equal(state.coins, -1500 + value);
  assert.equal(state.maxCoins, 500);
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  writeStoredState(storage, state);
  assert.deepEqual(readStoredState(storage), state);
  assert.equal(JSON.parse(data.get(SAVE_KEY)).maxCoins, 500);
});

test('旧档初始化最高资金，损坏或低于额度的负资金拒绝，金额边界精确', () => {
  for (const [coins, peak] of [
    [0, 500],
    [500, 500],
    [1200, 1200],
  ]) {
    const state = freshState();
    state.coins = coins;
    delete state.maxCoins;
    assert.equal(validateState(state).maxCoins, peak);
  }
  const invalid = freshState();
  invalid.coins = -1500.01;
  assert.throws(() => validateState(invalid), /贷款下限/);
  invalid.coins = -1;
  delete invalid.maxCoins;
  assert.throws(() => validateState(invalid), /最高资金/);
  invalid.coins = 0;
  for (const peak of [-1, null, NaN, Infinity, MAX_MONEY + 1]) {
    invalid.maxCoins = peak;
    assert.throws(() => validateState(invalid), /最高资金/);
  }
  assert.equal(balanceFromCents(balanceToCents(-3 * MAX_MONEY)), -3 * MAX_MONEY);
  const upper = freshState();
  upper.coins = upper.maxCoins = MAX_MONEY;
  const before = structuredClone(upper);
  assert.throws(() => quoteIncome(upper, 0.01), /上限/);
  assert.deepEqual(upper, before);
  assert.throws(() => balanceFromCents(-3 * MAX_MONEY * 100 - 1));
});
