import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, _electron } from 'playwright';
import { browserOptions, navigatePage, dragAlbumCard } from './helpers/browser.mjs';
import { makeItem, openPacks, addCards, transferWarehouseToTray } from '../src/game/model.js';
import { CARD_PRINTS } from '../src/game/card-data.js';
import { CARD_STEP, SIZES } from '../src/scene/packing.js';

const output = process.env.YGO_AUDIO_OUTPUT || 'test-results/half-sound-default50-20261010';
await fs.mkdir(output, { recursive: true });
const desktop = process.env.YGO_AUDIO_DESKTOP === '1';
const prefix = desktop ? 'desktop' : 'browser';
const state = freshState();
state.settings = { ...state.settings, sound: true, music: false, motion: false };
// Older saves without volume should render the new 50% default in the settings page.
delete state.settings.volume;
state.items = Array.from({ length: 2 }, () => makeItem('pack'));
const first = openPacks(state, [state.items[0].id]).stack;
const second = openPacks(state, [state.items[0].id]).stack;
const soundPackages = ['pack', 'box', 'case'].map((kind) => ({
  ...makeItem(kind),
  isNew: false,
  pose3d: {
    position:
      kind === 'case'
        ? [-5, 0.044 + SIZES.case[1] / 2, -1.8]
        : kind === 'box'
          ? [0, 0.044 + SIZES.box[1] / 2, -3.2]
          : [2, 0.044 + SIZES.pack[2] / 2, -1.5],
    quaternion: kind === 'pack' ? [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1],
  },
}));
state.items.push(...soundPackages);
[first, second].forEach((stack, i) => {
  stack.pose3d = {
    position: [i * 3, 0.084 + (stack.cards.length * CARD_STEP) / 2, 1.35],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  };
});
const print = CARD_PRINTS.find((p) => p.rarity === 'PSER');
addCards(state, print.id, 4);
transferWarehouseToTray(state, print.id, 3);
const sampleSizes = {};
for (const file of ['p3r-hover', 'p3r-navigate', 'p3r-tab', 'p3r-confirm', 'card-2'])
  sampleSizes[(await fs.stat(`public/assets/audio/${file}.wav`)).size] = file.replace(/^p3r-/, '');
const errors = [],
  checks = [];
