// Product IDs identify stock; kind identifies physical packaging and animation.
// All quotes are whole CNY; LOCR/LOCH box and case prices are explicitly set to 325/7999.
const definitions = {
  case: {
    name: 'LOCR 原封整箱',
    short: '整箱',
    en: 'SEALED CASE',
    price: 7999,
    image: 'case.png',
    children: 'box',
    count: 24,
    kind: 'case',
    set: 'LOCR',
  },
  box: {
    name: 'LOCR 收藏卡盒',
    short: '卡盒',
    en: 'BOOSTER BOX',
    price: 325,
    image: 'locr-box.png',
    warehouseImage: 'locr-box-warehouse.webp',
    children: 'pack',
    count: 15,
    kind: 'box',
    set: 'LOCR',
  },
  pack: {
    name: 'LOCR 卡包',
    short: '卡包',
    en: 'BOOSTER PACK',
    price: 22,
    image: 'locr-pack.png',
    children: 'card',
    count: 4,
    kind: 'pack',
    set: 'LOCR',
  },
  bonus: {
    code: 'LOSP',
    name: 'LIMIT OVER SPECIAL PACK vol.2',
    short: '特别包',
    en: 'SPECIAL PACK vol.2',
    price: 72,
    image: 'special-pack-vol2.svg',
    children: 'card',
    count: 1,
    kind: 'bonus',
    set: 'LOSP',
  },
  'loch-case': {
    name: 'LOCH 原封整箱',
    short: '整箱',
    en: 'SEALED CASE',
    price: 7999,
    image: 'loch-case.svg',
    children: 'box',
    childProduct: 'loch-box',
    count: 24,
    kind: 'case',
    set: 'LOCH',
    code: 'LOCH',
  },
  'loch-box': {
    name: 'LOCH 收藏卡盒',
    short: '卡盒',
    en: 'BOOSTER BOX',
    price: 325,
    image: 'loch-box.webp',
    children: 'pack',
    childProduct: 'loch-pack',
    count: 15,
    kind: 'box',
    set: 'LOCH',
    code: 'LOCH',
  },
  'loch-pack': {
    name: 'LOCH 卡包',
    short: '卡包',
    en: 'BOOSTER PACK',
    price: 22,
    image: 'loch-pack.webp',
    children: 'card',
    count: 4,
    kind: 'pack',
    set: 'LOCH',
    code: 'LOCH',
  },
};
export const PRODUCTS = Object.freeze(
  Object.fromEntries(
    Object.entries(definitions).map(([id, p]) => [id, Object.freeze({ ...p, id })]),
  ),
);
export const productIdOf = (item) => item.productId ?? item.kind;
export function itemProduct(item) {
  const product = PRODUCTS[productIdOf(item)];
  return product?.kind === item.kind ? product : null;
}
