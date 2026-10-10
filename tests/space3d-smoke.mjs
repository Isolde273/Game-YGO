import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
await fs.mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cartonPhotos = [];
page.on('request', (r) => {
  if (/\/case(?:-source)?\.(png|jpg)(?:\?|$)/.test(r.url())) cartonPhotos.push(r.url());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
const snapshot = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
const settled = () =>
  page.waitForFunction(
    () => {
      const s = document.querySelector('canvas')?.world3D?.snapshot();
      return (
        s && s.objects.length >= 6 && s.objects.every((o) => o.position[1] < 3 && o.velocity < 0.3)
      );
    },
    null,
    { timeout: 20000 },
  );
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForTimeout(650);
  const falling = await snapshot();
  assert.equal(falling.engine, 'WebGL');
  assert.equal(falling.physics, 'cannon-es');
  assert.equal(falling.objects.length, 6);
  assert.ok(falling.objects.some((o) => o.kind === 'case' && o.position[1] > 2));
  assert.ok(falling.objects.some((o) => o.kind === 'box' && o.position[1] > 2));
  assert.ok(falling.objects.some((o) => o.kind === 'pack' && o.position[1] > 2));
  await page.screenshot({ path: 'test-results/space3d-falling.png' });
  await settled();
  assert.equal((await snapshot()).objects.length, 6);
  assert.equal(
    await page.locator('.topbar,.footer,.space-sidebar,.space-bottom,.page-heading').count(),
    0,
  );
  assert.equal(await page.locator('.unboxing-hud button').count(), 1);
  assert.equal(await page.locator('.unboxing-hud').innerText(), '返回\nRETURN\n游戏币\n10,000');
  await page.screenshot({ path: 'test-results/space3d-initial.png' });
  const caseBefore = (await snapshot()).objects.find((o) => o.kind === 'case');
  const caseId = caseBefore.id;
  const casePoint = await page.evaluate(
    (id) => document.querySelector('canvas').world3D.projectItem(id),
    caseId,
  );
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), casePoint),
    caseId,
  );
  await page.mouse.move(casePoint.x, casePoint.y);
  await page.mouse.down();
  await page.mouse.move(casePoint.x + 110, casePoint.y - 50, { steps: 18 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  assert.equal((await snapshot()).animations.length, 0);
  assert.equal((await state()).opened.case, 0);
  await page.waitForTimeout(1600);
  const afterDrag = (await snapshot()).objects.find((o) => o.id === caseId);
  assert.ok(
    Math.hypot(
      afterDrag.position[0] - caseBefore.position[0],
      afterDrag.position[2] - caseBefore.position[2],
    ) > 0.25,
  );
  const pos = await page.evaluate(
    (id) => document.querySelector('canvas').world3D.projectItem(id),
    caseId,
  );
  await page.mouse.dblclick(pos.x, pos.y);
  await page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animation?.phase === 'opening',
  );
  await page.waitForTimeout(400);
  const caseAnim = await snapshot();
  assert.equal(caseAnim.animation.kind, 'case');
  assert.ok(caseAnim.animation.flaps.some((a) => Math.abs(a) > 0.2));
  await page.screenshot({ path: 'test-results/space3d-case-opening.png' });
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal((await state()).items.filter((i) => i.kind === 'box').length, 14);
  assert.equal((await snapshot()).objects.filter((i) => i.kind === 'box').length, 14);
  await page.waitForTimeout(1700);
  await page.screenshot({ path: 'test-results/space3d-boxes.png' });
  await page.locator('.object-box').first().press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('canvas').world3D.snapshot().animation?.kind === 'box' &&
      document
        .querySelector('canvas')
        .world3D.snapshot()
        .animation?.flaps.some((a) => Math.abs(a) > 0.8),
  );
  assert.ok((await snapshot()).animation.flaps.some((a) => Math.abs(a) > 0.5));
  await page.screenshot({ path: 'test-results/space3d-box-opening.png' });
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal((await state()).items.filter((i) => i.kind === 'pack').length, 13);
  await page.locator('.object-pack').first().press('Enter');
  await page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().animation?.phase === 'withdraw',
  );
  assert.ok((await snapshot()).animation.strip[0] > 0.1);
  await page.screenshot({ path: 'test-results/space3d-pack-opening.png' });
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal((await snapshot()).cards.length, 10);
  assert.equal(
    Object.values((await state()).cards).reduce((a, b) => a + b, 0),
    10,
  );
  await page.screenshot({ path: 'test-results/space3d-table-stack.png' });
  await page.waitForTimeout(650);
  assert.equal((await snapshot()).cards.filter((c) => c.revealed).length, 10);
  await page.screenshot({ path: 'test-results/space3d-cards-front.png' });
  await page.locator('.world-stack').press('Enter');
  await page.locator('[data-route-all="collection"]').click();
  assert.equal((await snapshot()).cards.length, 0);
  await page.locator('.space-return').click();
  await page.locator('.tile-album').click();
  assert.ok((await page.locator('.album-slot.owned').count()) > 0);
  assert.deepEqual(cartonPhotos, []);
  assert.deepEqual(errors, []);
  console.log(
    '3D 验证通过：极简 HUD、掉落与稳定拖拽、四片箱盖、盒盖和撕包动画、12/10/10 数量、桌面卡堆与整理收藏。',
  );
} finally {
  await browser.close();
}
