import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { purchase, PRODUCTS, validateState } from '../src/game/model.js';
import { performWork, workCooldown } from '../src/game/work.js';

test('打工获得500，1秒边界、连续触发与存档重载保持冷却', () => {
  const state = freshState();
  const before = state.coins;
  assert.equal(performWork(state, 1000), 500);
  assert.equal(state.coins, before + 500);
  assert.equal(workCooldown(state, 1000), 1000);
  const saved = structuredClone(state);
  for (const time of [1000, 1001, 1999]) {
    assert.throws(() => performWork(state, time), /冷却/);
    assert.deepEqual(state, saved);
  }
  const restored = validateState(structuredClone(state));
  assert.equal(workCooldown(restored, 1999), 1);
  assert.throws(() => performWork(restored, 1999), /冷却/);
  performWork(restored, 2000);
  assert.equal(restored.coins, before + 1000);
  assert.equal(restored.workReadyAt, 3000);
  assert.equal(restored.history.length, 2);
});

test('打工金额上限与无效时间不修改存档，旧档冷却默认可用', () => {
  const state = freshState();
  delete state.workReadyAt;
  assert.equal(validateState(structuredClone(state)).workReadyAt, 0);
  for (const time of [NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER - 1000]) {
    const before = structuredClone(state);
    assert.throws(() => performWork(state, time));
    assert.deepEqual(state, before);
  }
  state.coins = 1e12 - 499;
  const before = structuredClone(state);
  assert.throws(() => performWork(state, 1000), /上限/);
  assert.deepEqual(state, before);
});

test('箱盒包购买使用指定价格并按数量扣款', () => {
  for (const [kind, price] of [
    ['case', 7999],
    ['box', 325],
    ['pack', 22],
  ]) {
    const state = freshState();
    const before = state.coins;
    const quantity = kind === 'case' ? 1 : 2;
    assert.equal(PRODUCTS[kind].price, price);
    const order = purchase(state, kind, quantity);
    assert.equal(order.cost, price * quantity);
    assert.equal(state.coins, before - price * quantity);
    validateState(structuredClone(state));
  }
});
