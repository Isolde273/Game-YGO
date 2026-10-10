import { browserOptions } from './helpers/browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const baseline = process.argv.includes('--baseline');
const dir = process.env.YGO_MATERIAL_OPTICS_OUTPUT || 'test-results/material-review';
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const delta = async (a, b) => {
  const l = await sharp(a).removeAlpha().raw().toBuffer(),
    r = await sharp(b).removeAlpha().raw().toBuffer();
  assert.equal(l.length, r.length);
  let sum = 0;
  for (let i = 0; i < l.length; i++) sum += Math.abs(l[i] - r[i]);
  return sum / l.length;
};
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }),
    errors = [];
  if (baseline) {
    assert.ok(process.env.YGO_MATERIAL_BASELINE, 'Baseline source path is required');
    const body = await fs.readFile(process.env.YGO_MATERIAL_BASELINE, 'utf8');
    await page.route('**/src/scene/material-finishes.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body }),
    );
  }
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 400));
  });
  await page.goto('http://127.0.0.1:5173/public/material-review/index.html');
  await page.waitForFunction(() => window.materialReview?.ready);
  const state = await page.evaluate(() => materialReview.inspect());
  assert.ok(
    Math.abs(state.faceSize[0] / state.faceSize[1] - 59 / 86) < 1e-6,
    'Mesh and prints must use 59:86 ratio',
  );
  // Isolate the substrate with identical flat ink/masks/normals, no raised/name
  // foil. Compare actual shader output, rather than only checking a label.
  const film = await page.evaluate(async () => {
    const THREE = await import('/src/vendor/three.module.js');
    const { createFinishLibrary } = await import('/src/scene/material-finishes.js');
    const entry = materialReview.manifest.find((s) => s.id === 'PSER');
    const library = await createFinishLibrary(
      [
        { ...entry, id: 'PSE', kind: 5 },
        { ...entry, id: 'GMR', kind: 6 },
      ],
      location.href,
    );
    const p = library.create('PSE'),
      g = library.create('GMR');
    const productionPrint = p.userData.finish.uniforms.printMap.value;
    const productionBorder = p.userData.finish.uniforms.borderMap?.value;
    const texture = (bytes, srgb = false) => {
      const t = new THREE.DataTexture(new Uint8Array(bytes), 1, 1, THREE.RGBAFormat);
      t.needsUpdate = true;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    };
    const ink = texture([115, 115, 115, 255], true),
      mask = texture([255, 0, 0, 0]),
      normal = texture([128, 128, 255, 255]);
    const noBorder = texture([0, 0, 0, 255]);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(590, 860);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10;
    const scene = new THREE.Scene();
    scene.add(p, g);
    for (const card of [p, g]) {
      const u = card.userData.finish.uniforms;
      u.printMap.value = ink;
      u.finishMap.value = mask;
      u.reliefMap.value = normal;
      if (u.borderMap) u.borderMap.value = noBorder;
      if (u.accentMap) u.accentMap.value = noBorder;
      u.lightPosition.value.set(3, 1, 9);
    }
    const capture = (card, az = 17, enabled = 1, el = null, encode = true) => {
      p.visible = card === p;
      g.visible = card === g;
      const u = card.userData.finish.uniforms;
      u.lightPosition.value.set(
        Math.sin((az * Math.PI) / 180) * 10 * (el === null ? 1 : Math.cos((el * Math.PI) / 180)),
        el === null ? 1 : Math.sin((el * Math.PI) / 180) * 10,
        Math.cos((az * Math.PI) / 180) * 10 * (el === null ? 1 : Math.cos((el * Math.PI) / 180)),
      );
      u.foilEnabled.value = enabled;
      renderer.render(scene, camera);
      if (encode) return renderer.domElement.toDataURL('image/png').split(',')[1];
    };
    const result = {
      pse: capture(p),
      gmr: capture(g),
      again: capture(p),
      small: capture(p, 17.4),
      large: capture(p, 25),
      off: capture(p, 17, 0),
      lowAngle: capture(p, -30, 1, -35),
      normalAngle: capture(p, 0, 1, 0),
      highAngle: capture(p, 35, 1, 40),
    };
    // On a black print the only remaining response is the film/gloss.
    // Ambient must not scale those directional reflections or their masks.
    if (p.userData.finish.uniforms.diffuseIntensity) {
      const u = p.userData.finish.uniforms;
      u.diffuseIntensity.value = 0.25;
      result.ambientPrint = capture(p);
      const black = texture([0, 0, 0, 255], true);
      u.printMap.value = black;
      result.ambientFoilLow = capture(p);
      u.diffuseIntensity.value = 1;
      result.ambientFoilHigh = capture(p);
      u.printMap.value = ink;
      black.dispose();
    }
    const fullFilm = p.userData.finish.fragmentShader;
    result.mainFilm = capture(p, 0, 1, 0);
    result.mainFilmOff = capture(p, 0, 0, 0);
    result.registration = [];
    for (let az = -60; az <= 60; az += 5)
      result.registration.push({ az, data: capture(p, az, 1, 0) });
    result.verticalSweep = [];
    for (let el = -60; el <= 60; el += 2.5)
      result.verticalSweep.push({ el, data: capture(p, 0, 1, el) });
    p.userData.finish.fragmentShader = fullFilm;
    p.userData.finish.needsUpdate = true;
    p.userData.finish.uniforms.printMap.value = productionPrint;
    if (p.userData.finish.uniforms.borderMap)
      p.userData.finish.uniforms.borderMap.value = productionBorder;
    result.rimOn = capture(p, 17);
    result.rimAngle = capture(p, -25);
    result.rimOff = capture(p, 17, 0);
    p.userData.finish.uniforms.printMap.value = ink;
    if (p.userData.finish.uniforms.borderMap) p.userData.finish.uniforms.borderMap.value = noBorder;
    result.flashes = [];
    let previousPixels = null;
    for (const az of [-35, -25, -15, -5, 5, 15, 25, 35]) {
      capture(p, az);
      const gl = renderer.getContext(),
        pixels = new Uint8Array(590 * 860 * 4),
        hist = new Uint32Array(256),
        channelHist = new Uint32Array(256);
      gl.readPixels(0, 0, 590, 860, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let total = 0,
        patchTotal = 0,
        patchBright = 0,
        patchChromatic = 0,
        patchSwitched = 0;
      for (let y = 50; y < 810; y++)
        for (let x = 40; x < 550; x++) {
          const i = (y * 590 + x) * 4,
            luma = Math.round(pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722);
          const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]),
            low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          hist[luma]++;
          channelHist[peak]++;
          total++;
          if (x >= 80 && x < 310 && y >= 110 && y < 210) {
            patchTotal++;
            if (luma >= 228) patchBright++;
            if (peak >= 228 && peak - low >= 55) {
              patchChromatic++;
              if (
                previousPixels &&
                Math.max(
                  pixels[i] - previousPixels[i],
                  pixels[i + 1] - previousPixels[i + 1],
                  pixels[i + 2] - previousPixels[i + 2],
                ) >= 60
              )
                patchSwitched++;
            }
          }
        }
      const quantile = (q, histogram = hist) => {
        let count = 0;
        for (let value = 0; value < 256; value++) {
          count += histogram[value];
          if (count >= total * q) return value;
        }
        return 255;
      };
      result.flashes.push({
        az,
        median: quantile(0.5),
        p99: quantile(0.99),
        p99Channel: quantile(0.99, channelHist),
        patchBrightFraction: patchBright / patchTotal,
        patchChromaticFraction: patchChromatic / patchTotal,
        patchSwitchedFraction: patchSwitched / patchTotal,
      });
      previousPixels = pixels;
    }
    // Sub-degree sweep: evaluate every local transition, not just two distant
    // endpoints. A softer material must not pass by becoming invisible.
    const tw = 320,
      th = 466;
    renderer.setSize(tw, th);
    const gl = renderer.getContext();
    let lastPixels = null;
    let peakStep = 0,
      peakMeanStep = 0,
      peakAbruptFraction = 0;
    const tileCurves = Array.from({ length: 20 * 13 }, () => []);
    for (let step = 0; step <= 360; step++) {
      const az = -45 + step * 0.25;
      capture(p, az, 1, 0, false);
      const pixels = new Uint8Array(tw * th * 4);
      gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0,
        total = 0,
        abrupt = 0,
        maxStep = 0;
      const tileChroma = new Float64Array(tileCurves.length);
      for (let y = 25; y < 441; y++)
        for (let x = 16; x < 304; x++) {
          const i = (y * tw + x) * 4;
          const chroma =
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
            Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          tileChroma[Math.floor((y - 25) / 32) * 20 + Math.floor(x / 16)] += chroma / 512;
          if (lastPixels) {
            const d = Math.max(
              ...[0, 1, 2].map((c) => Math.abs(pixels[i + c] - lastPixels[i + c])),
            );
            sum += d;
            total++;
            maxStep = Math.max(maxStep, d);
            if (d > 48) abrupt++;
          }
        }
      for (let i = 0; i < tileCurves.length; i++) tileCurves[i].push(tileChroma[i]);
      if (lastPixels) {
        peakStep = Math.max(peakStep, maxStep);
        peakMeanStep = Math.max(peakMeanStep, sum / total);
        peakAbruptFraction = Math.max(peakAbruptFraction, abrupt / total);
      }
      lastPixels = pixels;
    }
    // For each visible tile, count intermediate steps relative to its own
    // dark/bright endpoints. Smooth fade tails must survive actual rendering.
    const fades = tileCurves
      .map((curve) => {
        const low = Math.min(...curve),
          high = Math.max(...curve);
        return {
          contrast: high - low,
          intermediate:
            curve.filter((v) => v > low + (high - low) * 0.15 && v < low + (high - low) * 0.85)
              .length / curve.length,
        };
      })
      .filter((t) => t.contrast > 25);
    result.transitions = {
      stepDegrees: 0.25,
      frames: 361,
      peakStep,
      peakMeanStep,
      peakAbruptFraction,
      visibleTiles: fades.length,
      meanIntermediate: fades.reduce((sum, t) => sum + t.intermediate, 0) / fades.length,
    };
    library.dispose();
    for (const t of [ink, mask, normal, noBorder]) t.dispose();
    renderer.dispose();
    return result;
  });
  const crop = async (key) =>
    sharp(Buffer.from(film[key], 'base64'))
      .extract({ left: 40, top: 50, width: 510, height: 760 })
      .toBuffer();
  const pse = await crop('pse'),
    gmr = await crop('gmr'),
    off = await crop('off');
  const mainFilm = await crop('mainFilm');
  // Measure rendered structure on uniform ink: print details cannot create
  // false bands. Broad, similar-strength row/column peaks indicate a grid.
  const structure = async (buffer) => {
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const columns = new Float64Array(info.width),
      rows = new Float64Array(info.height);
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const chroma =
          Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
        columns[x] += chroma / info.height;
        rows[y] += chroma / info.width;
      }
    const profile = (values) => {
      const smooth = Array.from(values, (_, i) => {
        let sum = 0,
          weight = 0;
        for (let j = -6; j <= 6; j++)
          if (i + j >= 0 && i + j < values.length) {
            const w = Math.exp((-j * j) / 8);
            sum += values[i + j] * w;
            weight += w;
          }
        return sum / weight;
      });
      const sorted = smooth.slice().sort((a, b) => a - b),
        median = sorted[Math.floor(sorted.length * 0.5)];
      const threshold = median + (sorted.at(-1) - median) * 0.3,
        bands = [];
      let start = null;
      for (let i = 0; i <= smooth.length; i++) {
        const active = i < smooth.length && smooth[i] > threshold;
        if (active && start === null) start = i;
        if (!active && start !== null) {
          if (i - start >= 6) bands.push([start, i]);
          start = null;
        }
      }
      return { bands, contrast: sorted[Math.floor(sorted.length * 0.95)] - median };
    };
    const vertical = profile(columns),
      horizontal = profile(rows);
    let quietPixels = 0,
      quietGlints = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        if (
          vertical.bands.some(([a, b]) => x >= a - 6 && x <= b + 6) ||
          horizontal.bands.some(([a, b]) => y >= a - 6 && y <= b + 6)
        )
          continue;
        quietPixels++;
        const i = (y * info.width + x) * info.channels;
        const peak = Math.max(data[i], data[i + 1], data[i + 2]),
          low = Math.min(data[i], data[i + 1], data[i + 2]);
        if (peak >= 210 && peak - low >= 65) quietGlints++;
      }
    return {
      verticalBands: vertical.bands.length,
      horizontalBands: horizontal.bands.length,
      axisContrastRatio: vertical.contrast / horizontal.contrast,
      offBandGlintFraction: quietGlints / quietPixels,
    };
  };
  const structures = [];
  for (const key of ['pse', 'small', 'large'])
    structures.push({ view: key, ...(await structure(await crop(key))) });
  await fs.writeFile(`${dir}/structure.json`, JSON.stringify(structures, null, 2));
  // Measure the rendered direction and width on uniform ink. Lighting may
  // select different stamped bands, but must never rotate their geometry.
  const diffraction = async (buffer) => {
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hues = new Uint32Array(6),
      points = [];
    for (let y = 0; y < info.height; y += 2)
      for (let x = 0; x < info.width; x += 2) {
        const i = (y * info.width + x) * info.channels,
          r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const high = Math.max(r, g, b),
          low = Math.min(r, g, b),
          chroma = high - low;
        points.push([x - info.width / 2, y - info.height / 2, chroma]);
        if (high > 180 && chroma > 80) {
          let hue =
            high === r
              ? (g - b) / chroma
              : high === g
                ? 2 + (b - r) / chroma
                : 4 + (r - g) / chroma;
          hues[Math.floor((hue + 6) % 6)]++;
        }
      }
    const extent = Math.ceil(Math.hypot(info.width, info.height)),
      profiles = [];
    for (let angle = -35; angle <= 35; angle += 2.5) {
      const radians = (angle * Math.PI) / 180,
        c = Math.cos(radians),
        s = Math.sin(radians);
      const sum = new Float64Array(extent * 2),
        count = new Uint32Array(extent * 2);
      for (const [x, y, chroma] of points) {
        const bin = Math.round(x * c + y * s) + extent;
        sum[bin] += chroma;
        count[bin]++;
      }
      const profile = [];
      // Fixed central range avoids short corner projections exaggerating peaks.
      for (let x = -200; x <= 200; x++) {
        let total = 0,
          n = 0;
        for (let j = -2; j <= 2; j++) {
          total += sum[extent + x + j];
          n += count[extent + x + j];
        }
        profile.push(total / Math.max(n, 1));
      }
      const sorted = profile.slice().sort((a, b) => a - b),
        base = sorted[200];
      profiles.push({
        angle,
        profile,
        base,
        score: sorted[Math.floor(sorted.length * 0.97)] - base,
      });
    }
    const best = profiles.reduce((a, b) => (a.score > b.score ? a : b)),
      widths = [];
    const threshold = best.base + best.score * 0.5;
    let start = null;
    for (let i = 0; i <= best.profile.length; i++) {
      const active = i < best.profile.length && best.profile[i] > threshold;
      if (active && start === null) start = i;
      if (!active && start !== null) {
        if (start > 0 && i < best.profile.length && i - start > 2) widths.push((i - start) / 590);
        start = null;
      }
    }
    widths.sort((a, b) => a - b);
    return {
      direction: best.angle,
      widths,
      medianWidth: widths[Math.floor(widths.length / 2)],
      hueBins: [...hues],
      colours: hues.filter((n) => n >= 30).length,
    };
  };
  const diffractionViews = [];
  for (const view of ['lowAngle', 'normalAngle', 'highAngle']) {
    const buffer = await crop(view);
    diffractionViews.push({ view, ...(await diffraction(buffer)) });
    await sharp(buffer).jpeg({ quality: 92 }).toFile(`${dir}/${view}.jpg`);
  }
  await fs.writeFile(`${dir}/diffraction.json`, JSON.stringify(diffractionViews, null, 2));
  if (!baseline) {
    const directions = diffractionViews.map((s) => s.direction);
    assert.ok(
      directions.every((direction) => Math.abs(direction) <= 2.5),
      'Changing incidence must not rotate the stamped vertical bands',
    );
    assert.ok(
      diffractionViews.some((s) => s.colours === 6),
      'The light sweep must still reveal the full six-bin spectrum',
    );
    for (const s of diffractionViews) {
      assert.ok(
        s.medianWidth >= 0.005 && s.medianWidth <= 0.065,
        'Half-peak orders must retain bounded displayed widths at oblique light angles',
      );
      assert.ok(s.colours >= 4, 'Each light direction must reveal several strong spectral colours');
    }
  }
  // Detect stripe centres from rendered column chroma, without using the
  // shader's carrier frequency or offsets. Pool the sweep to include bands
  // visible in individual views, then check their registration.
  const registrationProfiles = [];
  for (const frame of film.registration) {
    const { data, info } = await sharp(Buffer.from(frame.data, 'base64'))
      .extract({ left: 40, top: 50, width: 510, height: 760 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const profile = new Array(info.width).fill(0);
    const rgb = Array.from({ length: info.width }, () => [0, 0, 0]);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        profile[x] +=
          Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
        for (let c = 0; c < 3; c++) rgb[x][c] += data[i + c] / info.height;
      }
    }
    registrationProfiles.push({ az: frame.az, profile: profile.map((v) => v / info.height), rgb });
  }
  // Average across five pixels so individual subpixel ridges do not split
  // one continuous stripe into multiple candidate centres.
  const smoothProfile = (values, radius = 2) =>
    values.map(
      (_, x) =>
        Array.from({ length: radius * 2 + 1 }, (_, i) => i - radius).reduce(
          (sum, dx) => sum + values[Math.max(0, Math.min(values.length - 1, x + dx))],
          0,
        ) /
        (radius * 2 + 1),
    );
  const peaks = (values, radius = 2) => {
    const profile = smoothProfile(values, radius);
    const base = profile.slice().sort((a, b) => a - b)[Math.floor(profile.length / 2)];
    // A near-dark band has no measurable centre; its sparse background
    // glints must not be mistaken for displacement of the stamped stripe.
    const threshold = base + Math.max(20, (Math.max(...profile) - base) * 0.45);
    const centres = [];
    let start = null;
    for (let x = 0; x <= profile.length; x++) {
      if (profile[x] > threshold) {
        if (start === null) start = x;
      } else if (start !== null) {
        if (start > 0 && x < profile.length && x - start >= 3) {
          let mass = 0,
            moment = 0;
          for (let j = start; j < x; j++) {
            mass += profile[j] - base;
            moment += j * (profile[j] - base);
          }
          centres.push(moment / mass);
        }
        start = null;
      }
    }
    return centres;
  };
  const union = registrationProfiles[0].profile.map((_, x) =>
    Math.max(...registrationProfiles.map((f) => f.profile[x])),
  );
  // Faster-moving edge orders are only partially present inside this crop;
  // use fully visible orders for full-height registration/spectral checks.
  const centres = peaks(union).filter((centre) => centre > 40 && centre < union.length - 40);
  const observed = registrationProfiles.map((f) => peaks(f.profile));
  // The row profile independently measures the horizontal band. Its motion
  // must follow elevation, with bounded displacement between nearby angles.
  const horizontalObserved = [];
  const bandWidths = { vertical: [], horizontal: [] };
  function recordWidths(profile, axis) {
    // Horizontal bands contain the finer 296-row grain. Average three rows
    // so individual sparkling etches cannot split one main-band measurement.
    const radius = axis === 'horizontal' ? 4 : 2;
    const smooth = smoothProfile(profile, radius);
    const base = [...smooth].sort((a, b) => a - b)[Math.floor(smooth.length * 0.5)];
    for (const centre of peaks(profile, radius)) {
      const x = Math.round(centre),
        peak = Math.max(...smooth.slice(x - 8, x + 9));
      let lo = x,
        hi = x;
      while (lo > 0 && smooth[lo] > base + (peak - base) * 0.5) lo--;
      while (hi < smooth.length - 1 && smooth[hi] > base + (peak - base) * 0.5) hi++;
      if (hi - lo > 3 && hi - lo < 40) bandWidths[axis].push(hi - lo);
    }
  }
  registrationProfiles.forEach((f) => recordWidths(f.profile, 'vertical'));
  for (const frame of film.verticalSweep) {
    const { data, info } = await sharp(Buffer.from(frame.data, 'base64'))
      .extract({ left: 40, top: 50, width: 510, height: 760 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rows = new Array(info.height).fill(0);
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        rows[y] +=
          (Math.max(...data.subarray(i, i + 3)) - Math.min(...data.subarray(i, i + 3))) /
          info.width;
      }
    horizontalObserved.push(peaks(rows, 4));
    recordWidths(rows, 'horizontal');
  }
  function movement(observations, angleStep = 5) {
    const tracks = [];
    observations.forEach((positions, frame) => {
      for (const position of positions) {
        const candidates = tracks.filter(
          (t) =>
            frame - t.at(-1).frame <= 3 &&
            frame !== t.at(-1).frame &&
            Math.abs(t.at(-1).position - position) < 15,
        );
        candidates.sort(
          (a, b) => Math.abs(a.at(-1).position - position) - Math.abs(b.at(-1).position - position),
        );
        const track = candidates[0] ?? [];
        if (!candidates.length) tracks.push(track);
        track.push({ frame, position });
      }
    });
    return tracks
      .filter((t) => t.length >= 5)
      .map((t) => ({
        observations: t.length,
        travel: Math.abs(t.at(-1).position - t[0].position),
        maxStep: Math.max(
          ...t
            .slice(1)
            .map(
              (p, i) =>
                (Math.abs(p.position - t[i].position) / (p.frame - t[i].frame)) * (5 / angleStep),
            ),
        ),
      }));
  }
  const axisMovement = {
    vertical: movement(observed),
    horizontal: movement(horizontalObserved, 2.5),
  };
  const medians = Object.fromEntries(
    Object.entries(bandWidths).map(([axis, values]) => [
      axis,
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
    ]),
  );
  await fs.writeFile(`${dir}/axis-widths.json`, JSON.stringify({ medians, bandWidths }, null, 2));
  if (!baseline)
    assert.ok(
      medians.horizontal / medians.vertical > 0.65 && medians.horizontal / medians.vertical < 1.5,
      'Horizontal and vertical rendered bands need comparable physical widths',
    );
  await fs.writeFile(`${dir}/axis-movement.json`, JSON.stringify(axisMovement, null, 2));
  if (!baseline)
    for (const [axis, tracks] of Object.entries(axisMovement)) {
      assert.ok(tracks.length >= 2, `${axis}: at least two measurable moving bands`);
      assert.ok(
        tracks.every((t) => t.maxStep < Math.max(16, medians[axis] * 1.2)),
        `${axis}: five-degree centre movement must stay bounded relative to the thicker band width`,
      );
      assert.ok(
        tracks.some((t) => t.travel > 10 && t.travel < 90),
        `${axis}: visible, bounded light-driven travel`,
      );
    }
  const registeredBands = centres.map((centre) => {
    const matches = observed.flatMap((values) => values.filter((x) => Math.abs(x - centre) < 40));
    const positions = registrationProfiles.map((f, i) =>
      Math.round(
        observed[i]
          .filter((x) => Math.abs(x - centre) < 40)
          .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0] ?? centre,
      ),
    );
    const visibility = registrationProfiles.map((f, i) => f.profile[positions[i]]);
    const colours = registrationProfiles
      .map((f, i) => ({ colour: f.rgb[positions[i]], visibility: visibility[i] }))
      .filter((f) => f.visibility > Math.max(...visibility) * 0.6)
      .map((f) => f.colour);
    let colourChange = 0;
    for (const a of colours)
      for (const b of colours)
        colourChange = Math.max(colourChange, ...a.map((v, c) => Math.abs(v - b[c])));
    return {
      centre,
      observations: matches.length,
      drift: matches.length ? Math.max(...matches) - Math.min(...matches) : null,
      darkRatio: Math.min(...visibility) / Math.max(...visibility),
      colourChange,
    };
  });
  // Width variations along the same fixed stripe distinguish broken foil
  // ridges from a uniformly stroked line. Use actual pixel segments, ignoring
  // sections too dark to measure; avoid print and outer-border contamination.
  const segmentWidths = [];
  for (const key of ['lowAngle', 'normalAngle', 'highAngle']) {
    const { data, info } = await sharp(await crop(key))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const band of registeredBands) {
      const x = Math.round(band.centre),
        widths = [];
      if (x < 18 || x > info.width - 19) continue;
      for (let y = 0; y < info.height - 20; y += 20) {
        const profile = new Array(33).fill(0);
        for (let dy = 0; dy < 20; dy++)
          for (let dx = -16; dx <= 16; dx++) {
            const i = ((y + dy) * info.width + x + dx) * 3;
            profile[dx + 16] +=
              (Math.max(data[i], data[i + 1], data[i + 2]) -
                Math.min(data[i], data[i + 1], data[i + 2])) /
              20;
          }
        const filtered = profile.map(
          (v, j) => ((profile[j - 1] || 0) + v + (profile[j + 1] || 0)) / 3,
        );
        const edges = [...filtered.slice(0, 4), ...filtered.slice(-4)].sort((a, b) => a - b);
        const base = (edges[3] + edges[4]) / 2,
          peak = Math.max(...filtered);
        if (peak - base < 25) continue;
        widths.push(filtered.filter((v) => v > base + (peak - base) * 0.5).length);
      }
      if (widths.length >= 12) {
        const mean = widths.reduce((sum, w) => sum + w, 0) / widths.length;
        segmentWidths.push({
          view: key,
          centre: band.centre,
          mean,
          deviation: Math.sqrt(widths.reduce((sum, w) => sum + (w - mean) ** 2, 0) / widths.length),
        });
      }
    }
  }
  const widthVariation =
    segmentWidths.reduce((sum, b) => sum + b.deviation, 0) / segmentWidths.length;
  if (!baseline)
    assert.ok(
      widthVariation > 2 && widthVariation < 5,
      'Ridges need small visible width variations, without broad distorted bands',
    );
  // At 2x movement, pooled peaks favour different angles for each order.
  // Measure simultaneous neighbours so movement is not mistaken for pitch.
  const spacings = observed
    .flatMap((positions) =>
      positions.slice(1).map((position, i) => (position - positions[i]) / 590),
    )
    .filter((spacing) => spacing < 0.5);
  await fs.writeFile(`${dir}/spacing.json`, JSON.stringify({ centres, spacings }, null, 2));
  if (!baseline)
    assert.ok(
      spacings.length >= 5 && spacings.every((s) => s > 0.3 && s < 0.37),
      'Main stripe spacing must match the approximately one-third card-width reference',
    );
  // Inspect bright etched rows on neutral ink. An isolated-dot matrix can
  // pass band-width/registration checks, but leaves repeated gaps across
  // each short ridge. The reference close-ups show mostly connected marks.
  const etched = await sharp(mainFilm).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const etchedOff = await sharp(await crop('mainFilmOff'))
    .removeAlpha()
    .raw()
    .toBuffer();
  const etchStrengthAt = (x, y) => {
    const i = (y * etched.info.width + x) * 3;
    const maximum = Math.max(...etched.data.subarray(i, i + 3));
    // Strong neutral peaks are still connected foil. Counting only saturation
    // would treat their brighter white centres as gaps in an etched ridge.
    return Math.max(
      maximum - Math.min(...etched.data.subarray(i, i + 3)),
      maximum - Math.max(...etchedOff.subarray(i, i + 3)),
    );
  };
  // Locate etches in this actual frame, rather than at centres pooled from
  // other angles: double movement makes the pooled centres inappropriate.
  const etchProfile = Array.from({ length: etched.info.width }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < etched.info.height; y++) sum += etchStrengthAt(x, y);
    return sum / etched.info.height;
  });
  const etchBands = peaks(etchProfile)
    .filter((centre) => centre > 20 && centre < etched.info.width - 20)
    .map((centre) => ({ centre }));
  assert.ok(
    etchBands.length >= 2,
    'At least two fully visible main orders must retain connected etches',
  );
  const ridgeMorphology = etchBands.map((band) => {
    const x = Math.round(band.centre);
    const rows = Array.from(
      { length: etched.info.height },
      (_, y) =>
        [-3, -2, -1, 0, 1, 2, 3].reduce((sum, dx) => sum + etchStrengthAt(x + dx, y), 0) / 7,
    );
    const peaks = [];
    for (let y = 1; y < rows.length - 1; y++)
      if (rows[y] > 50 && rows[y] > rows[y - 1] && rows[y] >= rows[y + 1]) peaks.push(y);
    const continuity = peaks.flatMap((y) => {
      const row = Array.from({ length: 29 }, (_, j) => etchStrengthAt(x + j - 14, y));
      const peak = Math.max(...row);
      if (peak < 100) return [];
      const active = row.flatMap((value, j) => (value > Math.max(50, peak * 0.45) ? [j] : []));
      return active.length > 3 ? [active.length / (active.at(-1) - active[0] + 1)] : [];
    });
    const gaps = peaks
      .slice(1)
      .map((y, i) => y - peaks[i])
      .filter((gap) => gap >= 2 && gap <= 9)
      .sort((a, b) => a - b);
    return {
      centre: band.centre,
      measuredRows: continuity.length,
      continuity: continuity.reduce((sum, value) => sum + value, 0) / continuity.length,
      medianPitch: gaps[Math.floor(gaps.length / 2)],
    };
  });
  await fs.writeFile(`${dir}/ridge-morphology.json`, JSON.stringify(ridgeMorphology, null, 2));
  if (!baseline) {
    assert.ok(
      ridgeMorphology.every((r) => r.measuredRows >= 15 && r.continuity > 0.94),
      'Bright main ridges must read as connected short etches, not columns of dots',
    );
    assert.ok(
      ridgeMorphology.every((r) => r.medianPitch >= 4 && r.medianPitch <= 6),
      'Resolved ridge spacing must match the close-up reference at 590px card width',
    );
  }
  // Circular regression checks spectral direction, which a six-colour
  // histogram cannot detect. The video runs red -> violet -> blue -> green
  // down a main band, approximately one cycle over the full card height.
  const spectralOrders = etchBands.map((band) => {
    const points = [];
    for (let y = 0; y < etched.info.height; y++) {
      for (let dx = -6; dx <= 6; dx++) {
        const i = (y * etched.info.width + Math.round(band.centre) + dx) * 3;
        const [r, g, b] = etched.data.subarray(i, i + 3);
        const high = Math.max(r, g, b),
          low = Math.min(r, g, b),
          chroma = high - low;
        if (high < 145 || chroma < 60) continue;
        const hue =
          (((high === r
            ? (g - b) / chroma
            : high === g
              ? 2 + (b - r) / chroma
              : 4 + (r - g) / chroma) +
            6) %
            6) /
          6;
        points.push({ y: y / 860, hue, weight: chroma * chroma });
      }
    }
    let best = { coherence: 0, hueCyclesDownCard: null };
    for (let step = -250; step <= 250; step++) {
      const slope = step / 100;
      let re = 0,
        im = 0,
        weight = 0;
      for (const point of points) {
        const phase = 2 * Math.PI * (point.hue - slope * point.y);
        re += point.weight * Math.cos(phase);
        im += point.weight * Math.sin(phase);
        weight += point.weight;
      }
      const coherence = Math.hypot(re, im) / weight;
      if (coherence > best.coherence) best = { coherence, hueCyclesDownCard: slope };
    }
    return { centre: band.centre, pixels: points.length, ...best };
  });
  await fs.writeFile(`${dir}/spectral-orders.json`, JSON.stringify(spectralOrders, null, 2));
  if (!baseline)
    assert.ok(
      spectralOrders.every(
        (s) => s.coherence > 0.7 && s.hueCyclesDownCard > -1.5 && s.hueCyclesDownCard < -0.5,
      ),
      'Main-band spectral direction and cycle length must agree with the aligned reference',
    );

  // Track separate portions of each moving bright stripe through the sweep.
  // Their peaks must occur at different light angles, rather than the whole
  // stripe simply fading as a unit. Neutral ink removes artwork as a cause.
  const localCurves = registeredBands.map(() => Array.from({ length: 19 }, () => []));
  for (const [frameIndex, frame] of film.registration.entries()) {
    const { data, info } = await sharp(Buffer.from(frame.data, 'base64'))
      .extract({ left: 40, top: 50, width: 510, height: 760 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    registeredBands.forEach((band, b) => {
      const tracked =
        observed[frameIndex]
          .filter((x) => Math.abs(x - band.centre) < 40)
          .sort((a, b) => Math.abs(a - band.centre) - Math.abs(b - band.centre))[0] ?? band.centre;
      for (let section = 0; section < 19; section++) {
        let value = 0;
        for (let y = section * 40; y < (section + 1) * 40; y++)
          for (let dx = -5; dx <= 5; dx++) {
            const i = (y * info.width + Math.round(tracked) + dx) * 3;
            value += Math.max(...data.subarray(i, i + 3)) - Math.min(...data.subarray(i, i + 3));
          }
        localCurves[b][section].push(value / 440);
      }
    });
  }
  const localResponses = localCurves.map((curves, b) => {
    const peaks = curves
      .map((curve) => film.registration[curve.indexOf(Math.max(...curve))].az)
      .sort((a, b) => a - b);
    return {
      centre: registeredBands[b].centre,
      peakAngles: peaks,
      peakAngleSpread:
        peaks[Math.floor(peaks.length * 0.85)] - peaks[Math.floor(peaks.length * 0.15)],
    };
  });
  await fs.writeFile(`${dir}/local-responses.json`, JSON.stringify(localResponses, null, 2));
  if (!baseline)
    assert.ok(
      localResponses.every((r) => r.peakAngleSpread >= 20),
      'Tracked portions of each main stripe must reflect at distinct light angles',
    );
  const registration = {
    registeredBands,
    detected: observed,
    widthVariation,
    segmentWidths,
    spacings,
  };
  await fs.writeFile(`${dir}/registration.json`, JSON.stringify(registration, null, 2));
  if (!baseline) {
    assert.ok(
      registeredBands.length >= 2 && registeredBands.length <= 3,
      'The reference-scale film must reveal two or three separated main stripes',
    );
    assert.ok(
      registeredBands.every((b) => b.observations >= 3 && b.drift >= 10 && b.drift <= 90),
      'Double-speed bright bands must drift visibly within 90 pixels across the light sweep',
    );
    assert.ok(
      registeredBands.filter((b) => b.colourChange > 20).length >= 2,
      'The same registered stripes must retain spectral colour changes with light',
    );
  }
  await fs.writeFile(`${dir}/transitions.json`, JSON.stringify(film.transitions, null, 2));
  if (!baseline) {
    assert.ok(film.transitions.visibleTiles >= 30, 'Gradual transitions must retain visible foil');
    assert.ok(
      // Requested 2x spatial speed doubles permitted per-angle movement
      // and pixel deltas. Preserve the abrupt-pixel fraction constraint.
      film.transitions.peakStep <= 56 &&
        film.transitions.peakMeanStep < 3.6 &&
        film.transitions.peakAbruptFraction < 0.001,
      'Sub-degree changes must not cause abrupt colour jumps across the foil',
    );
    assert.ok(
      film.transitions.meanIntermediate > 0.25,
      'Visible facets must spend a substantial portion of the sweep fading',
    );
  }
  let ambientPrintDifference = null,
    ambientFoilDifference = null;
  if (film.ambientPrint) {
    ambientPrintDifference = await delta(pse, await crop('ambientPrint'));
    ambientFoilDifference = await delta(
      await crop('ambientFoilLow'),
      await crop('ambientFoilHigh'),
    );
    assert.ok(ambientPrintDifference > 10, 'Environmental light must visibly affect diffuse print');
    assert.equal(
      ambientFoilDifference,
      0,
      'Environmental light must not scale the isolated foil reflection',
    );
  }
  const commonFilm = await delta(pse, gmr),
    staticDifference = await delta(pse, await crop('again'));
  const smallAngle = await delta(pse, await crop('small')),
    largeAngle = await delta(pse, await crop('large'));
  const foil = await delta(pse, off);
  assert.equal(commonFilm, 0, 'PSE/GMR must share the same base film');
  assert.equal(staticDifference, 0, 'Grains must remain fixed when idle');
  assert.ok(foil > 1, 'Resolved grains must be visible');
  assert.ok(
    smallAngle < largeAngle * 0.5,
    'Small light movement must not jump between unrelated patterns',
  );
  const rim = async (key) =>
    sharp(Buffer.from(film[key], 'base64'))
      .extract({ left: 4, top: 65, width: 5, height: 720 })
      .toBuffer();
  const chroma = async (buffer) => {
    const rgb = await sharp(buffer).removeAlpha().raw().toBuffer();
    let sum = 0;
    for (let i = 0; i < rgb.length; i += 3)
      sum += Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2]);
    return sum / (rgb.length / 3);
  };
  const rimOn = await rim('rimOn'),
    rimOff = await rim('rimOff'),
    rimAngle = await delta(rimOn, await rim('rimAngle'));
  const rimPlainChroma = await chroma(rimOff),
    rimFoilChroma = await chroma(rimOn);
  assert.ok(rimPlainChroma < 3, 'PSE rim must be neutral with foil disabled');
  assert.ok(
    rimFoilChroma > rimPlainChroma + 4 && rimAngle > 1,
    'PSE rim colour must respond to light',
  );
  const inset = async (key) =>
    sharp(Buffer.from(film[key], 'base64'))
      .extract({ left: 64, top: 175, width: 5, height: 410 })
      .toBuffer();
  const insetOn = await inset('rimOn'),
    insetOff = await inset('rimOff');
  const insetPlainChroma = await chroma(insetOff),
    insetFoilChroma = await chroma(insetOn);
  const insetAngle = await delta(insetOn, await inset('rimAngle'));
  if (!baseline) {
    assert.ok(insetPlainChroma < 8, 'Inset foil must have a neutral silver substrate');
    assert.ok(
      insetFoilChroma > insetPlainChroma + 10 && insetAngle > 2,
      'Inset frame must diffract and change colour like the outer rim',
    );
  }
  const strongest = film.flashes.reduce((a, b) => (a.p99Channel > b.p99Channel ? a : b));
  await fs.writeFile(`${dir}/hdr-flashes.json`, JSON.stringify(film.flashes, null, 2));
  // Saturated blue/red reflections can have low photopic luminance. Requiring
  // luma >= 228 rewards white clipping and rejects the reference's colours.
  // Keep luma in the report, but require a bright channel AND colour contrast.
  const switchedPatches = film.flashes.map((f) => f.patchSwitchedFraction);
  assert.ok(
    strongest.p99Channel >= 228 && strongest.p99Channel - strongest.median > 65,
    'Mirror grains need strong spectral peaks above the ink',
  );
  assert.ok(
    Math.max(...switchedPatches) > 0.015,
    'Changing angle must light different coloured facets, even when total lit area stays similar',
  );
  await sharp(pse).resize({ height: 760 }).jpeg({ quality: 94 }).toFile(`${dir}/isolated-film.jpg`);
  // Real-print multi-angle closeups and three zoom distances, with all three
  // independent layouts represented. Grains remain registered at every zoom.
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -900);
  const tiles = [];
  let i = 0;
  for (const id of ['SER', 'PSER', 'GMR', 'PSER-OF']) {
    for (const [az, el] of [
      [-25, 30],
      [0, 0],
      [35, -20],
    ]) {
      await page.evaluate(
        ([id, az, el]) => {
          materialReview.select(id);
          materialReview.pose(0, 0);
          materialReview.light(az, el);
        },
        [id, az, el],
      );
      await page.waitForTimeout(70);
      const pic = await page.locator('#stage').screenshot(),
        meta = await sharp(pic).metadata();
      const close = await sharp(pic)
        .extract({
          left: Math.round(meta.width / 2 - 150),
          top: Math.round(meta.height / 2 - 150),
          width: 300,
          height: 300,
        })
        .resize(275, 275)
        .toBuffer();
      tiles.push({ input: close, left: (i % 3) * 285, top: Math.floor(i / 3) * 300 + 24 });
      tiles.push({
        input: Buffer.from(
          `<svg width="275" height="24"><text x="6" y="17" font-family="Arial" font-size="13" fill="#ccebf3">${id} ${az},${el}</text></svg>`,
        ),
        left: (i % 3) * 285,
        top: Math.floor(i / 3) * 300,
      });
      i++;
    }
  }
  await sharp({ create: { width: 845, height: 1200, channels: 3, background: '#102035' } })
    .composite(tiles)
    .jpeg({ quality: 91 })
    .toFile(`${dir}/mirror-angles.jpg`);
  await page.locator('#reset').click();
  await page.evaluate(() => {
    materialReview.select('PSER');
    materialReview.pose(0, 0);
    materialReview.light(12, 15);
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scales = [];
  for (const [name, wheel] of [
    ['far', 350],
    ['mid', -350],
    ['near', -900],
  ]) {
    await page.mouse.wheel(0, wheel);
    await page.waitForTimeout(80);
    const image = await page.locator('#stage').screenshot();
    await sharp(image)
      .resize({ height: 700 })
      .jpeg({ quality: 92 })
      .toFile(`${dir}/grain-${name}.jpg`);
    const current = await page.evaluate(() => materialReview.inspect());
    assert.equal(current.calls, 3);
    scales.push({ name, zoom: current.zoom });
  }
  assert.ok(
    scales[0].zoom < scales[1].zoom && scales[1].zoom < scales[2].zoom,
    'Grain snapshots must cover distinct distances',
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    baseline,
    structures,
    diffractionViews,
    registration,
    transitions: film.transitions,
    faceRatio: state.faceSize[0] / state.faceSize[1],
    commonFilm,
    staticDifference,
    ambientPrintDifference,
    ambientFoilDifference,
    foil,
    smallAngle,
    largeAngle,
    rimPlainChroma,
    rimFoilChroma,
    rimAngle,
    insetPlainChroma,
    insetFoilChroma,
    insetAngle,
    flashes: film.flashes,
    scales,
    checks: [
      '59:86 geometry',
      'identical PSE/GMR film output',
      'fixed grains',
      'continuous angle response',
      '361 sub-degree fade frames',
      'spectral peaks and angular flashes',
      'fixed etched directions and bounded light-driven band movement',
      'bounded band widths',
      'main etches and sparkle without auxiliary orders',
      'multi-colour diffraction',
      'neutral/dynamic PSE rim',
      'neutral/dynamic inset frame',
      '4 layouts x 3 angles',
      'far/mid/near grain screenshots',
    ],
    errors,
  };
  await fs.writeFile(`${dir}/optics.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
