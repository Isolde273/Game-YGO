import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { browserOptions } from './helpers/browser.mjs';
import { freshState } from './helpers/starter-state.mjs';
import { addCards } from '../src/game/model.js';
import { CARD_PRINTS, makeCardRecord } from '../src/game/card-data.js';
import { CARD_STEP } from '../src/scene/packing.js';

const desktop = process.env.YGO_FLASH_DESKTOP === '1';
const diagnostic = process.env.YGO_FLASH_DIAGNOSTIC === '1';
const baseline = process.env.YGO_FLASH_BASELINE === '1';
const variant =
  process.env.YGO_FLASH_VARIANT ||
  `${desktop ? 'desktop' : 'browser'}-${diagnostic ? 'lobes' : 'normal'}`;
const output = 'test-results/inspector-flash-position-20261010';
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
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1440, 900);
      window.show();
      window.focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  }
  if (baseline && !desktop) {
    for (const file of ['src/ui/card-finishes.js', 'src/ui/motion/inspector-motion.js']) {
      const body = await fs.readFile(`D:/Game-YGO-backups/20261010-flash-position/${file}`, 'utf8');
      await page.route(`**/${file}`, (route) =>
        route.fulfill({ contentType: 'text/javascript', body }),
      );
    }
  }
  const state = freshState();
  state.settings.sound = false;
  state.settings.motion = true;
  state.items = [];
  const print = CARD_PRINTS.find((print) => print.rarity === 'PSER');
  const cards = Array.from({ length: 60 }, () => {
    addCards(state, print.id);
    return makeCardRecord(print.id, crypto.randomUUID());
  });
  state.cardStacks.push({
    id: crypto.randomUUID(),
    cards,
    pose3d: {
      position: [-1.2, 0.084 + (cards.length * CARD_STEP) / 2, 1.35],
      quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 350));
  });
  await page.addInitScript(
    (state) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  if (diagnostic)
    await page.evaluate(async () => {
      const THREE = await import(new URL('src/vendor/three.module.js', location.href));
      // Test only: output the actual angular flash amplitudes as RGB. This
      // removes hue/diffuse changes and ACES saturation from the assertion.
      THREE.Material.prototype.onBeforeCompile = function (shader) {
        if (!shader.fragmentShader.includes('vec4 secretFilm(')) return;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            'return vec4(facetSpectrum*intensity*transmission+(mainFlare+sparkleFlare+flare*flash*facetResponse)*reflection,glintCoverage);',
            'return vec4(blaze,secondary,sparkle,1.);',
          )
          .replace(
            'color=color*(1.-zone.r*foilEnabled*film.a)+zone.r*foilEnabled*film.rgb+foil*vec3(gloss*.16);',
            'gl_FragColor=vec4(film.rgb,1.);return;',
          );
      };
    });
  await page.evaluate(() => {
    window.flashSamples = new Map();
    window.flashCopies = 0;
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('.inspect-flight-card canvas')) window.flashCopies++;
      return original.apply(this, args);
    };
    window.flashObserver = new MutationObserver(() => {
      for (const animation of document.getAnimations()) {
        const target = animation.effect?.target;
        if (animation.flashControlled) continue;
        if (target?.matches('.inspect-flight-card')) {
          animation.flashControlled = true;
          if (animation.effect.getKeyframes().some((key) => 'transform' in key))
            animation.updatePlaybackRate(0.12);
          else {
            animation.pause();
            animation.currentTime = 0;
          }
        } else if (target?.matches('.inspect-spread-group')) {
          animation.flashControlled = true;
          animation.pause();
          animation.currentTime = 0;
        }
      }
    });
    window.flashObserver.observe(document.querySelector('#app'), {
      childList: true,
      subtree: true,
    });
  });
  const sample = (selector, key) =>
    page.evaluate(
      ({ selector, key }) => {
        const host = document.querySelector(selector),
          canvas = host.querySelector('canvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const previous = window.flashSamples.get(key);
        const n = pixels.length / 4,
          mean = [0, 0, 0],
          peaks = [0, 0, 0],
          difference = [0, 0, 0],
          rising = [0, 0, 0],
          falling = [0, 0, 0];
        let hash = 2166136261;
        for (let i = 0; i < pixels.length; i += 4)
          for (let c = 0; c < 3; c++) {
            const value = pixels[i + c];
            hash = Math.imul(hash ^ value, 16777619) >>> 0;
            mean[c] += value;
            if (value > 64) peaks[c]++;
            if (previous?.length === pixels.length) {
              const delta = value - previous[i + c];
              difference[c] += Math.abs(delta);
              if (delta > 32) rising[c]++;
              if (delta < -32) falling[c]++;
            }
          }
        window.flashSamples.set(key, pixels);
        const rect = host.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: canvas.width,
          height: canvas.height,
          hash,
          copies: window.flashCopies,
          mean: mean.map((v) => v / n),
          peaks: peaks.map((v) => v / n),
          difference: difference.map((v) => v / n),
          rising: rising.map((v) => v / n),
          falling: falling.map((v) => v / n),
        };
      },
      { selector, key },
    );
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        ),
    );
  const progress = (value) =>
    page.waitForFunction((value) => {
      const a = document
        .getAnimations()
        .find(
          (a) =>
            a.effect?.target?.matches('.inspect-flight-card') &&
            a.effect.getKeyframes().some((key) => 'transform' in key),
        );
      return (
        a && (a.currentTime - a.effect.getTiming().delay) / a.effect.getTiming().duration >= value
      );
    }, value);
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.inspect-flight-card canvas[data-ready="true"]');
  // A fully overlapping entry lands farther left than the old mini fans.
  // Sample a wider portion of that shorter flight for the angular diagnostic.
  await progress(0.05);
  const entryFirst = await sample('.inspect-flight-card', 'entry');
  if (!diagnostic)
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-entry-early.webp`);
  await progress(0.9);
  const entryLater = await sample('.inspect-flight-card', 'entry');
  if (!diagnostic)
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-entry-later.webp`);
  await page.waitForSelector('.inspect-spread-group');
  const fanSample = async (value) => {
    await page.evaluate((value) => {
      for (const a of document.getAnimations())
        if (a.effect?.target?.matches('.inspect-spread-group')) {
          const t = a.effect.getTiming();
          a.currentTime = t.delay + t.duration * value;
        }
      window.dispatchEvent(new Event('resize'));
    }, value);
    await settle();
    return sample('.inspect-spread-group:last-child .inspect-card:last-child', 'fan');
  };
  const fanFirst = await fanSample(0.2),
    fanLater = await fanSample(0.75);
  await page.evaluate(() => {
    window.flashObserver.disconnect();
    for (const a of document.getAnimations())
      if (a.flashControlled) {
        a.playbackRate = 1;
        a.finish();
      }
  });
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.inspect-card canvas')].every(
      (c) => c.dataset.complete === 'true',
    ),
  );
  const front = '.inspect-card:last-child';
  const rect = await page.locator(front).boundingBox(),
    x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y);
  await page.mouse.move(x, y);
  await settle();
  const fixed = await sample(front, 'drag');
  await settle();
  const stationary = await sample(front, 'drag');
  await page.mouse.move(x + 170, y, { steps: 8 });
  await settle();
  const moved = await sample(front, 'drag');
  if (!diagnostic)
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-moved.webp`);
  await page.mouse.move(x, y, { steps: 8 });
  await settle();
  const returned = await sample(front, 'drag');
  if (!diagnostic)
    await sharp(await page.screenshot())
      .resize({ width: 1280 })
      .webp({ quality: 85 })
      .toFile(`${output}/${variant}-returned.webp`);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const report = {
    variant,
    diagnostic,
    entryFirst,
    entryLater,
    fanFirst,
    fanLater,
    fixed,
    stationary,
    moved,
    returned,
    errors,
  };
  await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(fixed.hash, stationary.hash, 'stationary foil changed with time');
  assert.equal(fixed.hash, returned.hash, 'same position did not reproduce the same flash');
  assert.notEqual(fixed.hash, moved.hash, 'drag did not change reflection');
  assert.notEqual(fanFirst.hash, fanLater.hash, 'fan did not change reflection');
  if (diagnostic) {
    for (const item of [moved, fanLater]) {
      assert.ok(item.difference[0] > 0.5, 'main etch flash amplitude was frozen');
      assert.ok(item.difference[2] > 0.5, 'facet flash amplitude was frozen');
      assert.ok(
        item.rising[2] > 0.005 && item.falling[2] > 0.005,
        'facets did not both flare and dim',
      );
    }
  }
  if (!baseline) {
    assert.ok(
      entryLater.copies > entryFirst.copies + 2,
      'moving flight retained only its snapshot',
    );
    assert.notEqual(entryFirst.hash, entryLater.hash, 'entry flight foil was frozen');
    if (diagnostic) assert.ok(entryLater.difference[2] > 0.5, 'entry facet flashes were frozen');
  }
  await page.evaluate(() =>
    window.flashObserver.observe(document.querySelector('#app'), {
      childList: true,
      subtree: true,
    }),
  );
  await page.locator('.inspect-return').click();
  await page.waitForSelector('.inspect-flight-card canvas[data-ready="true"]');
  await progress(0.2);
  const exitFirst = await sample('.inspect-flight-card', 'exit');
  await progress(0.7);
  const exitLater = await sample('.inspect-flight-card', 'exit');
  Object.assign(report, { exitFirst, exitLater });
  await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
  if (!baseline) {
    assert.ok(exitLater.copies > exitFirst.copies + 2, 'return flight retained only its snapshot');
    assert.notEqual(exitFirst.hash, exitLater.hash, 'return flight foil was frozen');
    if (diagnostic) assert.ok(exitLater.difference[2] > 0.5, 'return facet flashes were frozen');
  }
  await page.evaluate(() => {
    window.flashObserver.disconnect();
    for (const a of document.getAnimations())
      if (a.flashControlled) {
        a.playbackRate = 1;
        a.finish();
      }
  });
  await page.waitForFunction(
    () => !document.querySelector('.card-inspector,.inspect-transition-layer'),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/${variant}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      variant,
      diagnostic,
      entryDifference: entryLater.difference,
      fanDifference: fanLater.difference,
      dragDifference: moved.difference,
      exitDifference: exitLater.difference,
      stationary: fixed.hash === stationary.hash,
      returnMatches: fixed.hash === returned.hash,
      errors,
    }),
  );
} finally {
  await app.close();
}
