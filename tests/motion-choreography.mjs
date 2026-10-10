import { freshState } from './helpers/starter-state.mjs';
import { browserOptions, openPhoneApp } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { RARITIES } from '../src/game/model.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const output = 'test-results/motion-study';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { routes: [], errors: [], checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    state = freshState();
  state.settings.sound = false;
  for (const r of RARITIES) {
    state.cards[r.id] = 4;
    state.collection[r.id] = 1;
  }
  await page.addInitScript(
    (s) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s)),
    state,
  );
  page.on('pageerror', (e) => report.errors.push(e.message));
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
    );
  const bookIdle = () =>
    page.waitForFunction(
      () =>
        !document.querySelector('.book-outgoing') && !document.querySelector('.album-book')?.inert,
    );
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 960 })
      .jpeg({ quality: 80 })
      .toFile(`${output}/${name}.jpg`);
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(() => document.fonts.ready);
  for (const route of ['album', 'warehouse', 'shop', 'settings', 'open']) {
    await page.locator(`.tile-${route}`).click();
    await page.waitForFunction(
      () =>
        document
          .getAnimations()
          .filter(
            (a) => a.effect?.target?.closest?.('#page-transition') && a.playState === 'running',
          ).length > 2,
    );
    const cover = await page.evaluate(() => {
      const layer = document.querySelector('#page-transition');
      window.coverTracks = document
        .getAnimations()
        .filter(
          (a) => a.effect?.target?.closest?.('#page-transition') && a.playState === 'running',
        );
      const bad = window.coverTracks
        .flatMap((a) => a.effect.getKeyframes())
        .some((f) => 'clipPath' in f);
      for (const a of window.coverTracks) {
        a.pause();
        const t = a.effect.getTiming();
        a.currentTime = Number(t.delay) + Number(t.duration) * 0.6;
      }
      return {
        family: layer.dataset.family,
        panes: layer.querySelectorAll('.transition-pane').length,
        tracks: window.coverTracks.length,
        animatedClipPath: bad,
      };
    });
    assert.ok(cover.tracks >= 10, `${route} lacks independent motion`);
    assert.equal(cover.animatedClipPath, false);
    await shot(`${route}-cover`);
    await page.evaluate(() => {
      window.revealCaptured = false;
      const layer = document.querySelector('#page-transition'),
        observer = new MutationObserver(() => {
          if (layer.dataset.phase !== 'revealing') return;
          observer.disconnect();
          window.revealTracks = document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                (a.effect?.target?.closest?.('#page-transition') ||
                  a.effect?.target?.closest?.('#app')),
            );
          for (const a of window.revealTracks) {
            a.pause();
            const t = a.effect.getTiming();
            a.currentTime = Number(t.delay) + Number(t.duration) * 0.48;
          }
          window.revealCaptured = true;
        });
      observer.observe(layer, { attributes: true, attributeFilter: ['data-phase'] });
      window.coverTracks.forEach((a) => a.play());
    });
    await page.waitForFunction(() => window.revealCaptured);
    await shot(`${route}-reveal`);
    await page.evaluate(() => window.revealTracks.forEach((a) => a.play()));
    await idle();
    report.routes.push({ route, ...cover });
    await page.keyboard.press('Escape');
    await idle();
  }
  assert.equal(new Set(report.routes.map((r) => r.family)).size, 5);
  report.checks.push(
    'five distinct silhouettes; independent type, motifs and page entrances; no animated clip-path',
  );
  await page.locator('.tile-album').click();
  await idle();
  await page.locator('[data-action="album-next"]').click();
  assert.equal(await page.locator('.book-outgoing').count(), 1);
  assert.equal(await page.locator('.book-outgoing [data-action]').count(), 0);
  await page.evaluate(() => {
    window.leafTracks = document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('.album-book'));
    for (const a of window.leafTracks) {
      a.pause();
      const t = a.effect.getTiming();
      a.currentTime = Number(t.delay) + Number(t.duration) * 0.45;
    }
  });
  await shot('book-turn');
  await page.evaluate(() => window.leafTracks.forEach((a) => a.play()));
  await bookIdle();
  await page.evaluate(() => {
    document.querySelector('[data-action="album-prev"]').click();
    document.querySelector('[data-action="album-next"]').click();
    document.querySelector('[data-action="album-prev"]').click();
  });
  await bookIdle();
  assert.equal(await page.locator('.album-slot.owned').count(), 5);
  assert.equal(await page.locator('.book-outgoing').count(), 0);
  await page.locator('[data-action="album-next"]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bookIdle();
  assert.equal(await page.locator('.future-slot').count(), 6);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  report.checks.push(
    'outgoing page turns physically; rapid paging and live reduced motion release page locks',
  );
  await page.locator('.mini-nav [data-page="shop"]').click();
  await idle();
  await openPhoneApp(page, 'jhs');
  await page.waitForFunction(
    () => document.querySelector('#phone-content').dataset.localTransition === 'app',
  );
  const local = await page.evaluate(() => {
    window.phoneTracks = document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.('#phone-content'));
    for (const a of window.phoneTracks) {
      a.pause();
      const t = a.effect.getTiming();
      a.currentTime = Number(t.delay) + Number(t.duration) * 0.55;
    }
    return {
      tracks: window.phoneTracks.length,
      duplicateActions: document.querySelectorAll('.local-outgoing [data-action]').length,
    };
  });
  assert.ok(local.tracks >= 5);
  assert.equal(local.duplicateActions, 0);
  await page.evaluate(async () => {
    await Promise.all(window.phoneTracks.map((a) => a.ready));
    for (const a of window.phoneTracks) {
      const t = a.effect.getTiming();
      a.currentTime = Number(t.delay) + Number(t.duration) * 0.55;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  assert.ok(
    (await page
      .locator('#phone-content>.market-app')
      .evaluate((e) => Number(getComputedStyle(e).opacity))) > 0.5,
  );
  await shot('phone-launch');
  await page.evaluate(() => window.phoneTracks.forEach((a) => a.play()));
  await page.waitForFunction(
    () => !document.querySelector('#phone-content').dataset.localTransition,
  );
  assert.equal(await page.locator('[data-action="app-tab"], .app-history, .app-wallet').count(), 0);
  report.checks.push(
    'phone launch staggers cards; labels slide in both directions without duplicate actions',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['album', 'warehouse', 'settings', 'shop']) {
    await page.locator(`.mini-nav [data-page="${route}"]`).click();
    await idle();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await fs.writeFile(`${output}/choreography.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      routes: report.routes,
      checks: report.checks.length,
      errors: report.errors,
    }),
  );
} finally {
  await browser.close();
}
