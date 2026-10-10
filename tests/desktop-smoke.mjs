import { closePurchase, dragAlbumCard } from './helpers/browser.mjs';
import { ROOM_PHI } from '../src/scene/room-view.js';
import { freshState as freshGameState } from '../src/game/model.js';
import { freshState } from './helpers/starter-state.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const root = path.resolve(process.env.YGO_DESKTOP_ROOT || 'portable/游戏王开盒模拟器');
const executable = path.join(root, `${path.basename(root)}.exe`);
await fs.access(executable);
const profile = path.resolve('test-results/desktop-profile-' + Date.now());
// Leave the directory absent to exercise first-run profile creation.
const env = { ...process.env, YGO_SMOKE_TEST: '1', YGO_SMOKE_USERDATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
let electron;
try {
  electron = await _electron.launch({ executablePath: executable, env, timeout: 30000 });
  const page = await electron.firstWindow();
  const navigationReady = (view, target) =>
    view.waitForFunction(
      (target) =>
        document.body.dataset.page === target &&
        document.querySelector('#page-transition').hidden &&
        !document.querySelector('#app').inert,
      target,
    );
  await page.context().setOffline(true);
  // WebGL animation needs an actual visible window, as in a normal double-click launch.
  await electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('.home-menu');
  assert.equal(
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()),
    path.basename(root),
  );
  assert.ok(page.url().startsWith('file:///'));
  assert.equal(
    await page.locator('#coins').innerText(),
    freshGameState().coins.toLocaleString('en-US'),
  );
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).items.map((item) => item.kind),
    ),
    freshGameState().items.map((item) => item.kind),
  );
  // Opening workflows require explicit test stock; keep first-run gifts independent.
  await page.addInitScript((state) => {
    if (!sessionStorage.getItem('desktop-stock-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      sessionStorage.setItem('desktop-stock-fixture', '1');
    }
  }, freshState());
  await page.reload();
  await page.waitForSelector('.home-menu');
  assert.equal(await page.locator('#coins').innerText(), '10,000');
  assert.equal(await page.locator('.menu-tile').count(), 6);
  assert.equal(await page.evaluate(() => typeof window.desktop?.toggleFullscreen), 'function');
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.waitForTimeout(1300);
  await page.screenshot({ path: 'test-results/desktop-home.png' });
  await page.locator('.tile-shop').click();
  await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
  assert.equal(await page.locator('.transition-phone-dock,.room-portal-layer').count(), 0);
  assert.equal(await page.locator('.phone').evaluate((el) => el.offsetHeight), 606);
  assert.equal(await page.locator('.phone-hand').count(), 0);
  await page.locator('.purchase-overlay').click({ position: { x: 20, y: 100 } });
  await page.waitForSelector('.purchase-overlay', { state: 'detached' });
  await navigationReady(page, 'home');
  await page.locator('.tile-open').click();
  await navigationReady(page, 'open');
  await page.waitForSelector('canvas[data-ready="true"]');
  assert.equal(
    await page.evaluate(() => document.querySelector('canvas').world3D.snapshot().orbit.phi),
    ROOM_PHI,
  );
  const maxDistance = 9.8 * 2.42;
  await page.mouse.move(720, 700);
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => document.querySelector('canvas').world3D.snapshot().orbit.distance),
    maxDistance,
  );
  await page.mouse.wheel(0, -160);
  await page.waitForTimeout(250);
  assert.ok(
    (await page.evaluate(
      () => document.querySelector('canvas').world3D.snapshot().orbit.distance,
    )) < maxDistance,
  );
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(250);
  const scenery = await page.evaluate(
    () => document.querySelector('canvas').world3D.snapshot().scenery,
  );
  assert.equal(scenery.name, 'blender-card-shop');
  assert.match(scenery.authoring, /Blender/);
  assert.ok(scenery.sourceParts > 1000);
  assert.ok(!scenery.props.some((p) => p.name === 'Lamp'));
  assert.ok(scenery.props.some((p) => p.name === 'Warehouse'));
  await page.locator('[data-action="organize-space"]').click();
  for (const destination of ['shop', 'album', 'warehouse']) {
    const source = await page.evaluate(
      (destination) => document.querySelector('canvas').world3D.snapshot().entrances[destination],
      destination,
    );
    const point = {
      x: source.quad.reduce((s, p) => s + p[0], 0) / 4,
      y: source.quad.reduce((s, p) => s + p[1], 0) / 4,
    };
    assert.equal(
      await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), point),
      destination === 'shop' ? 'phone' : destination,
    );
    await page.evaluate(() => (window.desktopRoomCanvas = document.querySelector('canvas')));
    await page.mouse.click(point.x, point.y);
    if (destination === 'shop') {
      await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
      assert.equal(await page.locator('.room-portal-layer,.transition-screen-bridge').count(), 0);
      assert.equal(
        await page.evaluate(() => window.desktopRoomCanvas === document.querySelector('canvas')),
        true,
      );
      await page.screenshot({ path: 'test-results/desktop-phone-overlay.png' });
      await closePurchase(page);
      await navigationReady(page, 'open');
      assert.equal(
        await page.evaluate(() => window.desktopRoomCanvas === document.querySelector('canvas')),
        true,
      );
    } else {
      await page.waitForSelector(`.room-portal-layer[data-portal="${destination}"]`);
      await navigationReady(page, destination);
      assert.equal(await page.locator('.room-portal-layer').count(), 0);
      await page.locator('.brand').click();
      await navigationReady(page, 'home');
      await page.locator('.tile-open').click();
      await navigationReady(page, 'open');
      await page.waitForSelector('canvas[data-presented="true"]');
    }
  }
  assert.equal(
    await page.locator('.desk-status,.desk-pile-tag,.desk-hover-info,.desk-phone-button').count(),
    0,
  );
  assert.equal(
    (await page.locator('.desk-help').innerText()).replace(/\s+/g, ' ').trim(),
    '双击 拆封 右键 批量操作卡盒、卡包和卡堆 滚轮 缩放',
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector('canvas').world3D.snapshot().tabletop.cardPad.width,
    ),
    5.8,
  );
  await page.locator('[data-action="organize-space"]').click();
  assert.equal(await page.locator('#toast').innerText(), '桌面已整理');
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).items.length),
    6,
  );
  await page.waitForTimeout(2000);
  assert.equal(
    await page.locator('.world-object').count(),
    6,
    JSON.stringify(
      await page.evaluate(() => ({
        state: JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
        scene: document.querySelector('canvas').world3D.snapshot(),
      })),
    ),
  );
  const boxPoint = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    const box = api.snapshot().objects.find((o) => o.kind === 'box');
    return api.projectItem(box.id);
  });
  await page.mouse.move(boxPoint.x, boxPoint.y);
  await page.mouse.down();
  await page.mouse.move(boxPoint.x + 80, boxPoint.y + 35, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.world-object').count(), 6);
  const packPoint = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api
      .snapshot()
      .objects.filter((o) => o.kind === 'pack')
      .map((o) => ({ id: o.id, ...api.projectItem(o.id) }))
      .find((p) => api.hitAt(p.x, p.y) === p.id);
  });
  assert.ok(packPoint);
  await page.mouse.move(packPoint.x, packPoint.y);
  await page.mouse.down();
  await page.mouse.move(packPoint.x + 45, packPoint.y - 25, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.world-object').count(), 6);
  await page.locator('.object-case').press('Enter');
  await page.waitForFunction(() =>
    document
      .querySelector('canvas')
      .world3D.snapshot()
      .animation?.flaps.every((a) => Math.abs(a) > 0.8),
  );
  await page.screenshot({ path: 'test-results/desktop-3d-case-opening.png' });
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal(await page.locator('.object-box').count(), 26);
  await page.locator('.object-box').first().press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('canvas').world3D.snapshot().animation?.kind === 'box' &&
      document
        .querySelector('canvas')
        .world3D.snapshot()
        .animation?.flaps.some((a) => Math.abs(a) > 0.8),
  );
  await page.screenshot({ path: 'test-results/desktop-3d-box-opening.png' });
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal(await page.locator('.object-pack').count(), 18);
  await page.locator('.object-pack').first().press('Enter');
  await page.waitForFunction(() => !document.querySelector('canvas').world3D.snapshot().animation);
  assert.equal(
    await page.evaluate(() => document.querySelector('canvas').world3D.snapshot().cards.length),
    4,
  );

  await page.waitForTimeout(650);
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector('canvas')
          .world3D.snapshot()
          .cards.filter((c) => c.revealed).length,
    ),
    4,
  );
  await page.screenshot({ path: 'test-results/desktop-3d-reveal.png' });
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.inspect-transition-layer');
  assert.equal(await page.locator('.inspect-transition-layer').count(), 1);
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  await page.screenshot({ path: 'test-results/desktop-card-inspector.png' });
  await page.locator('.inspect-return').click();
  assert.equal(await page.locator('.card-inspector').getAttribute('data-phase'), 'closing');
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector('canvas').world3D.snapshot().stacks[0].visible,
    ),
    true,
  );
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  const originalOrder = await page
      .locator('.inspect-card')
      .evaluateAll((cards) => cards.map((c) => c.dataset.card)),
    rear = await page.locator('.inspect-card').first().boundingBox(),
    front = await page.locator('.inspect-card').last().boundingBox();
  await page.mouse.move(rear.x + 2, rear.y + rear.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(front.x + front.width / 2, front.y + front.height * 0.45, { steps: 12 });
  await page.mouse.up();
  assert.deepEqual(
    await page.locator('.inspect-card').evaluateAll((cards) => cards.map((c) => c.dataset.card)),
    [...originalOrder.slice(1), originalOrder[0]],
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).cardStacks[0].cards.at(-1).id,
    ),
    originalOrder[0],
  );
  await page.waitForTimeout(200);
  const card = await page.locator('.inspect-card').last().boundingBox(),
    target = await page.locator('[data-destination="collection"]').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  assert.ok((await page.locator('.inspect-route-flight').count()) > 0);
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  assert.equal(await page.locator('.inspect-card').count(), 3);
  const pending = await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).cardStacks[0].cards,
    ),
    counts = pending.reduce((r, c) => ((r[c.rarity] = (r[c.rarity] ?? 0) + 1), r), {}),
    [rarity, warehouseAmount] = Object.entries(counts).sort((a, b) => a[1] - b[1])[0];
  await page.locator('[data-warehouse-picker]').click();
  await page.locator('[data-rarity-select="none"]').click();
  assert.equal(await page.locator('[data-route-confirm]').isDisabled(), true);
  await page.locator(`[data-warehouse-rarity="${rarity}"] input`).check();
  await page.locator('[data-route-confirm]').click();
  const afterSelection = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
  );
  assert.equal(afterSelection.cardStacks[0]?.cards.length ?? 0, 3 - warehouseAmount);
  assert.ok(afterSelection.cardStacks.every((s) => s.cards.every((c) => c.rarity !== rarity)));
  if (warehouseAmount < 3) {
    await page.waitForSelector('.card-inspector[data-phase="open"]');
    await page.locator('[data-route-all="collection"]').click();
  }
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  const allocation = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
  );
  assert.equal(
    Object.values(allocation.collection).reduce((a, b) => a + b, 0),
    4 - warehouseAmount,
  );
  assert.equal(
    Object.values(allocation.cards).reduce((a, b) => a + b, 0),
    4,
  );
  assert.equal(allocation.cardStacks.length, 0);
  await page.locator('.space-return').click();
  await navigationReady(page, 'home');
  await page.locator('.tile-album').click();
  await navigationReady(page, 'album');
  assert.ok((await page.locator('.tray-card').count()) > 0);
  await dragAlbumCard(page, '.tray-card', '[data-slot="0"]');
  assert.equal(await page.locator('.album-slot.owned').count(), 1);
  await page.locator('[data-action="navigate"][data-page="settings"]').click();
  await navigationReady(page, 'settings');
  assert.equal(await page.locator('.topbar,.mini-nav,.workspace-rail,.footer').count(), 0);
  const settingsBounds = await page.locator('.settings-page').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      widthError: Math.abs(rect.width - innerWidth),
      heightError: Math.abs(rect.height - innerHeight),
    };
  });
  // Windows display scaling can give CSS viewport units fractional pixels while innerWidth rounds.
  assert.ok(
    settingsBounds.x === 0 &&
      settingsBounds.y === 0 &&
      settingsBounds.widthError < 1 &&
      settingsBounds.heightError < 1,
    JSON.stringify(settingsBounds),
  );
  assert.equal(await page.locator('.settings-menu>button').count(), 3);
  assert.deepEqual(await page.locator('.settings-menu>button').allInnerTexts(), [
    'CONFIG',
    'DATA SAVE',
    'RETURNtoTITLE',
  ]);
  assert.equal(await page.locator('.settings-card-stars>i').count(), 8);
  assert.equal(await page.locator('.settings-menu>button>.icon').count(), 0);
  assert.equal(await page.locator('.settings-card-name>span').innerText(), '白き幻獣－青眼の白龍');
  assert.equal(await page.locator('.settings-card-stats').innerText(), 'ATK/3000\nDEF/2500');
  assert.equal(await page.locator('.settings-card-footer>span').innerText(), '30397786');
  assert.equal(await page.locator('#settings-rules,[data-section="settings-rules"]').count(), 0);
  assert.ok(
    (await page.locator('.settings-feature-card img').getAttribute('src')).endsWith(
      'reload-dragon.svg',
    ),
  );
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.equal(
    await page.locator('.settings-config-word').evaluate((el) => getComputedStyle(el).fill),
    'rgb(6, 27, 102)',
  );
  assert.equal(
    await page.locator('.settings-circle').evaluate((el) => getComputedStyle(el).borderTopColor),
    'rgb(244, 251, 255)',
  );
  await page.locator('[data-section="settings-save"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.ok(await page.locator('[data-action="export"]').isVisible());
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.ok(await page.locator('[data-setting="motion"]').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.ok(await page.locator('.settings-persona.is-system').isVisible());
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  const before = await electron.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isFullScreen(),
  );
  await page.locator('[data-action="fullscreen"]').click();
  await page.waitForTimeout(500);
  assert.equal(
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
    !before,
  );
  await page.locator('[data-action="fullscreen"]').click();
  await page.locator('.settings-menu [data-action="home"]').click();
  await navigationReady(page, 'home');
  await page.reload();
  assert.equal(await page.locator('.card-counter').count(), 0);
  const brokenImages = await page.evaluate(() =>
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
  );
  assert.deepEqual(brokenImages, []);
  assert.deepEqual(errors, []);
  await electron.close();
  electron = null;
  electron = await _electron.launch({ executablePath: executable, env, timeout: 30000 });
  const restored = await electron.firstWindow();
  await electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  await restored.waitForSelector('.home-menu');
  assert.equal(await restored.locator('.card-counter').count(), 0);
  await restored.context().setOffline(true);
  await restored.locator('.tile-open').click();
  await navigationReady(restored, 'open');
  await restored.waitForSelector('canvas[data-ready="true"]');
  assert.equal(
    await restored.evaluate(
      () => document.querySelector('canvas').world3D.snapshot().scenery.triangles,
    ),
    scenery.triangles,
  );
  await restored.locator('.space-return').click();
  await navigationReady(restored, 'home');
  const quitFinished = electron.waitForEvent('close');
  await restored.locator('.tile-exit').click();
  await quitFinished;
  electron = null;
  console.log(
    '绿色版验证通过：独立 EXE 启动、新 Blender 场景、三个模型入口与前端追加转场、file 离线素材、原界面背景与手机拿取浮层、后排拖卡换序、按罕贵度入仓、五个主入口、开包收藏、全屏、刷新与程序重启后的存档恢复、退出按钮关闭程序。',
  );
} finally {
  if (electron) await electron.close();
}
