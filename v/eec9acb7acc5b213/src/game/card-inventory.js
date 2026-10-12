import { LEGACY_PRINT_IDS, CARD_PRINTS, getCardPrint, makeCardRecord } from './card-data.js';
import { numberedReservations } from './collation.js';

const uid = () => globalThis.crypto.randomUUID();
export const emptyCardCounts = () => Object.fromEntries(LEGACY_PRINT_IDS.map((id) => [id, 0]));
export function hasLegacyPlaceholders(state) {
  return LEGACY_PRINT_IDS.some((id) => state.cards?.[id] > 0);
}
export function retireLegacyPlaceholders(state) {
  for (const id of LEGACY_PRINT_IDS) {
    state.cards[id] = 0;
    state.collection[id] = 0;
  }
  state.cardStacks = state.cardStacks.filter((stack) => {
    stack.cards = stack.cards.filter((card) => !getCardPrint(card.printId)?.legacy);
    return stack.cards.length > 0;
  });
  for (const [slot, card] of Object.entries(state.binder.slots))
    if (getCardPrint(card.printId)?.legacy) delete state.binder.slots[slot];
  state.favorites = state.favorites.filter((id) => !getCardPrint(id)?.legacy);
  return state;
}
const dictionary = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validCount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1e9;
const recordTransfer = (state, text) => {
  state.history.unshift({ text, date: new Date().toISOString() });
  state.history = state.history.slice(0, 60);
};

