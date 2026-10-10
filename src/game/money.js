export const MAX_MONEY = 1e12;
export function isMoney(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_MONEY &&
    Number(value.toFixed(2)) === value
  );
}
export function toCents(value) {
  if (!isMoney(value)) throw new Error('金额不正确');
  return Math.round(value * 100);
}
export function fromCents(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY * 100)
    throw new Error('金额超出上限');
  return value / 100;
}
export function multiplyMoney(price, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('数量不正确');
  return fromCents(toCents(price) * quantity);
}
export function sumMoney(values) {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0));
}
