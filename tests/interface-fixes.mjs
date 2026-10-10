import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage, openPhoneApp } from './helpers/browser.mjs';
import {
  moveBinderCard,
  makeItem,
  openPacks,
  addCards,
  transferWarehouseToTray,
} from '../src/game/model.js';
import { fixturePrintId } from './helpers/sorting-stacks.mjs';

const output = 'test-results/interface-fixes';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { errors: [], checks: [], turns: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = freshState();
  state.settings.sound = false;
  const printId = fixturePrintId('N');
  addCards(state, printId, 4);
  transferWarehouseToTray(state, printId, 4);
  for (const slot of [0, 6, 12, 18]) moveBinderCard(state, { printId }, slot);
  state.items = [makeItem('pack')];
  const { stack } = openPacks(state, [state.items[0].id], () => 0.6);
  await page.addInitScript((s) => {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
  }, state);
  page.on('pageerror', (error) => report.errors.push(error.message));
  const idle = () => page.waitForFunction(() => !document.body.classList.contains('navigating'));
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(`${output}/${name}.jpg`);
  await page.goto('http://127.0.0.1:5173');
  await navigatePage(page, 'album');
  for (const back of [false, true]) {
    await page.locator(`[data-action="album-${back ? 'prev' : 'next'}"]`).click();
    await page.waitForFunction(() =>
      document.getAnimations().some((a) => a.effect?.target?.matches?.('.book-turn-sheet')),
    );
    await page.evaluate(async () => {
      const layer = document.querySelector('.book-turn-layer');
      for (const a of document.getAnimations().filter((a) => layer.contains(a.effect?.target))) {
        a.pause();
        a.currentTime = 0;
      }
      const colors = ['#ffff00', '#ff0000', '#00ff00', '#0000ff'];
      for (const img of document.querySelectorAll('.album-book .album-slot img')) {
        // This probe uses solid colors to isolate page geometry; real finishes
        // are exercised by room-album-continuity and game-finishes.
        delete img.dataset.finishPrint;
        delete img.dataset.finishSerial;
        img.parentElement.querySelector('.card-finish-canvas')?.remove();
        img.parentElement.classList.remove('has-real-finish');
        const foil = img.parentElement.querySelector('.foil');
        if (foil) foil.style.display = 'none';
        const slot = Number(img.closest('[data-slot]').dataset.slot);
        img.src =
          'data:image/svg+xml,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="59" height="86"><rect width="59" height="86" fill="${colors[Math.floor(slot / 6)]}"/></svg>`,
          );
      }
      await Promise.all(
        [...document.querySelectorAll('.album-book img')].map((img) => img.decode()),
      );
    });
    const poses = [];
    for (const ms of [0, 140, 300, 440, 599.9]) {
      await page.evaluate((time) => {
        const layer = document.querySelector('.book-turn-layer');
        for (const a of document.getAnimations().filter((a) => layer.contains(a.effect?.target)))
          a.currentTime = time;
      }, ms);
      const png = await page.locator('.album-book').screenshot();
      const { data, info } = await sharp(png)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const colors = { red: 0, green: 0, blue: 0, yellow: 0 };
      for (let i = 0; i < data.length; i += info.channels) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 210 && g < 50 && b < 50) colors.red++;
        if (g > 210 && r < 50 && b < 50) colors.green++;
        if (b > 210 && r < 50 && g < 50) colors.blue++;
        if (r > 210 && g > 210 && b < 50) colors.yellow++;
      }
      poses.push({ ms, ...colors });
      await sharp(png)
        .resize({ width: 950, withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(`${output}/turn-${back ? 'back' : 'next'}-${Math.round(ms)}.jpg`);
    }
    if (!back) {
      assert.ok(poses[0].red > 3000);
      assert.ok(poses[2].blue > 1000, 'Incoming right page is exposed during the turn');
      assert.ok(poses[3].green > 1000, 'Incoming left page is on the reverse face during the turn');
      assert.ok(poses[3].red < 50, 'Outgoing artwork is not mirrored onto the reverse');
      assert.ok(poses[4].green > 3000 && poses[4].blue > 3000);
    } else {
      assert.ok(poses[0].green > 3000);
      assert.ok(poses[2].yellow > 1000);
      assert.ok(poses[3].red > 1000 && poses[3].green < 50);
      assert.ok(poses[4].red > 3000 && poses[4].yellow > 3000);
    }
    report.turns.push({ back, poses });
    await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.target?.closest?.('.book-turn-layer'))
        .forEach((a) => a.finish()),
    );
    await page.waitForSelector('.book-turn-layer', { state: 'detached' });
  }
  report.checks.push(
    'Both incoming pages appear during forward and reverse turns; outgoing artwork never appears on the reverse face',
  );
  await navigatePage(page, 'home');
  await navigatePage(page, 'shop');
  assert.equal(await page.locator('.phone-hand').count(), 0);
  const arrows = await page.locator('.phone-apps>button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const arrow = button.querySelector('i').getBoundingClientRect();
      const option = button.querySelector('.phone-conversation').getBoundingClientRect();
      return arrow.right < option.right - 8;
    }),
  );
  assert.ok(arrows.every(Boolean));
  await shot('purchase');
  await openPhoneApp(page, 'tao');
  await page.locator('.purchase-overlay').click({ position: { x: 30, y: 120 } });
  await page.waitForSelector('.purchase-overlay', { state: 'detached' });
  assert.equal(await page.locator('#app').evaluate((el) => el.inert), false);
  report.checks.push(
    'Phone has no hand; app arrows stay inside options; clicking outside an app closes purchase',
  );
  await page.locator('.tile-settings').click();
  await page.waitForSelector('.settings-route-wipe');
  assert.equal(
    await page.locator('#page-transition .motif-rail,.settings-route-options').count(),
    0,
  );
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('#page-transition'))
      .forEach((a) => {
        a.pause();
        a.currentTime = 210;
      }),
  );
  const reveal = await page.locator('.settings-route-wipe').evaluate((el) => {
    window.preparedSettingsPage = el.querySelector('.settings-page');
    window.preparedSettingsScene = el
      .querySelector('.settings-scene')
      .getBoundingClientRect()
      .toJSON();
    const track = el.getAnimations()[0];
    return {
      clip: getComputedStyle(el).clipPath,
      frames: track.effect.getKeyframes().map((frame) => frame.clipPath),
    };
  });
  assert.deepEqual(reveal.frames, ['circle(22px at 28% 50%)', 'circle(145% at 28% 50%)']);
  assert.notEqual(reveal.clip, reveal.frames[0]);
  assert.notEqual(reveal.clip, reveal.frames[1]);
  await shot('settings-transition');
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('#page-transition'))
      .forEach((a) => a.play()),
  );
  await idle();
  assert.equal(
    await page.evaluate(
      () => window.preparedSettingsPage === document.querySelector('#app>.settings-page'),
    ),
    true,
  );
  assert.deepEqual(
    await page.locator('.settings-scene').evaluate((el) => el.getBoundingClientRect().toJSON()),
    await page.evaluate(() => window.preparedSettingsScene),
  );
  assert.equal(await page.locator('.topbar,.mini-nav,.workspace-rail,.footer').count(), 0);
  assert.equal(await page.locator('.settings-menu>button').count(), 3);
  assert.equal(await page.locator('.settings-menu>button>.icon').count(), 0);
  assert.deepEqual(await page.locator('.settings-menu>button').allInnerTexts(), [
    'CONFIG',
    'DATA SAVE',
    'RETURNtoTITLE',
  ]);
  assert.equal(await page.locator('#settings-rules,[data-section="settings-rules"]').count(), 0);
  assert.ok(
    (await page.locator('.settings-feature-card img').getAttribute('src')).endsWith(
      'reload-dragon.svg',
    ),
  );
  await page.mouse.move(1400, 50);
  assert.ok(
    (
      await page
        .locator('.settings-menu>button')
        .evaluateAll((buttons) =>
          buttons.map((el) => getComputedStyle(el, '::before').backgroundColor),
        )
    ).every((color) => color === 'rgba(0, 0, 0, 0)'),
  );
  const shapes = [];
  for (let i = 0; i < 3; i++) {
    const button = page.locator('.settings-menu>button').nth(i);
    await button.hover();
    shapes.push(await button.evaluate((el) => getComputedStyle(el, '::before').clipPath));
    assert.equal(
      await button.evaluate((el) => getComputedStyle(el, '::before').backgroundColor),
      'rgb(255, 255, 255)',
    );
    assert.equal(
      await button.evaluate((el) => getComputedStyle(el, '::after').backgroundColor),
      'rgb(255, 57, 180)',
    );
    assert.equal(await button.evaluate((el) => getComputedStyle(el).color), 'rgb(239, 0, 28)');
  }
  assert.equal(new Set(shapes).size, 3);
  await shot('settings');
  await page.locator('.settings-menu [data-action="home"]').click();
  await idle();
  report.checks.push(
    'English staggered menu; white and pink irregular hover banners; one circle expands from the left center with no transition options',
  );
  for (const target of ['album', 'warehouse', 'settings']) {
    await navigatePage(page, 'open');
    await page.waitForSelector('canvas[data-presented="true"]');
    const action =
      target === 'settings'
        ? '.space-settings'
        : `.world-${target === 'album' ? 'album' : 'warehouse'}`;
    if (target === 'settings') {
      await page.locator('.world-album').press('Enter');
      await page.waitForFunction(
        () =>
          document.body.dataset.page === 'album' && !document.querySelector('.room-portal-layer'),
      );
      await page.locator('.mini-nav [data-page="settings"]').click();
    } else await page.locator(action).press('Enter');
    await page.waitForFunction(
      (target) =>
        document.body.dataset.page === target &&
        !document.body.classList.contains('navigating') &&
        !document.querySelector('.room-portal-layer'),
      target,
    );
    await page.keyboard.press('Escape');
    await idle();
    assert.equal(await page.evaluate(() => document.body.dataset.page), 'open');
    await navigatePage(page, 'home');
  }
  report.checks.push(
    'Escape returns collection, warehouse and settings to their originating opening room',
  );
  await navigatePage(page, 'open');
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.locator('.world-stack').press('Enter');
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  assert.equal(await page.locator('.inspect-rarity').count(), 0);
  for (const destination of ['collection', 'warehouse']) {
    await page.locator(`[data-route-one="${destination}"]`).click();
    await page.waitForFunction(() =>
      document.getAnimations().some((a) => a.effect?.target?.matches?.('.inspect-route-flight')),
    );
    const track = await page.evaluate(() => {
      const a = document
        .getAnimations()
        .find((a) => a.effect?.target?.matches?.('.inspect-route-flight'));
      a.pause();
      window.shiftTrack = a;
      return a.effect.getKeyframes().map((f) => f.transform);
    });
    assert.notEqual(track[0], track.at(-1));
    await page.evaluate(() => {
      window.shiftTrack.currentTime = 120;
    });
    await shot(`shift-${destination}`);
    await page.evaluate(() => {
      document
        .getAnimations()
        .filter((a) => a.effect?.target?.matches?.('.inspect-route-flight,.card-destination'))
        .forEach((a) => a.finish());
    });
    await page.waitForFunction(() => !document.querySelector('.inspect-route-flight'));
    await page.waitForSelector('.card-inspector[data-phase="open"]');
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
  assert.equal(
    saved.cardStacks.find((s) => s.id === stack.id).cards.length,
    stack.cards.length - 2,
  );
  assert.equal(await page.locator('.inspect-route-flight').count(), 0);
  report.checks.push(
    'Sorting cards have no rarity badge; collection and warehouse routing animate the routed cards',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, checks: report.checks }));
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
