import { browserOptions } from './helpers/browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const directory = 'test-results/locr-full-cards';
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const errors = [],
  missing = [],
  external = [],
  tiles = new Map();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 250));
  });
  page.on('response', (response) => {
    if (response.status() >= 400) missing.push(response.url());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5173/') && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  await page.goto('http://127.0.0.1:5173/public/locr-catalog/index.html');
  await page.waitForFunction(() => window.locrCatalog?.ready);
  const catalog = await page.evaluate(() => locrCatalog.catalog);
  const manifest = await page.evaluate(() => locrCatalog.manifest);
  assert.equal(catalog.length, 80);
  assert.equal(manifest.length, 318);
  let rendered = 0,
    maxTextures = 0;
  for (const [index, card] of catalog.entries()) {
    await page.evaluate((id) => locrCatalog.selectCard(id), card.cardId);
    await page.waitForFunction(() => locrCatalog.ready);
    const variants = manifest.filter((entry) => entry.cardId === card.cardId);
    for (const variant of variants) {
      await page.evaluate((style) => {
        locrCatalog.selectVariant(style);
        locrCatalog.light(-25, 30);
      }, variant.style);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const snapshot = await page.locator('#stage').screenshot();
      const small = await sharp(snapshot)
        .resize({ width: 230, height: 280, fit: 'contain', background: '#152030' })
        .flatten({ background: '#152030' })
        .jpeg({ quality: 86 })
        .toBuffer();
      const styleTiles = tiles.get(variant.style) || [];
      styleTiles.push({ id: card.cardId, input: small });
      tiles.set(variant.style, styleTiles);
      const stats = await sharp(snapshot).stats();
      assert.ok(
        stats.channels.some((channel) => channel.stdev > 10),
        `Blank render: ${variant.id}`,
      );
      rendered++;
    }
    const info = await page.evaluate(() => locrCatalog.inspect());
    maxTextures = Math.max(maxTextures, info.textures);
    assert.ok(info.textures < 36, `Texture leak after ${card.cardId}: ${info.textures}`);
    if ((index + 1) % 10 === 0)
      console.log(`Rendered ${index + 1}/80 cards · ${rendered}/318 variants`);
  }
  for (const [style, inputs] of tiles) {
    for (let start = 0; start < inputs.length; start += 16) {
      const batch = inputs.slice(start, start + 16),
        composites = [];
      for (let index = 0; index < batch.length; index++) {
        const left = (index % 4) * 230,
          top = Math.floor(index / 4) * 305;
        composites.push({ input: batch[index].input, left, top: top + 25 });
        const label = Buffer.from(
          `<svg width="230" height="25"><text x="7" y="18" fill="white" font-size="12" font-family="Arial">${batch[index].id} / ${style}</text></svg>`,
        );
        composites.push({ input: label, left, top });
      }
      await sharp({
        create: {
          width: 920,
          height: Math.ceil(batch.length / 4) * 305,
          channels: 3,
          background: '#152030',
        },
      })
        .composite(composites)
        .jpeg({ quality: 85 })
        .toFile(`${directory}/render-${style}-${Math.floor(start / 16)}.jpg`);
    }
  }
  await page.locator('#search').fill('JP031');
  assert.equal(await page.locator('.sample:visible').count(), 1);
  await page.locator('.sample:visible').click();
  await page.waitForFunction(
    () => locrCatalog.ready && locrCatalog.inspect().cardId === 'LOCR-JP031',
  );
  await page.locator('#search').fill('');
  await page.locator('#rarity-filter').selectOption('GMR');
  assert.equal(await page.locator('.sample:visible').count(), 18);
  await page.evaluate(() => locrCatalog.selectCard('LOCR-JP001'));
  await page.locator('#variants [data-style="GMR"]').click();
  await page.locator('#compare').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${directory}/catalog-desktop.png` });
  const first = await page.locator('#stage').screenshot();
  await page.evaluate(() => locrCatalog.light(45, -10));
  await page.waitForTimeout(120);
  const second = await page.locator('#stage').screenshot();
  assert.notDeepEqual(first, second, 'Light position must affect foil');
  await page.locator('#foil').uncheck();
  await page.locator('#relief').uncheck();
  await page.locator('#back').click();
  await page.waitForTimeout(120);
  await page.locator('#back').click();
  await page.locator('#single').click();
  await page.locator('#foil').check();
  await page.locator('#relief').check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'Mobile horizontal overflow',
  );
  await page.screenshot({ path: `${directory}/catalog-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  assert.deepEqual(external, []);
  const report = {
    passed: true,
    renderedCards: 80,
    renderedVariants: rendered,
    maxTextures,
    errors,
    missing,
    external,
    checks: [
      'all 318 GPU renders',
      'bounded texture memory across 80 cards',
      'search and rarity filters',
      'same-card comparison',
      'light response',
      'foil/relief switches',
      'back face',
      'mobile layout',
    ],
  };
  await fs.writeFile(`${directory}/browser-validation.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
