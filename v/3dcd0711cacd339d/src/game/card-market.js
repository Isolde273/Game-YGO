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

// Group by the visible card name while keeping every distinct print purchasable.
export function marketCardGroups({ selectedPrints = {}, ...filters } = {}) {
  const grouped = new Map();
  for (const print of marketCards(filters)) {
    if (!grouped.has(print.name)) grouped.set(print.name, { name: print.name, prints: [] });
    grouped.get(print.name).prints.push(print);
  }
  const styleOrder = [
    'N',
    'NR',
    'R',
    'SR',
    'UR',
    'SER',
    'UL',
    'CR',
    'PSER',
    'UR-OF',
    'PSER-OF',
    'GMR',
  ];
  const groups = [...grouped.values()];
  for (const group of groups) {
    if (!filters.order || filters.order === 'code')
      group.prints.sort(
        (a, b) =>
          styleOrder.indexOf(a.style === 'UTR' ? 'UL' : a.style) -
            styleOrder.indexOf(b.style === 'UTR' ? 'UL' : b.style) || a.id.localeCompare(b.id),
      );
    const selectedId = Object.hasOwn(selectedPrints, group.name)
      ? selectedPrints[group.name]
      : null;
    group.selected = group.prints.find((print) => print.id === selectedId) ?? group.prints[0];
  }
  if (filters.order === 'price-asc' || filters.order === 'price-desc')
    groups.sort((a, b) => {
      const first = a.selected,
        second = b.selected;
      if (first.price === null || second.price === null)
        return first.price === second.price
          ? first.id.localeCompare(second.id)
          : first.price === null
            ? 1
            : -1;
      const difference =
        filters.order === 'price-asc' ? first.price - second.price : second.price - first.price;
      return difference || first.id.localeCompare(second.id);
    });
  return groups;
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
