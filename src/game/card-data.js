import { catalogCards, catalogPrints } from '../generated/locr-card-data.js';
import { bonusCards, bonusPrints } from '../generated/vol2-card-data.js';
import { getCardPrice } from './card-prices.js';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const CARD_RARITIES = freeze([
  { id: 'N', name: 'N', color: '#c1c6ca', price: 15 },
  { id: 'SR', name: 'SR', color: '#7bbfda', price: 80 },
  { id: 'UR', name: 'UR', color: '#e7c483', price: 220 },
  { id: 'SER', name: 'SER', color: '#baa3df', price: 650 },
  { id: 'PSER', name: 'PSER', color: '#ed847b', price: 1800 },
  { id: 'UL', name: 'UTR', color: '#d6b17c', price: null },
  { id: 'CR', name: 'CR', color: '#a9d1bf', price: null },
  { id: 'GMR', name: 'GMR', color: '#ebca77', price: null },
]);
export const LEGACY_PRINT_IDS = freeze(['N', 'SR', 'UR', 'SER', 'PSER']);

export const LOCR_CARD_PRINTS = freeze(catalogPrints);
export const BONUS_CARD_PRINTS = freeze(bonusPrints);
export const CARD_CATALOG = freeze([...catalogCards, ...bonusCards]);
export const CARD_PRINTS = freeze([...catalogPrints, ...bonusPrints]);
const byCard = new Map(CARD_CATALOG.map((card) => [card.cardId, card]));
const byPrint = new Map(CARD_PRINTS.map((print) => [print.id, print]));
for (const id of LEGACY_PRINT_IDS) {
  byPrint.set(
    id,
    freeze({
      id,
      cardId: 'legacy-placeholder',
      rarity: id,
      style: id,
      edition: 'legacy',
      overframe: false,
      legacy: true,
      front: '../assets/card-empty.svg',
    }),
  );
}

export const getCard = (cardId) => byCard.get(cardId) ?? null;
export const getCardPrint = (printId) => byPrint.get(printId) ?? null;
export const getRarity = (rarity) => CARD_RARITIES.find((r) => r.id === rarity) ?? null;
// Keep sealed results and saved print IDs compatible; only the visible name changes.
export const displayRarity = (style) => (style === 'UL' ? 'UTR' : style);
export function getCardView(printId) {
  const print = getCardPrint(printId);
  if (!print) return null;
  const card = getCard(print.cardId);
  const r = getRarity(print.rarity);
  return {
    ...r,
    ...print,
    style: displayRarity(print.style),
    price: getCardPrice(printId),
    name: card?.nameZh ?? '旧占位卡',
    nameJa: card?.nameJa ?? '',
    code: card?.cardId ?? '—',
    attack: card ? card.stats.atk : '—',
    defense: card ? card.stats.def : '—',
    image: `./public/${print.assetRoot ?? 'locr-catalog'}/${print.rarity === 'GMR' ? print.front.replace('-front.jpg', '-blank.jpg') : print.front}`,
    label: displayRarity(print.style),
    card,
  };
}

export function findCardPrints({ cardId, rarity, overframe, set, query = '' } = {}) {
  const text = query.trim().toLocaleLowerCase();
  return CARD_PRINTS.filter((print) => {
    const card = getCard(print.cardId);
    return (
      (!cardId || print.cardId === cardId) &&
      (!set || card.cardId.startsWith(`${set}-`)) &&
      (!rarity || print.rarity === rarity) &&
      (overframe === undefined || print.overframe === overframe) &&
      (!text ||
        [
          card.nameZh,
          card.nameJa,
          card.cardId,
          card.password,
          print.style,
          displayRarity(print.style),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(text))
    );
  });
}

export function makeCardRecord(printId, id, serial = null) {
  const print = getCardPrint(printId);
  if (!print || typeof id !== 'string' || !id) throw new Error('卡牌规格或实体 ID 不正确');
  if (
    print.rarity === 'GMR'
      ? !Number.isInteger(serial) || serial < 1 || serial > 100
      : serial !== null
  )
    throw new Error('卡牌编号不正确');
  return { id, printId, rarity: print.rarity, ...(serial === null ? {} : { serial }) };
}
