import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';

const output = process.env.YGO_SERIAL_OUTPUT || 'test-results/hover-serial-20261010';
await fs.mkdir(output, { recursive: true });
const baseline = process.env.YGO_SERIAL_BASELINE
  ? (await fs.readFile(process.env.YGO_SERIAL_BASELINE, 'utf8')).match(
      /const fragmentShader = \/\* glsl \*\/ `([\s\S]*?)`;/,
    )?.[1]
  : null;
const desktopRoot = process.env.YGO_SERIAL_DESKTOP_ROOT;
const env = {
  ...process.env,
  YGO_SMOKE_TEST: '1',
  YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const browser = desktopRoot
  ? await _electron.launch({
      executablePath: path.join(path.resolve(desktopRoot), `${path.basename(desktopRoot)}.exe`),
      env,
    })
  : await chromium.launch({ ...browserOptions, headless: true });
const errors = [];
try {
  const page = desktopRoot ? await browser.firstWindow() : await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  if (desktopRoot) {
    await page.waitForSelector('.home-menu');
    await page.context().setOffline(true);
    await browser.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
  } else await page.goto('http://127.0.0.1:5173');
  const report = await page.evaluate(async (baseline) => {
    const T = await import(new URL('./src/vendor/three.module.js', location.href));
    const { createGameFinishLibrary } = await import(
      new URL('./src/scene/game-card-finishes.js', location.href)
    );
    const { CARD_PRINTS } = await import(new URL('./src/game/card-data.js', location.href));
    const library = createGameFinishLibrary();
    const print = CARD_PRINTS.find((p) => p.rarity === 'GMR');
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(590, 860);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
    const camera = new T.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10.8;
    const scene = new T.Scene(),
      plane = new T.Mesh(new T.PlaneGeometry(2.95, 4.3));
    scene.add(plane);
    const capture = () => {
      renderer.render(scene, camera);
      const gl = renderer.getContext(),
        bytes = new Uint8Array(590 * 860 * 4);
      gl.readPixels(0, 0, 590, 860, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const index = (x, y) => ((859 - y) * 590 + x) * 4;
    let preview;
    const views = [],
      fingerprints = [];
    let outsideDifference = 0,
      quietPixels = 0,
      restoredPlaquePixels = 0;
    for (const serial of [1, 23, 37, 88, 100, null]) {
      const handle = library.acquire({ printId: print.id, ...(serial ? { serial } : {}) });
      await handle.ready;
      const mat = (plane.material = handle.material),
        shader = mat.fragmentShader;
      const stamp = mat.uniforms.serialMap.value.image;
      const stampPixels = serial
        ? stamp.getContext('2d').getImageData(0, 0, stamp.width, stamp.height).data
        : null;
      const stampBounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      if (stampPixels)
        for (let y = 0; y < stamp.height; y++)
          for (let x = 0; x < stamp.width; x++) {
            if (stampPixels[(y * stamp.width + x) * 4] < 128) continue;
            stampBounds.left = Math.min(stampBounds.left, x / 4);
            stampBounds.right = Math.max(stampBounds.right, x / 4);
            stampBounds.top = Math.min(stampBounds.top, y / 4);
            stampBounds.bottom = Math.max(stampBounds.bottom, y / 4);
          }
      for (const exposure of [0.86, 1.12])
        for (const light of [
          [-3, 4.5, 7],
          [5, -2, 7],
          [0, 0, 10],
        ]) {
          renderer.toneMappingExposure = exposure;
          library.updateLight(new T.Vector3(...light));
          const pixels = capture(),
            glyphs = [],
            background = [],
            chroma = [];
          if (serial === 37 && exposure === 1.12 && light[0] === -3)
            preview = renderer.domElement.toDataURL('image/png');
          for (let y = 812; y < 840; y++)
            for (let x = 29; x < 121; x++) {
              const i = index(x, y),
                rgb = [...pixels.subarray(i, i + 3)];
              const m = stampPixels?.[((y - 812) * 4 * stamp.width + (x - 29) * 4) * 4] ?? 0;
              if (m > 220) {
                glyphs.push(Math.max(...rgb));
                chroma.push(Math.max(...rgb) - Math.min(...rgb));
              }
              // Sample the empty plaque margin, away from filtered glyph edges.
              if (m < 10 && x >= 117) background.push(Math.max(...rgb));
            }
          const mean = (a) => a.reduce((s, n) => s + n, 0) / Math.max(a.length, 1);
          views.push({
            serial,
            exposure,
            light,
            stampSize: serial ? [stamp.width, stamp.height] : null,
            stampBounds: serial ? stampBounds : null,
            glyphPixels: glyphs.length,
            glyphMean: mean(glyphs),
            glyphPeak: Math.max(0, ...glyphs),
            glyphChroma: Math.max(0, ...chroma),
            backgroundMean: mean(background),
            backgroundPeak: Math.max(...background),
          });
          if (baseline) {
            mat.fragmentShader = baseline;
            mat.needsUpdate = true;
            const old = capture();
            for (let y = 0; y < 860; y++)
              for (let x = 0; x < 590; x++) {
                const i = index(x, y);
                if (!(x >= 29 && x < 205 && y >= 812 && y < 840)) {
                  for (let c = 0; c < 3; c++)
                    outsideDifference = Math.max(
                      outsideDifference,
                      Math.abs(pixels[i + c] - old[i + c]),
                    );
                } else if (
                  Math.max(...old.subarray(i, i + 3)) > 230 &&
                  Math.max(...pixels.subarray(i, i + 3)) < 210
                )
                  quietPixels++;
                if (
                  x >= 129 &&
                  x < 205 &&
                  y >= 812 &&
                  y < 840 &&
                  Math.max(...old.subarray(i, i + 3)) < 65 &&
                  Math.max(...pixels.subarray(i, i + 3)) > 75
                )
                  restoredPlaquePixels++;
              }
            mat.fragmentShader = shader;
            mat.needsUpdate = true;
          }
          if (exposure === 1.12 && light[0] === -3) {
            let hash = 2166136261;
            for (const v of pixels) hash = Math.imul(hash ^ v, 16777619);
            fingerprints.push({ serial, hash: hash >>> 0 });
          }
        }
      handle.release();
    }
    library.dispose();
    plane.geometry.dispose();
    renderer.dispose();
    return { views, fingerprints, outsideDifference, quietPixels, restoredPlaquePixels, preview };
  }, baseline);
  await sharp(Buffer.from(report.preview.split(',')[1], 'base64'))
    .extract({ left: 20, top: 796, width: 200, height: 52 })
    .resize({ width: 1000 })
    .png()
    .toFile(`${output}/plaque-detail.png`);
  delete report.preview;
  await fs.writeFile(`${output}/numbering-measurements.json`, JSON.stringify(report, null, 2));
  for (const v of report.views) {
    assert.ok(v.backgroundPeak < 65, 'the plaque stays dark under all tested lighting');
    if (v.serial) {
      assert.deepEqual(v.stampSize, [640, 112]);
      assert.ok(
        v.stampBounds.left >= 5 &&
          v.stampBounds.right < 110 &&
          v.stampBounds.top >= 3 &&
          v.stampBounds.bottom < 25,
        'digits fit with left/baseline padding',
      );
      assert.ok(
        v.glyphPixels > 100 && v.glyphMean - v.backgroundMean > 45,
        'small engraving remains readable',
      );
      assert.ok(
        v.glyphPeak < 210 && v.glyphChroma < 45,
        'grey-gold engraving avoids white/rainbow flash',
      );
    }
  }
  assert.equal(
    new Set(report.fingerprints.map((v) => v.hash)).size,
    6,
    'actual 001/023/037/088/100 and blank identities differ',
  );
  if (baseline) {
    assert.equal(
      report.outsideDifference,
      0,
      'all pixels outside the serial plaque remain unchanged',
    );
    assert.ok(report.restoredPlaquePixels > 100, 'the excess black tail is replaced by card print');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/numbering.json`,
    JSON.stringify({ passed: true, ...report, errors }, null, 2),
  );
  console.log(
    'GMR numbering: 36 rendered views, crisp 001/023/037/088/100 and blank, dark plaque, readable grey-gold digits, no white/rainbow flash; surrounding card pixels preserved.',
  );
} finally {
  await browser.close();
}
