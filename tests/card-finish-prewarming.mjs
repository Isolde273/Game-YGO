import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';

const output = 'test-results/inspector-entry-stutter-20261010';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/finish-warm-fixture.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><main id="fixture"></main>' }),
  );
  await page.goto('http://127.0.0.1:5173/finish-warm-fixture.html');
  const report = await page.evaluate(async () => {
    const { createCardFinishes } = await import('/src/ui/card-finishes.js');
    const { CARD_PRINTS, getCardView } = await import('/src/game/card-data.js');
    const prints = CARD_PRINTS.filter((print) => print.rarity !== 'GMR');
    const records = Array.from({ length: 60 }, (_, index) => ({
      printId: prints[Math.floor((index * prints.length) / 60)].id,
    }));
    const root = document.querySelector('#fixture');
    const settings = () => ({ motion: false, brightness: 85 });
    let tick = 0;
    const uploads = [];
    let ticking = true;
    const frame = () => {
      tick++;
      if (ticking) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    for (const name of ['texImage2D', 'texSubImage2D']) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        uploads.push({ tick, name });
        return original.apply(this, args);
      };
    }
    const nextFrame = () => new Promise(requestAnimationFrame);
    const until = async (condition) => {
      const start = performance.now();
      while (!condition()) {
        if (performance.now() - start > 15000) throw new Error('Texture preparation timed out');
        await nextFrame();
      }
    };
    const settle = async () => {
      let lastCount = -1,
        idle = 0;
      await until(() => {
        idle = uploads.length === lastCount ? idle + 1 : 0;
        lastCount = uploads.length;
        return idle >= 30;
      });
    };
    const finishes = createCardFinishes(root, settings);
    finishes.warm(records);
    await until(() => finishes.stats().active === 60);
    await until(
      () =>
        uploads.filter((upload) => upload.name === 'texSubImage2D').length >=
        finishes.stats().textures,
    );
    await settle();
    const warmed = finishes.stats();
    const byFrame = new Map();
    for (const upload of uploads.filter((upload) => upload.name === 'texSubImage2D'))
      byFrame.set(upload.tick, (byFrame.get(upload.tick) ?? 0) + 1);
    const maxUploadsPerFrame = Math.max(...byFrame.values());
    const initialUploads = uploads.length;
    finishes.warm(records);
    await settle();
    const repeatedUploads = uploads.length - initialUploads;
    finishes.warm([]);
    await settle();
    const released = finishes.stats();
    // Supersede a stack while its textures are still loading/queued.
    const supersededStart = uploads.length;
    finishes.warm(records);
    await until(() => uploads.length > supersededStart);
    finishes.warm(records.slice(0, 1));
    await settle();
    const superseded = finishes.stats();
    finishes.dispose();
    const disposedAt = uploads.length;
    await settle();
    const uploadsAfterDispose = uploads.length - disposedAt;

    // Dispose during incremental preparation, after uploads have begun but
    // before any canvas is drawn. Its pending promise must still settle.
    const inspector = document.createElement('section');
    inspector.className = 'card-inspector';
    inspector.dataset.phase = 'preparing';
    for (const record of records) {
      const data = getCardView(record.printId);
      const card = document.createElement('div');
      card.className = 'inspect-card';
      card.style.cssText = 'position:absolute;left:10px;top:10px;width:150px;height:220px';
      const image = document.createElement('img');
      image.src = `/public/${data.assetRoot ?? 'locr-catalog'}/${data.front}`;
      image.dataset.finishPrint = record.printId;
      image.style.cssText = 'width:150px;height:220px';
      card.append(image);
      inspector.append(card);
    }
    root.append(inspector);
    const preparing = createCardFinishes(root, settings);
    const preparingStart = uploads.length;
    const ready = preparing.prepare(inspector, { incremental: true, sortingEntry: true });
    await until(() => uploads.length > preparingStart);
    const interrupted = preparing.stats();
    preparing.dispose();
    const pendingDisposedAt = uploads.length;
    await Promise.race([
      ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Disposed preparation hung')), 3000),
      ),
    ]);
    await settle();
    const pendingUploadsAfterDispose = uploads.length - pendingDisposedAt;
    const queued = createCardFinishes(root, settings);
    const queuedStart = uploads.filter((upload) => upload.name === 'texSubImage2D').length;
    const queuedReady = queued.prepare(inspector, { incremental: true, sortingEntry: true });
    await until(
      () => uploads.filter((upload) => upload.name === 'texSubImage2D').length > queuedStart + 4,
    );
    const queuedInterrupted = queued.stats();
    queued.dispose();
    const queuedDisposedAt = uploads.length;
    await Promise.race([
      queuedReady,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Disposed upload queue hung')), 3000),
      ),
    ]);
    await settle();
    ticking = false;
    return {
      warmed,
      initialUploads,
      maxUploadsPerFrame,
      repeatedUploads,
      released,
      superseded,
      disposed: finishes.stats(),
      uploadsAfterDispose,
      interrupted,
      interruptedDisposed: preparing.stats(),
      pendingUploadsAfterDispose,
      queuedInterrupted,
      queuedDisposed: queued.stats(),
      queuedUploadsAfterDispose: uploads.length - queuedDisposedAt,
    };
  });
  await fs.writeFile(`${output}/prewarming.json`, JSON.stringify({ ...report, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(report.warmed.active, 60);
  assert.equal(report.warmed.draws, 0);
  assert.ok(report.initialUploads > 100);
  assert.ok(report.maxUploadsPerFrame <= 4, JSON.stringify(report));
  assert.equal(report.repeatedUploads, 0);
  assert.equal(report.released.active, 0);
  assert.ok(report.released.entries <= 6);
  assert.equal(report.superseded.active, 1);
  assert.ok(report.superseded.entries <= 7);
  assert.equal(report.disposed.entries, 0);
  assert.equal(report.uploadsAfterDispose, 0);
  assert.equal(report.interrupted.draws, 0);
  assert.equal(report.interruptedDisposed.entries, 0);
  assert.equal(report.pendingUploadsAfterDispose, 0);
  assert.equal(report.queuedInterrupted.draws, 0);
  assert.equal(report.queuedDisposed.entries, 0);
  assert.equal(report.queuedUploadsAfterDispose, 0);
  console.log(
    `Prewarming passed: ${report.initialUploads} uploads, at most ${report.maxUploadsPerFrame} per frame; repeat, replacement and disposal release pending resources.`,
  );
} finally {
  await browser.close();
}
