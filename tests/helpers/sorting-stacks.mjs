// Real prints exercise sorting with large, predictable mixed stacks.
// These do not simulate the production LOCR draw rules.
import { CARD_PRINTS, makeCardRecord } from '../../src/game/card-data.js';
import { randomRarity, addHistory, addCards } from '../../src/game/model.js';
import { CARD_STEP } from '../../src/scene/packing.js';
export const fixturePrintId = (rarity) => {
  const style = rarity === 'N' ? 'CR' : rarity;
  return CARD_PRINTS.find((print) => print.rarity === style && print.style === style).id;
};
export function openFixturePacks(state, ids, random = Math.random) {
  const cards = Array.from({ length: ids.length * 10 }, () => {
    const rarity = randomRarity(random);
    const printId = fixturePrintId(rarity);
    addCards(state, printId);
    return makeCardRecord(printId, crypto.randomUUID());
  });
  state.items = state.items.filter((i) => !ids.includes(i.id));
  state.opened.pack += ids.length;
  const stack = {
    id: crypto.randomUUID(),
    cards,
    pose3d: { position: [0, 0.084 + (cards.length * CARD_STEP) / 2, 1.35] },
  };
  state.cardStacks.push(stack);
  addHistory(state, '测试混合卡堆');
  return { kind: 'card', cards, stack };
}
