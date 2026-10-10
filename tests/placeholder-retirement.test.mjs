import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
  SAVE_KEY,
} from '../src/game/model.js';
import { makeCardRecord } from '../src/game/card-data.js';
import {
  readStoredState,
  writeStoredState,
  PLACEHOLDER_BACKUP_KEY,
} from '../src/game/save-storage.js';

function fixture() {
  const state = freshState();
  addCards(state, 'UR', 4);
  transferWarehouseToTray(state, 'UR', 1);
  moveBinderCard(state, { printId: 'UR' }, 0);
  addCards(state, 'LOCR-JP001-SER', 2);
  transferWarehouseToTray(state, 'LOCR-JP001-SER', 1);
  moveBinderCard(state, { printId: 'LOCR-JP001-SER' }, 1);
  addCards(state, 'LOCR-JP001-GMR', 1, [37]);
  state.cardStacks.push({
    id: 'mixed-stack',
    cards: [
      makeCardRecord('UR', 'old-stack-card'),
      makeCardRecord('LOCR-JP001-SER', 'real-stack-card'),
    ],
    pose3d: { position: [0, 0.1, 0] },
  });
  state.favorites = ['UR', 'LOCR-JP001-SER'];
  return validateState(state);
}
test('retiring placeholders removes only old holdings and preserves real prints, locations, seals and numbered identity', () => {
  const original = fixture(),
    raw = JSON.stringify(original);
  const values = new Map([[SAVE_KEY, raw]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = readStoredState(storage);
  assert.equal(state.cards.UR, 0);
  assert.equal(state.collection.UR, 0);
  assert.equal(state.binder.slots[0], undefined);
  assert.deepEqual(state.binder.slots[1], original.binder.slots[1]);
  assert.deepEqual(
    state.cardStacks[0].cards.map((card) => card.id),
    ['real-stack-card'],
  );
  assert.deepEqual(state.numberedCards, original.numberedCards);
  assert.deepEqual(state.items, original.items);
  assert.deepEqual(state.collation, original.collation);
  assert.equal(state.coins, original.coins);
  assert.equal(state.cards['LOCR-JP001-SER'], 2);
  assert.deepEqual(state.favorites, ['LOCR-JP001-SER']);
  assert.deepEqual(validateState(structuredClone(state)), state);
  writeStoredState(storage, state);
  assert.equal(storage.getItem(PLACEHOLDER_BACKUP_KEY), raw);
  writeStoredState(storage, state);
  assert.equal(storage.getItem(PLACEHOLDER_BACKUP_KEY), raw);
});
test('a failed retirement backup never overwrites the existing save', () => {
  const raw = JSON.stringify(fixture());
  const values = new Map([[SAVE_KEY, raw]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (key === PLACEHOLDER_BACKUP_KEY) throw new Error('quota');
      values.set(key, value);
    },
  };
  const state = readStoredState(storage);
  assert.throws(() => writeStoredState(storage, state), /quota/);
  assert.equal(storage.getItem(SAVE_KEY), raw);
});
