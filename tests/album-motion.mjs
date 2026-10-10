import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';

const output = 'test-results/album-motion';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { routes: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const to of ['album', 'home']) {
      await page.locator(to === 'album' ? '.tile-album' : '.brand').click();
      await page.waitForFunction(
        () => document.querySelector('#page-transition').dataset.phase === 'revealing',
      );
      await page.evaluate(() => {
        window.albumTracks = document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('#page-transition,#app'));
        window.albumTracks.forEach((a) => {
          a.pause();
          a.currentTime = 0;
        });
      });
      const frames = [];
      for (const ms of [0, 160, 280, 319, 337, 379]) {
        await page.evaluate(
          (ms) =>
            window.albumTracks.forEach((a) => {
              a.currentTime = ms;
            }),
          ms,
        );
        frames.push(
          await sharp(await page.screenshot())
            .resize(384, 240, { fit: 'contain', background: '#06174e' })
            .toBuffer(),
        );
      }
      await sharp({ create: { width: 1152, height: 480, channels: 3, background: '#06174e' } })
        .composite(
          frames.map((input, i) => ({ input, left: (i % 3) * 384, top: Math.floor(i / 3) * 240 })),
        )
        .jpeg({ quality: 89 })
        .toFile(`${output}/${to}-${size.width}.jpg`);
      const panes = await page.locator('.transition-pane').evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, outside: r.right <= 0 || r.left >= innerWidth };
        }),
      );
      const visible = await sharp(await page.screenshot())
        .removeAlpha()
        .raw()
        .toBuffer();
      await page.locator('#page-transition').evaluate((el) => {
        el.style.visibility = 'hidden';
      });
      const hidden = await sharp(await page.screenshot())
        .removeAlpha()
        .raw()
        .toBuffer();
      let changedPixels = 0;
      for (let i = 0; i < visible.length; i += 3)
        if (
          Math.abs(visible[i] - hidden[i]) +
            Math.abs(visible[i + 1] - hidden[i + 1]) +
            Math.abs(visible[i + 2] - hidden[i + 2]) >
          30
        )
          changedPixels++;
      await page.locator('#page-transition').evaluate((el) => {
        el.style.removeProperty('visibility');
      });
      report.routes.push({ to, width: size.width, panes, changedPixels });
      assert.ok(
        panes.every((pane) => pane.outside),
        `The ${to} masks must leave the viewport before removal: ${JSON.stringify(panes)}`,
      );
      assert.ok(
        changedPixels < 10,
        `The transition has no visible residue before cleanup: ${changedPixels}`,
      );
      await page.evaluate(() => window.albumTracks.forEach((a) => a.finish()));
      await page.waitForFunction(() => !document.body.classList.contains('navigating'));
      assert.equal(await page.locator('#page-transition').isHidden(), true);
      assert.equal(await page.locator('#app').evaluate((el) => el.inert), false);
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report));
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
