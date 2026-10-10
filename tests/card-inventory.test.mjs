import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_PRINTS } from '../src/game/card-data.js';
import {
  validateState,
  addCards,
  cardCount,
  collectionCount,
  warehouseCount,
  binderCount,
  trayCount,
  transferWarehouseToTray,
  transferCollectionToWarehouse,
  moveBinderCard,
  purchase,
  openPacks,
  routeStackCards,
  rarityCount,
  SAVE_KEY,
  LEGACY_BACKUP_KEY,
} from '../src/game/model.js';
import { readStoredState, writeStoredState } from '../src/game/save-storage.js';

const copy = (s) => JSON.parse(JSON.stringify(s));
function legacyState() {
  const state = freshState();
  state.cards.UR = 12;
  state.collection.UR = 3;
  moveBinderCard(state, { rarity: 'UR' }, 599);
  openPacks(state, [state.items.find((i) => i.kind === 'pack').id], () => 0.9);
  state.cards = { N: 0, SR: 0, UR: 22, SER: 0, PSER: 0 };
  state.collection = { N: 0, SR: 0, UR: 3, SER: 0, PSER: 0 };
  state.cardStacks[0].cards = Array.from({ length: 10 }, (_, i) => ({
    id: `legacy-card-${i}`,
    rarity: 'UR',
    printId: 'UR',
  }));
  state.favorites = ['UR'];
  state.binder.page = 99;
  state.version = 1;
  delete state.numberedCards;
  for (const card of [
    ...Object.values(state.binder.slots),
    ...state.cardStacks.flatMap((s) => s.cards),
  ])
    delete card.printId;
  return state;
}
test('版本1迁移保留旧卡数量、实体ID、册页、姿态、标记与余额且可重复校验', () => {
  const old = legacyState(),
    migrated = validateState(copy(old));
  assert.equal(migrated.version, 4);
  for (const key of ['cards', 'collection', 'coins', 'favorites', 'history'])
    assert.deepEqual(migrated[key], old[key]);
  assert.equal(migrated.binder.page, 99);
  assert.equal(migrated.binder.slots[599].id, old.binder.slots[599].id);
  assert.equal(migrated.binder.slots[599].printId, 'UR');
  assert.deepEqual(migrated.cardStacks[0].pose3d, old.cardStacks[0].pose3d);
  assert.deepEqual(
    migrated.cardStacks[0].cards.map((c) => c.id),
    old.cardStacks[0].cards.map((c) => c.id),
  );
  assert.equal(warehouseCount(migrated), 9);
  assert.equal(trayCount(migrated), 2);
  assert.deepEqual(validateState(copy(migrated)), migrated);
});
test('早期无收藏字段的十亿张旧卡保持紧凑计数', () => {
  const old = freshState();
  old.version = 1;
  old.cards.N = 1e9;
  delete old.binder;
  delete old.collection;
  delete old.cardStacks;
  delete old.numberedCards;
  const state = validateState(old);
  assert.equal(trayCount(state), 1e9);
  assert.equal(Object.keys(state.binder.slots).length, 0);
  assert.ok(JSON.stringify(state).length < 16000);
});
test('全部328个规格完成仓库、暂存、入册、换位、出册、重载且数量守恒', () => {
  const s = freshState();
  s.items = [];
  s.collation = { cases: [], boxes: [], packs: [] };
  for (const [slot, print] of CARD_PRINTS.entries()) {
    addCards(s, print.id, 1, print.rarity === 'GMR' ? [1] : []);
    transferWarehouseToTray(s, print.id);
    moveBinderCard(s, { printId: print.id }, slot);
    assert.equal(s.binder.slots[slot].printId, print.id);
    validateState(copy(s));
  }
  assert.equal(cardCount(s), 328);
  assert.equal(binderCount(s), 328);
  const first = s.binder.slots[0].id;
  moveBinderCard(s, { slot: 0 }, 317);
  assert.equal(s.binder.slots[317].id, first);
  for (let slot = 0; slot < 328; slot++) moveBinderCard(s, { slot }, 'tray');
  assert.equal(trayCount(s), 328);
  for (const print of CARD_PRINTS) transferCollectionToWarehouse(s, { printId: print.id });
  assert.equal(warehouseCount(s), 328);
  assert.equal(collectionCount(s), 0);
  assert.deepEqual(validateState(copy(s)), s);
});
test('同卡UR、出框UR、SER与旧版UR独立分组和标记，罕贵度可汇总', () => {
  const s = freshState();
  s.items = [];
  s.collation = { cases: [], boxes: [], packs: [] };
  for (const id of ['UR', 'LOCR-JP001-UR', 'LOCR-JP001-UR-OF', 'LOCR-JP001-SER'])
    addCards(s, id, 2);
  transferWarehouseToTray(s, 'LOCR-JP001-UR-OF');
  assert.equal(warehouseCount(s, 'LOCR-JP001-UR'), 2);
  assert.equal(warehouseCount(s, 'LOCR-JP001-UR-OF'), 1);
  assert.equal(rarityCount(s, 'UR'), 6);
  s.favorites = ['LOCR-JP001-UR-OF'];
  assert.deepEqual(validateState(copy(s)).favorites, s.favorites);
  addCards(s, 'LOCR-JP001-SER', 2);
  assert.equal(cardCount(s, 'LOCR-JP001-SER'), 4);
});
test('GMR实体编号在入册和转移中保持唯一身份且耗尽后拒绝重复', () => {
  const s = freshState(),
    key = 'LOCR-JP001-GMR';
  s.items = [];
  s.collation = { cases: [], boxes: [], packs: [] };
  const cards = addCards(
    s,
    key,
    100,
    Array.from({ length: 100 }, (_, i) => i + 1),
  );
  transferWarehouseToTray(s, key, 100);
  moveBinderCard(s, { printId: key }, 0);
  assert.equal(s.binder.slots[0].id, cards[0].id);
  assert.equal(s.binder.slots[0].serial, 1);
  transferCollectionToWarehouse(s, { slot: 0 });
  transferWarehouseToTray(s, key);
  moveBinderCard(s, { printId: key }, 0);
  assert.equal(s.binder.slots[0].id, cards[0].id);
  const before = copy(s);
  assert.throws(() => addCards(s, key, 1, [1]));
  assert.deepEqual(s, before);
  assert.deepEqual(validateState(copy(s)), s);
});
test('真实桌面卡堆分配和GMR编号账册一致', () => {
  const s = freshState(),
    printId = 'LOCR-JP002-GMR';
  s.items = [];
  s.collation = { cases: [], boxes: [], packs: [] };
  const [numbered] = addCards(s, printId, 1, [7]);
  addCards(s, 'LOCR-JP001-UR');
  const { inCollection, ...card } = numbered;
  s.cardStacks.push({
    id: 'real-stack',
    pose3d: { position: [0, 0.2, 3] },
    cards: [card, { id: 'real-ur', printId: 'LOCR-JP001-UR', rarity: 'UR' }],
  });
  assert.equal(warehouseCount(s), 0);
  validateState(copy(s));
  routeStackCards(s, 'real-stack', [card.id], 'collection');
  moveBinderCard(s, { printId }, 0);
  routeStackCards(s, 'real-stack', ['real-ur'], 'warehouse');
  assert.equal(binderCount(s), 1);
  assert.equal(warehouseCount(s), 1);
  assert.deepEqual(validateState(copy(s)), s);
});
test('拒绝非法规格、身份、编号、分配和未来版本', () => {
  const s = freshState();
  s.items = [];
  s.collation = { cases: [], boxes: [], packs: [] };
  addCards(s, 'LOCR-JP001-UR');
  transferWarehouseToTray(s, 'LOCR-JP001-UR');
  moveBinderCard(s, { printId: 'LOCR-JP001-UR' }, 0);
  for (const mutate of [
    (v) => (v.version = 5),
    (v) => (v.cards['LOCR-JP001-SR'] = 1),
    (v) => (v.collection['LOCR-JP001-UR'] = 2),
    (v) => delete v.binder.slots[0].printId,
    (v) => (v.binder.slots[0].rarity = 'SR'),
    (v) => (v.binder.slots[0].serial = 1),
    (v) => (v.cards['LOCR-JP001-GMR'] = 1),
  ]) {
    const bad = copy(s);
    mutate(bad);
    assert.throws(() => validateState(bad));
  }
  const g = freshState();
  g.items = [];
  g.collation = { cases: [], boxes: [], packs: [] };
  addCards(g, 'LOCR-JP001-GMR', 2, [1, 2]);
  for (const mutate of [
    (v) => (v.numberedCards[1].serial = 1),
    (v) => (v.numberedCards[0].serial = 101),
    (v) => (v.numberedCards[0].inCollection = true),
    (v) => (v.numberedCards[0].id = v.numberedCards[1].id),
  ]) {
    const bad = copy(g);
    mutate(bad);
    assert.throws(() => validateState(bad));
  }
});
test('失败的真实规格购买与转移不会扣款或更改库存', () => {
  const s = freshState();
  s.items = [];
  s.collation = { cases: [], boxes: [], packs: [] };
  for (const action of [
    () => purchase(s, 'card', 1, 'LOCR-JP001-SR'),
    () => purchase(s, 'card', 1, 'LOCR-JP001-GMR'),
    () => addCards(s, 'LOCR-JP001-GMR', 1),
    () => transferWarehouseToTray(s, 'LOCR-JP001-UR'),
    () => moveBinderCard(s, { printId: 'LOCR-JP001-UR' }, 0),
  ]) {
    const before = copy(s);
    assert.throws(action);
    assert.deepEqual(s, before);
  }
});
test('存储升级保留原始版本1备份，备份失败不覆盖原始存档', () => {
  const raw = JSON.stringify(legacyState()),
    values = new Map([[SAVE_KEY, raw]]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const s = readStoredState(storage);
  writeStoredState(storage, s);
  assert.equal(values.get(LEGACY_BACKUP_KEY), raw);
  assert.equal(JSON.parse(values.get(SAVE_KEY)).version, 4);
  writeStoredState(storage, s);
  assert.equal(values.get(LEGACY_BACKUP_KEY), raw);
  const blockedValues = new Map([[SAVE_KEY, raw]]);
  const blocked = {
    getItem: (k) => blockedValues.get(k) ?? null,
    setItem: (k, v) => {
      if (k === LEGACY_BACKUP_KEY) throw new Error('quota');
      blockedValues.set(k, v);
    },
  };
  assert.throws(() => writeStoredState(blocked, s));
  assert.equal(blocked.getItem(SAVE_KEY), raw);
});
