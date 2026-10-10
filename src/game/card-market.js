import { CARD_PRINTS, getCardPrint, getCardView } from './card-data.js';
import { getCardPrice, isCardPriceExcluded } from './card-prices.js';
import { addCards } from './card-inventory.js';
import { numberedReservations } from './collation.js';
import { multiplyMoney } from './money.js';
import { quotePurchase } from './wallet.js';

export function marketCards({
  search = '',
  rarity = 'all',
  cardType = 'all',
  order = 'code',
} = {}) {
  const query = search.trim().toLocaleLowerCase();
  const cards = CARD_PRINTS.filter((print) => !isCardPriceExcluded(print.id))
    .map((print) => getCardView(print.id))
    .filter(
      (view) =>
        (rarity === 'all' || view.rarity === rarity) &&
        (cardType === 'all' || view.card.cardType === cardType) &&
        (!query ||
          [view.name, view.nameJa, view.code, view.id, view.card.password, view.label]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)),
    );
  return cards.sort((a, b) => {
    if (order === 'price-asc' || order === 'price-desc') {
      if (a.price === null || b.price === null)
        return a.price === b.price ? a.id.localeCompare(b.id) : a.price === null ? 1 : -1;
      const difference = order === 'price-asc' ? a.price - b.price : b.price - a.price;
      if (difference) return difference;
    }
    return a.id.localeCompare(b.id);
  });
}

export function availableCardQuantity(state, printId) {
  const print = getCardPrint(printId);
  if (!print || print.legacy || isCardPriceExcluded(printId)) return 0;
  if (print.rarity !== 'GMR') return Math.max(0, Math.min(99, 1e9 - (state.cards[printId] ?? 0)));
  const reserved = numberedReservations(state);
  let count = 0;
  for (let serial = 1; serial <= 100; serial++) if (!reserved.has(`${printId}:${serial}`)) count++;
  return Math.min(99, count);
}

export function purchaseCard(state, printId, quantity) {
  const print = getCardPrint(printId);
  if (!print || print.legacy) throw new Error('单卡规格不存在');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
    throw new Error('数量应为 1–99');
  const price = getCardPrice(printId);
  if (price === null) throw new Error('该卡暂无报价');
  if (quantity > availableCardQuantity(state, printId)) throw new Error('单卡库存不足');
  const cost = multiplyMoney(price, quantity);
  const wallet = quotePurchase(state, cost);
  const serials = [];
  if (print.rarity === 'GMR') {
    const reserved = numberedReservations(state);
    for (let serial = 1; serial <= 100 && serials.length < quantity; serial++)
      if (!reserved.has(`${printId}:${serial}`)) serials.push(serial);
  }
  const draft = {
    ...state,
    cards: { ...state.cards },
    collection: { ...state.collection },
    numberedCards: state.numberedCards.slice(),
  };
  const records = addCards(draft, printId, quantity, serials);
  state.cards = draft.cards;
  state.collection = draft.collection;
  state.numberedCards = draft.numberedCards;
  Object.assign(state, wallet);
  state.history.unshift({
    text: `购入 ${quantity} 张 ${getCardView(printId).name} ${print.style} · ${cost}`,
    date: new Date().toISOString(),
  });
  state.history = state.history.slice(0, 60);
  return { cost, items: records, bonusCount: 0 };
}
