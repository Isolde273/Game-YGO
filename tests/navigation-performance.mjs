import { freshState } from './helpers/starter-state.mjs';
import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
const mode = process.argv[2] ?? 'current',
  results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = freshState();
  state.settings.sound = false;
  await page.addInitScript((s) => {
    if (!localStorage.getItem('nav-perf-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(s));
      localStorage.setItem('nav-perf-fixture', '1');
    }
  }, state);
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.home-menu').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let run = 0; run < 2; run++)
    for (const route of ['album', 'warehouse', 'shop', 'settings', 'open', 'home']) {
      if (route !== 'home' && (await page.locator('body').getAttribute('data-page')) !== 'home')
        await page.evaluate(() => document.querySelector('[data-action="home"]').click());
      await page.waitForFunction(
        () =>
          document.querySelector('#page-transition').hidden &&
          !document.querySelector('#app').inert,
      );
      const sample = await page.evaluate(async (route) => {
        const layer = document.querySelector('#page-transition'),
          frames = [],
          tasks = [],
          phases = [];
        let last = performance.now(),
          raf;
        const observe = new PerformanceObserver((list) =>
          tasks.push(
            ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
          ),
        );
        observe.observe({ type: 'longtask', buffered: false });
        const tick = (now) => {
          frames.push({ duration: now - last, phase: layer.dataset.phase ?? 'done' });
          last = now;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const mutation = new MutationObserver(() => {
          const phase = layer.dataset.phase;
          if (phase && phases.at(-1)?.phase !== phase)
            phases.push({ phase, at: performance.now() });
        });
        mutation.observe(layer, { attributes: true, attributeFilter: ['data-phase'] });
        const started = performance.now();
        document.querySelector(route === 'home' ? '.space-return' : `.tile-${route}`).click();
        await new Promise((resolve) => {
          const poll = () => {
            if (layer.hidden && !document.querySelector('#app').inert) resolve();
            else requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        });
        const elapsed = performance.now() - started;
        cancelAnimationFrame(raf);
        observe.disconnect();
        mutation.disconnect();
        const active = frames
          .filter((f) => ['covering', 'revealing'].includes(f.phase))
          .map((f) => f.duration)
          .sort((a, b) => a - b);
        return {
          route,
          elapsedMs: +elapsed.toFixed(1),
          activeFrames: active.length,
          p95FrameMs: +(active[Math.floor(active.length * 0.95)] ?? 0).toFixed(1),
          maxFrameMs: +(active.at(-1) ?? 0).toFixed(1),
          framesOver33ms: active.filter((t) => t > 33.4).length,
          longTasks: tasks.map((t) => +t.duration.toFixed(1)),
          phases: phases.map((p, i) => ({
            phase: p.phase,
            startMs: +(p.at - started).toFixed(1),
            durationMs: +((phases[i + 1]?.at ?? started + elapsed) - p.at).toFixed(1),
          })),
        };
      }, route);
      results.push({ run, ...sample });
    }
  await fs.mkdir('test-results/reload', { recursive: true });
  await fs.writeFile(
    `test-results/reload/navigation-${mode}.json`,
    JSON.stringify({ cpuThrottle: 4, viewport: '1440x900', results }, null, 2),
  );
  console.log(
    JSON.stringify({
      mode,
      transitions: results.length,
      averageMs: Math.round(results.reduce((n, r) => n + r.elapsedMs, 0) / results.length),
      framesOver33ms: results.reduce((n, r) => n + r.framesOver33ms, 0),
      longTasks: results.reduce((n, r) => n + r.longTasks.length, 0),
      routes: results.map(({ run, route, elapsedMs, p95FrameMs, maxFrameMs, longTasks }) => ({
        run,
        route,
        elapsedMs,
        p95FrameMs,
        maxFrameMs,
        longTasks,
      })),
    }),
  );
} finally {
  await browser.close();
}
