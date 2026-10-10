import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';

const output = 'test-results/room-sorting-performance-20261009';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const THREE = await import('/src/vendor/three.module.js');
    const { CARD_PRINTS } = await import('/src/game/card-data.js');
    const { createGameFinishLibrary } = await import('/src/scene/game-card-finishes.js');
    const { createFinishBatchRenderer } = await import('/src/ui/card-finish-batch.js');
    const library = createGameFinishLibrary();
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10.8;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.95, 4.3), null);
    scene.add(plane);
    const batch = createFinishBatchRenderer(renderer, scene, camera, plane);
    const styles = ['SR', 'UR', 'SER', 'UL', 'CR', 'PSER', 'UR-OF', 'PSER-OF', 'GMR'];
    const handles = styles.map((style) =>
      library.acquire({
        printId: CARD_PRINTS.find((print) => print.style === style).id,
        serial: style === 'GMR' ? 37 : undefined,
      }),
    );
    await Promise.all(handles.map((handle) => handle.ready));
    const jobs = Array.from({ length: 24 }, (_, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 440;
      canvas.height = 640;
      return {
        material: handles[i % handles.length].material,
        context: canvas.getContext('2d'),
        light: new THREE.Vector3((i % 7) - 3, i % 5, 7),
        exposure: 0.68 + (i % 3) * 0.12,
        toneMappingExposure: i % 2 ? 0.86 : 1.12,
        w: canvas.width,
        h: canvas.height,
        renderW: canvas.width,
      };
    });
    function reference(job) {
      renderer.setSize(job.renderW, job.h, false);
      renderer.setViewport(0, 0, job.renderW, job.h);
      renderer.setScissorTest(false);
      if (job.renderW < job.w) camera.setViewOffset(job.w, job.h, 0, 0, job.renderW, job.h);
      else camera.clearViewOffset();
      job.material.uniforms.lightPosition.value.copy(job.light);
      job.material.uniforms.exposure.value = job.exposure;
      job.material.uniforms.diffuseIntensity.value = 1;
      renderer.toneMappingExposure = job.toneMappingExposure;
      plane.material = job.material;
      renderer.render(scene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = job.renderW;
      canvas.height = job.h;
      const context = canvas.getContext('2d');
      context.drawImage(renderer.domElement, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const expected = jobs.map(reference);
    const repeatExpected = jobs.map(reference);
    let referenceDifference = 0;
    for (let i = 0; i < jobs.length; i++)
      for (let p = 0; p < expected[i].length; p++)
        referenceDifference = Math.max(
          referenceDifference,
          Math.abs(expected[i][p] - repeatExpected[i][p]),
        );
    batch.draw(jobs);
    const fullStats = batch.stats();
    let fullDifference = 0,
      stableDifference = 0,
      stampMeanDifference = 0;
    const fullChecks = [];
    const retainedPixels = [];
    jobs.forEach((job, i) => {
      const data = job.context.getImageData(0, 0, job.w, job.h).data;
      retainedPixels.push(data);
      let sum = 0,
        bad = 0,
        max = 0,
        location = 0,
        stampSum = 0,
        stampChannels = 0;
      for (let p = 0; p < data.length; p++) {
        const difference = Math.abs(data[p] - expected[i][p]);
        fullDifference = Math.max(fullDifference, difference);
        sum += difference;
        if (difference > 2) bad++;
        if (difference > max) {
          max = difference;
          location = p;
        }
        const x = Math.floor(p / 4) % job.w,
          y = Math.floor(p / 4 / job.w);
        // The existing numbered-stamp shader uses texture derivatives inside a
        // branch. Even standalone repeated renders differ at a few glyph pixels.
        const stamped =
          job.material.userData.serial &&
          x >= Math.floor((29 / 590) * job.w) &&
          x <= Math.ceil((205 / 590) * job.w) &&
          y >= Math.floor((812 / 860) * job.h) &&
          y <= Math.ceil((840 / 860) * job.h);
        if (stamped) {
          stampSum += difference;
          stampChannels++;
        } else stableDifference = Math.max(stableDifference, difference);
      }
      if (stampChannels)
        stampMeanDifference = Math.max(stampMeanDifference, stampSum / stampChannels);
      fullChecks.push({
        i,
        max,
        mean: sum / data.length,
        bad,
        x: Math.floor(location / 4) % job.w,
        y: Math.floor(location / 4 / job.w),
      });
    });
    const worst = fullChecks.toSorted((a, b) => b.max - a.max)[0].i;
    const diagnosticCanvas = document.createElement('canvas');
    diagnosticCanvas.width = jobs[worst].w;
    diagnosticCanvas.height = jobs[worst].h;
    diagnosticCanvas
      .getContext('2d')
      .putImageData(new ImageData(expected[worst], jobs[worst].w, jobs[worst].h), 0, 0);
    const diagnostic = {
      expected: diagnosticCanvas.toDataURL(),
      actual: jobs[worst].context.canvas.toDataURL(),
    };
    // Reconstruct full faces from an entry prefix and a later right-hand draw.
    const staged = jobs.map((job) => {
      const canvas = document.createElement('canvas');
      canvas.width = job.w;
      canvas.height = job.h;
      return { ...job, context: canvas.getContext('2d'), renderW: Math.ceil(job.w / 16) * 2 };
    });
    batch.draw(staged);
    const prefixes = staged.map((job) => job.context.getImageData(0, 0, job.renderW, job.h).data);
    batch.draw(
      staged.map((job) => ({ ...job, renderX: job.renderW, renderW: job.w - job.renderW })),
    );
    let reconstructionDifference = 0,
      reconstructionStampMean = 0,
      prefixDifference = 0;
    staged.forEach((job, i) => {
      const data = job.context.getImageData(0, 0, job.w, job.h).data;
      let stampSum = 0,
        stampChannels = 0;
      for (let p = 0; p < data.length; p++) {
        const x = Math.floor(p / 4) % job.w,
          y = Math.floor(p / 4 / job.w),
          channel = p % 4;
        if (x < job.renderW)
          prefixDifference = Math.max(
            prefixDifference,
            Math.abs(data[p] - prefixes[i][(y * job.renderW + x) * 4 + channel]),
          );
        const difference = Math.abs(data[p] - expected[i][p]);
        const stamped =
          job.material.userData.serial &&
          x >= Math.floor((29 / 590) * job.w) &&
          x <= Math.ceil((205 / 590) * job.w) &&
          y >= Math.floor((812 / 860) * job.h) &&
          y <= Math.ceil((840 / 860) * job.h);
        if (stamped) {
          stampSum += difference;
          stampChannels++;
        } else reconstructionDifference = Math.max(reconstructionDifference, difference);
      }
      if (stampChannels)
        reconstructionStampMean = Math.max(reconstructionStampMean, stampSum / stampChannels);
    });
    // Shared materials have different light/exposure per job. Test retained suffixes too.
    const cropJobs = jobs.map((job, i) => ({
      ...job,
      renderW: 2 + (i % 9),
      light: new THREE.Vector3(4 - (i % 5), -2, 7),
    }));
    const croppedExpected = cropJobs.map(reference);
    batch.draw(cropJobs);
    let stripDifference = 0,
      retainedDifference = 0;
    cropJobs.forEach((job, i) => {
      const data = job.context.getImageData(0, 0, job.w, job.h).data;
      for (let y = 0; y < job.h; y++)
        for (let x = 0; x < job.w; x++)
          for (let channel = 0; channel < 4; channel++) {
            const offset = (y * job.w + x) * 4 + channel;
            if (x < job.renderW)
              stripDifference = Math.max(
                stripDifference,
                Math.abs(data[offset] - croppedExpected[i][(y * job.renderW + x) * 4 + channel]),
              );
            else
              retainedDifference = Math.max(
                retainedDifference,
                Math.abs(data[offset] - retainedPixels[i][offset]),
              );
          }
    });
    const resized = jobs.slice(0, 3).map((job, i) => {
      job.context.canvas.width = 173 + i * 11;
      job.context.canvas.height = 251 + i * 16;
      return {
        ...job,
        w: job.context.canvas.width,
        h: job.context.canvas.height,
        renderW: job.context.canvas.width,
      };
    });
    const resizeExpected = resized.map(reference);
    batch.draw(resized);
    let resizeDifference = 0;
    resized.forEach((job, i) => {
      const data = job.context.getImageData(0, 0, job.w, job.h).data;
      for (let p = 0; p < data.length; p++)
        resizeDifference = Math.max(resizeDifference, Math.abs(data[p] - resizeExpected[i][p]));
    });
    const single = { ...resized[0], renderW: 7 };
    const singleExpected = reference(single);
    batch.draw([single]);
    const singleData = single.context.getImageData(0, 0, single.renderW, single.h).data;
    let singleDifference = 0;
    for (let p = 0; p < singleData.length; p++)
      singleDifference = Math.max(singleDifference, Math.abs(singleData[p] - singleExpected[p]));
    const singleSuffix = { ...resized[0], renderX: 58, renderW: resized[0].w - 58 };
    const suffixExpected = reference({ ...resized[0], renderW: resized[0].w });
    batch.draw([singleSuffix]);
    const suffixData = singleSuffix.context.getImageData(0, 0, singleSuffix.w, singleSuffix.h).data;
    let singleSuffixDifference = 0;
    for (let y = 0; y < singleSuffix.h; y++)
      for (let x = 58; x < singleSuffix.w; x++)
        for (let c = 0; c < 4; c++) {
          const p = (y * singleSuffix.w + x) * 4 + c;
          singleSuffixDifference = Math.max(
            singleSuffixDifference,
            Math.abs(suffixData[p] - suffixExpected[p]),
          );
        }
    const retainedTileUniforms = batch.stats().retainedTileUniforms;
    batch.dispose();
    const disposedPixels = batch.stats().atlasPixels;
    handles.forEach((handle) => handle.release());
    library.dispose();
    plane.geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    return {
      styles,
      fullDifference,
      stripDifference,
      retainedDifference,
      resizeDifference,
      singleDifference,
      fullStats,
      disposedPixels,
      retainedTileUniforms,
      fullChecks,
      diagnostic,
      referenceDifference,
      stableDifference,
      stampMeanDifference,
      reconstructionDifference,
      reconstructionStampMean,
      prefixDifference,
      singleSuffixDifference,
    };
  });
  if (
    result.stableDifference > 2 ||
    result.stampMeanDifference > 1 ||
    result.stripDifference > 2 ||
    result.resizeDifference > 2
  )
    for (const [name, data] of Object.entries(result.diagnostic))
      await fs.writeFile(`${output}/batch-${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  delete result.diagnostic;
  await fs.writeFile(`${output}/atlas-debug.json`, JSON.stringify(result, null, 2));
  assert.ok(result.stableDifference <= 2, JSON.stringify(result.fullChecks));
  assert.ok(result.stampMeanDifference <= 1, JSON.stringify(result.fullChecks));
  assert.ok(result.stripDifference <= 2, JSON.stringify(result));
  assert.equal(result.retainedDifference, 0);
  assert.ok(result.resizeDifference <= 2, JSON.stringify(result));
  assert.ok(result.singleDifference <= 2, JSON.stringify(result));
  assert.ok(result.reconstructionDifference <= 2, JSON.stringify(result));
  assert.ok(result.reconstructionStampMean <= 1, JSON.stringify(result));
  assert.equal(result.prefixDifference, 0, 'right-hand draws retain the entry prefix');
  assert.ok(result.singleSuffixDifference <= 2, JSON.stringify(result));
  assert.ok(result.fullStats.copies > 1 && result.fullStats.copies < 24);
  assert.equal(
    result.fullStats.submissions,
    result.fullStats.copies,
    'one scene submission per atlas',
  );
  assert.ok(result.fullStats.atlasPixels <= 4194304);
  assert.equal(
    result.fullStats.retainedTileUniforms,
    0,
    'atlas releases card uniforms after copying',
  );
  assert.equal(result.retainedTileUniforms, 0, 'reused materials do not retain card textures');
  assert.equal(result.disposedPixels, 1);
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/atlas-pixels.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(
    `Card batch pixels passed: ${result.styles.length} finishes, shared material/different lights, segmented atlas, retained strips and resize; stable/strip/resize differences ${result.stableDifference}/${result.stripDifference}/${result.resizeDifference}; stamped glyph mean difference ${result.stampMeanDifference.toFixed(3)} (standalone repeat maximum ${result.referenceDifference}).`,
  );
} finally {
  await browser.close();
}
