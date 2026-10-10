import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { makeItem, openPacks, purchase } from '../src/game/model.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  state = freshState();
state.items = Array.from({ length: 64 }, () => makeItem('pack'));
state.coins = 100000;
for (let i = 0; i < 6; i++) {
  const result = openPacks(
    state,
    state.items.slice(0, 5).map((p) => p.id),
    () => 0.9,
  );
  result.stack.pose3d.position = [(i - 2.5) * 1.3, 0.14645, 5];
}
purchase(state, 'pack', 30);
state.items.forEach((p, i) => {
  p.isNew = false;
  p.angle = 0;
  p.pose3d = {
    position: [((i % 8) - 3.5) * 1.7, 0.07, (Math.floor(i / 8) - 3.5) * 1.1],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  };
});
await page.addInitScript((s) => {
  if (!localStorage.getItem('lifecycle-seeded')) {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
    localStorage.setItem('lifecycle-seeded', '1');
  }
}, state);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const enter = async () => {
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
};
const snapshot = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const returned = () =>
  page.waitForFunction(() => !document.querySelector('.card-inspector,.inspect-transition-layer'));
try {
  await page.goto('http://127.0.0.1:5173');
  await enter();
  for (let i = 0; i < 8; i++) {
    const s = await snapshot();
    assert.equal(s.objects.length, 64);
    assert.equal(s.cards.length, 300);
    assert.equal(s.stacks.length, 6);
    assert.equal(await page.locator('canvas').count(), 1);
    await page.locator('.space-return').click();
    await enter();
  }
  await page.locator('.world-stack').first().press('Enter');
  await page.locator('[data-route-all="collection"]').click();
  await returned();
  assert.equal((await snapshot()).cards.length, 250);
  await page.locator('.world-stack').first().press('Enter');
  await page.locator('[data-warehouse-picker]').click();
  await page.locator('[data-route-confirm="warehouse"]').click();
  await returned();
  assert.equal((await snapshot()).cards.length, 200);
  await page.locator('.world-stack').first().press('Enter');
  await page.keyboard.press('Escape');
  await returned();
  assert.equal((await snapshot()).cards.length, 200);
  await page.locator('.space-return').click();
  await page.reload();
  await enter();
  const restored = await snapshot();
  assert.equal(restored.objects.length, 64);
  assert.equal(restored.cards.length, 200);
  assert.equal(restored.stacks.length, 4);
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  assert.equal(save.collection.UR, 50);
  assert.equal(save.cards.UR, 300);
  assert.equal(save.opened.pack, 30);
  assert.deepEqual(errors, []);
  console.log(
    '生命周期验证通过：64 件物品、300 张待整理卡、八次进出、收藏／仓库分配、未整理卡堆保留与刷新恢复。',
  );
} finally {
  await browser.close();
}
