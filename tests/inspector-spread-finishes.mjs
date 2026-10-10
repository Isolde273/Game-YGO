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

const desktop = process.env.YGO_SPREAD_DESKTOP === '1';
const baseline = process.env.YGO_SPREAD_BASELINE === '1';
const narrow = process.env.YGO_SPREAD_NARROW === '1';
const unreported = process.env.YGO_SPREAD_UNREPORTED === '1';
const normal = process.env.YGO_SPREAD_NORMAL === '1';
const style = process.env.YGO_SPREAD_STYLE || 'PSER';
const variant = process.env.YGO_SPREAD_VARIANT || (desktop ? 'desktop' : 'browser');
const output = process.env.YGO_SPREAD_OUTPUT || 'test-results/inspector-spread-live-20261010';
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
    : await app.newPage({
        viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: 1.5,
      });
  if (desktop) {
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900);
      window.show();
      window.focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  }
  const state = freshState();
  state.settings.sound = false;
  state.settings.motion = true;
  state.items = [];
  const print = CARD_PRINTS.find((print) => print.style === style);
  const cards = Array.from({ length: narrow ? 4 : 60 }, (_, index) => {
    const serial = print.rarity === 'GMR' ? index + 1 : null;
    const numbered = addCards(state, print.id, 1, serial === null ? [] : [serial]);
    return makeCardRecord(print.id, serial === null ? crypto.randomUUID() : numbered[0].id, serial);
  });
  state.cardStacks.push({
    id: crypto.randomUUID(),
    cards,
    pose3d: {
      position: [-1.2, 0.084 + (cards.length * CARD_STEP) / 2, 1.35],
      quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    },
  });
  validateState(structuredClone(state));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    (state) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  if (unreported)
    await page.evaluate(() => {
      const original = document.body.getAnimations.bind(document.body);
      // Keep the actual visual animation running, but reproduce a missing
      // inherited-property track in the renderer's animation discovery.
      document.body.getAnimations = (options) =>
        original(options).filter(
          (animation) => !animation.effect?.target?.matches('.inspect-spread-group'),
        );
    });
  await page.evaluate((normal) => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    window.spreadCopies = [];
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = original.apply(this, args);
      if (this.canvas.matches('.inspect-card .card-finish-canvas')) {
        const card = this.canvas.parentElement;
        const copy = {
          time: performance.now(),
          id: card.dataset.card,
          phase: card.closest('.card-inspector').dataset.phase,
          width: args.length === 9 ? args[7] : args[0].width,
          height: args.length === 9 ? args[8] : args[0].height,
        };
        const group = card.closest('.inspect-spread-group');
        if (normal && group && card.matches(':last-child')) {
          copy.progress = Number(getComputedStyle(group).getPropertyValue('--inspect-spread'));
          copy.x = card.getBoundingClientRect().left;
          // Small retained-canvas sample verifies visible pixels during the
          // real 220ms spread. These reads are not a latency benchmark.
          const sample = (window.finishSampleCanvas ??= document.createElement('canvas'));
          sample.width = 48;
          sample.height = 64;
          const context = sample.getContext('2d');
          original.call(context, this.canvas, 0, 0, 48, 64);
          let hash = 2166136261;
          for (const value of context.getImageData(0, 0, 48, 64).data)
            hash = Math.imul(hash ^ value, 16777619) >>> 0;
          copy.hash = hash;
        }
        window.spreadCopies.push(copy);
      }
      return result;
    };
    if (normal) return;
    window.spreadMutation = new MutationObserver(() => {
      for (const animation of document.getAnimations()) {
        if (!animation.effect?.target?.matches('.inspect-spread-group') || animation.spreadSlowed)
          continue;
        animation.spreadSlowed = true;
        // Slow only the fan so its snapshot fade completes before these samples.
        animation.updatePlaybackRate(0.08);
      }
    });
    window.spreadMutation.observe(document.querySelector('#app'), {
      childList: true,
      subtree: true,
    });
  }, normal);
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.card-inspector[data-phase="entering"]');
  if (normal) {
    await page.waitForSelector('.card-inspector[data-phase="open"]');
    const samples = await page.evaluate(() =>
      window.spreadCopies.filter(
        (copy) => copy.phase === 'entering' && copy.progress > 0 && copy.progress < 1,
      ),
    );
    const report = { variant, style, samples, errors };
    await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
    assert.deepEqual(errors, []);
    assert.ok(samples.length >= 2, 'front finish did not draw during normal-speed spread');
    assert.ok(
      new Set(samples.map((sample) => sample.hash)).size >= 2,
      'spread finish pixels were frozen',
    );
    assert.ok(samples.at(-1).x > samples[0].x + 5, 'live finish did not track rightward movement');
    await page.locator('.inspect-return').click();
    await page.waitForFunction(
      () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
    );
    console.log(
      JSON.stringify({
        variant,
        style,
        liveSamples: samples.length,
        differentPixels: new Set(samples.map((sample) => sample.hash)).size,
      }),
    );
  } else {
    const waitProgress = (progress) =>
      page.waitForFunction((progress) => {
        const animation = document
          .getAnimations()
          .find((animation) => animation.effect?.target?.matches('.inspect-spread-group'));
        const timing = animation?.effect.getTiming();
        return animation && (animation.currentTime - timing.delay) / timing.duration >= progress;
      }, progress);
    const sample = () =>
      page.evaluate(async (baseline) => {
        const cards = [...document.querySelectorAll('.inspect-card')];
        const front = cards.at(-1),
          rear = cards.at(-2);
        const read = (card, strip) => {
          const canvas = card.querySelector('canvas');
          const width = strip ? Math.min(6, canvas.width) : canvas.width;
          const data = canvas.getContext('2d').getImageData(0, 0, width, canvas.height).data;
          let hash = 2166136261;
          for (const value of data) hash = Math.imul(hash ^ value, 16777619) >>> 0;
          return {
            hash,
            width: canvas.width,
            coverage: Number(canvas.dataset.renderedWidth),
            x: card.getBoundingClientRect().left,
          };
        };
        const flight = document.querySelector('.inspect-flight-card');
        let geometryError = 0;
        if (!baseline) {
          const { measureInspectorSpread } = await import('./src/ui/card-finishes.js');
          const group = document.querySelector('.inspect-spread-group');
          for (const [image, rect] of measureInspectorSpread(group)) {
            const actual = image.getBoundingClientRect();
            for (const key of ['left', 'top', 'width', 'height'])
              geometryError = Math.max(geometryError, Math.abs(actual[key] - rect[key]));
          }
        }
        return {
          geometryError,
          phase: document.querySelector('.card-inspector').dataset.phase,
          front: read(front, false),
          rear: read(rear, true),
          snapshotOpacity: flight ? Number(getComputedStyle(flight).opacity) : 0,
          full: cards.filter((card) => card.querySelector('canvas').dataset.complete === 'true')
            .length,
          copies: window.spreadCopies.filter((copy) => copy.phase === 'entering').length,
        };
      }, baseline);
    await waitProgress(0.2);
    const first = await sample();
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-early.webp`);
    await waitProgress(0.65);
    const later = await sample();
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-later.webp`);
    const copies = await page.evaluate(() =>
      window.spreadCopies.filter((copy) => copy.phase === 'entering'),
    );
    const frontId = cards.at(-1).id;
    const report = {
      variant,
      first,
      later,
      errors,
      frontDraws: copies.filter((copy) => copy.id === frontId).length,
      rearDraws: copies.filter((copy) => copy.id !== frontId).length,
      maxRearDrawWidth: Math.max(
        0,
        ...copies.filter((copy) => copy.id !== frontId).map((copy) => copy.width),
      ),
    };
    await page.waitForSelector('.card-inspector[data-phase="open"]');
    assert.equal(await page.locator('.inspect-spread-group,.inspect-transition-layer').count(), 0);
    await page.locator('.inspect-return').click();
    await page.waitForFunction(
      () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
    );
    await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    assert.deepEqual(errors, []);
    if (!baseline) {
      assert.ok(
        first.geometryError < 0.03 && later.geometryError < 0.03,
        'spread light geometry changed',
      );
      assert.equal(first.snapshotOpacity, 0, 'flight snapshot reappeared after its fade');
      assert.equal(later.snapshotOpacity, 0, 'snapshot remained at the collapsed position');
      assert.notEqual(first.front.hash, later.front.hash, 'moving front finish was frozen');
      assert.notEqual(first.rear.hash, later.rear.hash, 'moving rear strip was frozen');
      assert.ok(later.front.x > first.front.x + (narrow ? 8 : 100), 'front did not move right');
      assert.ok(
        report.frontDraws > 3 && report.rearDraws > 3,
        'spread did not redraw the exposed finishes',
      );
      if (unreported)
        assert.ok(
          report.frontDraws > 10,
          'entry drawing relied on incidental refreshes instead of tracking the spread',
        );
      assert.equal(first.full, 1);
      assert.equal(later.full, 1);
      assert.ok(
        report.maxRearDrawWidth <= Math.ceil(first.rear.width / 16) * 2,
        'spread fully rendered hidden rear faces',
      );
    }
  }
} finally {
  await app.close();
}
