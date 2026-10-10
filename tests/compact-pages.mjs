import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions, openPhoneApp, navigatePage, closePurchase } from './helpers/browser.mjs';
import { RARITIES, moveBinderCard, addCards, transferWarehouseToTray } from '../src/game/model.js';
import { fixturePrintId } from './helpers/sorting-stacks.mjs';

const baseline = process.argv.includes('--baseline');
const output = 'test-results/compact-pages';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { layouts: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  const state = freshState();
  state.settings.motion = false;
  state.settings.sound = false;
  for (const r of RARITIES) {
    const printId = fixturePrintId(r.id);
    addCards(state, printId, 10);
    transferWarehouseToTray(state, printId, 8);
    moveBinderCard(state, { printId }, RARITIES.indexOf(r));
  }
  await page.addInitScript((s) => {
    if (!localStorage.getItem('compact-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('compact-fixture', '1');
    }
  }, state);
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-album').click();
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1095, 615],
    [1000, 700],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ['album', 'shop']) {
      await navigatePage(page, name);
      await page.evaluate(() => window.scrollTo(0, 0));
      const result = await page.evaluate((name) => {
        const selectors =
          name === 'album'
            ? [
                '.album-book',
                '.collection-dock',
                '.binder-navigation',
                '#album-jump-form',
                '.collection-warehouse',
              ]
            : ['.phone', '.phone-home-button'];
        const boxes = selectors.map((selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        });
        const a = document.querySelector('.album-book')?.getBoundingClientRect(),
          b = document.querySelector('.collection-dock')?.getBoundingClientRect();
        return {
          name,
          width: innerWidth,
          height: innerHeight,
          scroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
          overflow: document.documentElement.scrollWidth > innerWidth,
          boxes,
          overlap:
            !!a && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
        };
      }, name);
      report.layouts.push(result);
      if (!baseline) {
        assert.equal(result.overflow, false, `${name}: horizontal overflow ${width}`);
        assert.ok(
          result.scroll <= (name === 'shop' && width > 700 ? Math.max(1, 760 - height) : 1),
          `${name}: page requires ${result.scroll}px scrolling at ${width}×${height}`,
        );
        assert.ok(
          result.boxes.every(
            (r) =>
              r.left >= 0 &&
              r.right <= width &&
              r.top >= 0 &&
              r.bottom <= height + result.scroll + (name === 'shop' ? 65 : 0),
          ),
          `${name}: controls outside viewport at ${width}×${height}: ${JSON.stringify(result.boxes)}`,
        );
        assert.equal(result.overlap, false, `binder and tray overlap at ${width}`);
      }
      if (name === 'shop' && !baseline) {
        const phone = await page
          .locator('.phone')
          .evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight }));
        assert.equal(phone.height, 606);
        assert.equal(phone.width, width <= 700 ? 318 : 334);
        assert.equal(
          await page.locator('.shop-intro,.shop-ledger,.shop-app-guide,.purchase-backdrop').count(),
          0,
        );
      }
      if ([1440, 390].includes(width))
        await sharp(await page.screenshot({ style: '#toast{visibility:hidden}' }))
          .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 86 })
          .toFile(`${output}/${baseline ? 'before' : 'after'}-${name}-${width}.jpg`);
      if (name === 'shop') {
        for (const app of ['jhs', 'tao', 'q']) {
          await openPhoneApp(page, app);
          const appLayout = await page.evaluate(() => {
            const screen = document.querySelector('.phone-screen').getBoundingClientRect(),
              content = document.querySelector('#phone-content').getBoundingClientRect();
            return {
              pageScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
              contentInside: content.bottom <= screen.bottom && content.top >= screen.top,
              tabsAbsent: !document.querySelector(
                '[data-action="app-tab"], .app-bottom-nav, .app-wallet, .app-history',
              ),
              visibleProducts: [
                ...document.querySelectorAll('.jhs-product,.tao-product,.q-product-card button'),
              ].map((el) => {
                const r = el.getBoundingClientRect();
                return r.top >= content.top && r.bottom <= content.bottom;
              }),
            };
          });
          if (!baseline) {
            assert.ok(appLayout.pageScroll <= (width > 700 ? Math.max(1, 760 - height) : 1));
            assert.equal(appLayout.contentInside, true);
            assert.equal(appLayout.tabsAbsent, true);
            if (app === 'jhs') {
              const market = await page.locator('.jhs-products').evaluate((el) => {
                el.scrollTop = el.scrollHeight;
                const list = el.getBoundingClientRect();
                const last = el.lastElementChild.getBoundingClientRect();
                return {
                  scrollable: el.scrollHeight > el.clientHeight,
                  lastVisible: last.bottom <= list.bottom + 1 && last.top >= list.top,
                };
              });
              assert.ok(
                market.scrollable && market.lastVisible,
                `jhs: catalog inaccessible at ${width}×${height}`,
              );
              assert.ok(await page.locator('.market-pagination').isVisible());
            } else if (height >= 768 || width <= 700)
              assert.ok(
                appLayout.visibleProducts.every(Boolean),
                `${app}: products clipped at ${width}×${height}`,
              );
          }
          if (!baseline && width === 390 && app === 'tao')
            await sharp(await page.screenshot())
              .jpeg({ quality: 86 })
              .toFile(`${output}/after-tao-390.jpg`);
          await page.locator('.phone-home-button').click();
        }
      }
    }
  }
  assert.deepEqual(report.errors, []);
  await fs.writeFile(
    `${output}/${baseline ? 'baseline' : 'report'}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      report.layouts.map(({ name, width, height, scroll }) => ({ name, width, height, scroll })),
    ),
  );
} finally {
  await browser.close();
}
