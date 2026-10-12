import { MAX_MONEY, isMoney, toCents } from './money.js';

export function isBalance(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -3 * MAX_MONEY &&
    value <= MAX_MONEY &&
    Number(value.toFixed(2)) === value
  );
}
export function balanceToCents(value) {
  if (!isBalance(value)) throw new Error('金额不正确');
  return Math.round(value * 100);
}
export function balanceFromCents(value) {
  if (!Number.isSafeInteger(value) || value < -3 * MAX_MONEY * 100 || value > MAX_MONEY * 100)
    throw new Error('金额超出上限');
  return value / 100;
}

function snapshot(state) {
  const cents = balanceToCents(state.coins);
  // Older saves have no peak record; preserve their original 500 starter baseline.
  if (state.maxCoins === undefined && cents < 0) throw new Error('存档缺少最高资金记录');
  const recorded = state.maxCoins === undefined ? Math.max(500, state.coins) : state.maxCoins;
  if (!isMoney(recorded)) throw new Error('存档最高资金记录不正确');
  const maxCoins = Math.max(recorded, state.coins);
  if (cents < -3 * toCents(maxCoins)) throw new Error('存档资金低于贷款下限');
  return { cents, maxCoins };
}
export function validateWallet(state) {
  const { maxCoins } = snapshot(state);
  state.maxCoins = maxCoins;
}
export function loanLimit(state) {
  return (3 * toCents(snapshot(state).maxCoins)) / 100;
}
export function quotePurchase(state, cost) {
  const { cents, maxCoins } = snapshot(state);
  const remaining = cents - toCents(cost);
  if (remaining < -3 * toCents(maxCoins)) throw new Error('实在贷不动了');
  return { coins: balanceFromCents(remaining), maxCoins };
}
export function quoteIncome(state, amount) {
  const { cents, maxCoins } = snapshot(state);
  const coins = balanceFromCents(cents + toCents(amount));
  return { coins, maxCoins: Math.max(maxCoins, coins) };
}
