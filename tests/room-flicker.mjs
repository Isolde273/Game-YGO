import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { SIZES } from '../src/scene/packing.js';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  sharp = require('sharp');
const output = 'test-results/room-flicker';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.5,
    }),
    errors = [],
    state = freshState();
  state.settings.sound = false;
  state.settings.motion = false;
  state.items.forEach((p, i) => {
    p.isNew = false;
    p.pose3d = {
      position: [
        [-4, 0, 2, 0, 2, 4][i],
        0.044 + SIZES[p.kind][p.kind === 'pack' ? 2 : 1] / 2,
        i < 3 ? -2 : 4,
      ],
      quaternion: p.kind === 'pack' ? [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1],
    };
  });
  await page.addInitScript(
    (s) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s)),
    state,
  );
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async () => {
    window.resizeProbe = { resizes: 0, blankTasks: 0, frames: 0, qualityChanges: 0 };
    let revision = 0,
      drawn = 0;
    for (const key of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...descriptor,
        set(value) {
          descriptor.set.call(this, value);
          if (!this.classList.contains('world3d-canvas')) return;
          revision++;
          window.resizeProbe.resizes++;
          queueMicrotask(() => {
            if (this.isConnected && drawn < revision) window.resizeProbe.blankTasks++;
          });
        },
      });
    }
    for (const method of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
    ]) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        if (this.canvas.classList.contains('world3d-canvas')) {
          drawn = revision;
          window.resizeProbe.frames++;
        }
        return result;
      };
    }
    const { RoomQuality } = await import('/src/scene/room-quality.js'),
      observe = RoomQuality.prototype.observe;
    let calls = 0,
      packPhase = false;
    RoomQuality.prototype.observe = function (ms) {
      if (window.resizeProbe.phase === 'pack' && !packPhase) {
        packPhase = true;
        calls = 0;
      }
      calls++;
      if ([5, 15, 25].includes(calls)) {
        this.ratio = calls === 15 ? 0.85 : 0.7;
        window.resizeProbe.qualityChanges++;
        return true;
      }
      return observe.call(this, ms);
    };
  });
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  const point = await page.evaluate(
    (id) => document.querySelector('canvas').world3D.projectItem(id),
    state.items[1].id,
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 180, point.y + 95, { steps: 45 });
  await page.mouse.move(point.x + 35, point.y + 20, { steps: 35 });
  await page.mouse.up();
  const packPoint = await page.evaluate((id) => {
    window.resizeProbe.phase = 'pack';
    return document.querySelector('canvas').world3D.projectItem(id);
  }, state.items[3].id);
  await page.mouse.move(packPoint.x, packPoint.y);
  const beforePack = await page.evaluate(
    () => document.querySelector('canvas').world3D.snapshot().performance,
  );
  await page.mouse.down();
  await page.mouse.move(packPoint.x - 170, packPoint.y - 60, { steps: 45 });
  await page.mouse.move(packPoint.x - 40, packPoint.y - 15, { steps: 35 });
  const heldPack = await page.evaluate(
    () => document.querySelector('canvas').world3D.snapshot().performance,
  );
  assert.ok(
    heldPack.shadowUpdates - beforePack.shadowUpdates >= heldPack.renders - beforePack.renders - 2,
    'moving pack and shadow must use the same pose',
  );
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(100);
  const probe = await page.evaluate(() => window.resizeProbe);
  assert.equal(probe.qualityChanges, 6, JSON.stringify(probe));
  assert.ok(probe.resizes >= 12);
  assert.equal(
    probe.blankTasks,
    0,
    'drawing-buffer reset must be followed by a draw in the same task',
  );
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 82 })
    .toFile(`${output}/dragged-box.webp`);
  assert.equal(
    await page.evaluate(() => document.querySelector('canvas').world3D.snapshot().objects.length),
    6,
  );
  const material = await page.evaluate(async () => {
    const T = await import('/src/vendor/three.module.js'),
      { createPackageLibrary, PackageBatch } = await import('/src/scene/packages3d.js'),
      lib = await createPackageLibrary();
    const model = lib.create('box'),
      template = lib.templates.box,
      printed = [];
    let transparent = 0;
    template.traverse((o) => {
      if (o.isMesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m.transparent) transparent++;
    });
    model.traverse((o) => {
      if (o.isMesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m.map && m.clearcoat) printed.push(m);
    });
    lib.poseOpening(model, 0.2);
    const opening = printed.every((m) => m.clearcoat === 0),
      sealed = template.getObjectByName('box-front').material[4].clearcoat;
    const scene = new T.Scene(),
      record = {
        body: { position: new T.Vector3(), quaternion: new T.Quaternion() },
        hidden: false,
      };
    const packShadow = lib.templates.pack.userData.wrapper.material.every(
      (m) => m.shadowSide === T.FrontSide,
    );
    template.getObjectByName('box-lid-panel').castShadow = false;
    const batch = new PackageBatch(scene, template, [record]);
    batch.update();
    const flags = batch.meshes.find((m) => m.name === 'box-lid-panel-instances').castShadow;
    batch.dispose();
    lib.dispose();
    return { transparent, opening, sealed, flags, owned: new Set(printed).size, packShadow };
  });
  assert.deepEqual(material, {
    transparent: 0,
    opening: true,
    sealed: 0.38,
    flags: false,
    owned: 4,
    packShadow: true,
  });
  assert.deepEqual(errors, []);
  const report = { passed: true, probe, material, errors };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
