import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions } from './helpers/browser.mjs';
import { RARITIES } from '../src/game/model.js';
import { SIZES } from '../src/scene/packing.js';

const currentUrl = process.env.YGO_CURRENT_URL || 'http://127.0.0.1:5173';
const baselineUrl = process.env.YGO_BASELINE_URL || 'http://127.0.0.1:5174';
const output = 'test-results/project-layout';
await fs.mkdir(output, { recursive: true });
const fixture = freshState();
fixture.settings.motion = false;
fixture.settings.sound = false;
// Compare a saved, stationary desk instead of the first-run falling animation.
const positions = [
  [-7, 3],
  [-2, -4],
  [3, -4],
  [-3, 5],
  [0, 5],
  [3, 5],
];
fixture.items.forEach((item, index) => {
  const flat = item.kind === 'pack';
  item.isNew = false;
  item.pose3d = {
    position: [
      positions[index][0],
      0.044 + SIZES[item.kind][flat ? 2 : 1] / 2,
      positions[index][1],
    ],
    quaternion: flat ? [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1],
  };
});
for (const rarity of RARITIES) {
  fixture.cards[rarity.id] = 6;
  fixture.collection[rarity.id] = 2;
}
const report = { currentUrl, baselineUrl, cssRules: 0, states: [], errors: [] };
const browser = await chromium.launch({ ...browserOptions, headless: true });
async function capture(url, route, viewport, prefix) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-08T04:00:00Z'));
    page.on('pageerror', (error) => report.errors.push(`${prefix}/${route}: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400)
        report.errors.push(`${prefix}: ${response.status()} ${response.url()}`);
    });
    await page.addInitScript((state) => {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      let seed = 240108;
      Math.random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    }, fixture);
    await page.goto(url);
    await page.locator('.home-menu').waitFor();
    if (route === 'open') {
      await page.evaluate(async (prefix) => {
        // Freeze only the test's adaptive GPU resolution so machine load cannot change pixels.
        const { RoomQuality } = await import(
          prefix === 'before' ? '/src/room-quality.js' : '/src/scene/room-quality.js'
        );
        RoomQuality.prototype.observe = () => false;
      }, prefix);
    }
    if (route !== 'home') await page.locator(`.tile-${route}`).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
    );
    if (route === 'open') {
      await page.locator('canvas[data-ready="true"][data-presented="true"]').waitFor();
      await page.waitForTimeout(1500);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    );
    await page.mouse.move(1, 1);
    const rules = await page.evaluate(() => {
      const value = (text) =>
        text
          .replace(/(?:\.\.\/)+public\//g, 'public/')
          .split(/("[^"]*"|'[^']*')/g)
          .map((part, i) =>
            i % 2
              ? part
              : part.replace(/(^|[^\w-])\.(\d+)/g, '$10.$2').replace(/\s*([,*/])\s*/g, '$1'),
          )
          .join('');
      const describe = (rule) => ({
        type: rule.type,
        selector: rule.selectorText,
        condition: rule.conditionText,
        name: rule.name,
        key: rule.keyText,
        style: rule.style
          ? [...rule.style].map((name) => [
              name,
              value(rule.style.getPropertyValue(name)),
              rule.style.getPropertyPriority(name),
            ])
          : undefined,
        rules: rule.cssRules ? [...rule.cssRules].map(describe) : undefined,
      });
      return [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].map(describe));
    });
    const file = `${output}/${prefix}-${route}-${viewport.width}.png`;
    await page.screenshot({ path: file, animations: 'disabled' });
    const scene =
      route === 'open'
        ? await page.evaluate(() => document.querySelector('canvas').world3D.snapshot())
        : null;
    return { file, rules, scene };
  } finally {
    await context.close();
  }
}
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const route of ['home', 'album', 'warehouse', 'shop', 'settings', 'open']) {
      const baseline = await capture(baselineUrl, route, viewport, 'before');
      const current = await capture(currentUrl, route, viewport, 'after');
      if (route === 'open')
        await fs.writeFile(
          `${output}/scene-${viewport.width}.json`,
          JSON.stringify({ before: baseline.scene, after: current.scene }, null, 2),
        );
      const ruleDifferences = current.rules
        .map((rule, index) =>
          JSON.stringify(rule) === JSON.stringify(baseline.rules[index])
            ? null
            : { index, before: baseline.rules[index], after: rule },
        )
        .filter(Boolean);
      if (current.rules.length !== baseline.rules.length || ruleDifferences.length) {
        await fs.writeFile(
          `${output}/css-differences.json`,
          JSON.stringify(ruleDifferences, null, 2),
        );
        throw new Error(
          `CSS changed: ${route}, ${ruleDifferences.length} rules. See ${output}/css-differences.json`,
        );
      }
      report.cssRules = current.rules.length;
      const before = await sharp(baseline.file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const after = await sharp(current.file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.deepEqual(after.info, before.info);
      let changedPixels = 0,
        totalDifference = 0;
      for (let i = 0; i < before.data.length; i += 3) {
        let largest = 0;
        for (let channel = 0; channel < 3; channel++) {
          const delta = Math.abs(before.data[i + channel] - after.data[i + channel]);
          totalDifference += delta;
          largest = Math.max(largest, delta);
        }
        if (largest > 8) changedPixels++;
      }
      const pixels = viewport.width * viewport.height;
      const result = {
        route,
        width: viewport.width,
        meanChannelDifference: totalDifference / before.data.length,
        changedPixels,
        changedFraction: changedPixels / pixels,
      };
      report.states.push(result);
      assert.equal(changedPixels, 0, `Visible change: ${JSON.stringify(result)}`);
      console.log(`${route} ${viewport.width}px: CSS 一致，显著变化像素 ${changedPixels}`);
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await fs.writeFile(`${output}/preservation.json`, JSON.stringify(report, null, 2));
}
