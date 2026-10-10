import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { browserOptions } from './helpers/browser.mjs';
import { freshState } from './helpers/starter-state.mjs';
import { addCards, validateState } from '../src/game/model.js';
import { CARD_PRINTS, makeCardRecord } from '../src/game/card-data.js';
import { CARD_STEP } from '../src/scene/packing.js';

const desktop = process.env.YGO_HANDOFF_DESKTOP === '1';
const baseline = process.env.YGO_HANDOFF_BASELINE === '1';
const reduced = process.env.YGO_HANDOFF_REDUCED === '1';
const variant = process.env.YGO_HANDOFF_VARIANT || (desktop ? 'desktop' : 'browser');
const output = 'test-results/inspector-entry-handoff-20261010';
await fs.mkdir(output, { recursive: true });
const env = {
  ...process.env,
  YGO_SMOKE_TEST: '1',
  YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${variant}-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const application = desktop
  ? await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    })
  : await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = desktop
    ? await application.firstWindow()
    : await application.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  if (desktop) {
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  }
  const state = freshState();
  state.settings.sound = false;
  state.settings.motion = !reduced;
  state.items = [];
  const prints = CARD_PRINTS.filter((print) => print.rarity !== 'GMR');
  for (const [index, count] of [60, 4].entries()) {
    const cards = Array.from({ length: count }, (_, offset) => {
      const print = prints[index ? 0 : Math.floor((offset * prints.length) / 60)];
      addCards(state, print.id);
      return makeCardRecord(print.id, crypto.randomUUID());
    });
    state.cardStacks.push({
      id: crypto.randomUUID(),
      cards,
      pose3d: {
        position: [index ? 2 : -1.2, 0.084 + (count * CARD_STEP) / 2, 1.35],
        quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      },
    });
  }
  validateState(structuredClone(state));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    (fixture) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(fixture)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  const point = await page.evaluate(() =>
    document.querySelector('#world canvas').world3D.projectCard(59),
  );
  assert.equal(
    await page.evaluate(
      (point) => document.querySelector('#world canvas').world3D.hitAt(point.x, point.y),
      point,
    ),
    state.cardStacks[0].id,
  );
  await page.evaluate(() => {
    const paintVisible = (element) => {
      if (!element || getComputedStyle(element).visibility !== 'visible') return false;
      for (let parent = element; parent; parent = parent.parentElement)
        if (Number(getComputedStyle(parent).opacity) < 0.02) return false;
      return true;
    };
    const report = (window.handoff = { frames: [], transitions: [], leaks: [], tasks: [] });
    const observer = new PerformanceObserver((list) =>
      report.tasks.push(
        ...list.getEntries().map((task) => ({ start: task.startTime, ms: task.duration })),
      ),
    );
    observer.observe({ type: 'longtask' });
    let previousPhase = 'room',
      last = null;
    document.querySelector('#world canvas').addEventListener(
      'pointerup',
      () => {
        report.start = performance.now();
        last = report.start;
        const tick = () => {
          const now = performance.now();
          const view = document.querySelector('.card-inspector');
          const phase = view?.dataset.phase || 'room';
          report.frames.push({ phase: previousPhase, ms: now - last });
          if (phase !== previousPhase) report.transitions.push({ phase, ms: now - report.start });
          if (report.firstResponse === undefined && paintVisible(view))
            report.firstResponse = now - report.start;
          if (
            report.firstFlight === undefined &&
            paintVisible(document.querySelector('.inspect-flight-card'))
          )
            report.firstFlight = now - report.start;
          if (
            ['preparing', 'loading'].includes(phase) &&
            paintVisible(view?.querySelector('.inspect-selected-price'))
          )
            report.leaks.push({ phase, ms: now - report.start });
          if (['entering', 'open'].includes(phase) && !report.initialCoverage) {
            const canvases = [...view.querySelectorAll('.inspect-card .card-finish-canvas')];
            report.initialCoverage = {
              cards: canvases.length,
              ready: canvases.filter((canvas) => canvas.dataset.ready === 'true').length,
              full: canvases.filter((canvas) => canvas.dataset.complete === 'true').length,
              eighth: canvases.filter(
                (canvas) =>
                  Number(canvas.dataset.renderedWidth) === Math.ceil(canvas.width / 16) * 2,
              ).length,
            };
          }
          last = now;
          previousPhase = phase;
          if (phase !== 'open') requestAnimationFrame(tick);
          else {
            report.open = now - report.start;
            observer.disconnect();
            report.tasks = report.tasks.filter((task) => task.start >= report.start);
            report.done = true;
          }
        };
        requestAnimationFrame(tick);
      },
      { once: true, capture: true },
    );
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => window.handoff.done);
  const measured = await page.evaluate(() => window.handoff);
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-open.webp`);
  await page.locator('.inspect-return').click();
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  // Hold completion on a warm re-entry to examine the entire loading interval.
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    window.handoffOriginalDecode = original;
    const waiters = [];
    window.handoffHoldTop = true;
    HTMLImageElement.prototype.decode = function () {
      const decoded = original.call(this);
      if (!this.closest('.card-inspector')) return decoded;
      if (!window.handoffHoldTop && this.parentElement.matches('.inspect-card:last-child'))
        return decoded;
      return decoded.then(() => new Promise((resolve) => waiters.push(resolve)));
    };
    window.handoffDecodeWaiters = waiters;
    window.releaseHandoff = () => waiters.splice(0).forEach((resolve) => resolve());
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => window.handoffDecodeWaiters.length > 0);
  const pending = await page.evaluate(() => {
    const view = document.querySelector('.card-inspector');
    return {
      phase: view.dataset.phase,
      viewVisibility: getComputedStyle(view).visibility,
      priceVisibility: getComputedStyle(view.querySelector('.inspect-selected-price')).visibility,
      priceOpacity: getComputedStyle(view).opacity,
      stageVisibility: getComputedStyle(view.querySelector('.inspect-card-stage')).visibility,
      inert: view.inert,
      animations: document
        .getAnimations()
        .filter((animation) =>
          animation.effect?.target?.closest('.card-inspector,.inspect-transition-layer'),
        ).length,
    };
  });
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-pending.webp`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  await page.evaluate(() => window.releaseHandoff());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('body').getAttribute('data-page'), 'open');
  let pendingFlight;
  if (!baseline) {
    await page.evaluate(() => {
      window.handoffHoldTop = false;
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      () =>
        window.handoffDecodeWaiters.length > 0 &&
        document.querySelector('.inspect-flight-card canvas[data-complete="true"]'),
    );
    await page.waitForTimeout(600);
    pendingFlight = await page.evaluate(() => ({
      phase: document.querySelector('.card-inspector').dataset.phase,
      priceVisibility: getComputedStyle(document.querySelector('.inspect-selected-price'))
        .visibility,
      stageVisibility: getComputedStyle(document.querySelector('.inspect-card-stage')).visibility,
      flightOpacity: getComputedStyle(document.querySelector('.inspect-flight-card')).opacity,
      finishSurface: document.querySelector('.inspect-flight-card').dataset.finishSurface,
      liveFinish: document.querySelector('.inspect-flight-card img').dataset.finishPrint,
    }));
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-waiting-strips.webp`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
    );
    await page.evaluate(() => window.releaseHandoff());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('body').getAttribute('data-page'), 'open');
    assert.equal(pendingFlight.phase, 'loading');
    assert.equal(pendingFlight.flightOpacity, '1');
    assert.equal(pendingFlight.finishSurface, 'sorting');
    assert.ok(pendingFlight.liveFinish);
    assert.equal(pendingFlight.priceVisibility, 'hidden');
    assert.equal(pendingFlight.stageVisibility, 'hidden');
    if (reduced) assert.equal(pending.animations, 0);
    if (reduced)
      assert.equal(
        await page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((animation) =>
                animation.effect?.target?.closest('.card-inspector,.inspect-transition-layer'),
              ).length,
        ),
        0,
      );
  }
  // Inspect the real packaged fan during its rightward spread, then reverse
  // that unfinished entry to exercise wrapper and snapshot cleanup.
  let spread;
  if (!baseline && !reduced) {
    await page.evaluate(() => {
      HTMLImageElement.prototype.decode = window.handoffOriginalDecode;
      window.releaseHandoff();
    });
    await page.locator('.world-stack').first().press('Enter');
    await page.waitForFunction(() => document.querySelector('.inspect-spread-group'));
    spread = await page.evaluate(async () => {
      const tracks = document
        .getAnimations()
        .filter((animation) =>
          animation.effect?.target?.closest('.card-inspector,.inspect-transition-layer'),
        );
      tracks.forEach((animation) => animation.pause());
      await Promise.all(tracks.map((animation) => animation.ready));
      for (const animation of tracks) {
        const { delay, duration } = animation.effect.getTiming();
        animation.currentTime =
          delay + duration * (animation.effect.target.matches('.inspect-spread-group') ? 0.5 : 1);
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        phase: document.querySelector('.card-inspector').dataset.phase,
        groups: document.querySelectorAll('.inspect-spread-group').length,
        first: document.querySelector('.inspect-card').getBoundingClientRect().left,
        front: [...document.querySelectorAll('.inspect-card')].at(-1).getBoundingClientRect().left,
        full: document.querySelectorAll('.inspect-card canvas[data-complete="true"]').length,
      };
    });
    assert.equal(spread.phase, 'entering');
    assert.equal(spread.groups, 1);
    assert.equal(spread.full, 1);
    assert.ok(spread.front > spread.first);
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-spread-middle.webp`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        !document.querySelector('.card-inspector,.inspect-transition-layer,.inspect-spread-group'),
    );
    assert.equal(await page.locator('body').getAttribute('data-page'), 'open');
  }
  await fs.writeFile(
    `${output}/${variant}.json`,
    JSON.stringify({ measured, pending, pendingFlight, spread, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      variant,
      firstResponse: measured.firstResponse,
      firstFlight: measured.firstFlight,
      open: measured.open,
      transitions: measured.transitions,
      leaks: measured.leaks.length,
      longTasks: measured.tasks,
      initialCoverage: measured.initialCoverage,
      pending,
      pendingFlight,
      spread,
      errors,
    }),
  );
  assert.deepEqual(errors, []);
  if (!baseline) {
    assert.equal(measured.leaks.length, 0, 'price/icon leaked before the card fan');
    assert.ok(measured.firstResponse < 150, `click feedback took ${measured.firstResponse}ms`);
    assert.equal(measured.initialCoverage.ready, 60);
    if (!reduced) {
      assert.equal(measured.initialCoverage.full, 1);
      assert.equal(measured.initialCoverage.eighth, 59);
    }
    assert.equal(pending.priceVisibility, 'hidden');
    assert.equal(pending.inert, true);
  }
} finally {
  await application.close();
}
