import { freshState as freshGameState, makeItem } from '../../src/game/model.js';
import { newCollation, takeSeal } from '../../src/game/collation.js';

// Existing opening and transaction tests use explicit stock and funds, independent of new-game gifts.
export function freshState() {
  const state = freshGameState();
  state.coins = 10000;
  state.maxCoins = 10000;
  state.collation = newCollation();
  state.items = ['case', 'box', 'box', 'pack', 'pack', 'pack'].map((kind) =>
    makeItem(kind, takeSeal(state, kind)),
  );
  return state;
}
