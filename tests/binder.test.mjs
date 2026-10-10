import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateState,
  RARITIES,
  moveBinderCard,
  trayCount,
  binderCount,
  transferWarehouseToTray,
  transferCollectionToWarehouse,
  cardCount,
  warehouseCount,
  openPacks,
  routeStackCards,
} from '../src/game/model.js';
const copy = (s) => JSON.parse(JSON.stringify(s));
test('600 个位置自由入册、满册换卡、出册与存档保持库存守恒', () => {
  const s = freshState();
  s.cards.UR = 601;
  transferWarehouseToTray(s, 'UR', 601);
  for (let i = 0; i < 600; i++) moveBinderCard(s, { rarity: 'UR' }, i);
  assert.equal(binderCount(s), 600);
  assert.equal(trayCount(s), 1);
  const id = s.binder.slots[599].id;
  moveBinderCard(s, { rarity: 'UR' }, 599);
  assert.notEqual(s.binder.slots[599].id, id);
  assert.equal(trayCount(s), 1);
  const first = s.binder.slots[0].id,
    last = s.binder.slots[599].id;
  moveBinderCard(s, { slot: 0 }, 599);
  assert.equal(s.binder.slots[599].id, first);
  assert.equal(s.binder.slots[0].id, last);
  moveBinderCard(s, { slot: 599 }, 'tray');
  assert.equal(binderCount(s), 599);
  assert.equal(trayCount(s), 2);
  transferCollectionToWarehouse(s, { rarity: 'UR' }, 2);
  assert.equal(warehouseCount(s), 2);
  transferCollectionToWarehouse(s, { slot: 0 });
  assert.equal(warehouseCount(s), 3);
  assert.equal(cardCount(s), 601);
  s.binder.page = 100;
  assert.deepEqual(validateState(copy(s)), s);
});
test('所有罕贵度从桌面、仓库进入暂存区，旧存档大量收藏不展开', () => {
  const s = freshState();
  const { stack } = openPacks(s, [s.items.find((i) => i.kind === 'pack').id], () => 0.9);
  routeStackCards(
    s,
    stack.id,
    stack.cards.map((c) => c.id),
    'collection',
  );
  assert.equal(trayCount(s), 4);
  assert.equal(binderCount(s), 0);
  for (const r of RARITIES) {
    s.cards[r.id] += 2;
    transferWarehouseToTray(s, r.id, 2);
    moveBinderCard(s, { rarity: r.id }, RARITIES.indexOf(r));
  }
  validateState(copy(s));
  assert.equal(cardCount(s), 14);
  assert.equal(binderCount(s), 5);
  assert.equal(trayCount(s), 9);
  const legacy = freshState();
  delete legacy.binder;
  delete legacy.collection;
  legacy.cards.N = 1e9;
  validateState(legacy);
  assert.equal(trayCount(legacy), 1e9);
  assert.equal(Object.keys(legacy.binder.slots).length, 0);
  assert.ok(JSON.stringify(legacy).length < 16000);
});
test('非法转移与位置不会改变卡牌；损坏和重复卡位无法导入', () => {
  const s = freshState();
  s.cards.N = 2;
  transferWarehouseToTray(s, 'N', 1);
  moveBinderCard(s, { rarity: 'N' }, 0);
  for (const action of [
    () => moveBinderCard(s, { slot: 0 }, 600),
    () => moveBinderCard(s, { slot: -1 }, 1),
    () => moveBinderCard(s, { rarity: 'N' }, 2),
    () => transferWarehouseToTray(s, 'N', 2),
    () => transferCollectionToWarehouse(s, { rarity: 'N' }),
    () => transferCollectionToWarehouse(s, { slot: 0 }, 2),
  ]) {
    const before = copy(s);
    assert.throws(action);
    assert.deepEqual(s, before);
  }
  for (const mutate of [
    (b) => (b.page = 101),
    (b) => (b.slots['600'] = { id: 'bad', rarity: 'N' }),
    (b) => (b.slots['01'] = { id: 'bad', rarity: 'N' }),
    (b) => (b.slots[1] = { ...b.slots[0] }),
    (b) => (b.slots[1] = { id: 'extra', rarity: 'N' }),
    (b) => (b.slots[0].rarity = 'BAD'),
  ]) {
    const bad = copy(s);
    mutate(bad.binder);
    assert.throws(() => validateState(bad));
  }
});
