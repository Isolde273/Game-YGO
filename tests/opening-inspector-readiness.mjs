import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { browserOptions } from './helpers/browser.mjs';
import { freshState } from './helpers/starter-state.mjs';
import { makeItem } from '../src/game/model.js';
import { openFixturePacks } from './helpers/sorting-stacks.mjs';

const variant = process.env.YGO_READINESS_VARIANT || 'current';
const output =
  process.env.YGO_READINESS_OUTPUT || 'test-results/inspector-eighths-20261010/readiness';
await fs.mkdir(output, { recursive: true });
const desktop = process.env.YGO_READINESS_DESKTOP === '1';
const env = {
  ...process.env,
  YGO_SMOKE_TEST: '1',
  YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${variant}-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const browser = desktop
  ? await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    })
  : await chromium.launch({ ...browserOptions, headless: true });
const report = { variant, errors: [] };
try {
  const page = desktop
    ? await browser.firstWindow()
    : await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  if (desktop) {
    await page.locator('.home-menu').waitFor();
    await browser.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  }
  const state = freshState();
  state.settings.sound = false;
  state.items = Array.from({ length: 6 }, () => makeItem('pack'));
  let n = 0;
  openFixturePacks(
    state,
    state.items.map((item) => item.id),
    () => [0, 0.6, 0.9, 0.97, 0.999][n++ % 5],
  );
  state.items.push(makeItem('pack'));
  await page.addInitScript(
    (fixture) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(fixture)),
    state,
  );
  page.on('pageerror', (error) => report.errors.push(error.message));
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  report.entry = await page.evaluate(async () => {
    const start = performance.now(),
      frames = [];
    let previous = start,
      phase = '',
      entering,
      readiness,
      open;
    document.querySelector('.world-stack').click();
    const created = performance.now() - start;
    while (!open) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
      const view = document.querySelector('.card-inspector');
      if (view.dataset.phase !== phase) {
        phase = view.dataset.phase;
        if (phase === 'entering') {
          entering = now - start;
          readiness = [...view.querySelectorAll('.inspect-card')].map((card) => {
            const canvas = card.querySelector('.card-finish-canvas');
            return {
              ready: canvas?.dataset.ready === 'true',
              width: canvas?.width,
              height: canvas?.height,
              renderedWidth: Number(canvas?.dataset.renderedWidth ?? canvas?.width),
              suffixAlpha: canvas
                ?.getContext('2d')
                .getImageData(canvas.width - 2, Math.floor(canvas.height / 2), 1, 1).data[3],
            };
          });
        }
        if (phase === 'open') open = now - start;
      }
      if (now - start > 30000) throw new Error('Inspector never became ready');
    }
    return {
      created,
      entering,
      open,
      ready: readiness?.filter((card) => card.ready).length,
      cards: readiness?.length,
      complete: readiness?.filter((card) => card.renderedWidth === card.width).length,
      partial: readiness?.filter(
        (card) => card.renderedWidth === Math.ceil(card.width / 16) * 2 && card.suffixAlpha === 0,
      ).length,
      initialPixels: readiness?.reduce((sum, card) => sum + card.renderedWidth * card.height, 0),
      fullPixels: readiness?.reduce((sum, card) => sum + card.width * card.height, 0),
      maxFrame: Math.max(...frames),
      frames,
    };
  });
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-open.webp`);
  const rear = await page.locator('.inspect-card').first().boundingBox();
  await page.evaluate(() => {
    window.readinessDragEvents = [];
    const record = (type, extra = {}) =>
      window.readinessDragEvents.push({
        type,
        time: performance.now(),
        dragging: !!document.querySelector('.inspect-card.dragging'),
        ...extra,
      });
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture'])
      document.addEventListener(
        type,
        (event) =>
          record(type, {
            x: event.clientX,
            y: event.clientY,
            target: event.target.className,
          }),
        true,
      );
    window.addEventListener('resize', () =>
      record('resize', { width: innerWidth, height: innerHeight }),
    );
    window.addEventListener('blur', () => record('blur'));
    new ResizeObserver(([entry]) =>
      record('fan-resize', {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    ).observe(document.querySelector('.inspect-card-stage').parentElement);
  });
  await page.mouse.move(rear.x + 2, rear.y + rear.height * 0.4);
  await page.mouse.down();
  report.earlyPickComplete = await page
    .locator('.inspect-card')
    .first()
    .locator('canvas')
    .getAttribute('data-complete');
  await page.mouse.move(rear.x + 22, rear.y + rear.height * 0.4, { steps: 4 });
  await page.waitForTimeout(60);
  report.overlap = await page.evaluate(() => {
    const card = document.querySelector('.inspect-card.dragging'),
      rect = card.getBoundingClientRect();
    const top = document
      .elementFromPoint(rect.left + rect.width - 10, rect.top + rect.height / 2)
      ?.closest('.inspect-card');
    return {
      extracted: card.classList.contains('extracted'),
      z: getComputedStyle(card).zIndex,
      left: rect.left,
      top: rect.top,
      hiddenByFront: top !== card,
      topId: top?.dataset.card,
      dragId: card.dataset.card,
    };
  });
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-overlap.webp`);
  await page.mouse.move(rear.x - rear.width - 20, rear.y + rear.height * 0.4, { steps: 12 });
  await page.waitForTimeout(60);
  try {
    report.extracted = await page.locator('.inspect-card.dragging').evaluate((card) => ({
      extracted: card.classList.contains('extracted'),
      z: getComputedStyle(card).zIndex,
    }));
  } catch (error) {
    report.dragEvents = await page.evaluate(() => window.readinessDragEvents);
    await fs.writeFile(`${output}/${variant}-failed-drag.json`, JSON.stringify(report, null, 2));
    console.error(JSON.stringify({ variant, dragEvents: report.dragEvents.slice(-12) }));
    throw error;
  }
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-extracted.webp`);
  await page.mouse.move(rear.x + 22, rear.y + rear.height * 0.4, { steps: 12 });
  await page.waitForTimeout(60);
  report.returnedAbove = await page.locator('.inspect-card.dragging').evaluate((card) => {
    const rect = card.getBoundingClientRect();
    return (
      document
        .elementFromPoint(rect.right - 10, rect.top + rect.height / 2)
        ?.closest('.inspect-card') === card
    );
  });
  report.dragEvents = await page.evaluate(() => window.readinessDragEvents);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.inspect-card canvas')].every(
      (canvas) => canvas.dataset.complete === 'true',
    ),
  );
  await page.locator('.inspect-return').click();
  await page.waitForFunction(() => !document.querySelector('.card-inspector'));
  let delayedRequests = 0;
  if (!desktop)
    await page.route('**/public/locr-catalog/**', async (route) => {
      delayedRequests++;
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
  report.opening = await page.evaluate(async () => {
    const world = document.querySelector('#world canvas').world3D;
    const start = performance.now();
    document.querySelector('.object-pack').click();
    const created = performance.now() - start;
    let firstTear, torn, done;
    while (!done) {
      await new Promise(requestAnimationFrame);
      const elapsed = performance.now() - start,
        opening = world.snapshot().animations.find((a) => a.kind === 'pack');
      if (opening?.time >= 0.035 && !firstTear) firstTear = elapsed;
      if (opening?.time >= 0.28 && !torn) torn = elapsed;
      if (!opening) done = elapsed;
      if (elapsed > 30000) throw new Error('Pack never finished');
    }
    return { created, firstTear, torn, done };
  });
  report.opening.delayedRequests = delayedRequests;
  await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      ...report,
      entry: { ...report.entry, frames: undefined },
    }),
  );
  assert.deepEqual(report.errors, []);
  if (process.env.YGO_READINESS_BASELINE !== '1') {
    assert.equal(report.entry.ready, 60);
    assert.equal(report.entry.complete, 1);
    assert.equal(report.entry.partial, 59);
    assert.ok(report.entry.initialPixels / report.entry.fullPixels < 0.36);
    assert.equal(report.earlyPickComplete, 'true');
    assert.equal(report.overlap.extracted, false);
    assert.equal(report.overlap.hiddenByFront, true);
    assert.ok(Math.abs(report.overlap.left - (rear.x + 20)) < 2);
    assert.ok(Math.abs(report.overlap.top - rear.y) < 2);
    assert.equal(report.extracted.extracted, true);
    assert.equal(report.extracted.z, '1000');
    assert.equal(report.returnedAbove, true);
    if (!desktop) {
      assert.ok(delayedRequests > 0, 'Cold opening must request card textures');
      assert.ok(
        report.opening.firstTear < 700,
        'Tearing should not wait for delayed card textures',
      );
    }
  }
} finally {
  await browser.close();
}