export function validateCardInventory(state, ids, migrating) {
  if (!dictionary(state.cards) || !LEGACY_PRINT_IDS.every((id) => validCount(state.cards[id])))
    throw new Error('存档卡牌数据不正确');
  state.collection ??= { ...state.cards };
  if (!dictionary(state.collection)) throw new Error('存档收藏数量不正确');
  for (const key of new Set([...Object.keys(state.cards), ...Object.keys(state.collection)])) {
    if (
      !getCardPrint(key) ||
      (migrating && !LEGACY_PRINT_IDS.includes(key)) ||
      !validCount(state.cards[key]) ||
      !validCount(state.collection[key] ?? 0) ||
      (state.collection[key] ?? 0) > state.cards[key]
    )
      throw new Error('存档卡牌规格或数量不正确');
    state.collection[key] ??= 0;
  }
  state.cardStacks ??= [];
  if (!Array.isArray(state.cardStacks) || state.cardStacks.length > 5000)
    throw new Error('存档卡堆数量不正确');
  const pending = {},
    bound = {},
    physical = new Map();
  const checkCard = (card) => {
    if (migrating && card && card.printId === undefined) card.printId = card.rarity;
    const print = getCardPrint(card?.printId);
    if (
      !print ||
      !card.id ||
      typeof card.id !== 'string' ||
      ids.has(card.id) ||
      card.rarity !== print.rarity ||
      (migrating && !print.legacy) ||
      (print.rarity === 'GMR'
        ? !Number.isInteger(card.serial) || card.serial < 1 || card.serial > 100
        : card.serial !== undefined)
    )
      throw new Error('存档包含无效卡牌身份');
    ids.add(card.id);
    physical.set(card.id, card);
  };
  for (const stack of state.cardStacks) {
    if (
      !stack ||
      typeof stack.id !== 'string' ||
      ids.has(stack.id) ||
      !Array.isArray(stack.cards) ||
      stack.cards.length < 1 ||
      stack.cards.length > 60 ||
      !stack.pose3d ||
      !Array.isArray(stack.pose3d.position) ||
      stack.pose3d.position.length !== 3 ||
      !stack.pose3d.position.every((n) => Number.isFinite(n) && Math.abs(n) <= 80)
    )
      throw new Error('存档卡堆数据不正确');
    ids.add(stack.id);
    const q = stack.pose3d.quaternion;
    if (
      q &&
      (!Array.isArray(q) ||
        q.length !== 4 ||
        !q.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) ||
        Math.abs(q.reduce((sum, n) => sum + n * n, 0) - 1) > 0.05)
    )
      delete stack.pose3d.quaternion;
    for (const card of stack.cards) {
      checkCard(card);
      pending[card.printId] = (pending[card.printId] ?? 0) + 1;
    }
  }
  state.binder ??= { slots: {}, page: 1 };
  const binder = state.binder;
  if (
    !dictionary(binder.slots) ||
    Object.keys(binder.slots).length > 600 ||
    !Number.isInteger(binder.page) ||
    binder.page < 1 ||
    binder.page > 100
  )
    throw new Error('存档册页数据不正确');
  for (const [key, card] of Object.entries(binder.slots)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= 600) throw new Error('存档卡位数据不正确');
    checkCard(card);
    bound[card.printId] = (bound[card.printId] ?? 0) + 1;
  }
  for (const key of new Set([
    ...Object.keys(state.cards),
    ...Object.keys(pending),
    ...Object.keys(bound),
  ])) {
    if (
      (pending[key] ?? 0) + (state.collection[key] ?? 0) > (state.cards[key] ?? 0) ||
      (bound[key] ?? 0) > (state.collection[key] ?? 0)
    )
      throw new Error('存档卡牌分配数量不正确');
  }
  state.numberedCards ??= [];
  if (
    !Array.isArray(state.numberedCards) ||
    state.numberedCards.length > CARD_PRINTS.filter((p) => p.rarity === 'GMR').length * 100
  )
    throw new Error('存档编号卡数量不正确');
  const numbers = new Set(),
    numberedIds = new Set(),
    numbered = {},
    collected = {};
  const binderIds = new Set(Object.values(binder.slots).map((c) => c.id));
  for (const card of state.numberedCards) {
    const print = getCardPrint(card?.printId),
      reference = physical.get(card?.id);
    const numberKey = `${card?.printId}:${card?.serial}`;
    if (
      !print ||
      print.rarity !== 'GMR' ||
      typeof card.id !== 'string' ||
      !card.id ||
      card.rarity !== 'GMR' ||
      !Number.isInteger(card.serial) ||
      card.serial < 1 ||
      card.serial > 100 ||
      typeof card.inCollection !== 'boolean' ||
      numberedIds.has(card.id) ||
      numbers.has(numberKey) ||
      (ids.has(card.id) && !reference) ||
      (reference &&
        (reference.printId !== card.printId ||
          reference.serial !== card.serial ||
          card.inCollection !== binderIds.has(card.id)))
    )
      throw new Error('存档编号卡身份不正确或重复');
    numberedIds.add(card.id);
    numbers.add(numberKey);
    ids.add(card.id);
    numbered[card.printId] = (numbered[card.printId] ?? 0) + 1;
    if (card.inCollection) collected[card.printId] = (collected[card.printId] ?? 0) + 1;
  }
  for (const card of physical.values()) {
    if (card.rarity === 'GMR' && !numberedIds.has(card.id)) throw new Error('存档缺少编号卡记录');
  }
  for (const key of new Set([...Object.keys(state.cards), ...Object.keys(numbered)])) {
    if (
      getCardPrint(key)?.rarity === 'GMR' &&
      ((numbered[key] ?? 0) !== state.cards[key] ||
        (collected[key] ?? 0) !== (state.collection[key] ?? 0))
    )
      throw new Error('存档编号卡数量不一致');
  }
}

export function addCards(state, printId, quantity = 1, serials = []) {
  const print = getCardPrint(printId);
  if (
    !print ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1e9 ||
    (state.cards[printId] ?? 0) + quantity > 1e9 ||
    !Array.isArray(serials)
  )
    throw new Error('卡牌规格或数量不正确');
  const records = [];
  if (print.rarity === 'GMR') {
    const reserved = numberedReservations(state);
    if (
      serials.length !== quantity ||
      new Set(serials).size !== quantity ||
      serials.some(
        (serial) =>
          !Number.isInteger(serial) ||
          serial < 1 ||
          serial > 100 ||
          reserved.has(`${printId}:${serial}`),
      )
    )
      throw new Error('GMR 需要不重复的 001–100 编号');
    for (const serial of serials)
      records.push({ ...makeCardRecord(printId, uid(), serial), inCollection: false });
  } else if (serials.length) throw new Error('此规格不使用编号');
  state.cards[printId] = (state.cards[printId] ?? 0) + quantity;
  state.collection[printId] ??= 0;
  state.numberedCards.push(...records);
  return records;
}

export const inventoryKeys = (state) =>
  Object.keys(state.cards).filter((id) => state.cards[id] > 0);
