import { freshState } from './helpers/starter-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  purchase,
  openItem,
  openPacks,
  validateState,
  cardCount,
  addCards,
} from '../src/game/model.js';
import {
  newCollation,
  seededRandom,
  caseBoxes,
  boxPacks,
  takeSeal,
  CASE_GMR_PROBABILITY,
  BOX_OVERFRAME_WEIGHTS,
  PACK_SPECIAL_WEIGHTS,
  numberedReservations,
} from '../src/game/collation.js';
import { getCardPrint, LOCR_CARD_PRINTS, BONUS_CARD_PRINTS } from '../src/game/card-data.js';
import { readStoredState, writeStoredState } from '../src/game/save-storage.js';
const copy = (s) => structuredClone(s);
const stock = () => {
  const s = freshState();
  s.items = [];
  s.collation = newCollation();
  s.coins = 1e9;
  return s;
};
const tally = (cards) =>
  cards.reduce((a, c) => {
    const style = getCardPrint(c.printId).style;
    a[style] = (a[style] ?? 0) + 1;
    return a;
  }, {});
const contents = (item) =>
  item.kind === 'case'
    ? caseBoxes(item.seal).flatMap((s) => boxPacks(s).flatMap((p) => p.cards))
    : item.kind === 'box'
      ? boxPacks(item.seal).flatMap((p) => p.cards)
      : item.seal.cards;

