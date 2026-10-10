import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeItem } from '../src/game/model.js';
import { openFixturePacks as openPacks } from './helpers/sorting-stacks.mjs';
import { CARD_STEP } from '../src/scene/packing.js';
import { ROOM_ZOOM } from '../src/scene/room-view.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'),
  sharp = require('sharp');
const output = 'test-results/inspector-transitions';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1778, height: 1067 } }),
  state = freshState(),
  errors = [],
  report = { checks: [] };
state.settings.sound = false;
state.items = Array.from({ length: 6 }, () => makeItem('pack'));
openPacks(
  state,
  state.items.slice(0, 5).map((i) => i.id),
  () => 0.9,
);
openPacks(state, [state.items[0].id], () => 0.6);
state.cardStacks.forEach(
  (s, i) =>
    (s.pose3d = {
      position: [i ? 1.2 : -1.2, 0.084 + (s.cards.length * CARD_STEP) / 2, 1.35],
      quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    }),
);
state.spaceView = { orbit: { theta: 0, phi: 0.86, distance: 90 }, target: [0, 0.04, 0] };
await page.addInitScript((s) => {
  if (!localStorage.getItem('inspector-fixture')) {
    localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
    localStorage.setItem('inspector-fixture', '1');
  }
}, state);
page.on('pageerror', (e) => errors.push(e.message));
const snap = () => page.evaluate(() => document.querySelector('canvas').world3D.snapshot());
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1')));
const room = async () => {
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(
    () =>
      document.querySelector('#page-transition').hidden && !document.querySelector('#app').inert,
  );
};
const open = async () => {
  await page.locator('.world-stack').first().press('Enter');
  await page.waitForSelector('.card-inspector[data-phase="open"]');
};
const returned = () =>
  page.waitForFunction(() => !document.querySelector('.card-inspector,.inspect-transition-layer'));
const shot = async (name) =>
  sharp(await page.screenshot())
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(`${output}/${name}.webp`);
const pause = async (progress) =>
  page.evaluate(async (progress) => {
    // A route flight may be cancelled while the return tracks are being created.
    // Recapture after that cancellation instead of awaiting stale animation handles.
    for (let attempt = 0; attempt < 3; attempt++) {
      window.inspectTracks = document
        .getAnimations()
        .filter((a) => a.effect?.target?.closest?.('.card-inspector,.inspect-transition-layer'));
      for (const a of window.inspectTracks) a.pause();
      const results = await Promise.allSettled(window.inspectTracks.map((a) => a.ready));
      const failures = results.filter((r) => r.status === 'rejected');
      if (!failures.length) break;
      for (const failure of failures)
        if (failure.reason?.name !== 'AbortError') throw failure.reason;
      await new Promise(requestAnimationFrame);
    }
    for (const a of window.inspectTracks)
      a.currentTime =
        (document.querySelector('.card-inspector').dataset.phase === 'entering' ? 560 : 340) *
        progress;
    // Entry tracks are created in two batches around asynchronous preparation.
    // Sample the flight before handoff explicitly; its fade delay depends on
    // preparation time and does not share the original flight's local clock.
    if (document.querySelector('.card-inspector').dataset.phase === 'entering') {
      const fade = window.inspectTracks.find(
        (a) =>
          a.effect.target.matches('.inspect-flight-card') &&
          a.effect.getKeyframes().some((key) => 'opacity' in key),
      );
      if (fade) fade.currentTime = 0;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      count: window.inspectTracks.length,
      cardOpacity: Number(getComputedStyle(document.querySelector('.inspect-flight-card')).opacity),
      blur: getComputedStyle(document.querySelector('.card-inspector')).backdropFilter,
      phase: document.querySelector('.card-inspector').dataset.phase,
      nonCompositor: window.inspectTracks.some((a) =>
        a.effect
          .getKeyframes()
          .some((k) =>
            Object.keys(k).some((p) =>
              ['clipPath', 'filter', 'width', 'height', 'left', 'top'].includes(p),
            ),
          ),
      ),
    };
  }, progress);
