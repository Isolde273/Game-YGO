import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState as freshGameState,
  openItem,
  openPacks,
  extractItem,
  purchase,
  cardCount,
  countKind,
  validateState,
  randomRarity,
  routeStackCards,
  bringStackCardToFront,
  collectionCount,
  warehouseCount,
  rarityCount,
  addCards,
} from '../src/game/model.js';
import { freshState } from './helpers/starter-state.mjs';

test('新开局为500、三盒LOCR与一包特别包，封装和存档有效', () => {
  const s = freshGameState();
  assert.equal(s.coins, 500);
  assert.equal(s.settings.volume, 50);
  assert.equal(countKind(s, 'case'), 0);
  assert.equal(countKind(s, 'box'), 3);
  assert.equal(countKind(s, 'pack'), 0);
  assert.equal(countKind(s, 'bonus'), 1);
  assert.equal(cardCount(s), 0);
  assert.deepEqual(validateState(structuredClone(s)), s);
  const missingVolume = structuredClone(s);
  delete missingVolume.settings.volume;
  assert.equal(validateState(missingVolume).settings.volume, 50);
  const savedVolume = structuredClone(s);
  savedVolume.settings.volume = 68;
  assert.equal(validateState(savedVolume).settings.volume, 68);
});
test('卡堆置于最前只改顺序，归属、总数和其余卡牌相对次序不变', () => {
  const s = freshState(),
    result = openPacks(s, [s.items.find((i) => i.kind === 'pack').id], () => 0.9),
    stack = result.stack,
    ids = stack.cards.map((c) => c.id),
    collection = collectionCount(s),
    warehouse = warehouseCount(s),
    total = cardCount(s);
  assert.equal(bringStackCardToFront(s, stack.id, ids[2]), true);
  assert.deepEqual(
    stack.cards.map((c) => c.id),
    [...ids.filter((id) => id !== ids[2]), ids[2]],
  );
  assert.equal(bringStackCardToFront(s, stack.id, ids[2]), false);
  assert.equal(collectionCount(s), collection);
  assert.equal(warehouseCount(s), warehouse);
  assert.equal(cardCount(s), total);
  const before = JSON.stringify(s);
  assert.throws(() => bringStackCardToFront(s, stack.id, 'missing'));
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(validateState(JSON.parse(before)), s);
});
test('完整整箱产出链：24 盒、360 包、1440 张卡', () => {
  const s = freshState();
  s.items = s.items.filter((i) => i.kind === 'case');
  openItem(s, s.items[0].id);
  assert.equal(countKind(s, 'box'), 24);
  for (const id of s.items.map((i) => i.id)) openItem(s, id);
  assert.equal(countKind(s, 'pack'), 360);
  for (const id of s.items.map((i) => i.id)) openItem(s, id, () => 0.9);
  assert.equal(s.items.length, 0);
  assert.equal(cardCount(s), 1440);
  assert.equal(rarityCount(s, 'SR'), 720);
  assert.deepEqual(s.opened, { case: 1, box: 24, pack: 360, bonus: 0 });
});
test('同一个物品不能重复打开', () => {
  const s = freshState(),
    id = s.items[0].id;
  openItem(s, id);
  const total = s.items.length;
  assert.throws(() => openItem(s, id));
  assert.equal(s.items.length, total);
  assert.equal(s.opened.case, 1);
});
test('购买整箱准确扣币并入库', () => {
  const s = freshState();
  s.coins = 20000;
  purchase(s, 'case', 2);
  assert.equal(s.coins, 4002);
  assert.equal(countKind(s, 'case'), 3);
  assert.equal(s.history.length, 1);
});
test('旧占位规格或缺少集换价的单卡拒绝订单且不改变库存和余额', () => {
  const s = freshState();
  const before = JSON.stringify(s);
  for (const id of ['PSER', 'unknown-card-specification'])
    assert.throws(() => purchase(s, 'card', 3, id), /规格不存在/);
  assert.equal(JSON.stringify(s), before);
});
test('贷款额度不足或无效订单不会改变进度', () => {
  const s = freshState();
  s.coins = -3 * s.maxCoins + 10;
  const before = JSON.stringify(s);
  assert.throws(() => purchase(s, 'case'));
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => purchase(s, 'box', 0));
  assert.throws(() => purchase(s, 'box', 100));
  assert.throws(() => purchase(s, 'card', 1, 'FAKE'));
  assert.equal(JSON.stringify(s), before);
});
test('稀有度边界与权重', () => {
  assert.deepEqual(
    [0, 0.58, 0.84, 0.96, 0.995, 0.999999].map((n) => randomRarity(() => n)),
    ['N', 'SR', 'UR', 'SER', 'PSER', 'PSER'],
  );
});
test('存档可恢复开盒、购买、摆放和收藏记录', () => {
  const s = freshState();
  addCards(s, 'LOCR-JP001-SER', 2);
  openItem(s, s.items.find((i) => i.kind === 'pack').id, () => 0.999);
  s.favorites = ['PSER'];
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);
  assert.equal(cardCount(restored), 6);
});
test('拒绝损坏存档、重复物品、无效数量', () => {
  const s = freshState();
  assert.throws(() => validateState({ ...s, coins: -3 * s.maxCoins - 0.01 }));
  assert.throws(() => validateState({ ...s, items: [s.items[0], s.items[0]] }));
  assert.throws(() => validateState({ ...s, cards: { ...s.cards, N: NaN } }));
  assert.throws(() => validateState({ ...s, items: [{ ...s.items[0], x: Infinity }] }));
});
test('连续开包、保存后不重复产出', () => {
  const s = freshState(),
    id = s.items.find((i) => i.kind === 'pack').id;
  openItem(s, id);
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.throws(() => openItem(restored, id));
  assert.equal(cardCount(restored), 4);
});
test('3D 摆放与旧存档兼容，丢弃损坏的 3D 姿态', () => {
  const s = freshState();
  s.items[0].pose3d = { position: [2, 0.86, -1], quaternion: [0, 0, 0, 1] };
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))).items[0].pose3d, s.items[0].pose3d);
  s.items[1].pose3d = { position: [NaN, 0, 0], quaternion: [1, 1, 1, 1] };
  assert.equal(validateState(s).items[1].pose3d, undefined);
  assert.equal(s.items.length, 6);
});
test('物品上限时交易和开箱不丢失余额或物品', () => {
  const s = freshState();
  const original = s.items[0];
  s.items = Array.from({ length: 5000 }, (_, i) => ({ ...original, id: 'limit-' + i }));
  const before = JSON.stringify(s);
  assert.throws(() => purchase(s, 'box'));
  assert.throws(() => openItem(s, 'limit-0'));
  assert.equal(JSON.stringify(s), before);
});
test('拆箱的二十四盒保存唯一槽位，取出与拆盒不会重复产出', () => {
  const s = freshState(),
    result = openItem(s, s.items.find((i) => i.kind === 'case').id);
  assert.equal(s.containers.length, 1);
  assert.equal(result.items.length, 24);
  assert.deepEqual(
    result.items.map((i) => i.slotIndex),
    Array.from({ length: 24 }, (_, i) => i),
  );
  assert.ok(result.items.every((i) => i.containerId === result.container.id && !i.isNew));
  const restored = validateState(JSON.parse(JSON.stringify(s))),
    first = result.items[0].id;
  extractItem(restored, first);
  assert.equal(restored.items.find((i) => i.id === first).containerId, undefined);
  assert.equal(restored.items.filter((i) => i.containerId).length, 23);
  assert.equal(countKind(restored, 'box'), 26);
  openItem(restored, first);
  assert.equal(countKind(restored, 'pack'), 18);
  assert.throws(() => openItem(restored, first));
  validateState(restored);
});
test('旧存档兼容，拒绝重复槽位和不存在的箱体引用', () => {
  const s = freshState();
  delete s.containers;
  assert.deepEqual(validateState(s).containers, []);
  openItem(s, s.items.find((i) => i.kind === 'case').id);
  const copy = () => JSON.parse(JSON.stringify(s));
  let bad = copy(),
    inside = bad.items.filter((i) => i.containerId);
  inside[1].slotIndex = inside[0].slotIndex;
  assert.throws(() => validateState(bad));
  bad = copy();
  bad.items.find((i) => i.containerId).containerId = 'missing';
  assert.throws(() => validateState(bad));
});
test('取完十二盒后自动收纳空箱，继续开箱时不堵塞桌面', () => {
  const s = freshState(),
    result = openItem(s, s.items.find((i) => i.kind === 'case').id);
  result.items.forEach((i) => extractItem(s, i.id));
  assert.equal(s.containers.length, 0);
  assert.equal(countKind(s, 'box'), 26);
  validateState(s);
});
test('五包批量打开一次获得二十张，重复或无效批次不会部分消耗', () => {
  const s = freshState();
  purchase(s, 'pack', 5);
  const ids = s.items
    .filter((i) => i.kind === 'pack')
    .slice(0, 5)
    .map((i) => i.id);
  const before = JSON.stringify(s);
  assert.throws(() => openPacks(s, [...ids.slice(0, 4), ids[0]]));
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => openPacks(s, ids.slice(0, 4)));
  assert.equal(JSON.stringify(s), before);
  assert.equal(openPacks(s, ids, () => 0.96).cards.length, 20);
  assert.equal(rarityCount(s, 'SR'), 10);
  assert.equal(s.opened.pack, 5);
  const after = JSON.stringify(s);
  assert.throws(() => openPacks(s, ids));
  assert.equal(JSON.stringify(s), after);
  validateState(s);
});
test('自由视角可保存，非法视角回退而不破坏库存', () => {
  const s = freshState();
  s.spaceView = { orbit: { theta: 0.2, phi: 0.5, distance: 14 }, target: [2, 0.15, -1] };
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))).spaceView, s.spaceView);
  s.spaceView.orbit.distance = NaN;
  assert.equal(validateState(s).spaceView, undefined);
  assert.equal(s.items.length, 6);
});
test('桌面卡堆分配到收藏和仓库，互不重复且持有总数不变', () => {
  const s = freshState(),
    pack = s.items.find((i) => i.kind === 'pack'),
    result = openPacks(s, [pack.id], () => 0.9),
    stack = result.stack;
  assert.equal(cardCount(s), 4);
  assert.equal(collectionCount(s), 0);
  assert.equal(warehouseCount(s), 0);
  assert.equal(stack.cards.length, 4);
  const first = stack.cards[0].id;
  routeStackCards(s, stack.id, [first], 'collection');
  assert.equal(collectionCount(s), 1);
  assert.equal(warehouseCount(s), 0);
  const before = JSON.stringify(s);
  assert.throws(() => routeStackCards(s, stack.id, [first], 'warehouse'));
  assert.equal(JSON.stringify(s), before);
  assert.throws(() =>
    routeStackCards(s, stack.id, [stack.cards[0].id, stack.cards[0].id], 'collection'),
  );
  assert.equal(JSON.stringify(s), before);
  routeStackCards(
    s,
    stack.id,
    stack.cards.map((c) => c.id),
    'warehouse',
  );
  assert.equal(s.cardStacks.length, 0);
  assert.equal(warehouseCount(s), 3);
  assert.equal(collectionCount(s), 1);
  assert.equal(cardCount(s), 4);
  validateState(s);
});
test('待整理卡堆和已分配卡牌可恢复；旧版收藏迁移保留原有卡牌', () => {
  const s = freshState(),
    result = openItem(s, s.items.find((i) => i.kind === 'pack').id, () => 0.6);
  routeStackCards(s, result.stack.id, [result.stack.cards[0].id], 'warehouse');
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.cardStacks, s.cardStacks);
  assert.equal(warehouseCount(restored), 1);
  assert.equal(cardCount(restored), 4);
  const legacy = freshState();
  legacy.cards.UR = 8;
  delete legacy.collection;
  delete legacy.cardStacks;
  validateState(legacy);
  assert.equal(collectionCount(legacy, 'UR'), 8);
  assert.equal(cardCount(legacy), 8);
  assert.equal(warehouseCount(legacy), 0);
  const invalid = JSON.parse(JSON.stringify(s));
  invalid.collection.SR = 10;
  assert.throws(() => validateState(invalid));
  const duplicate = JSON.parse(JSON.stringify(s));
  duplicate.cardStacks[0].cards[1].id = duplicate.cardStacks[0].cards[0].id;
  assert.throws(() => validateState(duplicate));
});
test('卡堆拿取的三维朝向可恢复，旧存档兼容且无效朝向不会损坏卡牌', () => {
  const s = freshState(),
    { stack } = openPacks(s, [s.items.find((i) => i.kind === 'pack').id], () => 0.9);
  stack.pose3d = { position: [2, 1.8, -3], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.cardStacks[0].pose3d, stack.pose3d);
  stack.pose3d.quaternion = [1, 1, 1, 1];
  validateState(s);
  assert.equal(stack.pose3d.quaternion, undefined);
  assert.equal(stack.cards.length, 4);
  assert.equal(cardCount(s), 4);
});

test('overhead room view retains wheel zoom through save validation', async () => {
  const { ROOM_PHI } = await import('../src/scene/room-view.js');
  const s = freshState();
  s.spaceView = { orbit: { theta: 0, phi: ROOM_PHI, distance: 17.5 }, target: [0, 0.04, 0] };
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.spaceView, s.spaceView);
  s.spaceView.orbit.phi = ROOM_PHI - 0.01;
  assert.equal(validateState(s).spaceView, undefined);
});
