import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { volume, volumesOverlap } from '../src/scene/tabletop.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  state = freshState();
const flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  spots = [
    [-3.8, 0.904, -1.2],
    [1, 0.804, -1.2],
    [4, 0.804, -1.2],
    [-2, 0.07, 3],
    [0, 0.07, 3],
    [2, 0.07, 3],
  ];
state.items.forEach((item, i) => {
  item.isNew = false;
  item.angle = 0;
  item.pose3d = {
    position: spots[i],
    quaternion: item.kind === 'pack' ? flat : [0, Math.sin(0.1), 0, Math.cos(0.1)],
  };
});
state.items.forEach((i) => {
  if (i.pose3d) i.pose3d.position[1] = 0.044 + (i.pose3d.position[1] - 0.044) * 1.5;
});
await page.addInitScript((s) => {
  if (!localStorage.getItem('scene-fixture')) {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
    localStorage.setItem('scene-fixture', '1');
  }
}, state);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
const snapshot = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const project = (id) =>
  page.evaluate((id) => document.querySelector('canvas').world3D.projectItem(id), id);
const report = {};
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-ready="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  // Track real disposal events, including textures referenced through bump/env maps.
  report.resources = await page.evaluate(async () => {
    const THREE = await import('/src/vendor/three.module.js'),
      { createDeskScene } = await import('/src/scene/desk-scene.js');
    const { halfWidth, halfDepth } = document.querySelector('canvas').world3D.snapshot().tabletop;
    const scene = new THREE.Scene(),
      desk = createDeskScene(scene, halfWidth, halfDepth);
    desk.createPhone(new THREE.Texture());
    const resources = new Set(),
      disposed = new Set();
    scene.traverse((o) => {
      if (o.geometry) resources.add(o.geometry);
      if (o.material) {
        resources.add(o.material);
        for (const value of Object.values(o.material)) if (value?.isTexture) resources.add(value);
      }
    });
    resources.forEach((r) => r.addEventListener('dispose', () => disposed.add(r)));
    const colliders = desk.colliders;
    desk.dispose();
    return {
      resources: resources.size,
      disposed: disposed.size,
      remainingObjects: scene.children.length,
      colliders,
    };
  });
  assert.equal(report.resources.disposed, report.resources.resources);
  assert.equal(report.resources.remainingObjects, 0);
  report.collisions = [];
  const pack = state.items[3];
  for (const prop of report.resources.colliders) {
    const from = await project(pack.id),
      s = await snapshot(),
      current = s.objects.find((o) => o.id === pack.id);
    assert.equal(
      await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), from),
      pack.id,
    );
    const destination = await page.evaluate(
      (p) => document.querySelector('canvas').world3D.projectPoint(p),
      [prop.position[0], current.position[1], prop.position[2]],
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 18 });
    await page.mouse.up();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector('canvas')
          .world3D.snapshot()
          .objects.find((o) => o.id === id)?.sleeping,
      pack.id,
    );
    const placed = (await snapshot()).objects.find((o) => o.id === pack.id),
      a = volume(placed.position, placed.quaternion, s.sizes.pack),
      b = volume(prop.position, prop.quaternion, prop.size);
    assert.equal(volumesOverlap(a, b, 0.008), false, prop.name);
    assert.ok(a.bounds.min.y >= b.bounds.max.y - 0.008, prop.name);
    report.collisions.push({
      prop: prop.name,
      packBottom: a.bounds.min.y,
      propTop: b.bounds.max.y,
    });
  }
  // Return to the untouched fixture for a representative opening scene.
  await page.close();
  // The app saves on unload, so seed before initialization in a separate context.
  const preview = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  preview.on('pageerror', (e) => errors.push(e.message));
  preview.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await preview.addInitScript(
    (s) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s)),
    state,
  );
  await preview.goto('http://127.0.0.1:5173');
  await preview.locator('.tile-open').click();
  await preview.waitForSelector('canvas[data-ready="true"]');
  await preview.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
  for (const id of [state.items[0].id, state.items[1].id, state.items[5].id]) {
    const p = await preview.evaluate(
      (id) => document.querySelector('canvas').world3D.projectItem(id),
      id,
    );
    await preview.mouse.dblclick(p.x, p.y);
    await preview.waitForFunction(
      () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
    );
  }
  const final = await preview.evaluate(() => document.querySelector('canvas').world3D.snapshot());
  assert.equal(final.containers.length, 1);
  assert.equal(final.objects.filter((o) => o.kind === 'pack').length, 12);
  assert.equal(final.cards.length, 10);
  await preview.mouse.move(1350, 800);
  await preview.waitForFunction(
    () => getComputedStyle(document.querySelector('#toast')).opacity === '0',
  );
  await preview.screenshot({ path: 'test-results/scene-modeling-final.png' });
  report.scenery = await preview.evaluate(
    () => document.querySelector('canvas').world3D.snapshot().scenery,
  );
  await preview.setViewportSize({ width: 600, height: 800 });
  await preview.screenshot({ path: 'test-results/scene-modeling-narrow.png' });
  assert.equal(
    await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  assert.deepEqual(errors, []);
  report.errors = errors;
  report.passed = true;
  await fs.writeFile('test-results/scene-modeling.json', JSON.stringify(report, null, 2));
  console.log(
    `PASS: ${report.collisions.length} modeled props prevent penetration; ${report.resources.disposed} geometry/material/texture resources disposed; desktop and narrow previews saved.`,
  );
} finally {
  await browser.close();
}
