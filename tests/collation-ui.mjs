import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import path from 'node:path';
import {
  browserOptions,
  navigatePage,
  openPhoneApp,
  closePurchase,
  dragAlbumCard,
} from './helpers/browser.mjs';
import { purchase, openItem, validateState } from '../src/game/model.js';
import { newCollation } from '../src/game/collation.js';
import { getCardView } from '../src/game/card-data.js';
const desktop = process.env.YGO_COLLATION_DESKTOP === '1';
const directory = 'test-results/collation-ui';
await fs.mkdir(directory, { recursive: true });
let application;
const errors = [];
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${directory}/desktop-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
      timeout: 30000,
    });
    page = await application.firstWindow({ timeout: 30000 });
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
  } else {
    application = await chromium.launch({ ...browserOptions, headless: true });
    page = await application.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(r.url());
  });
  const s = freshState();
  s.coins = 1e6;
  s.settings.motion = false;
  s.settings.sound = false;
  s.items = [];
  s.collation = newCollation();
  purchase(s, 'case', 3, 'N', () => 0);
  const winning = s.items.find((i) => i.kind === 'case' && i.seal.gmr);
  const boxes = openItem(s, winning.id).items;
  const gmrBox = boxes.find((i) => i.seal.gmr);
  const packs = openItem(s, gmrBox.id).items;
  const gmrPack = packs.find((i) => i.seal.cards.some((c) => c.serial));
  const serial = gmrPack.seal.cards.find((c) => c.serial),
    bonus = s.items.find((i) => i.kind === 'bonus');
  const caseItem = s.items.find((i) => i.kind === 'case');
  const regularFive = packs.filter((i) => i !== gmrPack).slice(0, 5),
    bonuses = s.items.filter((i) => i.kind === 'bonus').slice(0, 6);
  s.items = [gmrPack, ...regularFive, ...bonuses, caseItem];
  s.containers = [];
  s.items.forEach((i) => {
    const isCase = i.kind === 'case',
      offset = i.kind === 'bonus' ? bonuses.indexOf(i) : regularFive.indexOf(i);
    i.isNew = false;
    i.pose3d = {
      position: [
        isCase ? -5 : i === gmrPack ? 0 : i.kind === 'bonus' ? 2 : 4,
        isCase ? 1.334 : 0.083 + Math.max(0, offset) * 0.078,
        isCase ? -3 : 1,
      ],
      quaternion: isCase ? [0, 0, 0, 1] : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    };
  });
  validateState(structuredClone(s));
  await page.addInitScript((state) => {
    if (!localStorage.getItem('collation-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('collation-fixture', '1');
    }
  }, s);
  if (desktop) {
    await page.context().setOffline(true);
    await page.reload();
  } else await page.goto('http://127.0.0.1:5173');
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'tao');
  assert.ok((await page.locator('.tao-product').first().innerText()).includes('15 包 / 盒'));
  await page.locator('[data-action="checkout"][data-kind="box"]').click();
  await page.locator('#checkout-quantity').fill('3');
  await page.locator('#checkout-quantity').dispatchEvent('input');
  assert.ok((await page.locator('#checkout-bonus').innerText()).includes('1 包'));
  await page.locator('[data-action="buy"]').click();
  assert.ok((await page.locator('.order-success').innerText()).includes('赠 vol.2 1 包'));
  await page.locator('.order-success [data-action="close"]').click();
  await closePurchase(page);
  await navigatePage(page, 'open');
  await page.locator('canvas[data-ready="true"]').waitFor();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const idle = () =>
    page.waitForFunction(
      () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
    );
  await page.locator(`.world-object[data-item="${caseItem.id}"]`).evaluate((b) => b.click());
  await idle();
  assert.equal(await page.locator('.world-object[aria-disabled="true"]').count(), 24);
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .jpeg({ quality: 82 })
    .toFile(`${directory}/${desktop ? 'desktop-' : 'browser-'}case.jpg`);
  const draw = async (item) => {
    await page.locator(`.world-object[data-item="${item.id}"]`).evaluate((b) => b.click());
    await idle();
  };
  await draw(gmrPack);
  assert.equal((await stored()).cardStacks[0].cards.length, 4);
  await draw(bonus);
  assert.equal((await stored()).cardStacks[1].cards.length, 1);
  const five = async (item) => {
    await page
      .locator(`.world-object[data-item="${item.id}"]`)
      .evaluate((b) =>
        b.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
        ),
      );
    await idle();
  };
  await five(regularFive[0]);
  assert.equal((await stored()).opened.pack, 6);
  await five(bonuses[1]);
  assert.equal((await stored()).opened.bonus, 6);
  const after = await stored();
  assert.equal(after.items.filter((i) => i.kind === 'bonus').length, 1);
  assert.equal(after.numberedCards.find((c) => c.printId === serial.printId).serial, serial.serial);
  const stack = after.cardStacks[0];
  await page.locator(`.world-stack[data-stack="${stack.id}"]`).evaluate((b) => b.click());
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  assert.equal(await page.locator('.inspect-card').count(), 4);
  assert.ok(
    (await page.locator('.inspect-card img').first().getAttribute('src')).includes('LOCR-'),
  );
  const expected = String(serial.serial).padStart(3, '0') + '/100';
  assert.equal(await page.locator('.gmr-serial').innerText(), expected);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .jpeg({ quality: 82 })
    .toFile(`${directory}/${desktop ? 'desktop-' : 'browser-'}cards.jpg`);
  await page.locator('[data-route-all="collection"]').click();
  await page.waitForSelector('.card-inspector', { state: 'detached' });
  await navigatePage(page, 'home');
  await navigatePage(page, 'album');
  await dragAlbumCard(page, `.tray-card[data-rarity="${serial.printId}"]`, '[data-slot="0"]');
  assert.equal(await page.locator('[data-slot="0"] .gmr-serial').innerText(), expected);
  assert.ok((await page.locator('[data-slot="0"] img').getAttribute('src')).includes('-blank.jpg'));
  await page.reload();
  validateState(await stored());
  assert.equal((await stored()).binder.slots[0].serial, serial.serial);
  assert.equal(
    (await stored()).numberedCards.find((c) => c.printId === serial.printId).inCollection,
    true,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${directory}/${desktop ? 'desktop' : 'browser'}-report.json`,
    JSON.stringify(
      {
        passed: true,
        serial: expected,
        boxSlots: 24,
        packCards: 4,
        bonusCards: 1,
        bulkRegularCards: 20,
        bulkBonusCards: 5,
        offline: desktop,
      },
      null,
      2,
    ),
  );
  console.log(
    `Collation ${desktop ? 'desktop offline' : 'browser'} flow passed: purchase, bonus delivery, 24 boxes, real draws, GMR identity, binder and reload.`,
  );
} finally {
  await application?.close();
}
