import { jihuanshePrices } from '../generated/jihuanshe-prices.js';
import { isMoney } from './money.js';

export function isCardPriceExcluded(printId) {
  return jihuanshePrices.excludedPrintIds?.includes(printId) ?? false;
}

export function getCardPrice(printId) {
  if (isCardPriceExcluded(printId)) return null;
  const entry = Object.hasOwn(jihuanshePrices.entries, printId)
    ? jihuanshePrices.entries[printId]
    : null;
  return entry && isMoney(entry.price) && entry.price > 0 ? entry.price : null;
}
