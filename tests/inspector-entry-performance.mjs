import { chromium, _electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { browserOptions } from './helpers/browser.mjs';
import { freshState } from './helpers/starter-state.mjs';
import { makeItem, validateState } from '../src/game/model.js';
import { openFixturePacks } from './helpers/sorting-stacks.mjs';
import { CARD_PRINTS, makeCardRecord } from '../src/game/card-data.js';

const desktop = process.env.YGO_ENTRY_DESKTOP === '1';
const variant = process.env.YGO_ENTRY_VARIANT || (desktop ? 'desktop' : 'browser');
const output = 'test-results/inspector-entry-stutter-20261010';
await fs.mkdir(output, { recursive: true });
const env = {
  ...process.env,
  YGO_SMOKE_TEST: '1',
  YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${variant}-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const application = desktop
  ? await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    })
  : await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = desktop
    ? await application.firstWindow()
    : await application.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  if (desktop) {
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().setOffline(true);
  }
  const state = freshState();
  state.settings.sound = false;
  state.items = Array.from({ length: 6 }, () => makeItem('pack'));
  let n = 0;
  openFixturePacks(
    state,
    state.items.map((item) => item.id),
    () => [0, 0.6, 0.9, 0.97, 0.999][n++ % 5],
  );
  if (process.env.YGO_ENTRY_UNIQUE === '1') {
    const prints = CARD_PRINTS.filter((print) => print.rarity !== 'GMR');
    state.cardStacks[0].cards = state.cardStacks[0].cards.map((card, index) =>
      makeCardRecord(prints[Math.floor((index * prints.length) / 60)].id, card.id),
    );
    for (const id of Object.keys(state.cards)) state.cards[id] = 0;
    for (const card of state.cardStacks[0].cards) state.cards[card.printId] = 1;
  }
  validateState(structuredClone(state));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    (fixture) => localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(fixture)),
    state,
  );
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  await page.locator('.tile-open').click();
  await page.waitForSelector('canvas[data-presented="true"]');
  await page.waitForFunction(() => document.querySelector('#page-transition').hidden);
  const result = await page.evaluate(async () => {
    const cycles = [],
      operations = [],
      tasks = [];
    let measuring = false,
      cycleIndex = 0;
    const phase = () => document.querySelector('.card-inspector')?.dataset.phase ?? 'room';
    const instrument = (prototype, name) => {
      const original = prototype[name];
      prototype[name] = function (...args) {
        if (!measuring) return original.apply(this, args);
        const start = performance.now(),
          currentPhase = phase();
        const result = original.apply(this, args);
        operations.push({
          name,
          phase: currentPhase,
          cycle: cycleIndex,
          duration: performance.now() - start,
        });
        return result;
      };
    };
    instrument(CanvasRenderingContext2D.prototype, 'drawImage');
    instrument(Element.prototype, 'getBoundingClientRect');
    instrument(WebGL2RenderingContext.prototype, 'texImage2D');
    instrument(WebGL2RenderingContext.prototype, 'texSubImage2D');
    instrument(WebGL2RenderingContext.prototype, 'generateMipmap');
    const observer = new PerformanceObserver((list) => {
      for (const item of list.getEntries())
        tasks.push({ start: item.startTime, duration: item.duration });
    });
    observer.observe({ type: 'longtask', buffered: false });
    for (cycleIndex = 0; cycleIndex < 3; cycleIndex++) {
      const frames = [],
        transitions = [],
        start = performance.now();
      let last = start,
        previousPhase = 'room',
        opened = null;
      measuring = true;
      document.querySelector('.world-stack').click();
      const created = performance.now() - start;
      while (opened === null || performance.now() - opened < 800) {
        await new Promise(requestAnimationFrame);
        const now = performance.now(),
          currentPhase = phase();
        frames.push({ phase: previousPhase, ms: now - last });
        if (currentPhase !== previousPhase)
          transitions.push({ phase: currentPhase, ms: now - start });
        if (currentPhase === 'open' && opened === null) opened = now;
        last = now;
        previousPhase = currentPhase;
        if (now - start > 30000) throw new Error('Entry did not finish');
      }
      measuring = false;
      const end = performance.now();
      cycles.push({
        created,
        transitions,
        frames,
        tasks: tasks.filter((task) => task.start >= start && task.start < end),
      });
      document.querySelector('.inspect-return').click();
      while (document.querySelector('.card-inspector,.inspect-transition-layer'))
        await new Promise(requestAnimationFrame);
    }
    observer.disconnect();
    const operationSummary = [];
    for (const name of [
      'drawImage',
      'getBoundingClientRect',
      'texImage2D',
      'texSubImage2D',
      'generateMipmap',
    ])
      for (const p of ['preparing', 'loading', 'entering', 'open']) {
        const matches = operations.filter((item) => item.name === name && item.phase === p);
        if (matches.length)
          operationSummary.push({
            name,
            phase: p,
            count: matches.length,
            total: matches.reduce((sum, item) => sum + item.duration, 0),
            max: Math.max(...matches.map((item) => item.duration)),
          });
      }
    return {
      cycles,
      operationSummary,
      slowOperations: operations
        .filter((item) => item.duration > 8)
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 12),
    };
  });
  await fs.writeFile(`${output}/${variant}.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(
    JSON.stringify({
      variant,
      cycles: result.cycles.map((cycle) => ({
        created: cycle.created,
        transitions: cycle.transitions,
        phases: ['preparing', 'loading', 'entering', 'open'].map((phase) => {
          const frames = cycle.frames
            .filter((frame) => frame.phase === phase)
            .map((frame) => frame.ms);
          return {
            phase,
            count: frames.length,
            max: Math.max(0, ...frames),
            over50: frames.filter((ms) => ms > 50).length,
          };
        }),
        longTasks: cycle.tasks.map((task) => task.duration),
      })),
      operationSummary: result.operationSummary,
      slowOperations: result.slowOperations,
      errors,
    }),
  );
  assert.deepEqual(errors, []);
  assert.equal(result.cycles.length, 3);
} finally {
  await application.close();
}
