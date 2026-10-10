import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import {
  makeItem,
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
} from '../src/game/model.js';
import { CARD_PRINTS, makeCardRecord } from '../src/game/card-data.js';

const desktop = process.env.YGO_CONTINUITY_DESKTOP === '1';
const output = 'test-results/room-album-fixes-20261009';
const prefix = desktop ? 'desktop' : 'browser';
await fs.mkdir(output, { recursive: true });
const fixture = freshState();
fixture.items = [];
fixture.settings.sound = false;
fixture.settings.motion = true;
const prints = ['SR', 'SER', 'PSER', 'CR', 'UL', 'GMR'].map((style) =>
  CARD_PRINTS.find((p) => p.style === style),
);
for (const [i, print] of prints.entries()) {
  addCards(fixture, print.id, 4, print.rarity === 'GMR' ? [11, 22, 33, 44] : undefined);
  transferWarehouseToTray(fixture, print.id, 4);
  for (let j = 0; j < 3; j++) moveBinderCard(fixture, { printId: print.id }, j * 12 + i);
}
for (const count of [1, 4, 20]) {
  const print = prints[count % 5];
  addCards(fixture, print.id, count);
  fixture.cardStacks.push({
    id: `continuity-stack-${count}`,
    cards: Array.from({ length: count }, (_, i) =>
      makeCardRecord(print.id, `continuity-${count}-${i}`),
    ),
    pose3d: {
      position: [-1.1 + count / 10, 0.1, 1.8],
      quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    },
  });
}
fixture.items = Array.from({ length: 6 }, (_, i) => ({
  ...makeItem('pack'),
  id: `continuity-pack-${i}`,
  kind: 'pack',
  isNew: false,
  x: 0,
  y: 0,
  angle: 0,
  pose3d: {
    position: [i === 0 ? -2 : 2, 0.22 + (i % 5) * 0.08, -1.5],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  },
}));
validateState(structuredClone(fixture));
const report = { desktop, turns: [], handoffs: [], errors: [] };
let application;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await application.firstWindow();
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.context().setOffline(true);
  } else {
    application = await chromium.launch({ ...browserOptions, headless: true });
    page = await application.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/locr-catalog/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.continue();
    });
  }
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.addInitScript((fixture) => {
    if (!localStorage.getItem('continuity-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(fixture));
      localStorage.setItem('continuity-fixture', '1');
    }
  }, fixture);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  await page.evaluate(() => {
    window.entryAudit = { frames: 0, unready: 0 };
    const sample = () => {
      const canvas = document.querySelector('#world canvas');
      if (canvas?.dataset.ready === 'true' && canvas.dataset.presented === 'true') {
        window.entryAudit.frames++;
        if (canvas.world3D.snapshot().stacks.some((stack) => !stack.finish?.ready))
          window.entryAudit.unready++;
      }
      window.entryFrame = requestAnimationFrame(sample);
    };
    sample();
  });
  await navigatePage(page, 'open');
  report.entry = await page.evaluate(() => {
    cancelAnimationFrame(window.entryFrame);
    return window.entryAudit;
  });
  assert.ok(report.entry.frames > 0);
  assert.equal(
    report.entry.unready,
    0,
    'The first presented room frame includes ready tabletop card faces',
  );
  await shot('room-ready');
  await page.evaluate(async (fixture) => {
    const { createWorld3D } = await import(new URL('./src/scene/world3d.js', location.href));
    const { openItem } = await import(new URL('./src/game/model.js', location.href));
    const host = document.createElement('main');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '1000' });
    host.id = 'continuity-room';
    document.body.append(host);
    window.handoffWorld = createWorld3D(host, {
      state: fixture,
      save() {},
      sound() {},
      toast() {},
      navigate() {},
      open: (id) => openItem(fixture, id),
    });
    await window.handoffWorld.ready;
    const w = window.handoffWorld;
    w.setNavigationPaused(true);
    w.renderer.setDrawingBufferSize(host.clientWidth, host.clientHeight, w.quality.ratio);
    w.renderSize = null;
    w.renderer.render(w.scene, w.camera);
    w.canvas.style.removeProperty('visibility');
  }, fixture);
  // Check the real animation face against the resting face at the handoff,
  // including the five-pack path that used to evict its finish from the cache.
  for (const count of [1, 5]) {
    await page.evaluate((count) => {
      const api = window.handoffWorld;
      api.setNavigationPaused(true);
      const records = api.records
        .filter((r) => r.item.id.startsWith('continuity-pack-') && !r.hidden)
        .slice(0, count);
      api.openPackRecords(records);
      api.batches.forEach((batch) => batch.update());
    }, count);
    await page.waitForFunction(() =>
      window.handoffWorld.animations.some((a) => a.kind === 'pack' && a.finishesReady),
    );
    const before = await page.evaluate(() => {
      const api = window.handoffWorld;
      const a = api.animations.find((a) => a.kind === 'pack');
      api.animateOpening(a, a.duration - 0.001);
      const top = a.contents.at(-1);
      top.updateWorldMatrix(true, false);
      window.handoff = {
        a,
        top,
        matrix: top.matrixWorld.clone(),
        board: top.getObjectByName('card-board'),
      };
      api.library.updateCardLight(api.keyLight.position);
      api.renderer.render(api.scene, api.camera);
      const center = top.getWorldPosition(api.target.clone());
      return {
        center: api.projectPoint(center.toArray()),
        print: top.userData.finish.userData.printId,
      };
    });
    const beforeShot = await page.screenshot();
    const continuity = await page.evaluate(() => {
      const api = window.handoffWorld;
      const { a, top, matrix, board } = window.handoff;
      api.finishOpening(a);
      const stack = api.tableStacks.find((s) => s.data.id === a.result.stack.id);
      const after = stack.visual.getObjectByName('card-board');
      top.updateWorldMatrix(true, false);
      api.library.updateCardLight(api.keyLight.position);
      api.renderer.render(api.scene, api.camera);
      return {
        count: stack.data.cards.length,
        sameBoard: after === board,
        sameMaterial: after.material[1] === board.material[1],
        ready: !!stack.visual.userData.finish.userData.ready,
        maxPoseDelta: Math.max(
          ...top.matrixWorld.elements.map((n, i) => Math.abs(n - matrix.elements[i])),
        ),
      };
    });
    const afterShot = await page.screenshot();
    // Compare an inner patch of the top face, excluding the new paper edges.
    const crop = {
      left: Math.round(before.center.x) - 8,
      top: Math.round(before.center.y) - 8,
      width: 16,
      height: 16,
    };
    const pixels = async (buffer) => sharp(buffer).extract(crop).removeAlpha().raw().toBuffer();
    const x = await pixels(beforeShot),
      y = await pixels(afterShot);
    continuity.maxPixelDelta = Math.max(...x.map((value, i) => Math.abs(value - y[i])));
    assert.equal(continuity.sameBoard, true);
    assert.equal(continuity.sameMaterial, true);
    assert.equal(continuity.ready, true);
    assert.ok(continuity.maxPoseDelta < 1e-10);
    assert.equal(
      continuity.maxPixelDelta,
      0,
      'The top face is pixel-identical across pack-to-stack handoff',
    );
    report.handoffs.push(continuity);
    await sharp(afterShot)
      .resize({ width: 1280 })
      .webp()
      .toFile(`${output}/${prefix}-pack-${count}.webp`);
    await page.evaluate(() => window.handoffWorld.setNavigationPaused(false));
  }
  await page.evaluate(() => {
    window.handoffWorld.dispose();
    document.querySelector('#continuity-room').remove();
    delete window.handoffWorld;
  });
  await navigatePage(page, 'home');
  await page.locator('.tile-album').click();
  await page.waitForFunction(
    () => document.querySelector('#page-transition').dataset.phase === 'revealing',
  );
  report.entranceAssemblyTracks = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.effect?.target?.matches?.('.left-page,.right-page,.collection-dock'))
        .length,
  );
  assert.equal(report.entranceAssemblyTracks, 0);
  await page.waitForFunction(() => !document.body.classList.contains('navigating'));
  const monitor = async () =>
    page.evaluate(() => {
      window.turnAudit = { frames: 0, missing: [], snapshots: 0 };
      const sample = () => {
        window.turnAudit.frames++;
        for (const image of document.querySelectorAll(
          '#app .album-studio img[data-finish-print]',
        )) {
          if (getComputedStyle(image).visibility === 'hidden') continue;
          const rect = image.getBoundingClientRect();
          if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
          const canvas = image.parentElement.querySelector('.card-finish-canvas');
          if (!canvas || canvas.dataset.ready !== 'true') {
            window.turnAudit.missing.push(image.dataset.finishPrint);
            continue;
          }
          const data = canvas
            .getContext('2d')
            .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          if (data[3] === 0) window.turnAudit.missing.push('blank-canvas');
          if (image.closest('.book-turn-layer')) window.turnAudit.snapshots++;
        }
        window.turnAudit.frame = requestAnimationFrame(sample);
      };
      sample();
    });
  for (const [width, motion] of [
    [1440, true],
    [390, true],
    [1440, false],
  ]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (!motion) await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const direction of ['next', 'prev']) {
      await monitor();
      await page.locator(`[data-action="album-${direction}"]`).click();
      if (motion) {
        await page.locator('.book-turn-layer').waitFor();
        await shot(`turn-${width}-${direction}`);
      }
      await page.waitForFunction(
        (expected) =>
          !document.querySelector('.book-turn-layer') &&
          document.querySelector('#album-jump').value === expected,
        direction === 'next' ? '3' : '1',
      );
      // Give the render observer a frame after committing the prepared spread.
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
      const audit = await page.evaluate(() => {
        cancelAnimationFrame(window.turnAudit.frame);
        delete window.turnAudit.frame;
        return window.turnAudit;
      });
      assert.deepEqual(
        audit.missing,
        [],
        'Outgoing, reverse and incoming pages all retain finished card pixels',
      );
      if (motion) assert.ok(audit.snapshots > 0);
      report.turns.push({ width, motion, direction, ...audit });
    }
  }
  // Dragging across a spread boundary also commits a ready page and preserves the source.
  await page.emulateMedia({ reducedMotion: null });
  const from = await page.locator('.album-slot[data-slot="0"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2);
  await page.locator('[data-action="album-next"]').dispatchEvent('click');
  await page.waitForSelector('.album-slot[data-slot="12"]');
  const to = await page.locator('.album-slot[data-slot="23"]').boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up();
  await page.waitForSelector('.album-slot[data-slot="23"] img');
  report.crossPageDrag = true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navigatePage(page, 'home');
  await page.evaluate(() => {
    window.reducedEntry = { frames: 0, unreadyVisible: 0 };
    const sample = () => {
      const canvas = document.querySelector('#world canvas');
      if (canvas && getComputedStyle(canvas).visibility !== 'hidden') {
        window.reducedEntry.frames++;
        if (canvas.world3D.snapshot().stacks.some((stack) => !stack.finish?.ready))
          window.reducedEntry.unreadyVisible++;
      }
      window.reducedEntryFrame = requestAnimationFrame(sample);
    };
    sample();
  });
  await navigatePage(page, 'open');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  report.reducedEntry = await page.evaluate(() => {
    cancelAnimationFrame(window.reducedEntryFrame);
    return window.reducedEntry;
  });
  assert.ok(report.reducedEntry.frames > 0);
  assert.equal(report.reducedEntry.unreadyVisible, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(
    `Continuity ${prefix}: entry ready, two pixel-identical pack handoffs, ${report.turns.length} page turns and cross-page drag passed.`,
  );
} finally {
  await fs.writeFile(`${output}/${prefix}-continuity.json`, JSON.stringify(report, null, 2));
  await application?.close();
}
