import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions } from './helpers/browser.mjs';

const output = process.env.YGO_MIRROR_RIDGES_OUTPUT || 'test-results/no-aux-audio-20261010/ridges';
const baselineModule = process.env.YGO_MIRROR_BASELINE
  ? await fs.readFile(process.env.YGO_MIRROR_BASELINE, 'utf8')
  : null;
const baselineSource = baselineModule?.match(
  /const fragmentShader = \/\* glsl \*\/ `([\s\S]*?)`;/,
)?.[1];
if (baselineModule) assert.ok(baselineSource, 'Supplied baseline must contain the previous shader');
const responseBaseline = process.env.YGO_MIRROR_RESPONSE_BASELINE
  ? (await fs.readFile(process.env.YGO_MIRROR_RESPONSE_BASELINE, 'utf8')).match(
      /const fragmentShader = \/\* glsl \*\/ `([\s\S]*?)`;/,
    )?.[1]
  : null;
if (process.env.YGO_MIRROR_RESPONSE_BASELINE)
  assert.ok(responseBaseline, 'Response baseline must contain a shader');
const speedFactor = Number(process.env.YGO_MIRROR_SPEED_FACTOR || 2);
const widthFactor = process.env.YGO_MIRROR_WIDTH_FACTOR
  ? Number(process.env.YGO_MIRROR_WIDTH_FACTOR)
  : null;
