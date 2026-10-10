import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import { makeItem } from '../src/game/model.js';
import { ROOM_PHI, ROOM_ZOOM } from '../src/scene/room-view.js';

const output = 'test-results/room-motion';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { errors: [], movement: [], checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = freshState();
  state.settings.sound = false;
  state.items = ['case', 'box', 'pack'].map((kind, i) => ({
    ...makeItem(kind),
    x: 0.22 + i * 0.26,
    y: 0.38,
  }));
  await page.addInitScript((s) => {
    // Put the purchased box beside the pad, avoiding a random tall-case landing.
    Math.random = () => 0.5;
    if (!localStorage.getItem('room-motion-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('room-motion-fixture', '1');
    }
    document.addEventListener('pointerdown', (event) => {
      window.motionPointer = event.pointerId;
    });
  }, state);
  page.on('pageerror', (error) => report.errors.push(error.message));
  const snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector('canvas')?.dataset.presented === 'true' &&
        !document.body.classList.contains('navigating'),
    );
  const settled = () =>
    page.waitForFunction(() => {
      const s = document.querySelector('canvas').world3D.snapshot();
      return s.objects.length >= 3 && s.objects.every((o) => o.sleeping && o.velocity === 0);
    });
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(`${output}/${name}.jpg`);
  await page.goto('http://127.0.0.1:5173');
  await navigatePage(page, 'settings');
  assert.equal(await page.locator('.settings-card-stars>i').count(), 8);
  assert.equal(await page.locator('.settings-card-name>i').count(), 0);
  assert.equal(await page.locator('.settings-card-name>span').innerText(), '白き幻獣－青眼の白龍');
  assert.equal(await page.locator('.settings-card-stats').innerText(), 'ATK/3000\nDEF/2500');
  const card = await page.locator('.settings-feature-card').evaluate((el) => {
    const art = el.querySelector('.settings-card-monster');
    return {
      width: art.offsetWidth,
      height: art.offsetHeight,
      borderRadius: getComputedStyle(el.querySelector('.settings-card-name>b')).borderRadius,
    };
  });
  assert.ok(Math.abs(card.width - card.height) <= 1);
  assert.equal(card.borderRadius, '50%');
  await shot('settings-8-stars');
  await navigatePage(page, 'open');
  await ready();
  await settled();
  const initial = await snap();
  assert.equal(initial.orbit.phi, ROOM_PHI);
  assert.equal(initial.orbit.distance, ROOM_ZOOM.max);
  assert.ok(initial.camera[1] > Math.cos(0.86) * ROOM_ZOOM.max);
  const starts = await page.evaluate(async () => {
    const T = await import(new URL('./src/vendor/three.module.js', location.href));
    const api = document.querySelector('canvas').world3D;
    const snapshot = api.snapshot();
    const canvas = document.querySelector('canvas');
    const camera = new T.PerspectiveCamera(38, canvas.clientWidth / canvas.clientHeight, 0.08, 150);
    camera.position.set(...snapshot.camera);
    camera.lookAt(0, 0.04, 0);
    camera.updateMatrixWorld();
    return api.snapshot().objects.map((o) => ({
      kind: o.kind,
      position: o.deliveryStart,
      screen: api.projectPoint(o.deliveryStart),
      depth: new T.Vector3(...o.deliveryStart).project(camera).z,
    }));
  });
  assert.ok(starts.every((o) => o.position && (o.screen.y < 0 || o.depth <= -1 || o.depth >= 1)));
  report.deliveryStarts = starts;
  await shot('room-overhead');
  report.checks.push(
    'Eight stars, reference card name and stats, round attribute and square art; more overhead camera; all three deliveries begin beyond the maximum view',
  );
  for (const item of state.items) {
    const point = await page.evaluate(
      (id) => document.querySelector('canvas').world3D.projectItem(id),
      item.id,
    );
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const sample = await page.evaluate(
      async ({ id, point }) => {
        const canvas = document.querySelector('canvas'),
          api = canvas.world3D;
        const base = api.snapshot(),
          start = performance.now();
        let frames = 0;
        await new Promise((resolve) => {
          const tick = (now) => {
            frames++;
            const progress = Math.min(1, (now - start) / 1200);
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                pointerId: window.motionPointer,
                button: 0,
                buttons: 1,
                clientX: point.x + Math.sin((progress * Math.PI) / 2) * 70,
                clientY: point.y + progress * 25,
                bubbles: true,
              }),
            );
            if (progress < 1) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        const end = api.snapshot(),
          duration = performance.now() - start;
        return {
          id,
          frames,
          renders: end.performance.renders - base.performance.renders,
          fps: ((end.performance.renders - base.performance.renders) / duration) * 1000,
          held: end.held,
          quality: end.performance.quality,
        };
      },
      { id: item.id, point },
    );
    assert.ok(sample.held.includes(item.id));
    assert.ok(
      sample.renders / sample.frames > 0.8,
      'Drag is rendered with the delivered animation frames',
    );
    report.movement.push({ kind: item.kind, ...sample });
    await page.mouse.up();
    await settled();
  }
  report.checks.push(
    'Case, box and pack follow every delivered animation frame without a second frame-rate cap',
  );
  const before = new Set((await snap()).objects.map((o) => o.id));
  await page.locator('.world-phone').press('Enter');
  await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
  await openPhoneApp(page, 'tao');
  await page.locator('.tao-product[data-kind="box"]').click();
  await page.locator('[data-action="buy"]').click();
  await page.locator('.success-modal [data-action="close"]').click();
  await page.locator('.purchase-overlay').click({ position: { x: 20, y: 120 } });
  await page.waitForSelector('.purchase-overlay', { state: 'detached' });
  await page.waitForFunction(
    (ids) =>
      document
        .querySelector('canvas')
        .world3D.snapshot()
        .objects.some((o) => !ids.includes(o.id)),
    [...before],
  );
  const purchased = (await snap()).objects.find((o) => !before.has(o.id));
  assert.ok(purchased.deliveryStart && purchased.position[1] > 2 && !purchased.sleeping);
  const poses = await page.evaluate(async (id) => {
    const api = document.querySelector('canvas').world3D,
      poses = [];
    await new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        const o = api.snapshot().objects.find((o) => o.id === id);
        poses.push({ physical: o.position, rendered: o.renderPosition });
        if (now - start < 500) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return poses;
  }, purchased.id);
  assert.ok(poses.at(-1).physical[1] < poses[0].physical[1]);
  assert.ok(poses.some((pose) => Math.abs(pose.physical[1] - pose.rendered[1]) > 0.001));
  await shot('purchased-falling');
  await settled();
  await shot('purchased-landed');
  assert.equal((await snap()).objects.length, 4);
  await navigatePage(page, 'home');
  await navigatePage(page, 'open');
  await ready();
  const restored = (await snap()).objects.find((o) => o.id === purchased.id);
  assert.equal(restored.deliveryStart, null);
  assert.equal(restored.sleeping, true);
  report.checks.push(
    'Live room purchase falls from outside the view using interpolated physics, lands, and returns without repeating the delivery',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, checks: report.checks, movement: report.movement }));
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
