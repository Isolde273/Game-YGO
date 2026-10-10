import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { _electron } from 'playwright';
import {
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
} from '../src/game/model.js';
import { getCardView } from '../src/game/card-data.js';

const root = path.resolve('portable/游戏王开盒模拟器');
const profile = path.resolve(`test-results/card-integration/desktop-profile-${Date.now()}`);
const env = { ...process.env, YGO_SMOKE_TEST: '1', YGO_SMOKE_USERDATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = path.join(root, '游戏王开盒模拟器.exe');
let electron;
const errors = [];
try {
  electron = await _electron.launch({ executablePath, env, timeout: 30000 });
  const page = await electron.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.home-menu').waitFor();
  await page.context().setOffline(true);
  const old = freshState();
  old.version = 1;
  old.cards.UR = 5;
  delete old.collection;
  delete old.numberedCards;
  const raw = JSON.stringify(old);
  await page.addInitScript((raw) => {
    if (!localStorage.getItem('desktop-old-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', raw);
      localStorage.setItem('desktop-old-fixture', '1');
    }
  }, raw);
  await page.reload();
  await page.locator('.home-menu').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('ygo-duel-archive-v1-backup')), raw);
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).version),
    4,
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).collection.UR,
    ),
    0,
  );

  const state = freshState();
  state.settings.motion = false;
  state.settings.sound = false;
  const key = 'LOCR-JP031-PSER';
  addCards(state, key, 2);
  addCards(state, 'LOCR-JP001-GMR', 1, [37]);
  addCards(state, 'LOCR-JP039-UL');
  transferWarehouseToTray(state, key);
  moveBinderCard(state, { printId: key }, 0);
  await page.addInitScript((state) => {
    if (!localStorage.getItem('desktop-real-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('desktop-real-fixture', '1');
    }
  }, state);
  await page.reload();
  await page.locator('.home-menu').waitFor();
  await page.locator('.tile-album').click();
  await page.locator('[data-slot="0"] img').waitFor();
  await page.locator('[data-slot="0"] img').evaluate((img) => img.decode());
  assert.ok(
    (await page.locator('[data-slot="0"] img').getAttribute('src')).includes(
      getCardView(key).front,
    ),
  );
  assert.equal(await page.locator('[data-slot="0"]').getAttribute('data-rarity'), key);
  assert.equal(await page.locator('[data-slot="0"] b').innerText(), 'PSER');
  await page.locator('.mini-nav [data-page="warehouse"]').click();
  assert.equal(await page.locator('.warehouse-card').count(), 3);
  await page
    .locator('.warehouse-card [data-action="card-detail"][data-rarity="LOCR-JP001-GMR"]')
    .click();
  assert.equal(await page.locator('.rarity-tag').innerText(), 'GMR');
  await page.locator('[data-action="close"]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await electron.close();
  electron = null;
  electron = await _electron.launch({ executablePath, env, timeout: 30000 });
  const restored = await electron.firstWindow();
  restored.on('pageerror', (error) => errors.push(error.message));
  await restored.locator('.home-menu').waitFor();
  const saved = validateState(
    await restored.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
  );
  assert.equal(saved.binder.slots[0].printId, key);
  assert.equal(saved.numberedCards[0].serial, 37);
  assert.equal(
    await restored.evaluate(() => localStorage.getItem('ygo-duel-archive-v1-backup')),
    raw,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/card-integration/desktop-report.json',
    JSON.stringify(
      {
        passed: true,
        offline: true,
        migration: true,
        backup: true,
        realCard: key,
        serial: 37,
        restart: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    '全卡存档 EXE 验证通过：离线异画卡面、规格分组、字母罕贵度、版本1备份、GMR编号与重启恢复。',
  );
} finally {
  if (electron) await electron.close();
}