test('每箱独立判定GMR，盒内固定配额与SR/UR无重复规则保留', () => {
  const s = stock();
  purchase(s, 'case', 3, 'N', () => 0);
  const cases = s.items.filter((i) => i.kind === 'case');
  let gmr = 0;
  for (const item of cases) {
    const count = tally(contents(item));
    assert.equal(contents(item).length, 1440);
    assert.equal(count['UR-OF'], 18);
    assert.equal(count['PSER-OF'], count.GMR ? 5 : 6);
    gmr += count.GMR ?? 0;
    for (const seal of caseBoxes(item.seal)) {
      const packs = boxPacks(seal),
        cards = packs.flatMap((p) => p.cards),
        total = tally(cards);
      assert.equal(packs.length, 15);
      for (const pack of packs)
        assert.deepEqual(
          pack.cards.slice(0, 3).map((c) => getCardPrint(c.printId).style),
          ['SR', 'SR', 'UR'],
        );
      assert.equal(total.SR, 30);
      assert.equal(total.UR, 15);
      assert.equal(total.SER, 9);
      assert.equal(total.UL, 2);
      assert.equal(total.CR, 2);
      assert.equal(total.PSER, 1);
      assert.equal((total['UR-OF'] ?? 0) + (total['PSER-OF'] ?? 0) + (total.GMR ?? 0), 1);
      for (const style of ['SR', 'UR']) {
        const ids = cards
          .filter((c) => getCardPrint(c.printId).style === style)
          .map((c) => getCardPrint(c.printId).cardId);
        assert.equal(new Set(ids).size, ids.length);
      }
    }
  }
  assert.equal(gmr, 3);
  assert.equal(s.items.filter((i) => i.kind === 'bonus').length, 24);
  validateState(copy(s));
  const absent = stock();
  purchase(absent, 'case', 3, 'N', () => 0.9);
  for (const item of absent.items.filter((i) => i.kind === 'case')) {
    assert.equal(tally(contents(item))['PSER-OF'], 6);
    assert.equal(tally(contents(item)).GMR, undefined);
  }
});
test('案例拆盒拆包、倒序打开和五包打开重载保持同一预定卡面与编号', () => {
  const s = stock();
  purchase(s, 'case', 3, 'N', () => 0);
  const expected = s.items
    .filter((i) => i.kind === 'case')
    .flatMap(contents)
    .map((c) => `${c.printId}:${c.serial ?? ''}`)
    .sort();
  for (const item of s.items.filter((i) => i.kind === 'case').reverse()) openItem(s, item.id);
  for (const item of s.items.filter((i) => i.kind === 'box').reverse()) openItem(s, item.id);
  let restored = validateState(copy(s));
  const packs = restored.items.filter((i) => i.kind === 'pack').reverse();
  for (let i = 0; i < packs.length; i += 5)
    openPacks(
      restored,
      packs.slice(i, i + 5).map((p) => p.id),
      () => {
        throw new Error('开包不应再随机');
      },
    );
  assert.deepEqual(
    restored.cardStacks
      .flatMap((s) => s.cards)
      .map((c) => `${c.printId}:${c.serial ?? ''}`)
      .sort(),
    expected,
  );
  assert.equal(cardCount(restored), 4320);
  assert.equal(restored.numberedCards.length, 3);
  assert.deepEqual(validateState(copy(restored)), restored);
});
test('每箱1/3判定边界、订单和初始箱不会形成三箱保底或补偿', () => {
  assert.equal(CASE_GMR_PROBABILITY, 1 / 3);
  for (const [roll, expected] of [
    [0, true],
    [1 / 3 - 1e-10, true],
    [1 / 3, false],
    [0.9999, false],
  ]) {
    const s = stock();
    let first = true;
    const seal = takeSeal(s, 'case', () => {
      if (first) {
        first = false;
        return roll;
      }
      return 0.5;
    });
    assert.equal(Boolean(seal.gmr), expected);
  }
  const s = stock();
  for (let i = 0; i < 6; i++) purchase(s, 'case', 1, 'N', () => 0.9);
  assert.equal(s.items.filter((i) => i.kind === 'case' && i.seal.gmr).length, 0);
  purchase(s, 'case', 3, 'N', () => 0);
  assert.equal(s.items.filter((i) => i.kind === 'case' && i.seal.gmr).length, 3);
  assert.deepEqual(s.collation, newCollation());
  validateState(copy(s));
});
test('散盒出框位按54:17:1抽取且盒内配额固定，散包特殊位独立按原配额折算', () => {
  assert.deepEqual(BOX_OVERFRAME_WEIGHTS, { 'UR-OF': 54, 'PSER-OF': 17, GMR: 1 });
  assert.deepEqual(PACK_SPECIAL_WEIGHTS, {
    SER: 648,
    UL: 144,
    CR: 144,
    PSER: 72,
    'UR-OF': 54,
    'PSER-OF': 17,
    GMR: 1,
  });
  const draw = (kind, roll) => {
    let first = true;
    return takeSeal(stock(), kind, () => {
      if (first) {
        first = false;
        return roll;
      }
      return 0.5;
    });
  };
  for (const [roll, style] of [
    [0, 'UR-OF'],
    [54 / 72, 'PSER-OF'],
    [71 / 72, 'GMR'],
  ]) {
    const seal = draw('box', roll),
      count = tally(boxPacks(seal).flatMap((p) => p.cards));
    assert.equal(seal.overframe, style);
    assert.equal(count.SER, 9);
    assert.equal(count.UL, 2);
    assert.equal(count.CR, 2);
    assert.equal(count.PSER, 1);
    assert.equal(count[style], 1);
  }
  let lower = 0;
  for (const [style, weight] of Object.entries(PACK_SPECIAL_WEIGHTS)) {
    const seal = draw('pack', (lower + weight / 2) / 1080);
    assert.deepEqual(
      seal.cards.slice(0, 3).map((c) => getCardPrint(c.printId).style),
      ['SR', 'SR', 'UR'],
    );
    assert.notEqual(seal.cards[0].printId, seal.cards[1].printId);
    assert.equal(getCardPrint(seal.cards[3].printId).style, style);
    lower += weight;
  }
  const s = stock();
  purchase(s, 'pack', 15, 'N', () => 0);
  assert.equal(tally(s.items.flatMap(contents)).SER, 15);
  assert.deepEqual(s.collation, newCollation());
  validateState(copy(s));
});
test('独立箱概率的确定性抽样接近1/3，散盒和散包无累计配额', () => {
  const s = { items: [], numberedCards: [], collation: newCollation() },
    random = seededRandom(20261009);
  let cases = 0;
  for (let i = 0; i < 9000; i++) cases += Boolean(takeSeal(s, 'case', random).gmr);
  assert.ok(Math.abs(cases / 9000 - 1 / 3) < 0.02);
  const boxes = stock(),
    packs = stock();
  purchase(boxes, 'box', 72, 'N', () => 0.9999);
  purchase(packs, 'pack', 99, 'N', () => 0.9999);
  assert.equal(boxes.items.filter((i) => i.kind === 'box' && i.seal.gmr).length, 72);
  assert.equal(packs.items.filter((i) => i.seal.cards.some((c) => c.serial)).length, 99);
  validateState(copy(boxes));
  validateState(copy(packs));
});

