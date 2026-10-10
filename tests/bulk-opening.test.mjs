import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState,
  openItem,
  openPacks,
  openBoxFully,
  purchase,
  extractItem,
  validateState,
  PRODUCTS,
} from '../src/game/model.js';
import { boxPacks } from '../src/game/collation.js';

const prints = (cards) => cards.map(({ printId, serial }) => ({ printId, serial: serial ?? null }));

test('10包开法与逐包开法保持预定卡面，重复或混合批次不能部分消耗', () => {
  const state = freshState();
  const packs = openItem(state, state.items.find((item) => item.kind === 'box').id).items;
  const singles = structuredClone(state);
  const ids = packs.slice(0, 10).map((item) => item.id);
  const expected = ids.flatMap((id) => openPacks(singles, [id]).cards);
  const before = structuredClone(state);
  assert.throws(() => openPacks(state, [...ids.slice(0, 9), ids[0]]));
  assert.deepEqual(state, before);
  assert.throws(() =>
    openPacks(state, [...ids.slice(0, 9), state.items.find((item) => item.kind === 'bonus').id]),
  );
  assert.deepEqual(state, before);
  const result = openPacks(state, ids);
  assert.equal(result.cards.length, 10 * PRODUCTS.pack.count);
  assert.deepEqual(prints(result.cards), prints(expected));
  assert.deepEqual(state.cards, singles.cards);
  assert.equal(state.opened.pack, 10);
  const after = structuredClone(state);
  assert.throws(() => openPacks(state, ids));
  assert.deepEqual(state, after);
  validateState(structuredClone(state));
});

test('全部打开卡盒保持全盒预定卡面、计数和存档，只消耗所选盒', () => {
  const state = freshState();
  const box = state.items.find((item) => item.kind === 'box');
  const expected = boxPacks(box.seal).flatMap((pack) => pack.cards);
  const otherIds = state.items.filter((item) => item !== box).map((item) => item.id);
  const result = openBoxFully(state, box.id);
  assert.deepEqual(
    prints(result.cards),
    prints(expected.map((card) => ({ ...card, serial: card.serial ?? null }))),
  );
  assert.equal(result.items.length, PRODUCTS.box.count);
  assert.equal(result.cards.length, PRODUCTS.box.count * PRODUCTS.pack.count);
  assert.deepEqual(
    state.items.map((item) => item.id),
    otherIds,
  );
  assert.equal(state.opened.box, 1);
  assert.equal(state.opened.pack, PRODUCTS.box.count);
  assert.equal(state.cardStacks.length, 1);
  validateState(JSON.parse(JSON.stringify(state)));
  const after = structuredClone(state);
  assert.throws(() => openBoxFully(state, box.id));
  assert.deepEqual(state, after);
});

test('全部打开保留GMR编号，卡堆满或持有量溢出时整盒原子拒绝', () => {
  const state = freshState();
  state.coins = state.maxCoins = 10000;
  purchase(state, 'case', 1, 'N', () => 0);
  const boxes = openItem(state, state.items.find((item) => item.kind === 'case').id).items;
  const box = boxes.find((item) =>
    boxPacks(item.seal).some((pack) => pack.cards.some((card) => card.serial)),
  );
  assert.ok(box);
  const containerState = structuredClone(state);
  assert.throws(() => openBoxFully(state, box.id), /拖到桌面/);
  assert.deepEqual(state, containerState);
  extractItem(state, box.id);
  const full = structuredClone(state);
  full.cardStacks = Array.from({ length: 5000 }, () => ({}));
  const beforeFull = structuredClone(full);
  assert.throws(() => openBoxFully(full, box.id), /整理/);
  assert.deepEqual(full, beforeFull);
  const overflow = structuredClone(state);
  overflow.cards[boxPacks(box.seal)[0].cards[0].printId] = 1e9;
  const beforeOverflow = structuredClone(overflow);
  assert.throws(() => openBoxFully(overflow, box.id), /超出上限/);
  assert.deepEqual(overflow, beforeOverflow);
  const result = openBoxFully(state, box.id);
  const numbered = result.cards.find((card) => card.rarity === 'GMR');
  assert.ok(numbered);
  assert.equal(state.numberedCards.find((card) => card.id === numbered.id).serial, numbered.serial);
  validateState(JSON.parse(JSON.stringify(state)));
});
