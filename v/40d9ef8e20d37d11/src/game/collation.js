import {
  LOCR_CARD_PRINTS,
  LOCH_CARD_PRINTS,
  BONUS_CARD_PRINTS,
  getCardPrint,
} from './card-data.js';
import { itemProduct } from './products.js';

export const COUNTS = Object.freeze({ case: 24, box: 15, pack: 4, bonus: 1 });
export const CASE_GMR_PROBABILITY = 1 / 3;
// Marginal odds from a 24-box case with a 1/3 chance of replacing one PSER-OF.
export const BOX_OVERFRAME_WEIGHTS = Object.freeze({ 'UR-OF': 54, 'PSER-OF': 17, GMR: 1 });
export const PACK_SPECIAL_WEIGHTS = Object.freeze({
  SER: 648,
  UL: 144,
  CR: 144,
  PSER: 72,
  'UR-OF': 54,
  'PSER-OF': 17,
  GMR: 1,
});
const pools = Object.fromEntries(
  ['SR', 'UR', 'SER', 'UL', 'CR', 'PSER', 'UR-OF', 'PSER-OF', 'GMR'].map((style) => [
    style,
    LOCR_CARD_PRINTS.filter((p) => p.style === style),
  ]),
);
const lochPools = Object.fromEntries(
  Object.keys(pools).map((style) => [style, LOCH_CARD_PRINTS.filter((p) => p.style === style)]),
);
function poolFor(set = 'LOCR') {
  if (set === 'LOCR') return pools;
  if (set === 'LOCH') return lochPools;
  throw new Error('卡盒不存在');
}
const setFields = (set) => (set === 'LOCH' ? { set: 'LOCH', rules: 1 } : {});
export const newCollation = () => ({ cases: [], boxes: [], packs: [] });
const seed = (random) => Math.floor(random() * 0x100000000) >>> 0;
export function seededRandom(initial) {
  let n = initial >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
const pick = (array, random) =>
  array[Math.min(array.length - 1, Math.floor(random() * array.length))];
function shuffle(array, random) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
const spec = (style, random, set = 'LOCR') => ({ printId: pick(poolFor(set)[style], random).id });
function weightedStyle(weights, random) {
  const entries = Object.entries(weights);
  let remaining = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [style, weight] of entries) {
    if (remaining < weight) return style;
    remaining -= weight;
  }
  return entries.at(-1)[0];
}
export function numberedReservations(state) {
  const used = new Set((state.numberedCards ?? []).map((c) => `${c.printId}:${c.serial}`));
  const scan = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.printId && value.serial !== undefined) used.add(`${value.printId}:${value.serial}`);
    else Object.values(value).forEach(scan);
  };
  (state.items ?? []).forEach((i) => scan(i.seal));
  scan(state.collation);
  return used;
}
function reserveGmr(state, random, set = 'LOCR') {
  const used = numberedReservations(state),
    available = [];
  for (const p of poolFor(set).GMR)
    for (let serial = 1; serial <= 100; serial++)
      if (!used.has(`${p.id}:${serial}`)) available.push({ printId: p.id, serial });
  if (!available.length) throw new Error('GMR 的 1–100 编号已全部分配，无法生成该商品');
  return pick(available, random);
}
function caseSeal(random, set = 'LOCR') {
  return {
    seed: seed(random),
    overframes: shuffle([...Array(18).fill('UR-OF'), ...Array(6).fill('PSER-OF')], random),
    ...setFields(set),
  };
}
export function caseBoxes(seal) {
  const random = seededRandom(seal.seed);
  return seal.overframes.map((overframe) => ({
    seed: seed(random),
    overframe,
    ...(overframe === 'GMR' ? { gmr: { ...seal.gmr } } : {}),
    ...setFields(seal.set),
  }));
}
export function boxPacks(seal) {
  const set = seal.set ?? 'LOCR',
    currentPool = poolFor(set);
  const random = seededRandom(seal.seed);
  const sr = shuffle(currentPool.SR, random).slice(0, 30);
  const ur = shuffle(currentPool.UR, random).slice(0, 15);
  const special = shuffle(
    [
      ...Array.from({ length: 9 }, () => spec('SER', random, set)),
      ...Array.from({ length: 2 }, () => spec('UL', random, set)),
      ...Array.from({ length: 2 }, () => spec('CR', random, set)),
      spec('PSER', random, set),
      seal.overframe === 'GMR' ? { ...seal.gmr } : spec(seal.overframe, random, set),
    ],
    random,
  );
  return special.map((card, i) => ({
    cards: [{ printId: sr[i * 2].id }, { printId: sr[i * 2 + 1].id }, { printId: ur[i].id }, card],
    ...setFields(set),
  }));
}
export function takeSeal(state, kind, random = Math.random, set = 'LOCR') {
  if (kind === 'bonus') return { cards: [{ printId: pick(BONUS_CARD_PRINTS, random).id }] };
  const currentPool = poolFor(set);
  if (kind === 'case') {
    const hasGmr = random() < CASE_GMR_PROBABILITY;
    const seal = caseSeal(random, set);
    if (hasGmr) {
      const indices = seal.overframes.flatMap((style, i) => (style === 'PSER-OF' ? [i] : []));
      seal.overframes[pick(indices, random)] = 'GMR';
      seal.gmr = reserveGmr(state, random, set);
    }
    return seal;
  }
  if (kind === 'box') {
    const overframe = weightedStyle(BOX_OVERFRAME_WEIGHTS, random);
    return {
      seed: seed(random),
      overframe,
      ...(overframe === 'GMR' ? { gmr: reserveGmr(state, random, set) } : {}),
      ...setFields(set),
    };
  }
  if (kind === 'pack') {
    const style = weightedStyle(PACK_SPECIAL_WEIGHTS, random);
    const sr = shuffle(currentPool.SR, random).slice(0, 2);
    return {
      cards: [
        ...sr.map((p) => ({ printId: p.id })),
        spec('UR', random, set),
        style === 'GMR' ? reserveGmr(state, random, set) : spec(style, random, set),
      ],
      ...setFields(set),
    };
  }
  throw new Error('商品不存在');
}
// Unattached previews use the same card layout. Actual stock always calls takeSeal with its save.
export function previewSeal(kind, set = 'LOCR') {
  if (kind === 'case') return caseSeal(Math.random, set);
  if (kind === 'box')
    return {
      seed: seed(Math.random),
      overframe: Math.random() < 0.75 ? 'UR-OF' : 'PSER-OF',
      ...setFields(set),
    };
  if (kind === 'pack') return pick(boxPacks(previewSeal('box', set)), Math.random);
  return { cards: [{ printId: pick(BONUS_CARD_PRINTS, Math.random).id }] };
}

