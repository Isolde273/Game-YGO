import { browserOptions } from './helpers/browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const dir = 'test-results/material-review';
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const errors = [],
  badRequests = [],
  external = [];
const meanDifference = async (a, b) => {
  const left = await sharp(a).removeAlpha().raw().toBuffer(),
    right = await sharp(b).removeAlpha().raw().toBuffer();
  assert.equal(left.length, right.length);
  let total = 0,
    changed = 0;
  for (let i = 0; i < left.length; i++) {
    const d = Math.abs(left[i] - right[i]);
    total += d;
    if (d > 8) changed++;
  }
  return {
    mean: Number((total / left.length).toFixed(3)),
    changed: Number((changed / left.length).toFixed(3)),
  };
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) badRequests.push([r.status(), r.url()]);
  });
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:5173/') && !r.url().startsWith('data:'))
      external.push(r.url());
  });
  await page.goto('http://127.0.0.1:5173/public/material-review/index.html');
  await page.waitForFunction(() => window.materialReview?.ready, { timeout: 30000 });
  await page.waitForTimeout(250);
  const manifest = await page.evaluate(() => window.materialReview.manifest);
  assert.equal(manifest.length, 27);
  for (const type of ['monster', 'spell', 'trap']) {
    await page.locator('#card-type').selectOption(type);
    const visible = await page.evaluate(() => materialReview.inspect().visible);
    assert.equal(visible.length, 9);
    assert.equal(
      new Set(manifest.filter((s) => visible.includes(s.id)).map((s) => s.style)).size,
      9,
    );
    assert.ok(manifest.filter((s) => visible.includes(s.id)).every((s) => s.cardType === type));
  }
  await page.locator('#card-type').selectOption('overview');
  assert.ok(manifest.every((s) => s.edition === 'JP-domestic'));
  assert.equal(new Set(manifest.map((s) => s.rarity)).size, 7);
  assert.equal(manifest.find((s) => s.id === 'GMR').serial, '001/100');
  // Environmental light changes the print while retaining the same light
  // direction and texture objects; it is independent of camera exposure.
  await page.evaluate(() => materialReview.select('PSER'));
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const ambientBefore = await page.evaluate(() => materialReview.inspect());
  assert.equal(ambientBefore.ambient, 0.25);
  const lowAmbient = await page.locator('#stage').screenshot();
  await page.locator('#ambient').fill('100');
  await page.locator('#ambient').dispatchEvent('input');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const highAmbient = await page.locator('#stage').screenshot();
  const ambientAfter = await page.evaluate(() => materialReview.inspect());
  assert.equal(ambientAfter.ambient, 1);
  assert.deepEqual(ambientAfter.light, ambientBefore.light);
  assert.equal(ambientAfter.textures, ambientBefore.textures);
  assert.ok(
    (await meanDifference(lowAmbient, highAmbient)).mean > 2,
    'Environment control must visibly change diffuse print',
  );
  assert.equal(await page.locator('#ambient-value').textContent(), '100%');
  await page.locator('#ambient').fill('25');
  await page.locator('#ambient').dispatchEvent('input');
  const optical = [];
  for (const sample of manifest) {
    await page.evaluate((id) => {
      materialReview.select(id);
      materialReview.pose(0.08, -0.16);
      materialReview.light(-25, 30);
    }, sample.id);
    await page.waitForTimeout(80);
    const region = page.locator('#stage');
    const normal = await region.screenshot();
    await sharp(normal)
      .resize({ height: 700 })
      .jpeg({ quality: 90 })
      .toFile(`${dir}/${sample.id}.jpg`);
    await page.locator('#foil').uncheck();
    await page.waitForTimeout(60);
    const plain = await region.screenshot();
    await page.locator('#foil').check();
    await page.evaluate(() => materialReview.light(27, -12));
    await page.waitForTimeout(60);
    const angled = await region.screenshot();
    const foilDifference = await meanDifference(normal, plain),
      angleDifference = await meanDifference(normal, angled);
    assert.ok(foilDifference.mean > 0.18, `${sample.id} has no visible optical foil`);
    assert.ok(angleDifference.mean > 0.2, `${sample.id} does not respond to light angle`);
    const state = await page.evaluate(() => materialReview.inspect());
    assert.equal(state.calls, 3);
    optical.push({ id: sample.id, foilDifference, angleDifference, calls: state.calls });
  }
  await page.evaluate(() => {
    materialReview.select('UL');
    materialReview.light(-25, 30);
  });
  await page.waitForTimeout(80);
  const reliefOn = await page.locator('#stage').screenshot();
  await page.locator('#relief').uncheck();
  await page.waitForTimeout(80);
  const reliefOff = await page.locator('#stage').screenshot();
  const relief = await meanDifference(reliefOn, reliefOff);
  assert.ok(relief.mean > 0.15, 'UL relief normals must affect reflections');
  await page.locator('#relief').check();
  await page.locator('#reset').click();
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.64, box.y + box.height * 0.54, { steps: 8 });
  await page.mouse.up();
  let state = await page.evaluate(() => materialReview.inspect());
  assert.ok(state.rotY > 0.4, 'Card drag must rotate');
  await page.mouse.wheel(0, -300);
  state = await page.evaluate(() => materialReview.inspect());
  assert.ok(state.zoom > 1);
  await page.locator('#back').click();
  await page.waitForTimeout(80);
  state = await page.evaluate(() => materialReview.inspect());
  assert.equal(state.reverse, true);
  await sharp(await page.locator('#stage').screenshot())
    .resize({ height: 700 })
    .jpeg({ quality: 86 })
    .toFile(`${dir}/back.jpg`);
  await page.locator('#reset').click();
  assert.equal((await page.evaluate(() => materialReview.inspect())).reverse, false);
  await page.waitForTimeout(80);
  let baseline = await page.evaluate(() => materialReview.inspect().renderCount);
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => materialReview.inspect().renderCount),
    baseline,
    'Static review must not keep drawing',
  );
  await page.locator('#turn').click();
  await page.waitForTimeout(260);
  state = await page.evaluate(() => materialReview.inspect());
  assert.ok(state.renderCount > baseline + 2);
  await page.locator('#turn').click();
  await page.locator('#reset').click();
  await page.locator('#card-type').selectOption('overview');
  await page.locator('#compare').click();
  await page.waitForTimeout(100);
  state = await page.evaluate(() => materialReview.inspect());
  assert.equal(state.compare, true);
  assert.equal(state.calls, 27);
  assert.equal(await page.locator('.compare-label').count(), 9);
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .jpeg({ quality: 90 })
    .toFile(`${dir}/desktop.jpg`);
  const tiles = [];
  for (let i = 0; i < 9; i++) {
    const label = manifest[i].id;
    const meta = await sharp(`${dir}/${label}.jpg`).metadata();
    const pic = await sharp(`${dir}/${label}.jpg`)
      .extract({ left: Math.round((meta.width - 430) / 2), top: 40, width: 430, height: 610 })
      .resize({ width: 310, height: 408, fit: 'contain', background: '#102035' })
      .toBuffer();
    tiles.push({ input: pic, left: (i % 3) * 320 + 5, top: Math.floor(i / 3) * 430 + 26 });
    tiles.push({
      input: Buffer.from(
        `<svg width="310" height="24"><text x="155" y="18" fill="#9de7fa" text-anchor="middle" font-family="Arial" font-size="16">${label}</text></svg>`,
      ),
      left: (i % 3) * 320 + 5,
      top: Math.floor(i / 3) * 430,
    });
  }
  await sharp({ create: { width: 960, height: 1295, channels: 3, background: '#102035' } })
    .composite(tiles)
    .resize({ height: 1280 })
    .jpeg({ quality: 88 })
    .toFile(`${dir}/overview.jpg`);
  // Clicking an overview sample opens the matching full-size specimen.
  await page.mouse.click(box.x + box.width * 0.84, box.y + box.height * 0.5);
  await page.waitForTimeout(60);
  state = await page.evaluate(() => materialReview.inspect());
  assert.equal(state.selected, 'PSER');
  assert.equal(state.compare, false);
  const beforeTextures = state.textures;
  for (let i = 0; i < 18; i++)
    await page.evaluate((id) => materialReview.select(id), manifest[i % 9].id);
  assert.equal(
    (await page.evaluate(() => materialReview.inspect())).textures,
    beforeTextures,
    'Switching samples must reuse textures',
  );
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#capture').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^LOCR-JP-/);
  await download.saveAs(`${dir}/export.png`);
  assert.ok((await fs.stat(`${dir}/export.png`)).size > 5000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => materialReview.select('GMR'));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.sample:visible').count(), 9);
  await sharp(await page.screenshot({ fullPage: true }))
    .resize({ height: 1280 })
    .jpeg({ quality: 87 })
    .toFile(`${dir}/mobile.jpg`);
  const pad = page.locator('#light-pad');
  await pad.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(40);
  assert.ok(Number(await pad.getAttribute('aria-valuenow')) > -25);
  assert.deepEqual(errors, []);
  assert.deepEqual(badRequests, []);
  assert.deepEqual(external, []);
  const report = {
    passed: true,
    samples: manifest.map(({ id, cardId, edition, serial }) => ({ id, cardId, edition, serial })),
    optical,
    relief,
    checks: [
      'independent environmental light',
      'light angle',
      'foil masks',
      'UL relief',
      'drag/zoom',
      'card back',
      'idle rendering',
      'auto rotation',
      '9-card comparison',
      'sample selection',
      'texture reuse',
      'PNG export',
      '390px layout',
      'keyboard light control',
      'offline assets',
    ],
    errors,
    badRequests,
    external,
  };
  await fs.writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      samples: manifest.length,
      rarities: 7,
      optical,
      relief,
      checks: report.checks,
    }),
  );
} finally {
  await browser.close();
}
