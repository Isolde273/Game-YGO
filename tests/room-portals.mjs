import { freshState } from './helpers/starter-state.mjs';
import { browserOptions, closePurchase, navigatePage } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ROOM_PORTAL_MS } from '../src/ui/motion/room-portals.js';

const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  sharp = require('sharp');
const output = 'test-results/room-entrances';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    state = freshState(),
    errors = [],
    report = { routes: [], checks: [] };
  state.settings.sound = false;
  state.spaceView = { orbit: { theta: 0, phi: 0.86, distance: 23.716 }, target: [0, 0.04, 0] };
  await page.addInitScript((s) => {
    if (!localStorage.getItem('entrance-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('entrance-fixture', '1');
    }
  }, state);
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = (target) =>
    page.waitForFunction(
      (target) =>
        document.body.dataset.page === target &&
        document.querySelector('#page-transition').hidden &&
        !document.querySelector('.room-portal-layer') &&
        !document.querySelector('#app').inert,
      target,
    );
  const room = async () => {
    if ((await page.locator('body').getAttribute('data-page')) !== 'home') {
      await navigatePage(page, 'home');
      await ready('home');
    }
    await page.locator('.tile-open').click();
    await ready('open');
    await page.waitForSelector('canvas[data-presented="true"]');
  };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(`${output}/${name}.webp`);
  await page.goto('http://127.0.0.1:5173');
  await room();
  await page.locator('[data-action="organize-space"]').click();
  await page.waitForTimeout(200);
  const scene = await page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
  assert.equal(scene.exposure, 0.85, 'retain the darker room lighting requested by the user');
  assert.ok(!scene.scenery.props.some((p) => p.name === 'Lamp'));
  assert.ok(scene.scenery.props.some((p) => p.name === 'Warehouse'));
  await shot('room-desktop');
  const entranceSamples = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D,
      s = api.snapshot();
    return ['album', 'warehouse'].flatMap((route) =>
      [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.2, 0.8],
        [0.8, 0.8],
        [0.5, 0.5],
      ].map(([u, v]) => {
        const q = s.entrances[route].quad,
          p = {
            x: (1 - v) * ((1 - u) * q[0][0] + u * q[1][0]) + v * ((1 - u) * q[3][0] + u * q[2][0]),
            y: (1 - v) * ((1 - u) * q[0][1] + u * q[1][1]) + v * ((1 - u) * q[3][1] + u * q[2][1]),
          };
        return { route, hit: api.hitAt(p.x, p.y) };
      }),
    );
  });
  assert.ok(
    entranceSamples.every((p) => p.route === p.hit),
    JSON.stringify(entranceSamples),
  );
  for (const route of ['album', 'warehouse']) {
    if (route !== 'shop') await room();
    const origin = await page.evaluate(
        (route) => document.querySelector('canvas').world3D.snapshot().entrances[route],
        route,
      ),
      center = {
        x: origin.quad.reduce((n, p) => n + p[0], 0) / 4,
        y: origin.quad.reduce((n, p) => n + p[1], 0) / 4,
      };
    assert.equal(
      await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), center),
      route === 'shop' ? 'phone' : route,
      `${route}: visible model must be clickable`,
    );
    await page.evaluate(() => {
      window.portalTimes = { start: performance.now() };
      const layer = document.querySelector('#page-transition'),
        observer = new MutationObserver(() => {
          if (!layer.hidden) {
            window.portalTimes.oldStart = performance.now();
            observer.disconnect();
          }
        });
      observer.observe(layer, { attributes: true, attributeFilter: ['hidden', 'data-phase'] });
    });
    const before = await saved();
    await page.mouse.click(center.x, center.y);
    await page.waitForSelector('.room-portal-layer[data-phase="entering"]');
    assert.equal(await page.locator('body').getAttribute('data-page'), 'open');
    assert.equal(await page.locator('#app').evaluate((e) => e.inert), true);
    assert.equal(await page.locator('#page-transition').isHidden(), true);
    const originError = await page.evaluate((expected) => {
      const el = document.querySelector('.room-portal-flight'),
        animation = document.getAnimations().find((a) => a.effect?.target === el),
        matrix = new DOMMatrix(animation.effect.getKeyframes()[0].transform),
        width = parseFloat(el.style.width),
        height = parseFloat(el.style.height);
      return Math.max(
        ...[
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
        ].map(([x, y], i) => {
          const p = matrix.transformPoint(new DOMPoint(x, y));
          return Math.hypot(p.x / p.w - expected[i][0], p.y / p.w - expected[i][1]);
        }),
      );
    }, origin.quad);
    assert.ok(originError < 0.1, originError);
    const tracks = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.target?.closest?.('.room-portal-layer'))
        .map((a) => ({
          duration: a.effect.getTiming().duration,
          rate: a.playbackRate,
          frames: a.effect.getKeyframes(),
        })),
    );
    assert.ok(tracks.some((a) => a.duration === ROOM_PORTAL_MS[route]));
    assert.ok(
      tracks.every((a) => a.rate === 0.85),
      'Room models and lids share the slowed playback rate',
    );
    assert.ok(
      tracks.every((a) =>
        a.frames.every((k) => !('width' in k || 'height' in k || 'filter' in k || 'clipPath' in k)),
      ),
    );
    if (route === 'warehouse') {
      const joints = await page.evaluate(() => {
        const model = document.querySelector('.portal-carton-model'),
          w = model.offsetWidth,
          d = parseFloat(getComputedStyle(model).getPropertyValue('--carton-depth'));
        return [...document.querySelectorAll('.portal-carton-leaf')].map((leaf) => {
          const hinge = leaf.parentElement,
            left = leaf.classList.contains('leaf-left'),
            matrix = new DOMMatrix(getComputedStyle(leaf).transform),
            edgeX = left ? 0 : leaf.offsetWidth;
          const endpoints = [0, d].map((y) => {
            const p = matrix.transformPoint(new DOMPoint(edgeX, y, 0));
            return [p.x + leaf.offsetLeft + hinge.offsetLeft, p.y + leaf.offsetTop, p.z];
          });
          return {
            localWidth: leaf.offsetWidth,
            w,
            willChange: getComputedStyle(hinge).willChange,
            modelWillChange: getComputedStyle(model).willChange,
            hingeOrigin: getComputedStyle(hinge).transformOrigin,
            maxError: Math.max(
              ...endpoints.map((p, i) =>
                Math.hypot(p[0] - (left ? 0 : w), p[1], p[2] - (i ? d / 2 : -d / 2)),
              ),
            ),
          };
        });
      });
      assert.ok(
        joints.every(
          (j) =>
            Math.abs(j.localWidth - j.w / 2) <= 1 &&
            j.hingeOrigin === '0px 0px' &&
            j.maxError < 0.1 &&
            j.willChange === 'transform' &&
            j.modelWillChange === 'transform',
        ),
        JSON.stringify(joints),
      );
      report.checks.push(
        'real CSS cuboid walls and floor; two half-width lids share the side-wall top edges; compositor preserves 3D',
      );
    }
    await page.waitForTimeout(220);
    await shot(`${route}-connector`);
    if (route === 'shop') {
      const early = await page.locator('.room-portal-flight').boundingBox(),
        sourceX = center.x,
        targetX = 720;
      assert.ok(
        Math.abs(early.x + early.width / 2 - sourceX) < Math.abs(targetX - sourceX) * 0.4,
        'phone lifts near its source before travelling',
      );
      await page.waitForTimeout(650);
      await shot('shop-raised');
    } else {
      await page.waitForTimeout(route === 'warehouse' ? 480 : 200);
      if (route === 'warehouse') {
        const bounded = await page.evaluate(() => {
          const f = document.querySelector('.room-portal-flight').getBoundingClientRect();
          return [...document.querySelectorAll('.portal-carton-leaf')].every((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.left > f.left - f.width * 0.75 &&
              r.right < f.right + f.width * 0.75 &&
              r.top > f.top - f.height * 0.65 &&
              r.bottom < f.bottom + f.height * 0.3
            );
          });
        });
        assert.ok(bounded, 'opened lids stay attached near the visible box');
      }
      await shot(`${route}-opening`);
    }
    await page.waitForFunction(() => !document.querySelector('#page-transition').hidden);
    await page.waitForFunction(() =>
      ['covered', 'revealing'].includes(document.querySelector('#page-transition').dataset.phase),
    );
    assert.equal(
      await page.locator('.room-portal-layer').count(),
      0,
      'connector removed once the old mask covers the room',
    );
    await ready(route);
    const timing = await page.evaluate(() => window.portalTimes);
    assert.ok(
      timing.oldStart - timing.start >= ROOM_PORTAL_MS[route] / 0.85 - 30,
      JSON.stringify(timing),
    );
    const after = await saved();
    assert.equal(after.coins, before.coins);
    assert.equal(after.items.length, before.items.length);
    assert.deepEqual(after.cards, before.cards);
    assert.deepEqual(after.collection, before.collection);
    assert.deepEqual(after.spaceView, before.spaceView);
    report.routes.push({
      route,
      prefixDuration: ROOM_PORTAL_MS[route],
      observedPrefixMs: Math.round(timing.oldStart - timing.start),
      hit: center,
    });
  }
  await room();
  await page.locator('.world-album').press('Enter');
  await page.waitForSelector('.room-portal-layer');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await ready('album');
  report.checks.push(
    'two real model clicks; purchase uses its independent overlay, additive sequential timing, frontend-only tracks, mask handoff, saved inventory and camera unchanged; keyboard and repeated Escape',
  );
  await room();
  await page.locator('.world-warehouse').press('Enter');
  await page.waitForSelector('.room-portal-layer');
  await page.setViewportSize({ width: 1000, height: 740 });
  await ready('warehouse');
  await room();
  await page.locator('.world-phone').press('Enter');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
  await closePurchase(page);
  await room();
  await page.locator('.world-album').press('Enter');
  await ready('album');
  assert.equal(await page.locator('.room-portal-layer').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  report.checks.push(
    'resize during prefix; live reduced motion completes cleanup; system reduced motion skips prefix',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await room();
  await shot('room-narrow');
  for (const route of ['warehouse', 'album']) {
    if (route !== 'warehouse') await room();
    const q = await page.evaluate(
        (route) => document.querySelector('canvas').world3D.snapshot().entrances[route].quad,
        route,
      ),
      point = { x: q.reduce((n, p) => n + p[0], 0) / 4, y: q.reduce((n, p) => n + p[1], 0) / 4 };
    assert.ok(
      point.x > 15 && point.x < 375 && point.y > 170 && point.y < 800,
      JSON.stringify({ route, point }),
    );
    assert.equal(
      await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), point),
      route === 'shop' ? 'phone' : route,
    );
    await page.mouse.click(point.x, point.y);
    await page.waitForSelector('.room-portal-layer');
    if (route === 'warehouse') {
      await page.waitForTimeout(260);
      await shot('warehouse-connector-narrow');
    }
    await ready(route);
  }
  await room();
  await page.reload();
  await ready('home');
  await page.locator('.tile-open').click();
  await ready('open');
  assert.equal((await saved()).items.length, 6);
  await page.locator('.space-return').click();
  await ready('home');
  await page.locator('.tile-settings').click();
  await ready('settings');
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('[data-action="setting-toggle"][data-setting="motion"]').click();
  await ready('settings');
  await room();
  await page.locator('.world-phone').press('Enter');
  await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
  await closePurchase(page);
  assert.equal(await page.locator('.room-portal-layer').count(), 0);
  assert.equal((await saved()).settings.motion, false);
  report.checks.push(
    'organized model faces remain clickable at ten sample points; 390px layout; reload persistence; game motion setting skips connector',
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.effect?.target?.closest?.('.room-portal-layer'))
          .length,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  report.passed = true;
  report.errors = errors;
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
