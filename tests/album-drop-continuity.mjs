import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import {
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
  cardCount,
} from '../src/game/model.js';
import { CARD_PRINTS } from '../src/game/card-data.js';

const desktop = process.env.YGO_ALBUM_DROP_DESKTOP === '1';
const output = 'test-results/album-flash-20261009';
const prefix = desktop ? 'desktop' : 'browser';
await fs.mkdir(output, { recursive: true });
const fixture = freshState();
fixture.items = [];
fixture.containers = [];
fixture.settings.sound = false;
fixture.settings.motion = true;
const prints = ['PSER', 'GMR', 'SER'].map((style) =>
  CARD_PRINTS.find((print) => print.style === style),
);
for (const [index, print] of prints.entries()) {
  const quantity = print.rarity === 'GMR' ? 2 : 3;
  addCards(fixture, print.id, quantity, print.rarity === 'GMR' ? [37, 88] : undefined);
  transferWarehouseToTray(fixture, print.id, quantity);
  moveBinderCard(fixture, { printId: print.id }, index);
}
let application;
const errors = [],
  report = [];
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await application.firstWindow();
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });
    await page.context().setOffline(true);
  } else {
    application = await chromium.launch({ ...browserOptions, headless: true });
    page = await application.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((state) => {
    if (!localStorage.getItem('album-drop-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('album-drop-fixture', '1');
    }
  }, fixture);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await navigatePage(page, 'album');
  const ready = () =>
    page.waitForFunction(
      () =>
        [...document.querySelectorAll('.album-studio img[data-finish-print]')].every(
          (image) =>
            image.parentElement.querySelector('.card-finish-canvas')?.dataset.ready === 'true',
        ) && !document.querySelector('.book-outgoing'),
    );
  await ready();
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  const drop = async (source, destination, name, motion = true) => {
    await ready();
    const from = await page.locator(source).boundingBox();
    const to = await page.locator(destination).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.waitForFunction(
      () =>
        document.querySelector('.album-drag-ghost .card-finish-canvas')?.dataset.ready === 'true',
    );
    await page.evaluate(() => {
      const canvas = document.querySelector('.album-drag-ghost canvas');
      window.dropPixels = canvas.toDataURL();
      window.dropTrace = [];
      window.dropSampling = true;
      const sample = (phase) => {
        const images = [...document.querySelectorAll('.album-studio img[data-finish-print]')];
        const missing = images.filter((image) => {
          const parent = image.parentElement,
            canvas = parent.querySelector('.card-finish-canvas');
          return (
            !parent.classList.contains('has-real-finish') ||
            parent.dataset.finishReady !== 'true' ||
            canvas?.dataset.ready !== 'true'
          );
        }).length;
        const misaligned =
          phase === 'paint'
            ? images.filter((image) => {
                const canvas = image.parentElement.querySelector('.card-finish-canvas');
                if (!canvas) return true;
                const face = image.getBoundingClientRect(),
                  finish = canvas.getBoundingClientRect();
                return (
                  !face.width ||
                  !face.height ||
                  Math.abs(face.left - finish.left) > 1.5 ||
                  Math.abs(face.top - finish.top) > 1.5 ||
                  Math.abs(face.width - finish.width) > 1.5 ||
                  Math.abs(face.height - finish.height) > 1.5
                );
              }).length
            : 0;
        const flight = document.querySelector('.album-flight');
        window.dropTrace.push({
          phase,
          cards: images.length,
          missing,
          misaligned,
          flight: !!flight,
          flightReady: flight?.querySelector('canvas')?.dataset.ready === 'true',
        });
      };
      window.dropObserver = new MutationObserver(() => sample('mutation'));
      window.dropObserver.observe(document.querySelector('#app'), {
        childList: true,
        subtree: true,
      });
      const tick = () => {
        sample('paint');
        if (window.dropSampling) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.up();
    const handoff = await page.evaluate(() => {
      const flight = document.querySelector('.album-flight');
      const canvas = flight?.querySelector('canvas');
      return { retained: canvas?.toDataURL() === window.dropPixels, present: !!flight };
    });
    if (motion) assert.equal(handoff.present, true);
    await page.waitForTimeout(90);
    if (name === 'insert' || name.includes('warehouse')) await shot(name);
    await page.waitForTimeout(520);
    const trace = await page.evaluate(() => {
      window.dropSampling = false;
      window.dropObserver.disconnect();
      return window.dropTrace;
    });
    const holes = trace.filter(
      (frame) => frame.missing || frame.misaligned || (frame.flight && !frame.flightReady),
    );
    report.push({ name, frames: trace.length, holes, handoff });
    await fs.writeFile(
      `${output}/${prefix}-report.json`,
      JSON.stringify({ report, errors }, null, 2),
    );
    assert.equal(
      holes.length,
      0,
      `${name}: finished card faces must remain present through every drop paint: ${JSON.stringify(holes.slice(0, 3))}`,
    );
    assert.equal(await page.locator('.album-flight,.album-drag-ghost').count(), 0);
    await ready();
    const state = validateState(
      await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
    );
    assert.equal(cardCount(state), 8);
  };
  await drop(`.tray-card[data-rarity="${prints[0].id}"]`, '[data-slot="3"]', 'insert');
  await drop('[data-slot="3"]', '[data-slot="2"]', 'exchange');
  await drop('[data-slot="2"]', '.collection-tray', 'remove');
  await drop('[data-slot="1"]', '[data-album-drop="warehouse"]', 'warehouse');
  await drop(`.tray-card[data-rarity="${prints[1].id}"]`, '[data-slot="5"]', 'numbered-insert');
  await drop('[data-slot="5"]', '.collection-tray', 'numbered-remove');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await drop(
    `.tray-card[data-rarity="${prints[0].id}"]`,
    '[data-slot="4"]',
    'reduced-motion',
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await drop('[data-slot="4"]', '[data-slot="5"]', 'narrow-reduced-motion', false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await drop('[data-slot="5"]', '[data-album-drop="warehouse"]', 'narrow-warehouse');
  const state = validateState(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
  );
  assert.equal(state.numberedCards.find((card) => card.serial === 37).inCollection, false);
  assert.equal(state.numberedCards.find((card) => card.serial === 88).inCollection, true);
  assert.deepEqual(errors, []);
  console.log(
    `Album drop ${prefix}: nine routes preserve finished faces on every paint, inventory and GMR identity.`,
  );
} finally {
  await application?.close();
}
