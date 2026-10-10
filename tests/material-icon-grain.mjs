import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { browserOptions } from './helpers/browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const dir = 'test-results/mirror-v18-icon-diamond';
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/public/material-review/index.html');
  await page.waitForFunction(() => window.materialReview?.ready);
  const result = await page.evaluate(async () => {
    const THREE = await import('/src/vendor/three.module.js');
    const { createFinishLibrary } = await import('/src/scene/material-finishes.js');
    const entries = materialReview.manifest;
    const library = await createFinishLibrary(entries, location.href);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(590, 860);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10;
    const scene = new THREE.Scene();
    function capture(card, az, el) {
      const a = (az * Math.PI) / 180,
        e = (el * Math.PI) / 180;
      card.userData.finish.uniforms.lightPosition.value.set(
        Math.sin(a) * Math.cos(e) * 10,
        Math.sin(e) * 10,
        Math.cos(a) * Math.cos(e) * 10,
      );
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png').split(',')[1];
    }
    const actual = [];
    for (const id of ['SR', 'SER', 'SER-monster', 'PSER', 'PSER-monster', 'GMR', 'PSER-OF-trap']) {
      const card = library.create(id);
      scene.add(card);
      card.userData.finish.uniforms.diffuseIntensity.value = 0.25;
      actual.push({ id, a: capture(card, -25, 30), b: capture(card, 25, -15) });
      scene.remove(card);
    }
    const texture = (bytes, srgb = false) => {
      const t = new THREE.DataTexture(new Uint8Array(bytes), 1, 1, THREE.RGBAFormat);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    // Neutral ink and no face/name foil isolate icon geometry from artwork,
    // the main bright bands and the existing SER/PSER/GMR finish differences.
    const card = library.create('PSER-monster'),
      u = card.userData.finish.uniforms;
    scene.add(card);
    const flat = texture([125, 125, 125, 255], true),
      empty = texture([0, 0, 0, 0]),
      normal = texture([128, 128, 255, 255]);
    u.printMap.value = flat;
    u.finishMap.value = empty;
    u.borderMap.value = empty;
    u.reliefMap.value = normal;
    u.diffuseIntensity.value = 0.25;
    const isolated = [];
    for (const kind of [0, 1, 2, 3, 4, 5, 6]) {
      u.kind.value = kind;
      const a = capture(card, -25, 30),
        b = capture(card, 25, -15),
        again = capture(card, -25, 30);
      u.foilEnabled.value = 0;
      const off = capture(card, -25, 30);
      u.foilEnabled.value = 1;
      isolated.push({ kind, a, b, again, off });
    }
    library.dispose();
    [flat, empty, normal].forEach((t) => t.dispose());
    renderer.dispose();
    return { actual, isolated, accent: entries.find((s) => s.id === 'PSER-monster').accent };
  });
  const raw = async (data) => sharp(Buffer.from(data, 'base64')).removeAlpha().raw().toBuffer();
  const accent = await sharp(`public/material-review/${result.accent}`)
    .greyscale()
    .raw()
    .toBuffer();
  const edgeAllowance = await sharp(`public/material-review/${result.accent}`)
    .greyscale()
    .dilate(2)
    .raw()
    .toBuffer();
  const smooth = await raw(result.isolated[0].a),
    offBase = await raw(result.isolated[0].off);
  const report = [];
  for (const entry of result.isolated) {
    const a = await raw(entry.a),
      b = await raw(entry.b),
      off = await raw(entry.off);
    assert.deepEqual(a, await raw(entry.again), 'Fixed light must reproduce identical icon facets');
    assert.deepEqual(off, offBase, 'Disabling foil must remove both smooth and diamond layers');
    let count = 0,
      difference = 0,
      variance = 0,
      outside = 0,
      changed = 0;
    for (let p = 0; p < 590 * 860; p++) {
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(a[p * 3 + c] - smooth[p * 3 + c])));
      if (accent[p] > 200) {
        count++;
        difference += d;
        variance += d * d;
        if (d > 12 && Math.max(...[0, 1, 2].map((c) => Math.abs(a[p * 3 + c] - b[p * 3 + c]))) > 12)
          changed++;
      } else if (
        edgeAllowance[p] === 0 &&
        p % 590 > 28 &&
        p % 590 < 560 &&
        p >= 590 * 25 &&
        p < 590 * 150
      )
        outside = Math.max(outside, d);
    }
    const mean = difference / count,
      std = Math.sqrt(variance / count - mean * mean);
    if ([2, 5, 6].includes(entry.kind)) {
      assert.ok(
        mean > 2 && std > 4,
        'Mirror icon film needs spatially distinct facets over smooth foil',
      );
      assert.ok(changed / count > 0.04, 'Distinct diamond cuts must respond to light direction');
      assert.ok(outside <= 2, 'Diamond reflections must stay inside icon masks');
    } else
      assert.deepEqual(a, smooth, 'Other finishes must retain their original smooth icon foil');
    report.push({ kind: entry.kind, mean, std, changedFraction: changed / count, outside });
  }
  for (const entry of result.actual) {
    const tiles = await Promise.all(
      [entry.a, entry.b].map((data) =>
        sharp(Buffer.from(data, 'base64'))
          .extract({ left: 30, top: 30, width: 530, height: 120 })
          .png()
          .toBuffer(),
      ),
    );
    await sharp({ create: { width: 1060, height: 120, channels: 3, background: '#132030' } })
      .composite(tiles.map((input, i) => ({ input, left: i * 530, top: 0 })))
      .jpeg({ quality: 94 })
      .toFile(`${dir}/${entry.id}-icons.jpg`);
    if (entry.id === 'PSER-monster')
      await sharp(Buffer.from(entry.a, 'base64')).jpeg({ quality: 92 }).toFile(`${dir}/card.jpg`);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${dir}/icon-grain.json`, JSON.stringify({ passed: true, report }, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'SER/PSER/GMR diamond facets',
        'smooth base retained',
        'unchanged other rarities',
        'icon mask boundaries',
        'deterministic light response',
        'foil switch',
      ],
    }),
  );
} finally {
  await browser.close();
}
