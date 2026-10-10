import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions, navigatePage, closePurchase } from './helpers/browser.mjs';
import { RARITIES, addCards } from '../src/game/model.js';
import { fixturePrintId } from './helpers/sorting-stacks.mjs';
const output = 'test-results/persona-navigation';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { routes: [], checks: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = freshState();
  state.settings.sound = false;
  for (const r of RARITIES) addCards(state, fixturePrintId(r.id), 5);
  await page.addInitScript((s) => {
    if (!localStorage.getItem('navigation-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('navigation-fixture', '1');
    }
  }, state);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  const idle = () =>
    page.waitForFunction(
      () =>
        !document.body.classList.contains('navigating') &&
        (!document.querySelector('.purchase-overlay') ||
          document.querySelector('.purchase-overlay').dataset.phase === 'open'),
    );
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const target of ['album', 'warehouse', 'shop', 'settings', 'open']) {
      const snapshot = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
      );
      await page.locator(`.tile-${target}`).click();
      if (['open', 'album', 'warehouse'].includes(target)) {
        await page.waitForFunction(() =>
          document.getAnimations().some((a) => a.effect?.target?.closest?.('#page-transition')),
        );
        const rates = await page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => a.effect?.target?.closest?.('#page-transition'))
            .map((a) => a.playbackRate),
        );
        assert.ok(rates.length > 0 && rates.every((rate) => rate === 0.85), `${target}: ${rates}`);
      }
      if (target === 'shop') {
        await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
        assert.equal(await page.locator('#app').evaluate((el) => el.inert), true);
        await closePurchase(page);
      } else {
        await idle();
        assert.equal(await page.evaluate(() => document.body.dataset.page), target);
        assert.equal(await page.locator('#app').evaluate((el) => el.inert), false);
        assert.equal(await page.locator('#page-transition').isHidden(), true);
        if (target === 'open') await page.waitForSelector('canvas[data-presented="true"]');
        await navigatePage(page, 'home');
      }
      const after = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('ygo-duel-archive-v1')),
      );
      assert.deepEqual(after.cards, snapshot.cards);
      assert.deepEqual(after.collection, snapshot.collection);
      assert.equal(after.items.length, snapshot.items.length);
      assert.equal(after.coins, snapshot.coins);
      assert.equal(await page.locator('.room-portal-layer,.purchase-overlay').count(), 0);
      report.routes.push({ target, width: size.width, returned: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.ok(await page.locator('.settings-persona.is-system').isVisible());
  await page.locator('[data-section="settings-save"]').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.ok(await page.locator('[data-action="export"]').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.equal(await page.locator('[data-section="settings-rules"],#settings-rules').count(), 0);
  await page.locator('.settings-menu [data-action="home"]').click();
  await idle();
  report.checks.push(
    'CONFIG and SAVE open from SYSTEM; Escape returns to SYSTEM; HOME replaces RULES',
  );
  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('[data-section="settings-save"]').click();
  await page.locator('.settings-section-transition[data-kind="switch"]').waitFor();
  assert.equal(await page.locator('.settings-section-transition').evaluate((el) => el.inert), true);
  const motionBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).settings.motion,
  );
  await page.locator('#app [data-setting="motion"]').evaluate((el) => el.click());
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).settings.motion,
    ),
    motionBefore,
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.ok(await page.locator('[data-action="export"]').isVisible());
  assert.equal(await page.locator('#app .settings-persona').evaluate((el) => el.inert), false);
  await page.locator('[data-section="settings-audio"]').click();
  await page.locator('.settings-section-transition[data-kind="switch"]').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.equal(await page.locator('.settings-secondary-next,.settings-section-flight').count(), 0);
  assert.ok(await page.locator('[data-setting="motion"]').isVisible());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await navigatePage(page, 'home');
  report.checks.push('Escape and reduced motion complete secondary switches and release input');
  await page.locator('.tile-settings').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await idle();
  await navigatePage(page, 'home');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await navigatePage(page, 'settings');
  await page.locator('.settings-menu [data-action="home"]').click();
  await page.locator('.home-route-reveal').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await idle();
  assert.equal(await page.locator('.home-route-reveal,.settings-page').count(), 0);
  assert.equal(await page.locator('.home-menu').count(), 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.tile-album').click();
  await page.setViewportSize({ width: 1000, height: 700 });
  await idle();
  await navigatePage(page, 'home');
  await navigatePage(page, 'settings');
  await page.locator('[data-section="settings-audio"]').click();
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await page.locator('[data-setting="motion"]').click();
  await navigatePage(page, 'home');
  await navigatePage(page, 'shop');
  await closePurchase(page);
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).settings.motion,
    ),
    false,
  );
  assert.equal(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('#page-transition,.purchase-overlay')).length,
    ),
    0,
  );
  report.checks.push(
    'Ten route roundtrips across desktop and narrow screens preserve inventory and release input',
    'Resize, live reduced motion and game motion preference finish navigation cleanly',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report));
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
