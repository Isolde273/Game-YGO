import { chromium, _electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { browserOptions } from './helpers/browser.mjs';
import { freshState } from './helpers/starter-state.mjs';
import { addCards, validateState } from '../src/game/model.js';
import { CARD_PRINTS, makeCardRecord } from '../src/game/card-data.js';
import { CARD_STEP } from '../src/scene/packing.js';

const desktop = process.env.YGO_BUDGET_DESKTOP === '1';
const baseline = process.env.YGO_BUDGET_BASELINE === '1';
const variant =
  process.env.YGO_BUDGET_VARIANT ||
  `${desktop ? 'desktop' : 'browser'}-${baseline ? 'before' : 'after'}`;
const output = 'test-results/inspector-eighths-20261010';
await fs.mkdir(output, { recursive: true });
const env = {
  ...process.env,
  YGO_SMOKE_TEST: '1',
  YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${variant}-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = desktop
  ? await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    })
  : await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = desktop
    ? await app.firstWindow()
    : await app.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  if (desktop) {
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1440, 900);
      w.show();
      w.focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  }
  if (baseline && !desktop)
    for (const file of [
      'src/ui/card-finishes.js',
      'src/ui/card-inspector.js',
      'src/ui/motion/inspector-motion.js',
      'src/ui/styles/world3d.css',
    ]) {
      const body = await fs.readFile(
        `D:/Game-YGO-backups/20261010-inspector-eighths/${file}`,
        'utf8',
      );
      await page.route(`**/${file}`, (route) =>
        route.fulfill({
          contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
          body,
        }),
      );
    }
  const state = freshState();
  state.settings.sound = false;
  state.settings.motion = true;
  state.items = [];
  const prints = CARD_PRINTS.filter((print) => print.rarity !== 'GMR');
  const cards = Array.from({ length: 60 }, (_, i) => {
    const p = prints[Math.floor((i * prints.length) / 60)];
    addCards(state, p.id);
    return makeCardRecord(p.id, crypto.randomUUID());
  });
  state.cardStacks.push({
    id: crypto.randomUUID(),
    cards,
    pose3d: {
      position: [-1.2, 0.084 + (60 * CARD_STEP) / 2, 1.35],
      quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    },
  });
  validateState(structuredClone(state));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (state) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  const cycles = await page.evaluate(async () => {
    const until = (check) =>
      new Promise((resolve) => {
        const tick = () => (check() ? resolve() : requestAnimationFrame(tick));
        tick();
      });
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const percentile = (list, p) =>
      list.slice().sort((a, b) => a - b)[Math.floor((list.length - 1) * p)] || 0;
    const results = [];
    const original = CanvasRenderingContext2D.prototype.drawImage;
    let active;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (active && this.canvas.matches('.card-finish-canvas')) {
        const inspector = this.canvas.closest('.card-inspector'),
          flight = this.canvas.closest('.inspect-flight-card');
        if (inspector || flight) {
          const phase = inspector?.dataset.phase || 'flight';
          const entry = (active.copies[phase] ??= { count: 0, pixels: 0 });
          entry.count++;
          entry.pixels += args.length === 9 ? args[7] * args[8] : args[0].width * args[0].height;
          if (phase === 'closing' && this.canvas.closest('.inspect-card-stage'))
            active.hiddenExitDraws++;
        }
      }
      return original.apply(this, args);
    };
    for (let i = 0; i < 3; i++) {
      const report = {
        frames: { loading: [], entering: [], open: [], closing: [] },
        copies: {},
        tasks: [],
        hiddenExitDraws: 0,
      };
      active = report;
      const observer = new PerformanceObserver((list) =>
        report.tasks.push(
          ...list.getEntries().map((e) => ({ ms: e.duration, start: e.startTime })),
        ),
      );
      observer.observe({ type: 'longtask' });
      const start = performance.now();
      let last = start,
        phase = 'loading',
        running = true;
      const tick = () => {
        if (!running) return;
        const now = performance.now(),
          view = document.querySelector('.card-inspector');
        report.frames[phase]?.push(now - last);
        last = now;
        phase = view?.dataset.phase || 'idle';
        if (view && report.feedback === undefined && Number(getComputedStyle(view).opacity) > 0.001)
          report.feedback = now - start;
        const flight = document.querySelector('.inspect-flight-card');
        if (
          flight &&
          report.firstCard === undefined &&
          Number(getComputedStyle(flight).opacity) > 0.001
        )
          report.firstCard = now - start;
        if (phase === 'entering' && !report.initial) {
          const canvases = [...view.querySelectorAll('.inspect-card canvas')];
          report.initial = {
            cards: canvases.length,
            full: canvases.filter((c) => c.dataset.complete === 'true').length,
            pixels: canvases.reduce(
              (sum, c) => sum + Number(c.dataset.renderedWidth) * c.height,
              0,
            ),
            fullPixels: canvases.reduce((sum, c) => sum + c.width * c.height, 0),
            prefixWidths: canvases
              .slice(0, -1)
              .map((c) => ({ width: c.width, coverage: Number(c.dataset.renderedWidth) })),
          };
        }
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.querySelector('.world-stack').click();
      await until(() => document.querySelector('.card-inspector')?.dataset.phase === 'open');
      report.enterMs = performance.now() - start;
      await delay(240);
      report.completeAt240ms = document.querySelectorAll(
        '.inspect-card canvas[data-complete="true"]',
      ).length;
      const exit = performance.now();
      document.querySelector('.inspect-return').click();
      await until(() => !document.querySelector('.card-inspector,.inspect-transition-layer'));
      report.exitMs = performance.now() - exit;
      await delay(80);
      running = false;
      observer.disconnect();
      active = null;
      report.tasks = report.tasks.filter((e) => e.start >= start);
      report.frames = Object.fromEntries(
        Object.entries(report.frames).map(([name, list]) => [
          name,
          {
            count: list.length,
            mean: list.reduce((s, v) => s + v, 0) / Math.max(1, list.length),
            p95: percentile(list, 0.95),
            max: Math.max(0, ...list),
            over33: list.filter((v) => v > 33.4).length,
          },
        ]),
      );
      results.push(report);
    }
    CanvasRenderingContext2D.prototype.drawImage = original;
    return results;
  });
  const completion = baseline
    ? null
    : await page.evaluate(async () => {
        const until = (check) =>
          new Promise((resolve, reject) => {
            const start = performance.now();
            const tick = () => {
              if (check()) resolve();
              else if (performance.now() - start > 15000)
                reject(new Error('progressive completion timed out'));
              else requestAnimationFrame(tick);
            };
            tick();
          });
        const original = CanvasRenderingContext2D.prototype.drawImage;
        const frames = new Map(),
          chunks = [],
          joins = [];
        let frame = 0,
          running = true;
        const tick = () => {
          if (!running) return;
          frame++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          if (
            args.length === 9 &&
            args[5] > 0 &&
            this.canvas.matches('.inspect-card .card-finish-canvas')
          ) {
            const pixels = args[7] * args[8];
            frames.set(frame, (frames.get(frame) || 0) + pixels);
            chunks.push({ x: args[5], width: args[7], pixels });
            joins.push(args[5] === Number(this.canvas.dataset.renderedWidth));
          }
          return original.apply(this, args);
        };
        try {
          document.querySelector('.world-stack').click();
          await until(() => document.querySelector('.card-inspector')?.dataset.phase === 'open');
          const started = performance.now();
          await until(
            () =>
              document.querySelectorAll('.inspect-card canvas[data-complete="true"]').length === 60,
          );
          const result = {
            milliseconds: performance.now() - started,
            chunks: chunks.length,
            maxFramePixels: Math.max(0, ...frames.values()),
            maxChunkPixels: Math.max(0, ...chunks.map((c) => c.pixels)),
            continuousJoins: joins.every(Boolean),
            complete: document.querySelectorAll('.inspect-card canvas[data-complete="true"]')
              .length,
          };
          document.querySelector('.inspect-return').click();
          await until(() => !document.querySelector('.card-inspector,.inspect-transition-layer'));
          return result;
        } finally {
          running = false;
          CanvasRenderingContext2D.prototype.drawImage = original;
        }
      });
  const report = { variant, baseline, desktop, cycles, completion, errors };
  await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      variant,
      errors,
      completion,
      cycles: cycles.map((c) => ({
        feedback: c.feedback,
        firstCard: c.firstCard,
        enterMs: c.enterMs,
        exitMs: c.exitMs,
        frames: c.frames,
        hiddenExitDraws: c.hiddenExitDraws,
        completeAt240ms: c.completeAt240ms,
        initialPixels: c.initial.pixels,
        fullPixels: c.initial.fullPixels,
        tasks: c.tasks,
      })),
    }),
  );
  assert.deepEqual(errors, []);
  if (completion) {
    assert.equal(completion.complete, 60);
    assert.ok(completion.chunks > 59, 'hidden faces did not complete progressively');
    assert.ok(
      completion.maxFramePixels <= 131072,
      'hidden completion exceeded the frame pixel budget',
    );
    assert.ok(completion.continuousJoins, 'hidden completion skipped or repeated columns');
  }
  if (!baseline)
    for (const c of cycles) {
      assert.equal(c.initial.full, 1);
      assert.equal(c.initial.cards, 60);
      assert.ok(c.initial.prefixWidths.every((c) => c.coverage === Math.ceil(c.width / 16) * 2));
      assert.equal(c.hiddenExitDraws, 0, 'hidden fan rendered during exit');
    }
} finally {
  await app.close();
}