export const ownedCount = (state, printId) =>
  printId ? (state.cards[printId] ?? 0) : Object.values(state.cards).reduce((a, b) => a + b, 0);
export const collectionCount = (state, printId) =>
  printId
    ? (state.collection?.[printId] ?? 0)
    : Object.values(state.collection ?? {}).reduce((a, b) => a + b, 0);
export const binderCount = (state, printId) =>
  Object.values(state.binder?.slots ?? {}).filter((c) => !printId || c.printId === printId).length;
export const trayCount = (state, printId) =>
  collectionCount(state, printId) - binderCount(state, printId);
export const warehouseCount = (state, printId) => {
  const stacks = state.cardStacks ?? [];
  if (!printId)
    return (
      ownedCount(state) -
      collectionCount(state) -
      stacks.reduce((count, stack) => count + stack.cards.length, 0)
    );
  let onTable = 0;
  for (const stack of stacks)
    for (const card of stack.cards) if (card.printId === printId) onTable++;
  return ownedCount(state, printId) - collectionCount(state, printId) - onTable;
};
export function rarityCount(state, rarity) {
  return inventoryKeys(state)
    .filter((id) => getCardPrint(id).rarity === rarity)
    .reduce((n, id) => n + ownedCount(state, id), 0);
}
const freeNumbered = (state, printId, inCollection) => {
  const placed = new Set(
    [...Object.values(state.binder.slots), ...state.cardStacks.flatMap((s) => s.cards)].map(
      (c) => c.id,
    ),
  );
  return state.numberedCards.filter(
    (c) => c.printId === printId && c.inCollection === inCollection && !placed.has(c.id),
  );
};
const sourceKey = (source) => source?.printId ?? source?.rarity;
export function moveBinderCard(state, source, destination) {
  const slots = state.binder.slots,
    fromSlot = source && Object.hasOwn(source, 'slot');
  const validSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < 600;
  const key = sourceKey(source);
  if (
    !source ||
    (fromSlot
      ? !validSlot(source.slot) || !slots[source.slot]
      : !getCardPrint(key) || trayCount(state, key) < 1)
  )
    throw new Error('请先选择一张可用的卡牌');
  if (destination !== 'tray' && !validSlot(destination))
    throw new Error('请选择 1–100 页的有效卡位');
  if ((fromSlot && destination === source.slot) || (!fromSlot && destination === 'tray'))
    return false;
  let card = fromSlot ? slots[source.slot] : null;
  if (!card) {
    const numbered = getCardPrint(key).rarity === 'GMR' ? freeNumbered(state, key, true)[0] : null;
    card = numbered
      ? makeCardRecord(key, numbered.id, numbered.serial)
      : makeCardRecord(key, uid());
  }
  const displaced = destination === 'tray' ? null : slots[destination];
  if (fromSlot) {
    delete slots[source.slot];
    if (displaced) slots[source.slot] = displaced;
  }
  if (destination !== 'tray') slots[destination] = card;
  return true;
}
export function transferWarehouseToTray(state, printId, quantity = 1) {
  if (
    !getCardPrint(printId) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > warehouseCount(state, printId)
  )
    throw new Error('转入数量超出仓库库存');
  for (const card of freeNumbered(state, printId, false).slice(0, quantity))
    card.inCollection = true;
  state.collection[printId] = (state.collection[printId] ?? 0) + quantity;
  recordTransfer(state, `${quantity} 张 ${getCardPrint(printId).style} 转入收藏暂存区`);
}
export function transferCollectionToWarehouse(state, source, quantity = 1) {
  const card = source?.slot !== undefined ? state.binder.slots[source.slot] : null;
  const key = card?.printId ?? sourceKey(source);
  if (
    !getCardPrint(key) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    (source?.slot !== undefined ? !card || quantity !== 1 : quantity > trayCount(state, key))
  )
    throw new Error('转出数量超出暂存区库存');
  if (card) {
    delete state.binder.slots[source.slot];
    const numbered = state.numberedCards.find((c) => c.id === card.id);
    if (numbered) numbered.inCollection = false;
  } else
    for (const numbered of freeNumbered(state, key, true).slice(0, quantity))
      numbered.inCollection = false;
  state.collection[key] -= quantity;
  recordTransfer(state, `${quantity} 张卡牌转回仓库`);
}