test('散购盒与包购买时确定结果，重载及单包/五包开法保持罕贵度和编号', () => {
  const s = stock();
  purchase(s, 'box', 1, 'N', () => 0.9999);
  purchase(s, 'pack', 5, 'N', () => 0.9999);
  const expected = s.items
    .flatMap(contents)
    .map((c) => `${c.printId}:${c.serial ?? ''}`)
    .sort();
  openItem(s, s.items.find((i) => i.kind === 'box').id);
  const single = validateState(copy(s)),
    bulk = validateState(copy(s));
  for (const i of single.items.slice().reverse()) openItem(single, i.id);
  const ids = bulk.items.map((i) => i.id);
  for (let i = 0; i < ids.length; i += 5) openPacks(bulk, ids.slice(i, i + 5));
  for (const restored of [single, bulk]) {
    assert.deepEqual(
      restored.cardStacks
        .flatMap((p) => p.cards)
        .map((c) => `${c.printId}:${c.serial ?? ''}`)
        .sort(),
      expected,
    );
    assert.equal(restored.numberedCards.length, 6);
    assert.equal(cardCount(restored), 80);
    validateState(copy(restored));
  }
});
test('赠包按单笔订单计数，不累计，开箱不再发赠包，特别包独立10种PSER-OF可重复', () => {
  const s = stock();
  purchase(s, 'box');
  purchase(s, 'box', 2);
  assert.equal(s.items.filter((i) => i.kind === 'bonus').length, 0);
  assert.equal(purchase(s, 'box', 3).bonusCount, 1);
  assert.equal(purchase(s, 'box', 7).bonusCount, 2);
  assert.equal(purchase(s, 'pack', 3).bonusCount, 0);
  assert.equal(purchase(s, 'case', 2).bonusCount, 16);
  const before = s.items.filter((i) => i.kind === 'bonus').length;
  openItem(s, s.items.find((i) => i.kind === 'case').id);
  assert.equal(s.items.filter((i) => i.kind === 'bonus').length, before);
  const id = s.items.find((i) => i.kind === 'bonus').id,
    result = openItem(s, id);
  assert.equal(result.cards.length, 1);
  assert.ok(BONUS_CARD_PRINTS.some((p) => p.id === result.cards[0].printId));
  assert.equal(result.cards[0].rarity, 'PSER');
  assert.equal(s.opened.bonus, 1);
  const bulk = openPacks(
    s,
    s.items
      .filter((i) => i.kind === 'bonus')
      .slice(0, 5)
      .map((i) => i.id),
  );
  assert.equal(bulk.cards.length, 5);
  assert.equal(bulk.cardsPerPack, 1);
  assert.equal(s.opened.bonus, 6);
  const all = new Set(
    Array.from(
      { length: 10 },
      (_, i) => takeSeal(stock(), 'bonus', () => (i + 0.1) / 10).cards[0].printId,
    ),
  );
  assert.equal(all.size, 10);
  assert.deepEqual(
    takeSeal(stock(), 'bonus', () => 0),
    takeSeal(stock(), 'bonus', () => 0),
  );
  validateState(copy(s));
});
test('赠包占用库存容量，失败订单与混合拆包不消耗余额、批次或物品', () => {
  const s = stock();
  purchase(s, 'box', 3);
  purchase(s, 'pack', 4);
  const ids = [
    s.items.find((i) => i.kind === 'bonus').id,
    ...s.items.filter((i) => i.kind === 'pack').map((i) => i.id),
  ];
  const snapshot = JSON.stringify(s);
  assert.throws(() => openPacks(s, ids));
  assert.equal(JSON.stringify(s), snapshot);
  s.items = Array.from({ length: 4997 }, (_, i) => ({ ...s.items[0], id: `full-${i}` }));
  const full = JSON.stringify(s);
  assert.throws(() => purchase(s, 'box', 3));
  assert.equal(JSON.stringify(s), full);
});
test('预留GMR与已持有编号互斥，耗尽所有编号拒绝购买且不扣款', () => {
  const s = stock();
  purchase(s, 'case', 1, 'N', () => 0);
  purchase(s, 'box', 1, 'N', () => 0.9999);
  const reservations = s.items.flatMap(contents).filter((c) => c.serial);
  assert.equal(new Set(reservations.map((c) => `${c.printId}:${c.serial}`)).size, 2);
  const reserved = reservations[0],
    prior = JSON.stringify(s);
  assert.throws(() => addCards(s, reserved.printId, 1, [reserved.serial]));
  assert.equal(JSON.stringify(s), prior);
  const bad = copy(s),
    gmrCases = bad.items.filter((i) => i.seal.gmr);
  gmrCases[1].seal.gmr = copy(gmrCases[0].seal.gmr);
  assert.throws(() => validateState(bad));
  const full = stock();
  for (const p of LOCR_CARD_PRINTS.filter((p) => p.rarity === 'GMR'))
    addCards(
      full,
      p.id,
      100,
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
  const snapshot = JSON.stringify(full);
  assert.throws(() => purchase(full, 'case', 1, 'N', () => 0));
  assert.equal(JSON.stringify(full), snapshot);
  purchase(full, 'case', 1, 'N', () => 0.9);
  assert.equal(full.items.find((i) => i.kind === 'case').seal.gmr, undefined);
});
test('旧版未开封商品只迁移一次，保留ID和摆放，v3拒绝缺失或损坏配额', () => {
  const s = stock();
  purchase(s, 'box', 3);
  s.items = s.items.filter((i) => i.kind === 'box');
  s.version = 2;
  delete s.collation;
  s.items.forEach((i) => delete i.seal);
  delete s.opened.bonus;
  const migrated = validateState(copy(s));
  assert.equal(migrated.version, 4);
  assert.deepEqual(
    migrated.items.map(({ seal, ...i }) => i),
    s.items,
  );
  assert.deepEqual(validateState(copy(migrated)), migrated);
  const bad = copy(migrated);
  delete bad.items[0].seal;
  assert.throws(() => validateState(bad));
  const wrong = copy(migrated);
  wrong.items[0].seal.overframe = 'N';
  assert.throws(() => validateState(wrong));
});
test('升级版本2保留独立原文备份，已有v1备份不被覆盖；备份失败保留原存档', () => {
  const old = stock();
  old.version = 2;
  delete old.collation;
  delete old.opened.bonus;
  const raw = JSON.stringify(old),
    key = 'ygo-duel-archive-v1',
    backup = 'ygo-duel-archive-v2-backup';
  const values = new Map([
    [key, raw],
    ['ygo-duel-archive-v1-backup', 'earlier-v1'],
  ]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const migrated = readStoredState(storage);
  writeStoredState(storage, migrated);
  assert.equal(values.get(backup), raw);
  assert.equal(values.get('ygo-duel-archive-v1-backup'), 'earlier-v1');
  writeStoredState(storage, migrated);
  assert.equal(values.get(backup), raw);
  values.delete(backup);
  values.set(key, raw);
  const failing = {
    getItem: storage.getItem,
    setItem: (k, v) => {
      if (k === backup) throw new Error('quota');
      values.set(k, v);
    },
  };
  assert.throws(() => writeStoredState(failing, migrated));
  assert.equal(values.get(key), raw);
});

test('版本3升级保留已买封装与编号，释放未买批次，不重抽旧商品', () => {
  const s = stock();
  purchase(s, 'case', 1, 'N', () => 0);
  purchase(s, 'pack', 1, 'N', () => 0.9999);
  const future = takeSeal(s, 'case', () => 0);
  s.collation.cases.push(future);
  s.collation.cases.push(takeSeal(s, 'case', () => 0.9));
  s.version = 3;
  const sealed = copy(s.items),
    futureNumber = `${future.gmr.printId}:${future.gmr.serial}`;
  const migrated = validateState(copy(s));
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.items, sealed);
  assert.deepEqual(migrated.collation, newCollation());
  assert.equal(numberedReservations(migrated).has(futureNumber), false);
  assert.deepEqual(validateState(copy(migrated)), migrated);
  const expected = sealed
    .flatMap(contents)
    .map((c) => `${c.printId}:${c.serial ?? ''}`)
    .sort();
  for (const i of migrated.items.filter((i) => i.kind === 'case')) openItem(migrated, i.id);
  for (const i of migrated.items.filter((i) => i.kind === 'box')) openItem(migrated, i.id);
  for (const i of migrated.items.filter((i) => i.kind === 'pack')) openItem(migrated, i.id);
  assert.deepEqual(
    migrated.cardStacks
      .flatMap((p) => p.cards)
      .map((c) => `${c.printId}:${c.serial ?? ''}`)
      .sort(),
    expected.filter((c) => !c.startsWith('LOSP-')),
  );
  validateState(copy(migrated));
});
test('版本3升级单独备份原文，已有旧版备份保留且备份失败不覆盖原存档', () => {
  const old = stock();
  old.version = 3;
  const raw = JSON.stringify(old),
    key = 'ygo-duel-archive-v1',
    backup = 'ygo-duel-archive-v3-backup';
  const values = new Map([
    [key, raw],
    ['ygo-duel-archive-v2-backup', 'v2-original'],
  ]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const migrated = readStoredState(storage);
  writeStoredState(storage, migrated);
  assert.equal(values.get(backup), raw);
  assert.equal(values.get('ygo-duel-archive-v2-backup'), 'v2-original');
  values.delete(backup);
  values.set(key, raw);
  assert.throws(() =>
    writeStoredState(
      {
        ...storage,
        setItem: () => {
          throw new Error('quota');
        },
      },
      migrated,
    ),
  );
  assert.equal(values.get(key), raw);
});