export function validateCollation(state, migrating = false, migratingSupply = false) {
  if (migrating) {
    state.collation = newCollation();
    for (const item of state.items) item.seal = takeSeal(state, item.kind);
  }
  const supply = state.collation;
  if (
    !supply ||
    !['cases', 'boxes', 'packs'].every((k) => Array.isArray(supply[k])) ||
    supply.cases.length > (migratingSupply ? 2 : 0) ||
    supply.boxes.length > (migratingSupply ? 71 : 0) ||
    supply.packs.length > (migratingSupply ? 14 : 0)
  )
    throw new Error('存档配额货源不正确');
  const numbers = new Set((state.numberedCards ?? []).map((c) => `${c.printId}:${c.serial}`));
  const checkSpec = (card, styles, set = 'LOCR') => {
    const p = getCardPrint(card?.printId);
    if (
      !p ||
      p.legacy ||
      !styles.includes(p.style) ||
      !p.cardId.startsWith(`${set}-`) ||
      (p.rarity === 'GMR'
        ? !Number.isInteger(card.serial) || card.serial < 1 || card.serial > 100
        : card.serial !== undefined)
    )
      throw new Error('存档未拆封卡牌规格不正确');
    if (p.rarity === 'GMR') {
      const key = `${p.id}:${card.serial}`;
      if (numbers.has(key)) throw new Error('存档 GMR 预留编号重复');
      numbers.add(key);
    }
  };
  const check = (kind, seal, expectedSet = kind === 'bonus' ? 'LOSP' : 'LOCR') => {
    if (!seal || typeof seal !== 'object') throw new Error('存档未拆封结果缺失');
    const set = seal.set ?? (kind === 'bonus' ? 'LOSP' : 'LOCR');
    if (
      set !== expectedSet ||
      (set === 'LOCH' && seal.rules !== 1) ||
      (set !== 'LOCH' && seal.rules !== undefined)
    )
      throw new Error('存档卡盒或封入规则不正确');
    if (kind === 'case' || kind === 'box') {
      if (!Number.isInteger(seal.seed) || seal.seed < 0 || seal.seed > 0xffffffff)
        throw new Error('存档配额种子不正确');
      if (kind === 'case') {
        if (
          !Array.isArray(seal.overframes) ||
          seal.overframes.length !== 24 ||
          seal.overframes.filter((s) => s === 'UR-OF').length !== 18 ||
          ![0, 1].includes(seal.overframes.filter((s) => s === 'GMR').length) ||
          seal.overframes.filter((s) => s === 'PSER-OF').length !== (seal.gmr ? 5 : 6)
        )
          throw new Error('存档整箱配额不正确');
      } else if (!['UR-OF', 'PSER-OF', 'GMR'].includes(seal.overframe))
        throw new Error('存档卡盒出框位不正确');
      const hasGmr = kind === 'case' ? seal.overframes.includes('GMR') : seal.overframe === 'GMR';
      if (hasGmr) checkSpec(seal.gmr, ['GMR'], set);
      else if (seal.gmr !== undefined) throw new Error('存档 GMR 预留不正确');
    } else {
      if (!Array.isArray(seal.cards) || seal.cards.length !== COUNTS[kind])
        throw new Error('存档卡包张数不正确');
      seal.cards.forEach((c, i) =>
        checkSpec(
          c,
          kind === 'bonus'
            ? ['PSER-OF']
            : i < 2
              ? ['SR']
              : i === 2
                ? ['UR']
                : ['SER', 'UL', 'CR', 'PSER', 'UR-OF', 'PSER-OF', 'GMR'],
          set,
        ),
      );
    }
  };
  state.items.forEach((i) => check(i.kind, i.seal, itemProduct(i)?.set));
  supply.cases.forEach((s) => check('case', s));
  supply.boxes.forEach((s) => check('box', s));
  supply.packs.forEach((s) => check('pack', s));
  // v3 queued stock was never purchased. Release it while preserving every purchased seal.
  if (migratingSupply) state.collation = newCollation();
}