assert.ok(
  Number.isFinite(speedFactor) && speedFactor > 0,
  'Expected speed factor must be positive',
);
if (widthFactor !== null) {
  assert.ok(baselineSource, 'Width comparison requires a baseline shader');
  assert.ok(
    Number.isFinite(widthFactor) && widthFactor > 0,
    'Expected width factor must be positive',
  );
}
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300));
  });
  await page.goto('http://127.0.0.1:5173/public/material-review/index.html');
  await page.waitForFunction(() => window.materialReview?.ready);
  const result = await page.evaluate(
    async ({ baselineSource, responseBaseline, widthFactor }) => {
      const THREE = await import('/src/vendor/three.module.js');
      const { createFinishLibrary } = await import('/src/scene/material-finishes.js');
      const entry = materialReview.manifest.find((sample) => sample.id === 'PSER');
      const library = await createFinishLibrary([{ ...entry, id: 'film', kind: 6 }], location.href);
      const card = library.create('film');
      const material = card.userData.finish;
      const original = material.fragmentShader;
      if (
        /auxiliary|companion|spanningDiffractionLine|verticalMiddle|horizontalMiddle|verticalPartial|horizontalPartial/.test(
          original,
        )
      )
        throw new Error('Auxiliary shader geometry, activation and reflection must be removed');
      material.uniforms.ridgeTestAngles = { value: new THREE.Vector2() };
      material.uniforms.ridgeTestLambert = { value: 1 };
      material.uniforms.ridgeTestUv = { value: new THREE.Vector2(0.5, 0.5) };
      material.uniforms.ridgeUseTestUv = { value: 0 };
      const width = 590,
        height = 860;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(width, height);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
      camera.position.z = 10;
      const scene = new THREE.Scene();
      scene.add(card);
      const pixels = () => {
        renderer.render(scene, camera);
        const renderWidth = renderer.domElement.width,
          renderHeight = renderer.domElement.height;
        const bytes = new Uint8Array(renderWidth * renderHeight * 4);
        const gl = renderer.getContext();
        gl.readPixels(0, 0, renderWidth, renderHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return bytes;
      };
      // Read the actual shader's die masks, bypassing ink and tone mapping.
      // This measures visible line count/endpoints without assuming their centres.
      function instrument(expression, az = 0, el = 0, source = original, lambert = 1, uv = null) {
        const channels = ['main-response', 'width-state'].includes(expression);
        const shader = source.replace(
          /return vec4\(facetSpectrum\*intensity[^\n]+/,
          expression === 'main-response'
            ? 'return vec4(response*mainCrest/1.60*ridgeFlash/(ridge*mix(.30,1.,rowResolved)),crossResponse*crossCrest/1.45*flash/(grain*mix(.30,1.,resolved)),0.,1.);'
            : expression === 'width-state'
              ? 'return vec4(edgeWidth,lightWidth,crossLightWidth,1.);'
              : `return vec4(vec3(${expression}),0.);`,
        );
        const x = Math.sin((az * Math.PI) / 180) * Math.cos((el * Math.PI) / 180);
        const y = Math.sin((el * Math.PI) / 180);
        material.uniforms.ridgeTestAngles.value.set(x, y);
        material.uniforms.ridgeTestLambert.value = lambert;
        material.uniforms.ridgeUseTestUv.value = uv ? 1 : 0;
        if (uv) material.uniforms.ridgeTestUv.value.set(...uv);
        const fragmentShader =
          shader.slice(0, shader.indexOf('\nvoid main(){')) +
          '\nuniform vec2 ridgeTestAngles;\nuniform float ridgeTestLambert;\nuniform vec2 ridgeTestUv;\nuniform float ridgeUseTestUv;\nvoid main(){vec2 probeUv=mix(vUv,ridgeTestUv,ridgeUseTestUv);gl_FragColor=' +
          (channels
            ? 'secretFilm(probeUv,ridgeTestAngles,ridgeTestAngles,1.,ridgeTestLambert,1.);'
            : 'vec4(secretFilm(probeUv,ridgeTestAngles,ridgeTestAngles,1.,ridgeTestLambert,1.).rgb,1.);') +
          (expression.includes('crossResponse')
            ? '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n'
            : '') +
          '}';
        if (material.fragmentShader !== fragmentShader) {
          material.fragmentShader = fragmentShader;
          material.needsUpdate = true;
        }
        return pixels();
      }
      function components(bytes, axis) {
        const across = axis === 'vertical' ? width : height;
        const along = axis === 'vertical' ? height : width;
        const profile = new Array(across).fill(0);
        const at = (a, b) => bytes[(axis === 'vertical' ? b * width + a : a * width + b) * 4];
        for (let a = 0; a < across; a++)
          for (let b = 0; b < along; b++) profile[a] += at(a, b) / along;
        const groups = [];
        let start = null;
        for (let a = 0; a <= across; a++) {
          if (a < across && profile[a] > 12) {
            if (start === null) start = a;
          } else if (start !== null) {
            const occupied = [],
              widths = [];
            for (let b = 0; b < along; b++) {
              let lo = across,
                hi = -1,
                peak = 0;
              for (let j = start; j < a; j++) peak = Math.max(peak, at(j, b));
              for (let j = start; j < a; j++) {
                if (at(j, b) > Math.max(32, peak * 0.5)) {
                  lo = Math.min(lo, j);
                  hi = j;
                }
              }
              if (hi >= lo) {
                occupied.push(b);
                widths.push(hi - lo + 1);
              }
            }
            widths.sort((a, b) => a - b);
            groups.push({
              centre: (start + a - 1) / 2 / across,
              start: occupied[0] / along,
              end: occupied.at(-1) / along,
              length: occupied.length / along,
              medianWidth: widths[Math.floor(widths.length / 2)],
            });
            start = null;
          }
        }
        return groups;
      }
      const verticalPixels = instrument('stamped');
      const horizontalPixels = instrument('crossStamped');
      const mainVertical = components(
        instrument('diffractionLine(carrier,tilt,orderWidth)'),
        'vertical',
      );
      const mainHorizontal = components(
        instrument('diffractionLine(crossing,crossTilt,crossWidth)'),
        'horizontal',
      );
      const vertical = components(verticalPixels, 'vertical');
      const horizontal = components(horizontalPixels, 'horizontal');
      // Scan actual horizontal-only radiance over both light axes. The dimmest
      // view must retain all main orders, with measurable coloured etch contrast.
      const visibility = [];
      for (const az of [-60, -30, 0, 30, 60])
        for (let el = -60; el <= 60; el += 10) {
          const bytes = instrument(
            'diffractionLine(crossing,crossTilt,crossWidth)*crossResponse*crossDepth*(.65+.35*group)*flash*125.*crossCrest',
            az,
            el,
          );
          const mask = instrument('diffractionLine(crossing,crossTilt,crossWidth)', az, el);
          const strengths = [];
          // A narrowed edge order can be mostly clipped off the card. Check
          // persistent radiance on fully visible orders, not its cropped tail.
          const bands = components(mask, 'horizontal').filter(
            (band) => band.centre > 0.03 && band.centre < 0.97,
          );
          for (const band of bands) {
            let sum = 0,
              weight = 0;
            const centre = Math.round(band.centre * height);
            for (
              let row = Math.max(0, centre - 18);
              row <= Math.min(height - 1, centre + 18);
              row++
            ) {
              for (let column = 0; column < width; column++) {
                const i = (row * width + column) * 4;
                if (mask[i] > 32) {
                  sum += bytes[i];
                  weight++;
                }
              }
            }
            strengths.push(sum / weight);
          }
          visibility.push({
            az,
            el,
            measuredBands: strengths.length,
            bands: bands.map((band, index) => ({
              centre: band.centre,
              strength: strengths[index],
            })),
            mean: strengths.reduce((sum, n) => sum + n, 0) / strengths.length,
            minimum: Math.min(...strengths),
          });
        }
      const image = (bytes) => {
        // readPixels starts at the lower edge; flip for the saved visual.
        const flipped = new Uint8Array(bytes.length);
        for (let y = 0; y < height; y++)
          flipped.set(
            bytes.subarray(y * width * 4, (y + 1) * width * 4),
            (height - y - 1) * width * 4,
          );
        return [...flipped];
      };
      const images = { vertical: image(verticalPixels), horizontal: image(horizontalPixels) };
      // One pixel measures the shader response and light-dependent widths.
      renderer.setSize(1, 1);
      // Compare final light factors with the version before the half-peak floor.
      const measureResponse = (source) => {
        const mainResponse = {
          views: 0,
          minimum: [255, 255],
          maximum: [0, 0],
          darkLight: [255, 255],
          peaks: [],
          darkViews: [0, 0],
        };
        for (const lambert of [0, 0.25, 0.5, 0.75, 1])
          for (let az = -80; az <= 80; az += 5)
            for (let el = -80; el <= 80; el += 5) {
              const bytes = instrument('main-response', az, el, source, lambert);
              mainResponse.views++;
              for (let axis = 0; axis < 2; axis++) {
                mainResponse.minimum[axis] = Math.min(mainResponse.minimum[axis], bytes[axis]);
                mainResponse.maximum[axis] = Math.max(mainResponse.maximum[axis], bytes[axis]);
                if (bytes[axis] < [13, 25][axis]) mainResponse.darkViews[axis]++;
                if (lambert === 0)
                  mainResponse.darkLight[axis] = Math.min(
                    mainResponse.darkLight[axis],
                    bytes[axis],
                  );
              }
            }
        return mainResponse;
      };
      const mainResponse = measureResponse(original);
      const oldResponse = responseBaseline ? measureResponse(responseBaseline) : null;
      const angularEndpoints = [
        instrument('mainAngularResponse(0.)')[0],
        instrument('mainAngularResponse(3.14159265)')[0],
      ];
      const widthState = { minimum: [255, 255], maximum: [0, 0], edges: [] };
      for (let az = -80; az <= 80; az += 5)
        for (let el = -80; el <= 80; el += 5) {
          const bytes = instrument('width-state', az, el);
          for (let i = 0; i < 2; i++) {
            widthState.minimum[i] = Math.min(widthState.minimum[i], bytes[i + 1]);
            widthState.maximum[i] = Math.max(widthState.maximum[i], bytes[i + 1]);
          }
        }
      for (const uv of [
        [0.01, 0.5],
        [0.99, 0.5],
        [0.5, 0.01],
        [0.5, 0.99],
        [0.5, 0.5],
      ])
        widthState.edges.push({ uv, factor: instrument('width-state', 0, 0, original, 1, uv)[0] });
      const glintProbe = original
        .replace(
          'float blaze=stamped*response*stampDepth;',
          'float blaze=1.; response=1.; grain=1.; resolved=1.; ridge=.52*grain; ridgeTip=shape; rowResolved=resolved;',
        )
        .replace(/float sparkle=exp\([^\n]+/, 'float sparkle=1.;')
        .replace(/sparkle\*=smoothstep\([^\n]+/, '');
      const glintMatches = [];
      for (const uv of [
        [0.2, 0.2],
        [0.5, 0.5],
        [0.8, 0.8],
      ]) {
        glintMatches.push(
          instrument(
            'sqrt(dot(sparkleFlare,sparkleFlare))/max(sqrt(dot(facetSpectrum,facetSpectrum)),.0001)/max(sqrt(dot(mainFlare,mainFlare))/max(sqrt(dot(spectral,spectral)),.0001),.0001)',
            0,
            0,
            glintProbe,
            1,
            uv,
          )[0],
        );
      }
      const speed = [];
      if (baselineSource)
        for (const [axis, expression] of [
          ['vertical', '(carrier-uv.x*3.-.60)*.5+.5'],
          ['horizontal', '(crossing-uv.y*4.2-.31)*.5+.5'],
        ])
          for (const [az, el] of [
            [-45, 0],
            [45, 0],
            [0, -45],
            [0, 45],
          ]) {
            const before = instrument(expression, az, el, baselineSource)[0] - 127.5;
            const after = instrument(expression, az, el)[0] - 127.5;
            speed.push({ axis, az, el, before, after, ratio: after / before });
          }
      const widths = [];
      if (widthFactor !== null)
        for (const [axis, main] of [
          ['vertical', 'orderWidth'],
          ['horizontal', 'crossWidth'],
        ])
          for (const [az, el] of [
            [0, 0],
            [-45, 0],
            [45, 0],
            [0, -45],
            [0, 45],
          ]) {
            const before = instrument(`${main}*10.`, az, el, baselineSource)[0];
            const after = instrument(`${main}*10.`, az, el)[0];
            widths.push({
              axis,
              az,
              el,
              before,
              after,
              ratio: after / before,
            });
          }
      material.fragmentShader = original;
      material.needsUpdate = true;
      library.dispose();
      renderer.dispose();
      return {
        vertical,
        horizontal,
        mainVertical,
        mainHorizontal,
        mainResponse,
        oldResponse,
        angularEndpoints,
        widthState,
        glintMatches,
        speed,
        widths,
        visibility,
        images,
      };
    },
    { baselineSource, responseBaseline, widthFactor },
  );
  await fs.writeFile(`${output}/shader-errors.json`, JSON.stringify(errors, null, 2));
  assert.deepEqual(errors, [], 'Instrumented and production shaders must compile without errors');
  const { images: measuredImages, ...measurement } = result;
  await fs.writeFile(`${output}/ridges-measurement.json`, JSON.stringify(measurement, null, 2));
  assert.ok(
    result.mainResponse.minimum[0] <= 2 &&
      result.mainResponse.minimum[1] >= 10 &&
      result.mainResponse.minimum[1] <= 13,
    'Main stripes must restore the pre-half-floor minimum strengths',
  );
  assert.deepEqual(
    result.mainResponse.maximum,
    [255, 255],
    'Main light sweep must still reach the original peak',
  );
  assert.deepEqual(
    result.angularEndpoints,
    [255, 1],
    'Original angular minimum and peak must remain',
  );
  if (result.oldResponse)
    for (let axis = 0; axis < 2; axis++) {
      assert.ok(
        Math.abs(result.mainResponse.minimum[axis] - result.oldResponse.minimum[axis]) <= 1.5,
        'Restored minimum must match the pre-half-floor shader',
      );
      assert.ok(
        result.mainResponse.darkViews[axis] < result.oldResponse.darkViews[axis] * 0.85,
        'The darkest main light views must become less frequent',
      );
    }
  assert.ok(
    result.widthState.minimum.every((value) => value >= 190 && value <= 193),
    'Main light widths must reach three quarters',
  );
  assert.deepEqual(
    result.widthState.maximum,
    [255, 255],
    'Current main width must remain the maximum',
  );
  assert.ok(
    result.widthState.edges.slice(0, 4).every((sample) => Math.abs(sample.factor - 191.25) <= 1),
    'Edge widths must be three quarters',
  );
  assert.equal(
    result.widthState.edges.at(-1).factor,
    255,
    'Central widths must retain their maximum',
  );
  assert.ok(
    result.glintMatches.every((value) => value >= 254),
    'Sparse glints must match the resolved main-etch peak scale',
  );
  if (baselineSource)
    assert.ok(
      result.speed.every((view) => Math.abs(view.after - view.before * speedFactor) <= 1.5),
      `Measured main-stripe displacement must be ${speedFactor}x the baseline shader`,
    );
  if (widthFactor !== null) {
    assert.ok(
      result.widths.every(
        (view) =>
          view.before > 0 &&
          view.after >= view.before * widthFactor * 0.75 - 1.5 &&
          view.after <= view.before * widthFactor + 1.5,
      ),
      `Measured main-stripe widths must be ${widthFactor}x the baseline shader`,
    );
  }
  assert.ok(
    result.visibility.every(
      (view) => view.measuredBands >= 3 && view.mean > 15 && view.minimum > 15,
    ),
    'Horizontal main etches must retain visible radiance at every tested light angle',
  );
  const centralStrengths = result.visibility.map(
    (view) =>
      view.bands.reduce((a, b) => (Math.abs(a.centre - 0.52) < Math.abs(b.centre - 0.52) ? a : b))
        .strength,
  );
  assert.ok(
    (Math.max(...centralStrengths) - Math.min(...centralStrengths)) /
      Math.max(...centralStrengths) >
      0.15,
    'Half-peak horizontal orders must retain a visible tone-mapped light response',
  );
  assert.deepEqual(errors, []);
  delete result.images;
  result.passed = true;
  await fs.writeFile(`${output}/ridges.json`, JSON.stringify(result, null, 2));
  console.log(
    'Mirror ridges: no auxiliary code; main response, matched sparkle peaks, 75–100% widths, 75% edges, movement and persistent horizontal lines passed.',
  );
} finally {
  await browser.close();
}