let app;
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${output}/audio-profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await app.firstWindow();
    await page.locator('.home-menu').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.context().setOffline(true);
  } else {
    app = await chromium.launch({ ...browserOptions, headless: true });
    page = await app.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  await page.addInitScript(
    ({ state, sampleSizes }) => {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      window.audioProbe = { plays: [], decoded: [], oscillators: 0 };
      const labels = new WeakMap();
      const Audio = window.AudioContext || window.webkitAudioContext;
      const decode = Audio.prototype.decodeAudioData;
      Audio.prototype.decodeAudioData = async function (bytes) {
        const label = sampleSizes[bytes.byteLength];
        const buffer = await decode.call(this, bytes);
        labels.set(buffer, label);
        audioProbe.decoded.push({ label, duration: buffer.duration, length: buffer.length });
        return buffer;
      };
      const create = Audio.prototype.createBufferSource;
      Audio.prototype.createBufferSource = function () {
        const source = create.call(this),
          connect = source.connect,
          start = source.start;
        let gain;
        source.connect = function (node) {
          gain = node;
          return connect.call(this, node);
        };
        source.start = function (...args) {
          const play = {
            sample: labels.get(this.buffer),
            volume: gain?.gain.value,
            time: performance.now(),
          };
          audioProbe.plays.push(play);
          (audioProbe.allPlays ??= []).push(play);
          return start.apply(this, args);
        };
        return source;
      };
      const oscillator = Audio.prototype.createOscillator;
      Audio.prototype.createOscillator = function () {
        audioProbe.oscillators++;
        return oscillator.call(this);
      };
    },
    { state, sampleSizes },
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  await page.waitForFunction(() => !document.body.classList.contains('navigating'));

  async function expectSound(label, action, expected) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    // Isolate click/card audio; navigation hover has its own positive and negative checks.
    await page.evaluate(() => {
      audioProbe.blockHover = (e) => e.stopImmediatePropagation();
      document.addEventListener('pointerover', audioProbe.blockHover, true);
    });
    await page.evaluate(() => {
      audioProbe.plays = [];
    });
    try {
      await action();
    } finally {
      await page.evaluate(() =>
        document.removeEventListener('pointerover', audioProbe.blockHover, true),
      );
    }
    await page.waitForFunction(() => audioProbe.plays.some((p) => p.sample !== 'hover'));
    const plays = await page.evaluate(() => audioProbe.plays.filter((p) => p.sample !== 'hover'));
    assert.ok(
      plays.length > 0 && plays.every((p) => expected.includes(p.sample)),
      `${label}: ${JSON.stringify(plays)}`,
    );
    const volume = await page.evaluate(
      () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).settings.volume,
    );
    const sampleScales = { 'card-2': 1 / 3, tab: 0.35, navigate: 0.225, confirm: 0.3 };
    assert.ok(
      plays.every((p) => Math.abs(p.volume - (volume / 100) * sampleScales[p.sample]) < 1e-6),
      `${label}: every sound must use half its previous gain`,
    );
    checks.push({ label, plays });
  }
  async function silentHover(label, selector) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      audioProbe.plays = [];
    });
    await page.locator(selector).first().hover();
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => audioProbe.plays.filter((p) => p.sample === 'hover').length),
      0,
      label,
    );
    checks.push({ label, silentHover: true });
  }
  async function expectSilence(label, action) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      audioProbe.plays = [];
      audioProbe.blockHover = (e) => e.stopImmediatePropagation();
      document.addEventListener('pointerover', audioProbe.blockHover, true);
    });
    try {
      await action();
      await page.waitForTimeout(200);
    } finally {
      await page.evaluate(() =>
        document.removeEventListener('pointerover', audioProbe.blockHover, true),
      );
    }
    assert.equal(await page.evaluate(() => audioProbe.plays.length), 0, label);
    checks.push({ label, silent: true });
  }
  await expectSound('navigation and first gesture decode', () => navigatePage(page, 'album'), [
    'navigate',
  ]);
  await page.waitForFunction(() => audioProbe.decoded.length === 5);
  const decoded = await page.evaluate(() => audioProbe.decoded);
  assert.deepEqual(decoded.map((b) => b.label).sort(), Object.values(sampleSizes).sort());
  assert.ok(decoded.every((b) => b.duration > 0 && b.length > 0));
  await expectSound(
    'album next page card 2',
    () => page.locator('#app [data-action="album-next"]').press('Enter'),
    ['card-2'],
  );
  await page.waitForFunction(() => !document.querySelector('.book-turn-layer'));
  await expectSound(
    'album previous page card 2',
    () => page.locator('#app [data-action="album-prev"]').press('Enter'),
    ['card-2'],
  );
  await page.waitForFunction(() => !document.querySelector('.book-turn-layer'));
  await silentHover('album cards have no hover sound', '[data-album-source="tray"]');
  await silentHover('empty pockets have no hover sound', '[data-slot="0"]');
  await silentHover('return has no hover sound', '.rail-home');
  await silentHover('currency has no hover sound', '.currency');
  assert.equal(await page.locator('[data-action="toggle-music"]').count(), 0);
  await page.evaluate(() => {
    Math.random = () => 0.25;
  });
  await expectSound(
    'album insertion uses card 2 with low random value',
    () =>
      dragAlbumCard(
        page,
        `[data-album-source="tray"][data-rarity="${print.id}"]`,
        '[data-slot="0"]',
      ),
    ['card-2'],
  );
  await page.evaluate(() => {
    Math.random = () => 0.75;
  });
  await expectSound(
    'album removal uses card 2 with high random value',
    () => dragAlbumCard(page, '[data-slot="0"]', '[data-album-drop="tray"]'),
    ['card-2'],
  );
  await expectSound(
    'album direct warehouse',
    () =>
      dragAlbumCard(
        page,
        `[data-album-source="tray"][data-rarity="${print.id}"]`,
        '[data-album-drop="warehouse"]',
      ),
    ['card-2'],
  );
  await navigatePage(page, 'warehouse');
  await expectSound(
    'warehouse preview',
    () => page.locator(`[data-action="warehouse-preview"][data-rarity="${print.id}"]`).click(),
    ['card-2'],
  );
  await expectSound(
    'warehouse to album tray',
    () =>
      page.locator(`[data-action="warehouse-transfer"][data-rarity="${print.id}"]`).first().click(),
    ['card-2'],
  );
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('canvas')
      .world3D.snapshot()
      .stacks.every((s) => s.finish?.ready),
  );
  const hoverStackPoint = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api.projectPoint(api.snapshot().stacks[0].position);
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    audioProbe.plays = [];
  });
  await page.mouse.move(hoverStackPoint.x, hoverStackPoint.y);
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => audioProbe.plays.filter((p) => p.sample === 'hover').length),
    0,
    'table stack hover must stay silent',
  );
  checks.push({ label: 'table stack hover is silent' });
  await page.evaluate(() => {
    Math.random = () => 0.25;
  });
  await expectSound('stack inspection', () => page.locator('.world-stack').first().press('Enter'), [
    'card-2',
  ]);
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  await expectSilence('sorting return is silent', () => page.locator('.inspect-return').click());
  await page.locator('.card-inspector').waitFor({ state: 'detached' });
  await expectSound(
    'reopen stack after silent return',
    () => page.locator('.world-stack').first().press('Enter'),
    ['card-2'],
  );
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  await silentHover('sorting cards have no hover sound', '.inspect-card:last-child');
  await silentHover('sorting route buttons have no hover sound', '[data-route-one="collection"]');
  await expectSound('sorting card selection', () => page.locator('.inspect-card').last().click(), [
    'card-2',
  ]);
  await expectSound(
    'sorting single card to collection',
    () => page.locator('[data-route-one="collection"]').click(),
    ['card-2'],
  );
  await expectSound(
    'sorting warehouse picker',
    () => page.locator('[data-warehouse-picker]').click(),
    ['card-2'],
  );
  await expectSound('sorting batch warehouse', () => page.locator('[data-route-confirm]').click(), [
    'card-2',
  ]);
  await page.locator('.card-inspector').waitFor({ state: 'detached' });
  const point = await page.evaluate(() => {
    const api = document.querySelector('canvas').world3D;
    return api.projectPoint(api.snapshot().stacks[0].position);
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await silentHover('stack context menu has no hover sound', '[data-store-stack]');
  await expectSound(
    'table stack context storage',
    () => page.locator('[data-store-stack]').click(),
    ['card-2'],
  );
  for (const item of soundPackages) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      audioProbe.plays = [];
    });
    const point = await page.evaluate((id) => {
      const api = document.querySelector('canvas').world3D;
      const point = api.projectItem(id);
      return { ...point, hit: api.hitAt(point.x, point.y) };
    }, item.id);
    assert.equal(point.hit, item.id, `${item.kind} projection must hit its own package`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      (id) => document.querySelector('canvas').world3D.snapshot().selected.includes(id),
      item.id,
    );
    await page.waitForTimeout(200);
    await page.waitForFunction((id) => {
      const api = document.querySelector('canvas').world3D;
      const point = api.projectItem(id);
      return api.snapshot().animations.length === 0 && api.hitAt(point.x, point.y) === id;
    }, item.id);
    const dragPoint = await page.evaluate(
      (id) => document.querySelector('canvas').world3D.projectItem(id),
      item.id,
    );
    await page.mouse.move(dragPoint.x, dragPoint.y);
    await page.mouse.down();
    await page.mouse.move(dragPoint.x + 40, dragPoint.y + 16, { steps: 8 });
    await page
      .waitForFunction(
        (id) => document.querySelector('canvas').world3D.snapshot().held.includes(id),
        item.id,
        { timeout: 3000 },
      )
      .catch(async (error) => {
        const snapshot = await page.evaluate(() => {
          const state = document.querySelector('canvas').world3D.snapshot();
          return { selected: state.selected, held: state.held };
        });
        error.message = `${item.kind} drag: ${error.message}; ${JSON.stringify(snapshot)}`;
        throw error;
      });
    await page.mouse.up();
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => audioProbe.plays.length),
      0,
      `${item.kind} selection/drag/drop must stay silent`,
    );
    await page.locator(`[data-item="${item.id}"]`).press('Enter');
    await page.waitForFunction(
      () => document.querySelector('canvas').world3D.snapshot().animations.length === 0,
    );
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => audioProbe.plays.length),
      0,
      `opening ${item.kind} must stay silent`,
    );
    checks.push({ label: `opening ${item.kind} has no sound` });
  }
  await expectSilence('return to home is silent', () => navigatePage(page, 'home'));
  await silentHover('exit has no hover sound', '.tile-exit');
  for (const name of ['open', 'album', 'warehouse', 'shop', 'settings']) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      audioProbe.plays = [];
    });
    await page.locator(`.tile-${name}`).hover();
    await page.waitForFunction(() => audioProbe.plays.some((p) => p.sample === 'hover'));
    assert.equal(
      await page.evaluate(() => audioProbe.plays.filter((p) => p.sample === 'hover').length),
      1,
    );
    checks.push({ label: `${name} navigation hover enabled` });
  }

  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    audioProbe.plays = [];
  });
  const tile = page.locator('.tile-album');
  await tile.hover();
  await page.waitForFunction(() => audioProbe.plays.some((p) => p.sample === 'hover'));
  await page.evaluate(() => {
    const tile = document.querySelector('.tile-album');
    tile
      .querySelector('strong')
      .dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: tile }));
  });
  assert.equal(
    await page.evaluate(() => audioProbe.plays.filter((p) => p.sample === 'hover').length),
    1,
    'hovering child elements must not replay',
  );
  checks.push({ label: 'hover sample without duplicate child hover' });
  const hoverPlays = await page.evaluate(() =>
    audioProbe.plays.filter((p) => p.sample === 'hover'),
  );
  assert.ok(hoverPlays.every((p) => Math.abs(p.volume - 0.5 * 0.55 * 0.5) < 1e-6));
  await navigatePage(page, 'shop');
  await silentHover('purchase phone apps have no hover sound', '[data-action="phone-app"]');
  await expectSound(
    'phone app tab sample',
    () => page.locator('.phone-apps [data-app="tao"]').click(),
    ['tab'],
  );
  await page.waitForFunction(
    () => !document.querySelector('#phone-content')?.dataset.localTransition,
  );
  await expectSound(
    'product selection click sample',
    () => page.locator('.tao-product[data-kind="pack"]').click(),
    ['tab'],
  );
  const coinsBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).coins,
  );
  await expectSound(
    'purchase confirmation sample',
    () => page.locator('[data-action="buy"]').click(),
    ['confirm'],
  );
  assert.ok(
    await page.evaluate(
      (coinsBefore) => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')).coins < coinsBefore,
      coinsBefore,
    ),
  );
  await page.locator('.success-modal [data-action="close"]').click();
  await navigatePage(page, 'home');

  await navigatePage(page, 'settings');
  await expectSound(
    'settings tab sample',
    () => page.locator('[data-action="settings-section"][data-section="settings-audio"]').click(),
    ['tab'],
  );
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  assert.equal(await page.locator('[data-setting="volume"]').inputValue(), '50');
  assert.equal(
    await page.locator('[data-setting="volume"]').locator('..').locator('span').textContent(),
    '50%',
  );
  await sharp(await page.screenshot())
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(`${output}/${prefix}-default-volume.jpg`);
  checks.push({ label: 'settings default sound volume is 50%' });
  await silentHover(
    'settings controls have no hover sound',
    '[data-action="setting-toggle"][data-setting="sound"]',
  );
  await page.locator('[data-setting="volume"]').evaluate((input) => {
    input.value = '25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectSound(
    'volume 25%',
    () => page.locator('[data-action="setting-toggle"][data-setting="motion"]').click(),
    ['tab'],
  );
  assert.ok(checks.at(-1).plays.every((p) => Math.abs(p.volume - 0.0875) < 1e-6));
  await page.locator('[data-action="setting-toggle"][data-setting="sound"]').click();
  await page.evaluate(() => {
    audioProbe.plays = [];
  });
  await page.locator('[data-action="setting-toggle"][data-setting="motion"]').click();
  await page.mouse.move(0, 0);
  await page.locator('[data-action="setting-toggle"][data-setting="sound"]').hover();
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => audioProbe.plays.length),
    0,
    'mute blocks click, hover and pending playback',
  );
  await page.locator('[data-action="setting-toggle"][data-setting="sound"]').click();
  await expectSound(
    'sound restored',
    () => page.locator('[data-action="setting-toggle"][data-setting="motion"]').click(),
    ['tab'],
  );
  await page.evaluate(() => {
    audioProbe.plays = [];
    for (let i = 0; i < 2; i++) {
      document.querySelector('[data-action="setting-toggle"][data-setting="motion"]').click();
    }
  });
  const rapidPlays = await page.evaluate(() => audioProbe.plays);
  assert.equal(rapidPlays.length, 2, 'both immediate clicks must play');
  assert.ok(rapidPlays.every((p) => p.sample === 'tab'));
  assert.ok(rapidPlays[1].time - rapidPlays[0].time < 300);
  checks.push({ label: 'rapid clicks have no playback cooldown', plays: rapidPlays });
  assert.equal(
    await page.evaluate(() => audioProbe.oscillators),
    0,
    'no synthesized interaction audio remains',
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#settings-audio [data-setting]').count(), 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await sharp(await page.screenshot())
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toFile(`${output}/${prefix}-settings-audio-${width}.jpg`);
    for (const key of ['sound', 'volume']) {
      await page.locator(`[data-setting="${key}"]`).scrollIntoViewIfNeeded();
      assert.ok(await page.locator(`[data-setting="${key}"]`).isVisible());
    }
    checks.push({ label: `audio settings controls accessible at ${width}px` });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/${prefix}-audio.json`,
    JSON.stringify({ passed: true, decoded, checks, errors }, null, 2),
  );
  console.log(
    `Audio ${prefix}: all sound gains halved, settings default 50%; click/tab, card 2, silent return, package silence, rapid clicks and mute passed.`,
  );
} finally {
  await app?.close();
}
