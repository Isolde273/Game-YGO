import { browserOptions } from './helpers/browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const dir = 'test-results/foil-template-update';
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto('http://127.0.0.1:5173/public/material-review/index.html');
  await page.waitForFunction(() => window.materialReview?.ready);
  const captures = await page.evaluate(async () => {
    const THREE = await import('/src/vendor/three.module.js');
    const { createFinishLibrary } = await import('/src/scene/material-finishes.js');
    const samples = materialReview.manifest;
    const library = await createFinishLibrary(samples, location.href);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(590, 860);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10;
    const scene = new THREE.Scene(),
      results = [];
    for (const sample of samples) {
      const card = library.create(sample.id),
        u = card.userData.finish.uniforms;
      scene.add(card);
      u.diffuseIntensity.value = 0.25;
      function capture(az, el, foil) {
        const a = (az * Math.PI) / 180,
          e = (el * Math.PI) / 180;
        u.lightPosition.value.set(
          Math.sin(a) * Math.cos(e) * 10,
          Math.sin(e) * 10,
          Math.cos(a) * Math.cos(e) * 10,
        );
        u.foilEnabled.value = foil;
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png').split(',')[1];
      }
      results.push({
        sample,
        a: capture(-25, 30, 1),
        b: capture(35, -20, 1),
        off: capture(-25, 30, 0),
      });
      scene.remove(card);
    }
    library.dispose();
    renderer.dispose();
    return results;
  });
  const report = [];
  for (const { sample, a, b, off } of captures) {
    const raw = async (value) => sharp(Buffer.from(value, 'base64')).removeAlpha().raw().toBuffer();
    const [first, second, plain] = await Promise.all([raw(a), raw(b), raw(off)]);
    const mask = await sharp(`public/material-review/${sample.mask}`).raw().toBuffer();
    const accent = await sharp(`public/material-review/${sample.accent}`)
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer();
    const regions = { name: [], icons: [] };
    for (let i = 0; i < 590 * 860; i++) {
      if (mask[i * 4 + 2] > 128) regions.name.push(i);
      if (accent[i] > 128) regions.icons.push(i);
    }
    if (sample.style === 'UR-OF') {
      regions.effect = [];
      regions.edge = [];
      for (let y = 670; y < 800; y++)
        for (let x = 45; x < 545; x++) regions.effect.push(y * 590 + x);
      for (let y = 100; y < 600; y++) for (let x = 2; x < 12; x++) regions.edge.push(y * 590 + x);
    }
    const measurements = {};
    for (const [name, pixels] of Object.entries(regions)) {
      let foil = 0,
        angle = 0;
      for (const p of pixels)
        for (let c = 0; c < 3; c++) {
          foil += Math.abs(first[p * 3 + c] - plain[p * 3 + c]);
          angle += Math.abs(first[p * 3 + c] - second[p * 3 + c]);
        }
      foil /= pixels.length * 3;
      angle /= pixels.length * 3;
      assert.ok(
        foil > (name === 'edge' ? 0.1 : 1),
        `${sample.id} ${name} missing foil response: ${foil}`,
      );
      assert.ok(angle > 1, `${sample.id} ${name} does not respond to lighting: ${angle}`);
      measurements[name] = { foil, angle };
    }
    report.push({ id: sample.id, measurements });
    if (['UR', 'SR', 'UR-trap', 'UR-OF-spell', 'UR-OF-trap', 'PSER'].includes(sample.id)) {
      await sharp(Buffer.from(a, 'base64'))
        .jpeg({ quality: 90 })
        .toFile(`${dir}/${sample.id}-final.jpg`);
      const crops = await Promise.all(
        [a, b].map((value) =>
          sharp(Buffer.from(value, 'base64'))
            .extract({ left: 28, top: 30, width: 530, height: 120 })
            .png()
            .toBuffer(),
        ),
      );
      await sharp({ create: { width: 1060, height: 120, channels: 3, background: '#102035' } })
        .composite(crops.map((input, i) => ({ input, left: i * 530, top: 0 })))
        .jpeg({ quality: 92 })
        .toFile(`${dir}/${sample.id}-headers.jpg`);
    }
  }
  await fs.writeFile(
    `${dir}/details.json`,
    JSON.stringify({ passed: true, samples: report }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      samples: report.length,
      checks: ['rendered name and icon hue response', 'UR-OF edge and effect text foil'],
    }),
  );
} finally {
  await browser.close();
}
