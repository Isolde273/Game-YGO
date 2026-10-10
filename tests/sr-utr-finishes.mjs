import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import { addCards } from '../src/game/model.js';

const output = 'test-results/sr-utr-finishes-20261010';
await fs.mkdir(output, { recursive: true });
const baselineFile =
  process.env.YGO_FINISH_TWEAK_BASELINE ||
  'D:/Game-YGO-backups/20261010-sr-utr-finishes/src/scene/material-finishes.js';
const baseline = (await fs.readFile(baselineFile, 'utf8')).match(
  /const fragmentShader = \/\* glsl \*\/ `([\s\S]*?)`;/,
)[1];
const state = freshState();
state.settings = { ...state.settings, motion: false, music: false, sound: false };
addCards(state, 'LOCR-JP039-UL', 2);
const desktop = process.env.YGO_FINISH_TWEAK_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const errors = [];
let app;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(output, `profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      w.focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 250));
  });
  await page.addInitScript(
    (state) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  const result = await page.evaluate(
    async ({ baseline }) => {
      const THREE = await import(new URL('./src/vendor/three.module.js', location.href));
      const { CARD_PRINTS, getCardView } = await import(
        new URL('./src/game/card-data.js', location.href)
      );
      const { createGameFinishLibrary } = await import(
        new URL('./src/scene/game-card-finishes.js', location.href)
      );
      const library = createGameFinishLibrary();
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      const width = 295,
        height = 430;
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      const scene = new THREE.Scene(),
        camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
      camera.position.z = 10;
      const geometry = new THREE.PlaneGeometry(2.95, 4.3),
        face = new THREE.Mesh(geometry);
      scene.add(face);
      const draw = (material, az, foil = 1) => {
        material.uniforms.lightPosition.value.set(
          Math.sin((az * Math.PI) / 180) * 9,
          2,
          Math.cos((az * Math.PI) / 180) * 9,
        );
        material.uniforms.foilEnabled.value = foil;
        face.material = material;
        renderer.render(scene, camera);
        const pixels = new Uint8Array(width * height * 4),
          gl = renderer.getContext();
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const inside = (x, y, r, pad = 0) =>
        x > r[0] + pad && x < r[2] - pad && y > r[1] + pad && y < r[3] - pad;
      const difference = (a, b, region) => {
        let total = 0,
          count = 0,
          max = 0;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const px = (x + 0.5) * 2,
              py = 860 - (y + 0.5) * 2;
            if (!region(px, py)) continue;
            const i = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(a[i + c] - b[i + c]);
              total += d;
              max = Math.max(max, d);
              count++;
            }
          }
        return { mean: total / Math.max(1, count), max, count };
      };
      const image = (data) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const flipped = new Uint8ClampedArray(data.length);
        for (let y = 0; y < height; y++)
          flipped.set(
            data.subarray(y * width * 4, (y + 1) * width * 4),
            (height - 1 - y) * width * 4,
          );
        canvas.getContext('2d').putImageData(new ImageData(flipped, width, height), 0, 0);
        return canvas.toDataURL('image/png');
      };
      const poisonFilm = (shader) => {
        for (const signature of ['vec4 secretFilm(', 'vec4 iconDiamondFilm(', 'float cellSeed(']) {
          const start = shader.indexOf(signature),
            open = shader.indexOf('{', start);
          let depth = 1,
            end = open + 1;
          for (; depth && end < shader.length; end++) {
            if (shader[end] === '{') depth++;
            if (shader[end] === '}') depth--;
          }
          shader =
            shader.slice(0, open + 1) +
            (signature.startsWith('float') ? 'return .99;' : 'return vec4(1000.);') +
            shader.slice(end - 1);
        }
        return shader;
      };
      const results = { sr: [], utr: [], unchanged: [], images: [] };
      const selected = [
        ...CARD_PRINTS.filter((p) => p.rarity === 'SR' || p.rarity === 'UL'),
        ...['UR', 'SER', 'CR', 'PSER', 'PSER-OF', 'GMR'].map((style) =>
          CARD_PRINTS.find((p) => p.style === style),
        ),
      ];
      for (const print of selected) {
        const handle = library.acquire({ printId: print.id });
        await handle.ready;
        const material = handle.material,
          before = material.clone();
        before.fragmentShader = baseline;
        before.needsUpdate = true;
        const data = getCardView(print.id),
          art = data.calibration.artWindow ?? data.calibration.art;
        if (print.rarity === 'SR') {
          let outside = 0,
            artMean = 0;
          for (const az of [-40, -15, 0, 20, 45]) {
            const on = draw(material, az),
              off = draw(material, az, 0);
            outside = Math.max(
              outside,
              difference(
                on,
                off,
                (x, y) => !inside(x, y, [art[0] - 3, art[1] - 3, art[2] + 3, art[3] + 3]),
              ).max,
            );
            artMean = Math.max(artMean, difference(on, off, (x, y) => inside(x, y, art, 3)).mean);
          }
          results.sr.push({ id: print.id, outsideFoilMax: outside, artFoilMean: artMean });
          if (print.id === 'LOCR-JP039-SR')
            results.images.push({ name: 'SR', data: image(draw(material, 0)) });
        } else if (print.rarity === 'UL') {
          const frame = data.calibration.frame;
          let outerChange = 0,
            innerChange = 0,
            bodyMax = 0,
            facetMax = 0;
          const poisoned = material.clone();
          poisoned.fragmentShader = poisonFilm(material.fragmentShader);
          poisoned.needsUpdate = true;
          for (const az of [-30, 0, 30]) {
            const current = draw(material, az),
              old = draw(before, az);
            outerChange = Math.max(
              outerChange,
              difference(current, old, (x, y) => Math.min(x, 590 - x, y, 860 - y) < 12).mean,
            );
            innerChange = Math.max(
              innerChange,
              difference(
                current,
                old,
                (x, y) =>
                  inside(x, y, frame, 2) &&
                  !inside(x, y, [art[0] - 2, art[1] - 2, art[2] + 2, art[3] + 2]),
              ).mean,
            );
            bodyMax = Math.max(
              bodyMax,
              difference(
                current,
                old,
                (x, y) =>
                  inside(x, y, [20, 20, 570, 840]) &&
                  (!inside(x, y, [frame[0] - 2, frame[1] - 2, frame[2] + 2, frame[3] + 2]) ||
                    inside(x, y, art, 3)),
              ).max,
            );
            facetMax = Math.max(facetMax, difference(current, draw(poisoned, az), () => true).max);
          }
          results.utr.push({
            id: print.id,
            outerChange,
            innerChange,
            bodyMax,
            facetMax,
            label: data.label,
          });
          if (print.id === 'LOCR-JP039-UL') {
            results.images.push(
              { name: 'UTR-before', data: image(draw(before, 0)) },
              { name: 'UTR-after', data: image(draw(material, 0)) },
              { name: 'UTR-light', data: image(draw(material, 30)) },
            );
          }
          poisoned.dispose();
        } else {
          let max = 0,
            mean = 0;
          for (const az of [-30, 0, 30]) {
            const d = difference(draw(material, az), draw(before, az), () => true);
            max = Math.max(max, d.max);
            mean = Math.max(mean, d.mean);
          }
          results.unchanged.push({ style: print.style, max, mean });
        }
        before.dispose();
        handle.release();
      }
      geometry.dispose();
      library.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      return results;
    },
    { baseline },
  );
  const images = result.images;
  delete result.images;
  await fs.writeFile(`${output}/${prefix}-pixels.json`, JSON.stringify(result, null, 2));
  for (const row of result.sr) {
    assert.equal(row.outsideFoilMax, 0, `${row.id}: SR outside picture flashes`);
    assert.ok(row.artFoilMean > 0.2, `${row.id}: picture lost foil`);
  }
  for (const row of result.utr) {
    assert.ok(row.outerChange > 1 && row.innerChange > 1, `${row.id}: rims absent`);
    assert.ok(row.bodyMax <= 1, `${row.id}: original body changed ${row.bodyMax}`);
    assert.equal(row.facetMax, 0, `${row.id}: diamond film in UTR`);
    assert.equal(row.label, 'UTR');
  }
  for (const row of result.unchanged)
    assert.ok(
      row.max <= 1 && row.mean < 0.01,
      `${row.style}: unrelated finish changed ${JSON.stringify(row)}`,
    );
  await navigatePage(page, 'warehouse');
  assert.equal(await page.locator('[data-filter="UL"] b').textContent(), 'UTR');
  assert.ok((await page.locator('.warehouse-card').first().textContent()).includes('UTR'));
  await page.locator('[data-action="warehouse-mode"][data-mode="sales"]').click();
  assert.equal(await page.locator('#sale-rarity option[value="UL"]').textContent(), 'UTR');
  await navigatePage(page, 'shop');
  await openPhoneApp(page, 'jhs');
  assert.equal(await page.locator('#market-rarity option[value="UL"]').textContent(), 'UTR');
  await page.locator('#market-rarity').selectOption('UL');
  assert.equal(await page.locator('[data-market-count]').textContent(), '21');
  assert.ok(
    (await page.locator('.market-rarity').allTextContents()).every(
      (text) => text.includes('UTR') && !text.includes('UL'),
    ),
  );
  assert.deepEqual(errors, []);
  const rawImages = await Promise.all(
    images.map(({ name, data }) =>
      sharp(Buffer.from(data.split(',')[1], 'base64'))
        .resize({ width: 270 })
        .png()
        .toBuffer()
        .then((input) => ({ name, input })),
    ),
  );
  const tiles = await Promise.all(
    rawImages.map(async ({ name, input }, i) => ({
      input: await sharp(input)
        .extend({ top: 24, bottom: 0, left: 0, right: 0, background: '#09152b' })
        .composite([
          {
            input: Buffer.from(
              `<svg width="270" height="24"><text x="8" y="17" fill="#fff" font-family="Arial" font-size="13">${name}</text></svg>`,
            ),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer(),
      left: i * 270,
      top: 0,
    })),
  );
  await sharp({ create: { width: 1080, height: 418, channels: 3, background: '#09152b' } })
    .composite(tiles)
    .jpeg({ quality: 88 })
    .toFile(`${output}/${prefix}-comparison.jpg`);
  await fs.writeFile(
    `${output}/${prefix}-report.json`,
    JSON.stringify(
      {
        passed: true,
        sr: result.sr.length,
        utr: result.utr.length,
        unrelatedFinishes: result.unchanged,
        labels: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `${prefix}: ${result.sr.length} SR picture-only, ${result.utr.length} UTR rims/relief/no diamonds, other finishes and labels passed.`,
  );
} finally {
  await app?.close();
}
