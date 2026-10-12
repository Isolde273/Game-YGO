import { getCardView } from './card-data.js';
import { inventoryKeys, warehouseCount } from './card-inventory.js';
import { getCardPrice } from './card-prices.js';
import { PRODUCTS } from './model.js';
import { productIdOf } from './products.js';
import { isMoney, multiplyMoney, sumMoney } from './money.js';
import { quoteIncome } from './wallet.js';

const productKinds = Object.keys(PRODUCTS);
export function saleUnitPrice(entry) {
  return entry.kind === 'cards'
    ? getCardPrice(entry.printId)
    : (PRODUCTS[entry.productId ?? entry.kind]?.price ?? null);
}
export function stackSaleValue(stack) {
  const prices = stack?.cards.map((card) => getCardPrice(card.printId)) ?? [];
  if (!prices.length || prices.some((price) => price === null)) return null;
  try {
    return sumMoney(prices);
  } catch {
    return null;
  }
}

export function warehouseSaleEntries(state) {
  const entries = [];
  for (const kind of productKinds) {
    const items = state.items.filter((item) => productIdOf(item) === kind);
    if (items.length)
      entries.push({
        key: `item:${kind}`,
        kind: PRODUCTS[kind].kind,
        ...(PRODUCTS[kind].set === 'LOCH' ? { productId: kind } : {}),
        quantity: items.length,
        itemIds: items.map((item) => item.id),
      });
  }
  const placed = new Set(
    [...Object.values(state.binder.slots), ...state.cardStacks.flatMap((stack) => stack.cards)].map(
      (card) => card.id,
    ),
  );
  for (const printId of inventoryKeys(state)) {
    const card = getCardView(printId),
      quantity = warehouseCount(state, printId);
    if (!quantity) continue;
    if (card.rarity === 'GMR') {
      for (const numbered of state.numberedCards.filter(
        (record) => record.printId === printId && !record.inCollection && !placed.has(record.id),
      ))
        entries.push({
          key: `number:${numbered.id}`,
          kind: 'cards',
          printId,
          serial: numbered.serial,
          cardId: numbered.id,
          quantity: 1,
        });
    } else entries.push({ key: `card:${printId}`, kind: 'cards', printId, quantity });
  }
  return entries;
}

function valueFor(state, quantity, value) {
  if (value === null) throw new Error('卡牌暂无报价');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !isMoney(value))
    throw new Error('出售数量或金额超出上限');
  quoteIncome(state, value);
  return value;
}
function recordSale(state, quantity, value) {
  Object.assign(state, quoteIncome(state, value));
  state.history.unshift({
    text: `出售 ${quantity} 件 · ＋${value}`,
    date: new Date().toISOString(),
  });
  state.history = state.history.slice(0, 60);
}

export function quoteWarehouseSale(state, selections) {
  if (
    !Array.isArray(selections) ||
    !selections.length ||
    new Set(selections.map((s) => s?.key)).size !== selections.length
  )
    throw new Error('请选择出售物品');
  const available = new Map(warehouseSaleEntries(state).map((entry) => [entry.key, entry]));
  const entries = selections.map((selection) => {
    if (!selection || typeof selection.key !== 'string') throw new Error('请选择出售物品');
    const entry = available.get(selection.key),
      quantity = selection.quantity;
    if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity)
      throw new Error('出售数量超出可用库存');
    const unitPrice = saleUnitPrice(entry);
    if (unitPrice === null) throw new Error('卡牌暂无报价');
    return { ...entry, quantity, unitPrice, value: multiplyMoney(unitPrice, quantity) };
  });
  const quantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  return {
    entries,
    quantity,
    value: valueFor(state, quantity, sumMoney(entries.map((entry) => entry.value))),
  };
}

export function sellWarehouse(state, selections) {
  // Validate the complete mixed order before touching any inventory or balance.
  const sale = quoteWarehouseSale(state, selections);
  const removedItems = new Set(),
    removedNumbers = new Set();
  for (const entry of sale.entries) {
    if (entry.itemIds) entry.itemIds.slice(0, entry.quantity).forEach((id) => removedItems.add(id));
    else {
      state.cards[entry.printId] -= entry.quantity;
      if (entry.cardId) removedNumbers.add(entry.cardId);
    }
  }
  state.items = state.items.filter((item) => !removedItems.has(item.id));
  state.numberedCards = state.numberedCards.filter((card) => !removedNumbers.has(card.id));
  state.containers = state.containers.filter((container) =>
    state.items.some((item) => item.containerId === container.id),
  );
  recordSale(state, sale.quantity, sale.value);
  return sale;
}

export function sellStack(state, stackId) {
  const stack = state.cardStacks.find((entry) => entry.id === stackId);
  if (!stack?.cards.length) throw new Error('这个卡堆已不存在');
  const value = valueFor(state, stack.cards.length, stackSaleValue(stack));
  const counts = new Map(),
    numbers = new Set();
  for (const card of stack.cards) {
    counts.set(card.printId, (counts.get(card.printId) ?? 0) + 1);
    if (card.serial) numbers.add(card.id);
  }
  for (const [printId, quantity] of counts) {
    if ((state.cards[printId] ?? 0) - (state.collection[printId] ?? 0) < quantity)
      throw new Error('卡堆库存不正确');
  }
  for (const [printId, quantity] of counts) state.cards[printId] -= quantity;
  state.numberedCards = state.numberedCards.filter((card) => !numbers.has(card.id));
  state.cardStacks = state.cardStacks.filter((entry) => entry !== stack);
  recordSale(state, stack.cards.length, value);
  return { cards: [...stack.cards], quantity: stack.cards.length, value };
}
