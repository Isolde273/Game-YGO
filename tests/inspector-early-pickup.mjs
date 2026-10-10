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

const desktop = process.env.YGO_EARLY_DESKTOP === '1';
const narrow = process.env.YGO_SPREAD_NARROW === '1';
const style = process.env.YGO_SPREAD_STYLE || 'PSER';
const variant = process.env.YGO_SPREAD_VARIANT || (desktop ? 'desktop' : 'browser');
const output = 'test-results/work1s-pickup-after-spread-20261010';
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
  if (process.env.YGO_EARLY_BASELINE_RENDER === '1') {
    assert.equal(desktop, false);
    const body = await fs.readFile(
      'D:/Game-YGO-backups/20261010-spread440-early-pickup/src/ui/card-finishes.js',
      'utf8',
    );
    await page.route('**/src/ui/card-finishes.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body }),
    );
  }
  await page.addInitScript(
    (state) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    window.finishCopies = [];
    window.finishFrame = 0;
    const tick = () => {
      window.finishFrame++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('.inspect-card .card-finish-canvas')) {
        window.finishCopies.push({
          id: this.canvas.parentElement.dataset.card,
          frame: window.finishFrame,
          phase: this.canvas.closest('.card-inspector').dataset.phase,
          x: args.length === 9 ? args[5] : args[1] || 0,
          incomplete: this.canvas.dataset.complete !== 'true',
        });
      }
      return original.apply(this, args);
    };
    const observer = new MutationObserver(() => {
      const animation = document
        .getAnimations()
        .find((a) => a.effect?.target?.matches('.inspect-spread-group'));
      if (!animation || window.spread) return;
      window.spread = animation;
      animation.pause();
      animation.currentTime = animation.effect.getTiming().delay;
    });
    observer.observe(document.querySelector('#app'), { childList: true, subtree: true });
  });
  await page.locator('.world-stack').press('Enter');
  await page.waitForFunction(
    () => window.spread && document.querySelector('.card-inspector')?.dataset.phase === 'entering',
  );
  const timing = await page.evaluate(() => ({
    ...window.spread.effect.getTiming(),
    progress: Number(
      getComputedStyle(window.spread.effect.target).getPropertyValue('--inspect-spread'),
    ),
    inert: document.querySelector('.card-inspector').inert,
  }));
  assert.equal(timing.duration, 440);
  assert.equal(timing.progress, 0);
  assert.equal(timing.inert, true);
  const top = page.locator('.inspect-card').last();
  const blocked = [];
  for (const progress of [0, 0.5, 1]) {
    await page.evaluate((progress) => {
      const { delay, duration } = window.spread.effect.getTiming();
      window.spread.currentTime = delay + duration * progress;
    }, progress);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const rect = await top.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 40, rect.y + rect.height / 2 - 30);
    await page.mouse.up();
    // Exercise the handler guard too, even if synthetic events bypass inert.
    await top.dispatchEvent('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: rect.x + 10,
      clientY: rect.y + 10,
    });
    assert.equal(await page.locator('.inspect-card.dragging').count(), 0);
    assert.equal(await page.locator('.card-inspector').evaluate((el) => el.inert), true);
    assert.equal(await page.locator('.card-inspector').getAttribute('data-phase'), 'entering');
    assert.equal(await page.locator('.inspect-card').count(), 60);
    blocked.push(progress);
  }
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-before-unlock.webp`);
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  await settle();
  const readPixels = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.inspect-card')];
      return cards.map((card, index) => {
        const canvas = card.querySelector('canvas');
        const width = index === cards.length - 1 ? canvas.width : Math.min(6, canvas.width);
        return [...canvas.getContext('2d').getImageData(0, 0, width, canvas.height).data];
      });
    });
  const before = await readPixels();
  await page.evaluate(() => window.spread.finish());
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  assert.equal(await page.locator('.card-inspector').evaluate((el) => el.inert), false);
  await settle();
  const atOpen = await readPixels();
  const meanDifference = (left, right) =>
    left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / left.length;
  const boundaryDifferences = before.map((pixels, index) => meanDifference(pixels, atOpen[index]));
  assert.ok(Math.max(...boundaryDifferences) < 0.2, 'visible finish jumped at the spread handoff');
  await page.waitForFunction(
    () => document.querySelectorAll('.inspect-card canvas[data-complete="true"]').length === 60,
  );
  const completed = await readPixels();
  const completionDifferences = atOpen.map((pixels, index) =>
    meanDifference(pixels, completed[index]),
  );
  assert.ok(
    Math.max(...completionDifferences) < 0.2,
    'hidden completion flashed the visible finish',
  );
  const simultaneous = await page.evaluate(() => {
    const suffixes = window.finishCopies.filter(
      (copy) => copy.phase === 'open' && copy.x > 0 && copy.incomplete,
    );
    return suffixes.filter((suffix) =>
      window.finishCopies.some(
        (copy) => copy.id === suffix.id && copy.frame === suffix.frame && copy.x === 0,
      ),
    ).length;
  });
  assert.ok(simultaneous > 0, 'hidden completion blocked visible refresh');

  // The completed spread now accepts normal pickup and routing.
  const initial = await top.boundingBox();
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.inspect-card.dragging');
  const grabbed = await top.boundingBox();
  assert.ok(Math.abs(grabbed.x - initial.x) < 0.1 && Math.abs(grabbed.y - initial.y) < 0.1);
  await page.mouse.move(initial.x + initial.width / 2 + 80, initial.y + initial.height / 2 - 50);
  await settle();
  const held = await top.boundingBox();
  assert.ok(Math.abs(held.x - initial.x - 80) < 0.1 && Math.abs(held.y - initial.y + 50) < 0.1);
  const panel = await page.locator('.destination-warehouse').boundingBox();
  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.inspect-card').length === 59);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  validateState(saved);
  assert.equal(saved.cardStacks[0].cards.length, 59);

  const rear = page.locator('.inspect-card').nth(57);
  const front = page.locator('.inspect-card').last();
  const rr = await rear.boundingBox(),
    fr = await front.boundingBox();
  await page.mouse.move(rr.x + (fr.x - rr.x) / 2, rr.y + rr.height * 0.45);
  await page.mouse.down();
  await page.waitForSelector('.inspect-card.dragging');
  await page.mouse.move(rr.x + (fr.x - rr.x) / 2 - 5, rr.y + rr.height * 0.45 + 8);
  await settle();
  const overlap = await rear.evaluate((el) => ({
    extracted: el.classList.contains('extracted'),
    complete: el.querySelector('canvas').dataset.complete,
    above:
      document
        .elementFromPoint(
          el.getBoundingClientRect().left + el.clientWidth / 2,
          el.getBoundingClientRect().top + el.clientHeight / 2,
        )
        ?.closest('.inspect-card') === el,
  }));
  assert.equal(overlap.complete, 'true');
  assert.equal(overlap.extracted, false);
  assert.equal(overlap.above, false);
  await page.mouse.move(rr.x + (fr.x - rr.x) / 2 - 100, rr.y - rr.height);
  await page.waitForSelector('.inspect-card.dragging.extracted');
  await page.mouse.up();
  await sharp(await page.screenshot())
    .resize({ width: 1280 })
    .webp({ quality: 85 })
    .toFile(`${output}/${variant}-settled.webp`);
  await page.locator('.inspect-return').click();
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  assert.deepEqual(errors, []);
  const report = {
    variant,
    timing,
    blockedProgress: blocked,
    pickupAfterOpen: true,
    remainingCards: 59,
    overlap,
    maxBoundaryDifference: Math.max(...boundaryDifferences),
    maxCompletionDifference: Math.max(...completionDifferences),
    simultaneousVisibleAndHidden: simultaneous,
    errors,
    passed: true,
  };
  await fs.writeFile(`${output}/${variant}-early.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await app.close();
}