const finish = () => page.evaluate(() => window.inspectTracks.forEach((a) => a.finish()));
try {
  await page.goto('http://127.0.0.1:5173');
  await room();
  assert.equal((await snap()).orbit.distance, ROOM_ZOOM.max);
  assert.equal((await stored()).spaceView.orbit.distance, ROOM_ZOOM.max);
  await page.mouse.move(900, 700);
  await page.waitForTimeout(500);
  const before = await snap();
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(250);
  const boundary = await snap();
  assert.equal(boundary.orbit.distance, ROOM_ZOOM.max);
  assert.equal(boundary.performance.renders, before.performance.renders);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(250);
  assert.ok((await snap()).orbit.distance < ROOM_ZOOM.max);
  await page.mouse.wheel(0, -10000);
  await page.waitForTimeout(250);
  assert.equal((await snap()).orbit.distance, ROOM_ZOOM.min);
  await page.mouse.wheel(0, 10000);
  await page.waitForTimeout(250);
  assert.equal((await snap()).orbit.distance, ROOM_ZOOM.max);
  await shot('zoom-limit');
  report.checks.push(
    'reference maximum, legacy 90-unit save clamped and persisted, zoom-in/minimum, idle at boundary',
  );

  // Use a real canvas hit for the first entry, then freeze compositor tracks for visual QA.
  const point = await page.evaluate(() => document.querySelector('canvas').world3D.projectCard(49));
  assert.equal(
    await page.evaluate((p) => document.querySelector('canvas').world3D.hitAt(p.x, p.y), point),
    state.cardStacks[0].id,
  );
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.card-inspector[data-phase="entering"]');
  const entry = await pause(0.43);
  assert.equal(entry.phase, 'entering');
  assert.ok(entry.count >= 12 && entry.count <= 18);
  assert.equal(entry.blur, 'none');
  assert.equal(entry.nonCompositor, false);
  assert.equal(entry.cardOpacity, 1);
  assert.equal((await snap()).stacks[0].visible, false);
  assert.equal(await page.locator('.inspect-flight-card').count(), 1);
  await shot('enter-middle');
  const afterFade = await page.evaluate(async () => {
    const fade = window.inspectTracks.find(
      (animation) =>
        animation.effect.target.matches('.inspect-flight-card') &&
        animation.effect.getKeyframes().some((frame) => 'opacity' in frame),
    );
    fade.finish();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Number(getComputedStyle(document.querySelector('.inspect-flight-card')).opacity);
  });
  assert.equal(afterFade, 0, 'finished snapshot fade left an opaque duplicate during the spread');
  report.snapshotAfterFade = afterFade;
  const spread = await page.evaluate(async () => {
    const { measureInspectorSpread } = await import('/src/ui/card-finishes.js');
    const tracks = window.inspectTracks.filter((animation) =>
      animation.effect.target.matches('.inspect-spread-group'),
    );
    const cards = [...document.querySelectorAll('.inspect-card')];
    const samples = [];
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      for (const track of tracks) {
        const { delay, duration } = track.effect.getTiming();
        track.currentTime = delay + duration * progress;
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rects = cards.map((card) => card.getBoundingClientRect());
      const predicted = measureInspectorSpread(tracks[0].effect.target);
      let geometryError = 0;
      for (const [image, rect] of predicted) {
        const actual = image.getBoundingClientRect();
        for (const key of ['left', 'top', 'width', 'height'])
          geometryError = Math.max(geometryError, Math.abs(actual[key] - rect[key]));
      }
      let uncovered = 0;
      cards.slice(0, -1).forEach((card, index) => {
        const image = card.querySelector('img').getBoundingClientRect(),
          canvas = card.querySelector('canvas'),
          coverage = Number(canvas.dataset.renderedWidth),
          suffixLeft = image.left + (coverage / canvas.width) * image.width,
          covering = rects.slice(index + 1).filter((rect) => rect.right >= image.right - 0.1),
          coverLeft = Math.min(...covering.map((rect) => rect.left));
        uncovered = Math.max(uncovered, coverLeft - suffixLeft);
      });
      samples.push({ progress, left: rects.map((rect) => rect.left), uncovered, geometryError });
    }
    return { groups: tracks.length, samples };
  });
  assert.equal(spread.groups, 1);
  for (const [index, sample] of spread.samples.entries()) {
    assert.ok(sample.uncovered < 0.2, `unpainted suffix exposed at ${sample.progress}`);
    assert.ok(sample.geometryError < 0.03, `incorrect light geometry at ${sample.progress}`);
    if (index)
      sample.left.forEach((left, card) =>
        assert.ok(left >= spread.samples[index - 1].left[card] - 0.1, 'card moved left'),
      );
  }
  const first = spread.samples[0].left,
    last = spread.samples.at(-1).left;
  assert.ok(Math.max(...first) - Math.min(...first) < 0.1, 'entry did not begin fully overlapped');
  assert.ok(Math.abs(last[0] - first[0]) < 0.1, 'left edge moved');
  assert.ok(last.at(-1) - first.at(-1) > 100, 'front card did not unfold to the right');
  await page.evaluate(() => {
    for (const track of window.inspectTracks) {
      const { delay, duration } = track.effect.getTiming();
      track.currentTime =
        delay + duration * (track.effect.target.matches('.inspect-spread-group') ? 0 : 1);
    }
  });
  await shot('spread-collapsed');
  // Show the actual midpoint after the complete front snapshot has handed off.
  await page.evaluate(() => {
    for (const track of window.inspectTracks) {
      const { delay, duration } = track.effect.getTiming();
      track.currentTime =
        delay + duration * (track.effect.target.matches('.inspect-spread-group') ? 0.5 : 1);
    }
  });
  await shot('spread-middle');
  report.spread = {
    groups: spread.groups,
    samples: spread.samples.map(({ left, ...sample }) => ({
      ...sample,
      first: left[0],
      front: left.at(-1),
    })),
  };
  await finish();
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  assert.equal(await page.locator('.inspect-transition-layer').count(), 0);
  assert.equal(await page.locator('.inspect-spread-group').count(), 0);
  assert.equal(await page.locator('.inspect-card').count(), 50);
  await shot('sorting');
  await page.locator('[data-route-one="collection"]').click();
  assert.ok((await page.locator('.inspect-route-flight').count()) > 0);
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  assert.equal(await page.locator('.inspect-card').count(), 49);
  await page.locator('.inspect-return').click();
  const leaving = await pause(0.48);
  assert.equal(leaving.phase, 'closing');
  assert.equal(leaving.nonCompositor, false);
  await shot('return-middle');
  // Return endpoint is the perspective of the current, now shorter, table stack.
  await page.evaluate(() => {
    for (const a of window.inspectTracks) {
      const t = a.effect.getTiming();
      a.currentTime = Number(t.delay) + Number(t.duration) * 0.999;
    }
  });
  const returning = await page.locator('.inspect-flight-card').boundingBox();
  const destination = await page.evaluate(() =>
    document.querySelector('canvas').world3D.projectCard(48),
  );
  assert.ok(
    Math.abs(returning.x + returning.width / 2 - destination.x) < 3 &&
      Math.abs(returning.y + returning.height / 2 - destination.y) < 5,
  );
  await finish();
  await returned();
  assert.equal((await snap()).stacks[0].count, 49);
  assert.equal((await snap()).stacks[0].visible, true);
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('canvas')),
    true,
  );
  report.entry = entry;
  report.return = leaving;
  report.checks.push(
    'canvas click, perspective flight both ways, one fully overlapping rightward spread, covered unfinished suffixes, single routing and return location/focus',
  );

  // Esc may reverse an unfinished entry; repeated Esc must not navigate away.
  await page.locator('.world-stack').first().press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await returned();
  assert.equal(await page.locator('body').getAttribute('data-page'), 'open');
  await page.locator('.world-stack').first().press('Enter');
  await page.setViewportSize({ width: 900, height: 750 });
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  await page.locator('.inspect-return').click();
  await page.setViewportSize({ width: 1100, height: 800 });
  await returned();
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  await shot('narrow');
  await page.keyboard.press('Escape');
  await returned();
  report.checks.push('interrupt entry, repeated Escape, resize during entry/exit, narrow viewport');

  await open();
  await page.locator('[data-warehouse-picker]').click();
  await page.locator('[data-route-confirm="warehouse"]').click();
  await page.waitForSelector('.card-inspector[data-phase="closing"]');
  assert.equal(await page.locator('.inspect-flight-card').isHidden(), true);
  await returned();
  assert.equal((await snap()).cards.length, 10);
  assert.equal(
    Object.values((await stored()).collection).reduce((a, b) => a + b, 0),
    1,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open();
  assert.equal(await page.locator('.inspect-transition-layer').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.card-inspector').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.world-stack').first().press('Enter');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForSelector('.card-inspector[data-phase="open"]');
  await page.keyboard.press('Escape');
  await returned();
  report.checks.push(
    'all cards routed without ghost return, OS reduced motion including a live preference change',
  );

  // Direct lifecycle fixture tests immediate teardown while the world is being navigated away.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const fixture = await page.evaluate(async () => {
    const { createCardInspector } = await import('/src/ui/card-inspector.js');
    const { freshState, makeItem, openPacks } = await import('/src/game/model.js');
    const state = freshState();
    state.items = [makeItem('pack')];
    openPacks(state, [state.items[0].id], () => 0.9);
    const stack = state.cardStacks[0];
    let closes = 0;
    const host = document.querySelector('.unboxing-space');
    const options = {
      save: () => {},
      sound: () => {},
      onRoute: () => {},
      onClose: () => {
        closes++;
      },
    };
    state.settings.motion = false;
    let view = createCardInspector(host, state, stack, options);
    view.close();
    const immediate = !host.querySelector('.card-inspector');
    state.settings.motion = true;
    view = createCardInspector(host, state, stack, options);
    view.dispose();
    view.close();
    await view.ready;
    view = createCardInspector(host, state, stack, options);
    const leaving = view.close();
    view.dispose();
    await leaving;
    return {
      closes,
      immediate,
      layers: host.querySelectorAll('.card-inspector,.inspect-transition-layer').length,
    };
  });
  assert.deepEqual(fixture, { closes: 3, immediate: true, layers: 0 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1778, height: 1067 });
  await page.reload();
  await room();
  assert.equal((await snap()).cards.length, 10);
  assert.equal((await snap()).orbit.distance, ROOM_ZOOM.max);
  await open();
  await page.keyboard.press('Escape');
  await returned();
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('.card-inspector,.inspect-transition-layer'))
          .length,
    ),
    0,
  );
  report.checks.push(
    'game reduced motion synchronous close, immediate disposal, refresh persistence, no animation/layer leaks',
  );
  assert.deepEqual(errors, []);
  report.passed = true;
  report.errors = errors;
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
