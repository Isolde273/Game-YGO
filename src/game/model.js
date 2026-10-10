import { LEGACY_PRINT_IDS, getRarity, getCardPrint, makeCardRecord } from './card-data.js';
import { emptyCardCounts, validateCardInventory, addCards, ownedCount } from './card-inventory.js';
import { purchaseCard } from './card-market.js';
import { isBalance, validateWallet, quotePurchase } from './wallet.js';
export {
  addCards,
  collectionCount,
  warehouseCount,
  binderCount,
  trayCount,
  moveBinderCard,
  transferWarehouseToTray,
  transferCollectionToWarehouse,
  inventoryKeys,
  rarityCount,
} from './card-inventory.js';
import { MODEL_SCALE, SIZES, CARD_STEP } from '../scene/packing.js';
import { ROOM_PHI } from '../scene/room-view.js';
import {
  COUNTS,
  takeSeal,
  previewSeal,
  caseBoxes,
  boxPacks,
  newCollation,
  validateCollation,
} from './collation.js';
export const SAVE_KEY = 'ygo-duel-archive-v1';
// Keep the installed application's storage key; the JSON schema version is separate.
// Legacy single-card market listings remain available for old placeholder holdings.
export const RARITIES = LEGACY_PRINT_IDS.map((id, i) => ({
  ...getRarity(id),
  weight: [58, 26, 12, 3.5, 0.5][i],
}));
export const SAVE_VERSION = 4;
export const LEGACY_BACKUP_KEY = 'ygo-duel-archive-v1-backup';
export const PRODUCTS = {
  case: {
    name: 'LOCR 原封整箱',
    short: '整箱',
    en: 'SEALED CASE',
    price: 7999,
    image: 'case.png',
    children: 'box',
    count: COUNTS.case,
  },
  box: {
    name: 'LOCR 收藏卡盒',
    short: '卡盒',
    en: 'BOOSTER BOX',
    price: 325,
    image: 'locr-box.png',
    children: 'pack',
    count: COUNTS.box,
  },
  pack: {
    name: 'LOCR 卡包',
    short: '卡包',
    en: 'BOOSTER PACK',
    price: 22,
    image: 'locr-pack.png',
    children: 'card',
    count: COUNTS.pack,
  },
  bonus: {
    code: 'LOSP',
    name: 'LIMIT OVER SPECIAL PACK vol.2',
    short: '特别包',
    en: 'SPECIAL PACK vol.2',
    price: 72,
    image: 'special-pack-vol2.svg',
    children: 'card',
    count: COUNTS.bonus,
  },
};
const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function makeItem(kind, seal = previewSeal(kind)) {
  return {
    id: uid(),
    kind,
    seal,
    x: 0.15 + Math.random() * 0.7,
    y: 0.22 + Math.random() * 0.5,
    angle: (Math.random() - 0.5) * 26,
    isNew: true,
  };
}
export function freshState() {
  const state = {
    version: SAVE_VERSION,
    spaceModelScale: MODEL_SCALE,
    coins: 500,
    maxCoins: 500,
    collation: newCollation(),
    items: [],
    containers: [],
    cards: emptyCardCounts(),
    collection: emptyCardCounts(),
    numberedCards: [],
    binder: { slots: {}, page: 1 },
    cardStacks: [],
    favorites: [],
    history: [],
    opened: { case: 0, box: 0, pack: 0, bonus: 0 },
    settings: {
      sound: true,
      volume: 50,
      music: false,
      musicVolume: 25,
      motion: true,
      brightness: 85,
    },
    lastGift: null,
    workReadyAt: 0,
  };
  for (const kind of ['box', 'box', 'box', 'bonus'])
    state.items.push(makeItem(kind, takeSeal(state, kind)));
  return state;
}
export function validateState(value) {
  if (!value || ![1, 2, 3, SAVE_VERSION].includes(value.version) || !isBalance(value.coins))
    throw new Error('存档格式或金额数据不正确');
  validateWallet(value);
  if (!Array.isArray(value.items) || value.items.length > 5000)
    throw new Error('存档物品数量不正确');
  const ids = new Set();
  for (const item of value.items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !Object.hasOwn(PRODUCTS, item.kind) ||
      ids.has(item.id)
    )
      throw new Error('存档包含无效物品');
    ids.add(item.id);
    if (![item.x, item.y, item.angle].every(Number.isFinite)) throw new Error('存档摆放数据不正确');
    if (item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1 || Math.abs(item.angle) > 360)
      throw new Error('存档摆放数据超出范围');
    if (item.pose3d) {
      const { position, quaternion } = item.pose3d;
      if (
        !Array.isArray(position) ||
        position.length !== 3 ||
        !position.every((n) => Number.isFinite(n) && Math.abs(n) <= 80) ||
        !Array.isArray(quaternion) ||
        quaternion.length !== 4 ||
        !quaternion.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) ||
        Math.abs(quaternion.reduce((sum, n) => sum + n * n, 0) - 1) > 0.05
      )
        delete item.pose3d;
    }
  }
  validateCardInventory(value, ids, value.version === 1);
  value.containers ??= [];
  if (!Array.isArray(value.containers) || value.containers.length > 5000)
    throw new Error('存档箱体数据不正确');
  const containerIds = new Set();
  for (const c of value.containers) {
    if (
      !c ||
      typeof c.id !== 'string' ||
      ids.has(c.id) ||
      containerIds.has(c.id) ||
      !c.pose3d ||
      !Array.isArray(c.pose3d.position) ||
      c.pose3d.position.length !== 3 ||
      !c.pose3d.position.every((n) => Number.isFinite(n) && Math.abs(n) <= 80) ||
      !Array.isArray(c.pose3d.quaternion) ||
      c.pose3d.quaternion.length !== 4 ||
      !c.pose3d.quaternion.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) ||
      Math.abs(c.pose3d.quaternion.reduce((sum, n) => sum + n * n, 0) - 1) > 0.05
    )
      throw new Error('存档箱体位置不正确');
    containerIds.add(c.id);
  }
  const slots = new Set();
  for (const item of value.items) {
    if (item.containerId === undefined) continue;
    const slot = `${item.containerId}:${item.slotIndex}`;
    if (
      item.kind !== 'box' ||
      !containerIds.has(item.containerId) ||
      !Number.isInteger(item.slotIndex) ||
      item.slotIndex < 0 ||
      item.slotIndex >= COUNTS.case ||
      slots.has(slot)
    )
      throw new Error('存档箱内物品不正确');
    slots.add(slot);
    item.isNew = false;
  }
  if (value.version < 3) value.opened.bonus ??= 0;
  for (const k of ['case', 'box', 'pack', 'bonus'])
    if (!Number.isSafeInteger(value.opened?.[k]) || value.opened[k] < 0 || value.opened[k] > 1e9)
      throw new Error('存档开盒记录不正确');
  validateCollation(value, value.version < 3, value.version === 3);
  const defaults = {
    sound: true,
    volume: 50,
    music: false,
    musicVolume: 25,
    motion: true,
    brightness: 85,
  };
  const s = value.settings ?? {};
  value.settings = {
    ...defaults,
    ...Object.fromEntries(
      ['sound', 'music', 'motion'].map((k) => [k, typeof s[k] === 'boolean' ? s[k] : defaults[k]]),
    ),
    ...Object.fromEntries(
      ['volume', 'musicVolume', 'brightness'].map((k) => [
        k,
        Number.isFinite(s[k]) ? Math.max(0, Math.min(100, s[k])) : defaults[k],
      ]),
    ),
  };
  value.history = Array.isArray(value.history)
    ? value.history
        .filter((h) => h && typeof h.text === 'string' && typeof h.date === 'string')
        .slice(0, 60)
    : [];
  value.favorites = Array.isArray(value.favorites)
    ? [...new Set(value.favorites.filter((k) => getCardPrint(k)))]
    : [];
  value.lastGift = typeof value.lastGift === 'string' ? value.lastGift : null;
  value.workReadyAt ??= 0;
  if (!Number.isSafeInteger(value.workReadyAt) || value.workReadyAt < 0)
    throw new Error('存档打工冷却不正确');
  if (value.spaceView) {
    const v = value.spaceView,
      o = v.orbit;
    if (
      !o ||
      ![o.theta, o.phi, o.distance].every(Number.isFinite) ||
      Math.abs(o.theta) > 1000 ||
      o.phi < ROOM_PHI ||
      o.phi > 1.35 ||
      o.distance < 4 ||
      o.distance > 90 ||
      !Array.isArray(v.target) ||
      v.target.length !== 3 ||
      !v.target.every((n) => Number.isFinite(n) && Math.abs(n) <= 80)
    )
      delete value.spaceView;
  }
  value.version = SAVE_VERSION;
  return value;
}
export function addHistory(state, text) {
  state.history.unshift({ text, date: new Date().toISOString() });
  state.history = state.history.slice(0, 60);
}
export const cardCount = ownedCount;
export const countKind = (state, kind) => state.items.filter((i) => i.kind === kind).length;
export const ALBUM_PAGES = 100;
export const ALBUM_SLOTS = 6;
export function randomRarity(random = Math.random) {
  const n = random();
  let t = 0;
  for (const r of RARITIES) {
    t += r.weight;
    if (n < t / 100) return r.id;
  }
  return 'PSER';
}
export function openItem(state, id, random = Math.random) {
  const at = state.items.findIndex((i) => i.id === id);
  if (at < 0) throw new Error('这个物品已被打开');
  const item = state.items[at],
    p = PRODUCTS[item.kind];
  if (p.children === 'card') return openPacks(state, [id]);
  if (p.children !== 'card' && state.items.length - 1 + p.count > 5000)
    throw new Error('空间已满，请先打开一些卡包');
  const seals = item.kind === 'case' ? caseBoxes(item.seal) : boxPacks(item.seal);
  const items = seals.map((seal) => makeItem(p.children, seal));
  state.items.splice(at, 1);
  if (item.containerId)
    state.containers = (state.containers ?? []).filter((c) =>
      state.items.some((i) => i.containerId === c.id),
    );
  state.opened[item.kind]++;
  let container;
  if (item.kind === 'case') {
    container = {
      id: uid(),
      pose3d: { position: [0, 0.044 + SIZES.case[1] / 2, 0.5], quaternion: [0, 0, 0, 1] },
    };
    (state.containers ??= []).push(container);
    items.forEach((child, i) => {
      child.containerId = container.id;
      child.slotIndex = i;
      child.isNew = false;
    });
  }
  state.items.push(...items);
  addHistory(state, `打开 1 ${p.short}，获得 ${p.count} ${PRODUCTS[p.children].short}`);
  return { kind: p.children, items, container };
}
export function extractItem(state, id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new Error('这个物品已被打开');
  delete item.containerId;
  delete item.slotIndex;
  item.isNew = false;
  state.containers = (state.containers ?? []).filter((c) =>
    state.items.some((i) => i.containerId === c.id),
  );
  return item;
}
export function openPacks(state, ids, random = Math.random) {
  if (
    !Array.isArray(ids) ||
    ![1, 5, 10].includes(ids.length) ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !state.items.some((i) => i.id === id && ['pack', 'bonus'].includes(i.kind)))
  )
    throw new Error('请选择1包、5包或10包未拆封卡包');
  const items = ids.map((id) => state.items.find((i) => i.id === id));
  return revealPackItems(state, items, ids);
}
export function openBoxFully(state, id) {
  const item = state.items.find((i) => i.id === id && i.kind === 'box');
  if (!item) throw new Error('请选择未拆封卡盒');
  if (item.containerId) throw new Error('箱内卡盒需先拖到桌面');
  const items = boxPacks(item.seal).map((seal) => makeItem('pack', seal));
  const result = revealPackItems(state, items, [id]);
  state.opened.box++;
  addHistory(state, `全部打开 1 卡盒，打开 ${items.length} 包，获得 ${result.cards.length} 张卡牌`);
  return { ...result, items };
}
function revealPackItems(state, items, ids) {
  // Draw everything before committing, so an invalid batch cannot consume part of it.
  if ((state.cardStacks ??= []).length >= 5000) throw new Error('请先整理桌上的卡堆');
  if (items.some((i) => i.kind !== items[0].kind)) throw new Error('普通卡包与特别包请分别拆封');
  const cards = items.flatMap((item) =>
    item.seal.cards.map((c) => makeCardRecord(c.printId, uid(), c.serial ?? null)),
  );
  for (const c of cards)
    if ((state.cards[c.printId] ?? 0) + cards.filter((p) => p.printId === c.printId).length > 1e9)
      throw new Error('卡牌数量超出上限');
  const stack = {
    id: uid(),
    cards,
    pose3d: { position: [0, 0.044 + (cards.length * CARD_STEP) / 2, 3] },
  };
  const selected = new Set(ids);
  state.items = state.items.filter((i) => !selected.has(i.id));
  state.opened[items[0].kind] += items.length;
  for (const card of cards) {
    state.cards[card.printId] = (state.cards[card.printId] ?? 0) + 1;
    state.collection[card.printId] ??= 0;
    if (card.rarity === 'GMR') state.numberedCards.push({ ...card, inCollection: false });
  }
  state.cardStacks.push(stack);
  addHistory(
    state,
    `打开 ${items.length} 包 ${items[0].kind === 'bonus' ? 'vol.2' : 'LOCR'}，获得 ${cards.length} 张卡牌`,
  );
  return { kind: 'card', cards, stack, cardsPerPack: PRODUCTS[items[0].kind].count };
}
export function routeStackCards(state, stackId, cardIds, destination) {
  const stack = state.cardStacks?.find((s) => s.id === stackId);
  if (
    !stack ||
    !['collection', 'warehouse'].includes(destination) ||
    !Array.isArray(cardIds) ||
    !cardIds.length ||
    new Set(cardIds).size !== cardIds.length ||
    cardIds.some((id) => !stack.cards.some((c) => c.id === id))
  )
    throw new Error('请选择卡堆中的卡牌与收纳位置');
  const selected = new Set(cardIds),
    cards = stack.cards.filter((c) => selected.has(c.id));
  state.collection ??= Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
  if (destination === 'collection')
    for (const card of cards) {
      state.collection[card.printId] = (state.collection[card.printId] ?? 0) + 1;
      const numbered = state.numberedCards.find((c) => c.id === card.id);
      if (numbered) numbered.inCollection = true;
    }
  stack.cards = stack.cards.filter((c) => !selected.has(c.id));
  if (!stack.cards.length) state.cardStacks = state.cardStacks.filter((s) => s !== stack);
  addHistory(
    state,
    `${cards.length} 张卡牌${destination === 'collection' ? '转入收藏暂存区' : '放入仓库'}`,
  );
  return cards;
}
export function bringStackCardToFront(state, stackId, cardId) {
  const stack = state.cardStacks?.find((s) => s.id === stackId),
    index = stack?.cards.findIndex((c) => c.id === cardId) ?? -1;
  if (index < 0) throw new Error('请选择卡堆中的卡牌');
  if (index === stack.cards.length - 1) return false;
  stack.cards.push(...stack.cards.splice(index, 1));
  return true;
}
export function purchase(state, kind, quantity = 1, rarity = 'N', random = Math.random) {
  if (kind === 'card') return purchaseCard(state, rarity, quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
    throw new Error('数量应为 1–99');
  const p = Object.hasOwn(PRODUCTS, kind) ? PRODUCTS[kind] : null;
  if (!p) throw new Error('商品不存在');
  const cost = p.price * quantity;
  const wallet = quotePurchase(state, cost);
  const bonusCount = bonusForOrder(kind, quantity);
  if (state.items.length + quantity + bonusCount > 5000)
    throw new Error('空间已满，请先打开一些卡包');
  // Allocate against a draft: exhausted serials or a full desk cannot partially charge an order.
  const draft = {
    ...state,
    items: state.items.slice(),
    collation: structuredClone(state.collation),
  };
  const items = [];
  for (const product of [...Array(quantity).fill(kind), ...Array(bonusCount).fill('bonus')]) {
    const item = makeItem(product, takeSeal(draft, product, random));
    draft.items.push(item);
    items.push(item);
  }
  state.items = draft.items;
  state.collation = draft.collation;
  Object.assign(state, wallet);
  addHistory(
    state,
    `购入 ${quantity} ${p.short}${bonusCount ? `，赠 vol.2 ${bonusCount} 包` : ''} · ${cost.toLocaleString()}`,
  );
  return { cost, items, bonusCount };
}
export const bonusForOrder = (kind, quantity) =>
  kind === 'case' ? quantity * 8 : kind === 'box' ? Math.floor(quantity / 3) : 0;
