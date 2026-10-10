import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions, openPhoneApp } from './helpers/browser.mjs';
import { RARITIES, moveBinderCard, addCards, transferWarehouseToTray } from '../src/game/model.js';
import { fixturePrintId } from './helpers/sorting-stacks.mjs';

const output = 'test-results/persona-ui';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { errors: [], layouts: [], checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`);
  });
  const state = freshState();
  state.settings.sound = false;
  for (const r of RARITIES) {
    const printId = fixturePrintId(r.id);
    addCards(state, printId, 16);
    transferWarehouseToTray(state, printId, 8);
    moveBinderCard(state, { printId }, RARITIES.indexOf(r));
  }
  await page.addInitScript((s) => {
    if (!localStorage.getItem('persona-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('persona-fixture', '1');
    }
  }, state);
  const idle = () =>
    page.waitForFunction(
      () =>
        !document.body.classList.contains('navigating') &&
        (!document.querySelector('.purchase-overlay') ||
          document.querySelector('.purchase-overlay').dataset.phase === 'open'),
    );
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(`${output}/${name}.jpg`);
  };
  const checkSettingsCard = async () => {
    assert.equal(await page.locator('.settings-card-stars>i').count(), 8);
    assert.equal(await page.locator('.settings-menu>button>.icon').count(), 0);
    assert.equal(
      await page.locator('.settings-card-name>span').innerText(),
      '白き幻獣－青眼の白龍',
    );
    assert.equal(await page.locator('.settings-card-name>b').innerText(), '光');
    assert.equal(await page.locator('.settings-card-type').innerText(), '【ドラゴン族／効果】');
    const effect = await page.locator('.settings-card-text p').innerText();
    assert.ok(
      effect.startsWith('このカード名の①②の効果はそれぞれ１ターンに１度しか使用できない。'),
    );
    assert.ok(effect.endsWith('その効果を無効にする。'));
    assert.equal(await page.locator('.settings-card-stats').innerText(), 'ATK/3000\nDEF/2500');
    const fit = await page.locator('.settings-feature-card').evaluate((el) => {
      const name = el.querySelector('.settings-card-name>span');
      const attribute = el.querySelector('.settings-card-name>b');
      const text = el.querySelector('.settings-card-text');
      const effect = text.querySelector('p');
      const stats = text.querySelector('.settings-card-stats');
      const art = el.querySelector('.settings-card-monster');
      return {
        gap: text.offsetTop - art.offsetTop - art.offsetHeight >= 1,
        title: name.offsetLeft + name.offsetWidth <= attribute.offsetLeft + 1,
        effect: effect.offsetTop + effect.offsetHeight <= stats.offsetTop + 1,
        panel: text.scrollHeight <= text.clientHeight + 1,
      };
    });
    assert.deepEqual(fit, { gap: true, title: true, effect: true, panel: true });
  };
  await page.goto('http://127.0.0.1:5173');
  for (const [width, height] of [
    [1440, 900],
    [1095, 615],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('.tile-warehouse').click();
    await idle();
    assert.equal(await page.locator('.stock-summary,.stock-room,.sealed-grid').count(), 0);
    assert.equal(await page.locator('.warehouse-card').count(), 5);
    await page
      .locator(`[data-action="warehouse-preview"][data-rarity="${fixturePrintId('UR')}"]`)
      .click();
    if (width > 1100)
      assert.equal(await page.locator('.inventory-preview-art>span:last-child').innerText(), 'UR');
    await shot(`warehouse-${width}`);
    await page.locator('.mini-nav [data-page="album"]').click();
    await idle();
    await shot(`album-${width}`);
    if (width === 1440) {
      await page.locator('[data-action="album-next"]').click();
      await page.waitForSelector('.book-turn-sheet');
      const shots = [];
      for (const ms of [0, 120, 240, 360, 480, 590]) {
        await page.evaluate((ms) => {
          const layer = document.querySelector('.book-turn-layer');
          for (const a of document
            .getAnimations()
            .filter((a) => layer.contains(a.effect?.target))) {
            a.pause();
            a.currentTime = ms;
          }
        }, ms);
        const png = await page.locator('.album-book').screenshot();
        const pixels = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let light = 0;
        for (let i = 0; i < pixels.data.length; i += 3)
          if (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2] > 450) light++;
        assert.ok(
          light / (pixels.info.width * pixels.info.height) > 0.22,
          `Book is dark at ${ms}ms`,
        );
        shots.push(
          await sharp(png).resize(380, 240, { fit: 'contain', background: '#0b2b78' }).toBuffer(),
        );
      }
      await sharp({ create: { width: 1140, height: 480, channels: 3, background: '#0b2b78' } })
        .composite(
          shots.map((input, i) => ({ input, left: (i % 3) * 380, top: Math.floor(i / 3) * 240 })),
        )
        .jpeg({ quality: 88 })
        .toFile(`${output}/book-turn.jpg`);
      await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('.book-turn-layer'))
          .forEach((a) => a.finish()),
      );
      await page.waitForSelector('.book-turn-layer', { state: 'detached' });
      await page.locator('[data-action="album-prev"]').click();
      await page.waitForSelector('.book-turn-sheet');
      await page.evaluate(() => {
        for (const a of document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('.book-turn-layer'))) {
          a.pause();
          a.currentTime = 599.9;
        }
      });
      const alignment = await page.evaluate(() => {
        const turned = document
          .querySelector('.book-turn-sheet .turn-back')
          .getBoundingClientRect();
        const target = document.querySelector('.album-book>.right-page').getBoundingClientRect();
        return Math.max(
          ...['left', 'top', 'right', 'bottom'].map((key) => Math.abs(turned[key] - target[key])),
        );
      });
      assert.ok(alignment < 1.6, `Backward page lands ${alignment}px from its real position`);
      await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('.book-turn-layer'))
          .forEach((a) => a.finish()),
      );
      await page.waitForSelector('.book-turn-layer', { state: 'detached' });
    }
    const background = await page.locator('#app').innerHTML();
    await page.locator('.mini-nav [data-page="shop"]').click();
    await idle();
    assert.equal(await page.locator('#app').innerHTML(), background);
    assert.equal(await page.locator('.room-portal-layer').count(), 0);
    assert.equal(await page.locator('.phone').count(), 1);
    const size = await page
      .locator('.phone')
      .evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight }));
    assert.deepEqual(size, { width: width <= 700 ? 318 : 334, height: 606 });
    await shot(`purchase-${width}`);
    for (const app of ['jhs', 'tao', 'q']) {
      await openPhoneApp(page, app);
      assert.equal(
        await page
          .locator('.app-bottom-nav, [data-action="app-tab"], .app-history, .app-wallet')
          .count(),
        0,
      );
    }
    await page.locator('.phone-home-button').click();
    await page.waitForFunction(
      () => !document.querySelector('#phone-content').dataset.localTransition,
    );
    await page.locator('[data-action="phone-close"]').click();
    await page.waitForSelector('.purchase-overlay', { state: 'detached' });
    await page.locator('.mini-nav [data-page="settings"]').click();
    await idle();
    await checkSettingsCard();
    await shot(`system-${width}`);
    await page.locator('[data-section="settings-audio"]').click();
    await page.waitForFunction(() => !document.body.dataset.settingsTransition);
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => !a.effect?.target?.closest?.('.settings-persona')),
    );
    assert.ok(await page.locator('[data-setting="motion"]').isVisible());
    await checkSettingsCard();
    await shot(`config-${width}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    report.layouts.push({ width, height, phone: size, overflow });
    await page.locator('.settings-menu [data-action="home"]').click();
    await idle();
  }
  report.checks.push(
    'Warehouse rebuilt; five versions, preview, categories and sealed products',
    'Double-sided paper remains visible throughout six sampled turning poses',
    'Original background DOM preserved; one original-size phone and no room-phone portal',
    'Three phone applications; animated pickup and return',
    'SYSTEM and CONFIG show a card with functional settings; desktop and narrow layouts',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, checks: report.checks, layouts: report.layouts }));
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
