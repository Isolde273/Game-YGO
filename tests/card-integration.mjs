import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import { CARD_PRINTS, getCardView } from '../src/game/card-data.js';
import { previewSeal, newCollation } from '../src/game/collation.js';
import { addCards, validateState, cardCount } from '../src/game/model.js';

const directory = 'test-results/card-integration';
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const errors = [];
const forbidden = /超级稀有|究极稀有|秘稀|棱镜秘稀|银碎|金字|大师卡框/;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(response.url());
  });
  const fixture = freshState();
  fixture.collation = newCollation();
  fixture.items.forEach((i) => (i.seal = previewSeal(i.kind)));
  fixture.settings.motion = false;
  fixture.settings.sound = false;
  for (const print of CARD_PRINTS)
    addCards(fixture, print.id, 1, print.rarity === 'GMR' ? [7] : []);
  await page.addInitScript((s) => {
    if (!localStorage.getItem('integration-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('integration-fixture', '1');
    }
  }, fixture);
  await page.goto('http://127.0.0.1:5173');
  await navigatePage(page, 'warehouse');
  assert.equal(await page.locator('.warehouse-card').count(), 328);
  assert.equal(forbidden.test(await page.locator('body').innerText()), false);
  await page.locator('#warehouse-search').fill('LOCR-JP001');
  assert.equal(await page.locator('.warehouse-card').count(), 5);
  const key = 'LOCR-JP001-UR-OF';
  const row = page.locator(`.warehouse-card:has([data-rarity="${key}"])`);
  const decodeImages = () =>
    page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  assert.ok((await row.innerText()).includes('UR-OF'));
  assert.ok((await row.locator('img').getAttribute('src')).includes(getCardView(key).front));
  await row.locator('[data-action="card-detail"]').click();
  assert.equal(await page.locator('.rarity-tag').innerText(), 'UR-OF');
  await page.locator('[data-action="close"]').click();
  await row.locator('[data-action="warehouse-transfer"]').first().click();
  await decodeImages();
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .jpeg({ quality: 82 })
    .toFile(`${directory}/warehouse.jpg`);
  await navigatePage(page, 'album');
  const drag = async (source, destination) => {
    const from = await page.locator(source).boundingBox();
    const to = await page.locator(destination).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  await drag(`.tray-card[data-rarity="${key}"]`, '[data-slot="0"]');
  assert.equal(await page.locator('[data-slot="0"]').getAttribute('data-rarity'), key);
  assert.ok(
    (await page.locator('[data-slot="0"] img').getAttribute('src')).includes(
      getCardView(key).front,
    ),
  );
  await decodeImages();
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .jpeg({ quality: 82 })
    .toFile(`${directory}/album.jpg`);
  await page.reload();
  const restored = validateState(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
  );
  assert.equal(restored.binder.slots[0].printId, key);
  assert.equal(cardCount(restored), 328);
  await navigatePage(page, 'album');
  await drag('[data-slot="0"]', '[data-album-drop="warehouse"]');
  assert.equal(await page.locator('[data-slot="0"].owned').count(), 0);
  await navigatePage(page, 'warehouse');
  await page.locator('[data-action="inventory-filter"][data-filter="UL"]').click();
  assert.equal(await page.locator('.warehouse-card').count(), 21);
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'jhs');
  assert.equal(forbidden.test(await page.locator('body').innerText()), false);
  assert.equal(await page.locator('[data-market-count]').textContent(), '328');
  assert.equal(await page.locator('.jhs-product').count(), 20);
  await page.locator('#market-rarity').selectOption('UL');
  assert.equal(await page.locator('[data-market-count]').textContent(), '21');
  assert.ok(
    (await page.locator('.market-rarity').allTextContents()).every((text) =>
      text.startsWith('UTR'),
    ),
  );
  await context.close();

  const oldContext = await browser.newContext();
  const oldPage = await oldContext.newPage();
  oldPage.on('pageerror', (e) => errors.push(e.message));
  const old = freshState();
  old.version = 1;
  old.cards.SR = 8;
  delete old.collection;
  delete old.binder;
  delete old.numberedCards;
  const raw = JSON.stringify(old);
  await oldPage.addInitScript((raw) => {
    if (!localStorage.getItem('migration-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', raw);
      localStorage.setItem('migration-fixture', '1');
    }
  }, raw);
  await oldPage.goto('http://127.0.0.1:5173');
  await oldPage.locator('.tile-album').waitFor();
  const saved = await oldPage.evaluate(() => ({
    current: JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
    backup: localStorage.getItem('ygo-duel-archive-v1-backup'),
  }));
  assert.equal(saved.current.version, 4);
  assert.equal(saved.current.collection.SR, 0);
  assert.equal(saved.current.cards.SR, 0);
  assert.equal(saved.backup, raw);
  await navigatePage(oldPage, 'album');
  assert.equal(await oldPage.locator('.tray-card[data-rarity="SR"]').count(), 0);
  await oldPage.reload();
  assert.equal(
    await oldPage.evaluate(() => localStorage.getItem('ygo-duel-archive-v1-backup')),
    raw,
  );
  await oldContext.close();
  const stackContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const stackPage = await stackContext.newPage();
  stackPage.on('pageerror', (error) => errors.push(error.message));
  const stacked = freshState();
  stacked.collation = newCollation();
  stacked.items = [];
  stacked.settings.motion = false;
  stacked.settings.sound = false;
  const stackPrints = ['LOCR-JP001-GMR', 'LOCR-JP039-UL', 'LOCR-JP040-CR'];
  const records = [];
  for (const printId of stackPrints) {
    const numbered = addCards(stacked, printId, 1, printId.endsWith('GMR') ? [37] : []);
    records.push(
      numbered.length
        ? { id: numbered[0].id, printId, rarity: 'GMR', serial: 37 }
        : { id: printId + '-instance', printId, rarity: getCardView(printId).rarity },
    );
  }
  stacked.cardStacks.push({
    id: 'actual-stack',
    pose3d: { position: [0, 0.12, 3] },
    cards: records,
  });
  validateState(stacked);
  await stackPage.addInitScript(
    (state) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state)),
    stacked,
  );
  await stackPage.goto('http://127.0.0.1:5173');
  await navigatePage(stackPage, 'open');
  await stackPage.locator('canvas[data-ready="true"]').waitFor();
  await stackPage.locator('.world-stack').press('Enter');
  await stackPage.locator('.inspect-card').first().waitFor();
  assert.equal(await stackPage.locator('.inspect-card').count(), 3);
  for (const record of records)
    assert.ok(
      (await stackPage.locator(`[data-card="${record.id}"] img`).getAttribute('src')).includes(
        getCardView(record.printId).image.split('/').at(-1),
      ),
    );
  await stackPage.locator('[data-warehouse-picker]').click();
  assert.equal(await stackPage.locator('[data-warehouse-rarity="UL"] b').textContent(), 'UTR');
  for (const rarity of ['UL', 'CR', 'GMR'])
    assert.equal(
      await stackPage.locator(`[data-warehouse-rarity="${rarity}"] input`).isDisabled(),
      false,
    );
  await stackPage.locator('[data-route-confirm="warehouse"]').click();
  await stackPage.locator('.card-inspector').waitFor({ state: 'detached' });
  const routed = validateState(
    await stackPage.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
  );
  assert.equal(routed.cardStacks.length, 0);
  assert.equal(cardCount(routed), 3);
  assert.equal(routed.numberedCards[0].serial, 37);
  await stackContext.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${directory}/report.json`,
    JSON.stringify({ passed: true, prints: 328, migration: true, backup: true, errors }, null, 2),
  );
  console.log(
    '全卡数据与存档浏览器验证通过：328规格、搜索/详情/转移/入册/重载、版本1备份、字母罕贵度。',
  );
} finally {
  await browser.close();
}
