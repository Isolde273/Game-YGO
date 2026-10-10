import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import { makeItem, validateState } from '../src/game/model.js';
import { CARD_STEP, PACK_STEP, SIZES } from '../src/scene/packing.js';
import { ROOM_PHI } from '../src/scene/room-view.js';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';

const desktop = process.env.YGO_OPENING_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const output = 'test-results/opening-fixes-20261009';
await fs.mkdir(output, { recursive: true });
const fixture = freshState();
fixture.settings.sound = false;
fixture.items = [4, 0, 3, 1, 2, 0].map((height, index) => ({
  ...makeItem('pack'),
  id: `opening-pack-${index}`,
  isNew: false,
  x: 0.5,
  y: 0.5,
  angle: 0,
  pose3d: {
    position: [index === 5 ? -2 : 2, 0.1 + height * PACK_STEP, -1.5],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  },
}));
fixture.items.push({
  ...makeItem('box'),
  id: 'opening-box',
  isNew: false,
  x: 0.5,
  y: 0.5,
  angle: 0,
  pose3d: { position: [0, SIZES.box[1] / 2 + 0.044, -3.2], quaternion: [0, 0, 0, 1] },
});
validateState(structuredClone(fixture));
const report = { desktop, cards: [], errors: [] };
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
    page = await application.newPage();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.addInitScript((fixture) => {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(fixture));
  }, fixture);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  assert.equal(await page.title(), '游戏王开盒模拟器');
  await navigatePage(page, 'shop');
  assert.equal((await page.locator('.phone-apps [data-app="q"]').innerText()).split('\n')[0], 'OO');
  await openPhoneApp(page, 'q');
  assert.equal(await page.locator('.app-header.q-header b').innerText(), 'OO');
  await navigatePage(page, 'open');
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 88 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  await shot('room-view');
  report.entrances = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const entrances = await page.evaluate(() => {
      const canvas = document.querySelector('#world canvas');
      const api = canvas.world3D;
      return Object.entries(api.snapshot().entrances).map(([name, source]) => {
        const x = source.quad.reduce((sum, p) => sum + p[0], 0) / 4;
        const y = source.quad.reduce((sum, p) => sum + p[1], 0) / 4;
        return {
          name,
          hit: api.hitAt(x, y),
          unobstructed: document.elementFromPoint(x, y) === canvas,
        };
      });
    });
    for (const entry of entrances) {
      assert.equal(entry.hit, entry.name === 'shop' ? 'phone' : entry.name);
      assert.equal(entry.unobstructed, true, `${width}: ${entry.name} entrance is covered by UI`);
    }
    report.entrances.push({ width, entries: entrances });
    if (width === 390) await shot('room-narrow');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async (fixture) => {
    const { createWorld3D } = await import(new URL('./src/scene/world3d.js', location.href));
    const { openItem } = await import(new URL('./src/game/model.js', location.href));
    const host = document.createElement('main');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '1000' });
    host.id = 'opening-audit';
    document.body.append(host);
    window.auditWorld = createWorld3D(host, {
      state: fixture,
      save() {},
      sound() {},
      toast(message) {
        throw new Error(message);
      },
      navigate() {},
      open: (id) => openItem(fixture, id),
    });
    await window.auditWorld.ready;
    window.auditWorld.setNavigationPaused(true);
    const w = window.auditWorld;
    w.renderer.setDrawingBufferSize(host.clientWidth, host.clientHeight, w.quality.ratio);
    w.renderSize = null;
    w.renderer.render(w.scene, w.camera);
    w.canvas.style.removeProperty('visibility');
  }, fixture);
  report.view = await page.evaluate(() => {
    const w = window.auditWorld;
    return { phi: w.orbit.phi, inclination: (w.orbit.phi * 180) / Math.PI };
  });
  assert.equal(report.view.phi, ROOM_PHI);
  assert.ok(report.view.inclination < 12);
  // The selected order deliberately disagrees with the actual pack heights.
  // Audit every frame, including withdrawal and alignment before the handoff.
  for (const count of [5, 1]) {
    await page.evaluate((count) => {
      const w = window.auditWorld;
      const records = w.records.filter((r) => r.item.id.startsWith('opening-pack-') && !r.hidden);
      w.openPackRecords(count === 5 ? records.slice(0, 5) : records.slice(-1));
      w.batches.forEach((batch) => batch.update());
    }, count);
    await page.waitForFunction(() => window.auditWorld.animations.some((a) => a.finishesReady));
    const audit = await page.evaluate(
      async ({ count, cardStep }) => {
        const w = window.auditWorld;
        const T = await import(new URL('./src/vendor/three.module.js', location.href));
        const a = w.animations.find((a) => a.kind === 'pack');
        const phases = new Set();
        const opening = w.animationSnapshot(a);
        if (opening.method !== 'tear' || a.model.getObjectByName('five-pack-scissors'))
          throw new Error('pack opening must use direct tearing without scissors');
        const original = new Map(a.contents.map((c, i) => [c.uuid, a.result.cards[i].id]));
        const expected = [...a.contents]
          .sort(
            (left, right) =>
              left.getWorldPosition(new T.Vector3()).y - right.getWorldPosition(new T.Vector3()).y,
          )
          .at(-1);
        const failures = [];
        const ray = new T.Raycaster();
        let frames = 0,
          aligned = 0,
          minSeparation = Infinity;
        w.orbit.distance = 8;
        w.target.set(0, 0.1, 0);
        w.updateCamera();
        while (a.time < a.duration - 0.001) {
          w.animateOpening(a, Math.min(1 / 60, a.duration - 0.001 - a.time));
          phases.add(a.phase);
          if (a.phase === 'cut') throw new Error('direct opening entered a scissor phase');
          w.scene.updateMatrixWorld(true);
          frames++;
          if (!a.presenting) continue;
          aligned++;
          for (let i = 1; i < a.contents.length; i++) {
            const gap = a.contents[i].position.z - a.contents[i - 1].position.z;
            minSeparation = Math.min(minSeparation, gap);
            if (gap < cardStep - 1e-8) failures.push({ time: a.time, reason: 'crossing', gap });
          }
          if (a.contents.at(-1) !== expected)
            failures.push({ time: a.time, reason: 'changed top mesh' });
          if (a.contents.some((c, i) => original.get(c.uuid) !== a.result.cards[i].id))
            failures.push({ time: a.time, reason: 'mesh/data mismatch' });
          const point = expected.getWorldPosition(new T.Vector3()).project(w.camera);
          ray.setFromCamera(point, w.camera);
          const board = ray
            .intersectObjects(a.contents, true)
            .find((hit) => hit.object.name === 'card-board');
          if (board?.object !== expected.getObjectByName('card-board'))
            failures.push({ time: a.time, reason: 'different visible top face' });
        }
        w.library.updateCardLight(w.keyLight.position);
        w.renderer.render(w.scene, w.camera);
        window.cardHandoff = {
          a,
          expected,
          board: expected.getObjectByName('card-board'),
          matrix: expected.matrixWorld.clone(),
        };
        return {
          count: a.result.cards.length,
          frames,
          duration: a.duration,
          phases: [...phases],
          aligned,
          minSeparation,
          failures,
          ids: a.result.cards.map((c) => c.id).sort(),
          originalIds: [...original.values()].sort(),
          center: w.projectPoint(expected.getWorldPosition(new T.Vector3()).toArray()),
        };
      },
      { count, cardStep: CARD_STEP },
    );
    assert.equal(audit.count, count * 4);
    assert.ok(Math.abs(audit.frames - Math.ceil((audit.duration - 0.001) * 60)) <= 1);
    assert.ok(audit.aligned > 35);
    for (const phase of ['tear', 'withdraw', 'align']) assert.ok(audit.phases.includes(phase));
    assert.deepEqual(audit.failures, []);
    assert.deepEqual(audit.ids, audit.originalIds);
    const before = await page.screenshot();
    const handoff = await page.evaluate(() => {
      const w = window.auditWorld,
        { a, expected, board, matrix } = window.cardHandoff;
      w.finishOpening(a);
      const stack = w.tableStacks.find((s) => s.data.id === a.result.stack.id);
      expected.updateWorldMatrix(true, false);
      w.renderer.render(w.scene, w.camera);
      return {
        sameBoard: stack.visual.getObjectByName('card-board') === board,
        maxPoseDelta: Math.max(
          ...expected.matrixWorld.elements.map((n, i) => Math.abs(n - matrix.elements[i])),
        ),
      };
    });
    const after = await page.screenshot();
    const patch = {
      left: Math.round(audit.center.x) - 8,
      top: Math.round(audit.center.y) - 8,
      width: 16,
      height: 16,
    };
    const x = await sharp(before).extract(patch).removeAlpha().raw().toBuffer();
    const y = await sharp(after).extract(patch).removeAlpha().raw().toBuffer();
    handoff.maxPixelDelta = Math.max(...x.map((n, i) => Math.abs(n - y[i])));
    assert.equal(handoff.sameBoard, true);
    assert.ok(handoff.maxPoseDelta < 1e-10);
    assert.equal(handoff.maxPixelDelta, 0);
    report.cards.push({ ...audit, ids: undefined, originalIds: undefined, handoff });
    await shot(`cards-${count}`);
  }
  await page.evaluate(() => {
    const w = window.auditWorld;
    w.orbit.distance = 6;
    w.target.set(0, 0.9, -3.2);
    w.updateCamera();
    w.renderer.render(w.scene, w.camera);
  });
  await shot('box-lid');
  await page.evaluate(() => {
    const w = window.auditWorld;
    w.openRecord(w.records.find((r) => r.item.id === 'opening-box'));
    w.batches.forEach((batch) => batch.update());
  });
  const tiles = [];
  report.box = { frames: 0, shadowReceivers: 0, elapsed: 0 };
  for (const time of [1, 1.15, 1.3, 1.44, 1.46, 1.6, 1.75, 1.9, 2.05, 2.2, 2.35, 2.399]) {
    const audit = await page.evaluate((time) => {
      const w = window.auditWorld,
        a = w.animations.find((a) => a.kind === 'box');
      let frames = 0;
      let elapsed = 0;
      while (a.time < time - 1e-8) {
        const dt = Math.min(1 / 60, (time - a.time) / 1.25);
        w.animateOpening(a, dt);
        elapsed += dt;
        w.renderer.shadowMap.needsUpdate = frames % 2 === 0;
        w.renderer.render(w.scene, w.camera);
        frames++;
      }
      let shadowReceivers = 0;
      a.contents.forEach((c) =>
        c.traverse((m) => {
          if (m.name === 'foil-pack-body' && m.receiveShadow) shadowReceivers++;
        }),
      );
      return { frames, elapsed, shadowReceivers, count: a.contents.length, time: a.time };
    }, time);
    assert.equal(audit.count, 15);
    assert.equal(audit.shadowReceivers, 0);
    report.box.frames += audit.frames;
    report.box.elapsed += audit.elapsed;
    assert.ok(Math.abs(report.box.elapsed * 1.25 - audit.time) < 1e-6);
    tiles.push(
      await sharp(await page.screenshot())
        .extract({ left: 380, top: 50, width: 680, height: 800 })
        .resize(255, 300)
        .png()
        .toBuffer(),
    );
  }
  await sharp({ create: { width: 1020, height: 900, channels: 3, background: '#242424' } })
    .composite(
      tiles.map((input, i) => ({ input, left: (i % 4) * 255, top: Math.floor(i / 4) * 300 })),
    )
    .webp({ quality: 90 })
    .toFile(`${output}/${prefix}-box-animation.webp`);
  report.box.handoff = await page.evaluate(() => {
    const w = window.auditWorld,
      a = w.animations.find((a) => a.kind === 'box');
    w.animateOpening(a, 0.002);
    w.renderer.render(w.scene, w.camera);
    return w.records.filter((r) => a.result.items.includes(r.item)).length;
  });
  assert.equal(report.box.handoff, 15);
  assert.ok(Math.abs(report.box.elapsed - 2.399 / 1.25) < 1e-6);
  validateState(await page.evaluate(() => structuredClone(window.auditWorld.options.state)));
  await page.evaluate(() => {
    window.auditWorld.dispose();
    document.querySelector('#opening-audit').remove();
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(
    `Opening ${prefix}: 20/4 cards keep their visible top through alignment; exact handoffs, 15-pack animation, lid, OO and overhead view passed.`,
  );
} finally {
  await fs.writeFile(`${output}/${prefix}-opening.json`, JSON.stringify(report, null, 2));
  await application?.close();
}
