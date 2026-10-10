import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions } from './helpers/browser.mjs';

const output = process.env.YGO_MATERIAL_OUTPUT || 'test-results/mirror-first15s';
const baselineSource =
  process.env.YGO_MATERIAL_BASELINE || `${output}/before-v5/material-finishes.js`;
const baseline = process.argv.includes('--baseline');
const label = baseline ? 'before' : 'after';
await fs.mkdir(`${output}/${label}-frames`, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 400));
  });
  if (baseline) {
    const body = await fs.readFile(baselineSource, 'utf8');
    await page.route('**/src/scene/material-finishes.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body }),
    );
  }
  await page.goto('http://127.0.0.1:5173/public/material-review/index.html');
  await page.waitForFunction(() => window.materialReview?.ready);
  const result = await page.evaluate(async () => {
    const THREE = await import('/src/vendor/three.module.js');
    const { createFinishLibrary } = await import('/src/scene/material-finishes.js');
    const library = await createFinishLibrary(materialReview.manifest, location.href);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    const width = 400,
      height = Math.round((width * 86) / 59);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10;
    const scene = new THREE.Scene(),
      samples = [],
      images = [];
    const render = (card, az, enabled) => {
      const u = card.userData.finish.uniforms,
        a = (az * Math.PI) / 180,
        e = (15 * Math.PI) / 180;
      u.lightPosition.value.set(
        Math.sin(a) * Math.cos(e) * 10,
        Math.sin(e) * 10,
        Math.cos(a) * Math.cos(e) * 10,
      );
      u.foilEnabled.value = enabled;
      renderer.render(scene, camera);
      const pixels = new Uint8Array(width * height * 4);
      renderer
        .getContext()
        .readPixels(
          0,
          0,
          width,
          height,
          renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE,
          pixels,
        );
      return pixels;
    };
    for (const id of ['SER', 'PSER', 'GMR', 'PSER-OF']) {
      const card = library.create(id);
      scene.add(card);
      // The finish PNG alpha stores raised ink; it is not transparency.
      // Read its red channel through WebGL, avoiding canvas premultiplication.
      const front = card.getObjectByName('printed-finish'),
        originalMaterial = front.material;
      front.material = new THREE.ShaderMaterial({
        uniforms: { coverage: { value: originalMaterial.uniforms.finishMap.value } },
        vertexShader:
          'varying vec2 sampleUv; void main(){sampleUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'uniform sampler2D coverage; varying vec2 sampleUv; void main(){gl_FragColor=vec4(vec3(texture2D(coverage,sampleUv).r),1.);}',
      });
      renderer.render(scene, camera);
      const coverage = new Uint8Array(width * height * 4),
        gl = renderer.getContext();
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, coverage);
      front.material.dispose();
      front.material = originalMaterial;
      const frames = [];
      let previous = null,
        maximumSwitch = 0,
        maximumChromaticSwitch = 0;
      for (let az = -45; az <= 45; az += 3) {
        const off = render(card, az, 0),
          on = render(card, az, 1);
        let bright = 0,
          chromatic = 0,
          neutral = 0,
          chromaticSwitched = 0,
          eligible = 0,
          switched = 0,
          totalGain = 0;
        const luminance = (bytes, i) =>
          bytes[i] * 0.2126 + bytes[i + 1] * 0.7152 + bytes[i + 2] * 0.0722;
        for (let y = 20; y < height - 20; y++)
          for (let x = 18; x < width - 18; x++) {
            const i = (y * width + x) * 4,
              base = luminance(off, i),
              lit = luminance(on, i);
            if (base < 12 || base > 180 || coverage[i] < 200) continue;
            eligible++;
            totalGain += lit - base;
            const maximum = Math.max(on[i], on[i + 1], on[i + 2]);
            const minimum = Math.min(on[i], on[i + 1], on[i + 2]);
            const gain = Math.max(on[i] - off[i], on[i + 1] - off[i + 1], on[i + 2] - off[i + 2]);
            // Red/blue diffraction can be intense at low photopic luminance.
            // Count newly reflected colour, not the already coloured print.
            if (maximum >= 225 && maximum - minimum >= 50 && gain >= 55) {
              chromatic++;
              if (
                previous &&
                Math.max(
                  on[i] - previous[i],
                  on[i + 1] - previous[i + 1],
                  on[i + 2] - previous[i + 2],
                ) >= 55
              )
                chromaticSwitched++;
            }
            if (minimum >= 225 && maximum - minimum < 25 && lit - base >= 55) neutral++;
            if (lit >= 240 && lit - base >= 70) {
              bright++;
              if (previous && luminance(previous, i) < 185) switched++;
            }
          }
        frames.push({
          az,
          brightFraction: bright / eligible,
          chromaticFlashFraction: chromatic / eligible,
          neutralFlashFraction: neutral / eligible,
          chromaticSwitchFraction: chromaticSwitched / eligible,
          switchFraction: switched / eligible,
          meanGain: totalGain / eligible,
        });
        maximumSwitch = Math.max(maximumSwitch, switched / eligible);
        maximumChromaticSwitch = Math.max(maximumChromaticSwitch, chromaticSwitched / eligible);
        if (id === 'PSER' || (id === 'GMR' && (az === -9 || az === 27)))
          images.push({
            name: `${id}-${az + 45}`,
            data: renderer.domElement.toDataURL('image/png').split(',')[1],
          });
        previous = on;
      }
      const peak = frames.reduce((a, b) => (a.brightFraction > b.brightFraction ? a : b));
      const chromaticPeak = frames.reduce((a, b) =>
        a.chromaticFlashFraction > b.chromaticFlashFraction ? a : b,
      );
      samples.push({ id, peak, chromaticPeak, maximumSwitch, maximumChromaticSwitch, frames });
      scene.remove(card);
    }
    library.dispose();
    renderer.dispose();
    return { width, height, samples, images };
  });
  for (const image of result.images)
    await fs.writeFile(
      `${output}/${label}-frames/${image.name}.png`,
      Buffer.from(image.data, 'base64'),
    );
  delete result.images;
  result.errors = errors;
  await fs.writeFile(`${output}/${label}-flash.json`, JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  if (!baseline) {
    for (const sample of result.samples) {
      // The reference study calls for narrow saturated flashes, not more
      // white coverage than v3. These are visibility/legibility bounds, not
      // a claim to reproduce the unknown lighting of the recorded card.
      // Reference-aligned main-band spacing is now one third of card width.
      // Keep a visibility floor appropriate to sparse bright orders; increasing
      // their density merely to satisfy the earlier area count is incorrect.
      assert.ok(
        sample.chromaticPeak.chromaticFlashFraction > 0.02,
        `${sample.id}: saturated glints must be visible on the real print at 400px`,
      );
      // Rapid 3-degree switching was a v8/v9 aesthetic target. The fixed
      // film now fades through intermediate states; sub-degree continuity
      // and visible fading are checked in material-optics. Keep this metric
      // as a diagnostic, rather than rewarding abrupt changes.
      assert.ok(
        sample.frames.every(
          (f) =>
            f.neutralFlashFraction < 0.005 && f.meanGain < 24 && f.chromaticFlashFraction < 0.22,
        ),
        `${sample.id}: flashes must remain local and preserve the printed artwork`,
      );
      assert.ok(
        sample.frames.filter((f) => f.chromaticFlashFraction > 0.012).length >= 20,
        `${sample.id}: foil must be visible across the light sweep, not just at one ideal angle`,
      );
    }
  }
  const picks = result.samples
    .find((s) => s.id === 'PSER')
    .frames.slice()
    .sort((a, b) => b.chromaticFlashFraction - a.chromaticFlashFraction);
  const selected = [picks.at(-1), picks[0]];
  const inputs = await Promise.all(
    selected.map(async (s, i) => ({
      input: await sharp(`${output}/${label}-frames/PSER-${s.az + 45}.png`)
        .resize(400, result.height)
        .png()
        .toBuffer(),
      left: i * 400,
      top: 0,
    })),
  );
  await sharp({ create: { width: 800, height: result.height, channels: 3, background: '#050914' } })
    .composite(inputs)
    .jpeg({ quality: 90 })
    .toFile(`${output}/${label}-flash-pair.jpg`);
  console.log(
    JSON.stringify({
      version: label,
      samples: result.samples.map((s) => ({
        id: s.id,
        peakBrightFraction: s.peak.brightFraction,
        peakChromaticFraction: s.chromaticPeak.chromaticFlashFraction,
        peakNeutralFraction: Math.max(...s.frames.map((f) => f.neutralFlashFraction)),
        peakAngle: s.peak.az,
        changedAt3Degrees: s.maximumSwitch,
        colourChangedAt3Degrees: s.maximumChromaticSwitch,
      })),
      errors,
    }),
  );
} finally {
  await browser.close();
}
