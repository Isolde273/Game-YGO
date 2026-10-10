import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CARD_CATALOG,
  CARD_PRINTS,
  LOCR_CARD_PRINTS,
  CARD_RARITIES,
  getCard,
  getCardPrint,
  getCardView,
  findCardPrints,
} from '../src/game/card-data.js';

test('统一数据入口逐项匹配80种卡与318个合法规格', () => {
  const cards = JSON.parse(fs.readFileSync('public/locr-catalog/cards.json', 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('public/locr-catalog/manifest.json', 'utf8'));
  assert.deepEqual(
    CARD_CATALOG.filter((c) => c.cardId.startsWith('LOCR-')),
    cards,
  );
  assert.equal(CARD_CATALOG.length, 90);
  assert.equal(CARD_PRINTS.length, 328);
  assert.equal(new Set(CARD_PRINTS.map((p) => p.id)).size, 328);
  for (const print of LOCR_CARD_PRINTS) {
    const original = manifest.find((p) => p.id === print.id);
    for (const key of Object.keys(print)) assert.deepEqual(print[key], original[key]);
    assert.ok(getCard(print.cardId).variants.includes(print.id));
    assert.equal(getCardView(print.id).label, original.style === 'UL' ? 'UTR' : original.style);
    assert.ok(fs.existsSync(getCardView(print.id).image));
    assert.ok(Object.isFrozen(print));
  }
  assert.equal(getCard('missing'), null);
  assert.equal(getCardPrint('LOCR-JP001-SR'), null);
  assert.equal(getCardView('missing'), null);
  assert.ok(Object.isFrozen(CARD_CATALOG[0].stats));
});
test('异画、出框和工艺按实际规格查询，旧卡不会冒充真实卡种', () => {
  assert.equal(findCardPrints({ rarity: 'UL' }).length, 21);
  assert.equal(findCardPrints({ rarity: 'PSER', overframe: false }).length, 62);
  assert.equal(findCardPrints({ rarity: 'PSER', overframe: true, set: 'LOCR' }).length, 18);
  assert.equal(findCardPrints({ query: '30397786' }).length, 5);
  assert.equal(getCardPrint('LOCR-JP031-UR').officialArtVariant, 3);
  assert.equal(getCardPrint('LOCR-JP001-UR-OF').overframe, true);
  assert.equal(getCardPrint('UR').legacy, true);
  assert.equal(getCardPrint('UR').cardId, 'legacy-placeholder');
  for (const r of CARD_RARITIES) assert.equal(r.name, r.id === 'UL' ? 'UTR' : r.id);
  assert.equal(findCardPrints({ query: 'UTR' }).length, 21);
  assert.equal(getCardView('LOCR-JP039-UL').style, 'UTR');
});

test('328个游戏规格都提供独立工艺通道，GMR底图没有固定预览编号', () => {
  for (const print of CARD_PRINTS) {
    assert.ok(Number.isInteger(print.kind) && print.kind >= 0 && print.kind <= 6, print.id);
    assert.equal(print.calibration.frame.length, 4, print.id);
    const root = `public/${print.assetRoot ?? 'locr-catalog'}/`;
    for (const field of ['front', 'mask', 'normal', 'accent'])
      assert.ok(print[field] && fs.existsSync(root + print[field]), `${print.id}:${field}`);
    if (print.border) assert.ok(fs.existsSync(root + print.border), print.id);
    if (print.rarity === 'GMR') assert.ok(getCardView(print.id).image.endsWith('-blank.jpg'));
  }
});
