import { icon } from '../icons.js';
import { copyFinishCanvases } from '../card-surfaces.js';
import {
  createMotionPlayer,
  enterPage,
  enterList,
  nextPaint,
  descendSettingsCard,
  revealSettingsArc,
  entryPlaybackRate,
} from './motion-player.js';
const rectangle = (element) => element?.getBoundingClientRect?.() ?? null;
const routes = {
  open: ['01', 'OPEN', '开盒', 'box'],
  album: ['02', 'COLLECTION', '收藏册', 'album'],
  warehouse: ['03', 'INVENTORY', '仓库', 'warehouse'],
  shop: ['04', 'SHOP', '购买', 'shop'],
  settings: ['05', 'SETTINGS', '设置', 'settings'],
};
const families = {
  open: 'radial',
  album: 'book',
  warehouse: 'shelves',
  shop: 'handset',
  settings: 'tuning',
};
const repeat = (count, html) => Array.from({ length: count }, (_, i) => html(i)).join('');
function motif(theme, symbol) {
  if (theme === 'album')
    return `<div class="motion-book">${repeat(3, (i) => `<div class="motif-page page-${i}"><span></span><div>${repeat(6, () => '<i></i>')}</div></div>`)}</div>`;
  if (theme === 'warehouse')
    return `<div class="motion-stock">${repeat(3, (i) => `<div class="motif-bin bin-${i}"><i></i><span></span><b></b></div>`)}</div>`;
  if (theme === 'shop')
    return `<div class="motion-handset"><div class="motif-device"><i></i><div>${repeat(4, (i) => `<span>${icon(['card', 'box', 'coin', 'check'][i])}</span>`)}</div><b></b></div><div class="motif-receipt"><i></i><i></i><i></i></div></div>`;
  if (theme === 'settings')
    return `<div class="motion-tuning">${repeat(3, (i) => `<div class="motif-rail rail-${i}"><i></i><b></b></div>`)}</div>`;
  return `<div class="motion-record"><div class="record-rim"></div><div class="record-arc"></div><div class="record-ticks"></div><div class="motif-parcel">${icon(symbol)}${repeat(3, (i) => `<i class="parcel-flap flap-${i}"></i>`)}</div></div>`;
}
function markup(theme, back) {
  const [number, label, zh, symbol] = routes[theme];
  const count = theme === 'album' ? 2 : theme === 'warehouse' ? 5 : theme === 'settings' ? 4 : 1;
  return `<div class="transition-mask">${repeat(count, (i) => `<div class="transition-pane pane-${i}"></div>`)}</div>${theme === 'open' ? '<div class="transition-echo"></div>' : ''}<div class="transition-stage"><div class="transition-grid"></div><div class="transition-streak streak-one"></div><div class="transition-streak streak-two"></div><div class="transition-number">${number}</div><div class="transition-motif">${motif(theme, symbol)}</div><div class="transition-label"><span>${back ? '主界面' : zh}</span><b>${label}</b><i></i></div><div class="transition-word-echo" aria-hidden="true">${label}</div><div class="transition-route">${icon(symbol)}<i></i>${icon('arrow')}</div><span class="transition-loading">准备开盒空间</span></div>`;
}

// Each route has its own silhouette and choreography. Typography moves separately
// from the mask, so source-window scaling never squeezes the functional labels.
export function createPageTransitions({
  app,
  layer,
  getPage,
  motion,
  commit,
  prepareSettings,
  prepareHome,
  ready,
  onError,
  onStart,
  onFinish,
}) {
  let active = false,
    sequence = 0,
    destination;
  const player = createMotionPlayer(motion, () => entryPlaybackRate(destination)),
    { play } = player;
  const focusPage = () => {
    const target = app.querySelector('main');
    if (target) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  };
  async function systemRoute(to) {
    active = true;
    const from = getPage(),
      priorInert = app.inert;
    const entering = to === 'settings';
    const returningHome = to === 'home';
    layer.innerHTML = entering
      ? `<div class="settings-route-wipe settings-route-reveal">${prepareSettings()}</div>`
      : returningHome
        ? `<div class="home-route-reveal"><div class="scene-background"></div><div class="home-route-content">${prepareHome()}</div><div class="home-route-color"></div></div>`
        : `<div class="settings-route-wipe"></div>`;
    Object.assign(layer.dataset, {
      theme: 'settings',
      family: returningHome ? 'system-home' : 'system',
      phase: 'covering',
      sequence: String(++sequence),
    });
    layer.hidden = false;
    app.inert = true;
    document.body.classList.add('navigating');
    onStart?.();
    const wipe = layer.querySelector('.settings-route-wipe,.home-route-reveal');
    try {
      if (returningHome) {
        await Promise.all([
          play(
            app.querySelector('.settings-system-orbit'),
            [
              { transform: 'rotate(0deg)', opacity: 1 },
              { opacity: 1, offset: 0.55 },
              { transform: 'rotate(-100deg)', opacity: 0 },
            ],
            { duration: 680, hold: true, easing: 'cubic-bezier(.4,0,.65,1)' },
          ),
          play(
            wipe,
            [{ clipPath: 'circle(0px at 80% 24%)' }, { clipPath: 'circle(145% at 80% 24%)' }],
            { duration: 620, delay: 170, hold: true, easing: 'cubic-bezier(.65,0,.25,1)' },
          ),
          play(wipe.querySelector('.home-route-color'), [{ opacity: 1 }, { opacity: 0 }], {
            duration: 280,
            delay: 350,
            hold: true,
            easing: 'ease-in-out',
          }),
        ]);
        layer.dataset.phase = 'covered';
        const prepared = document.createDocumentFragment();
        prepared.append(...wipe.querySelector('.home-route-content').childNodes);
        commit(to, prepared);
        const entrance = Promise.all([
          enterPage(app, to, player),
          play(app.querySelector('.topbar'), [{ opacity: 0 }, { opacity: 1 }], { duration: 240 }),
        ]);
        wipe.remove();
        layer.dataset.phase = 'revealing';
        await entrance;
        return true;
      }
      await play(
        wipe,
        entering
          ? [{ clipPath: 'circle(22px at 28% 50%)' }, { clipPath: 'circle(145% at 28% 50%)' }]
          : [
              { transform: 'translate(-50%,-50%) scale(.015)' },
              { transform: 'translate(-50%,-50%) scale(1)' },
            ],
        { duration: 560, hold: true, easing: 'cubic-bezier(.65,0,.25,1)' },
      );
      layer.dataset.phase = 'covered';
      if (entering) {
        const prepared = wipe.querySelector('.settings-page');
        commit(to, prepared);
        const entrance = enterPage(app, to, player, { settingsBackdropReady: true });
        wipe.remove();
        layer.dataset.phase = 'revealing';
        await entrance;
        return true;
      }
      commit(to);
      await ready(to);
      await nextPaint();
      layer.dataset.phase = 'revealing';
      await Promise.all([
        play(wipe, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 140,
          hold: true,
          easing: 'linear',
        }),
        enterPage(app, to, player),
      ]);
      return true;
    } catch (error) {
      commit(from);
      onError?.(error);
      return false;
    } finally {
      player.clear();
      layer.hidden = true;
      layer.replaceChildren();
      delete layer.dataset.phase;
      app.inert = priorInert;
      document.body.classList.remove('navigating');
      active = false;
      onFinish?.();
      focusPage();
    }
  }
  function go(to, { source, phonePortal = false } = {}) {
    if (active || to === getPage()) return Promise.resolve(false);
    player.clear();
    destination = to;
    const from = getPage();
    if (!player.enabled()) {
      active = true;
      const priorInert = app.inert;
      app.inert = true;
      app.setAttribute('aria-busy', 'true');
      document.body.classList.add('navigating');
      return (async () => {
        try {
          onStart?.();
          commit(to);
          await ready(to);
          return true;
        } catch (error) {
          commit(from);
          onError?.(error);
          return false;
        } finally {
          active = false;
          app.inert = priorInert;
          app.removeAttribute('aria-busy');
          document.body.classList.remove('navigating');
          onFinish?.();
          focusPage();
        }
      })();
    }
    if (to === 'settings' || (from === 'settings' && ['home', 'open'].includes(to)))
      return systemRoute(to);
    active = true;
    const priorInert = app.inert,
      theme = to === 'home' ? from : to,
      back = to === 'home',
      sign = back ? -1 : 1;
    const sourceRect = rectangle(source),
      family = families[theme],
      linkedPhone = to === 'shop' && phonePortal && sourceRect?.width > 0 && sourceRect?.height > 0;
    layer.style.setProperty(
      '--wipe-diameter',
      `${Math.ceil(Math.hypot(innerWidth, innerHeight)) + 4}px`,
    );
    layer.innerHTML = markup(theme, back);
    Object.assign(layer.dataset, {
      theme,
      family,
      direction: back ? 'back' : 'forward',
      sequence: String(++sequence),
      phase: 'covering',
    });
    if (linkedPhone) layer.dataset.origin = 'room-phone';
    else delete layer.dataset.origin;
    layer.hidden = false;
    app.inert = true;
    app.setAttribute('aria-busy', 'true');
    document.body.classList.add('navigating');
    const panes = [...layer.querySelectorAll('.transition-pane')],
      stage = layer.querySelector('.transition-stage');
    let resizeDock = null,
      resizeBridge = null;
    const windowTransform = (rect) => {
      if (!rect) return 'translate3d(0,0,0) scale(.08,.08)';
      const x = (rect.left + rect.right) / 2 - innerWidth / 2,
        y = (rect.top + rect.bottom) / 2 - innerHeight / 2;
      return `translate3d(${x}px,${y}px,0) scale(${Math.max(0.01, rect.width / (innerWidth + 48))},${Math.max(0.01, rect.height / (innerHeight + 48))})`;
    };
    function transform(phase, i) {
      if (phase === 'rest') return 'translate3d(0,0,0) scale(1)';
      if (theme === 'open') {
        const x =
          phase === 'cover' && sourceRect
            ? (sourceRect.left + sourceRect.right) / 2 - innerWidth / 2
            : 0;
        const y =
          phase === 'cover' && sourceRect
            ? (sourceRect.top + sourceRect.bottom) / 2 - innerHeight / 2
            : 0;
        return `translate3d(${x}px,${y}px,0) scale(.001)`;
      }
      if (theme === 'shop')
        return windowTransform(
          phase === 'cover'
            ? sourceRect
            : rectangle(app.querySelector(to === 'shop' ? '.phone-screen' : '.tile-shop')),
        );
      if (theme === 'album') {
        const side = phase === 'cover' || !back ? (i === 0 ? -1 : 1) : 1;
        const angle = phase === 'cover' ? side * 8 : back ? -7 : side * 5;
        const pane = panes[i],
          radians = (Math.abs(angle) * Math.PI) / 180;
        const halfExtent =
          (pane.offsetWidth * Math.cos(radians) + pane.offsetHeight * Math.sin(radians)) / 2;
        const center = pane.offsetLeft + pane.offsetWidth / 2;
        const x = side > 0 ? innerWidth - center + halfExtent + 24 : -center - halfExtent - 24;
        return `translate3d(${x}px,0,0) rotate(${angle}deg)`;
      }
      const alternating = i % 2 ? -sign : sign;
      if (theme === 'warehouse')
        return `translate3d(${(phase === 'cover' ? -1 : 1) * alternating * 110}%,0,0)`;
      return `translate3d(0,${phase === 'cover' ? -110 * alternating : 110 * alternating}%,0)`;
    }
    panes.forEach((pane, i) => (pane.style.transform = transform('cover', i)));
    function masks(reveal = false) {
      if (reveal && to === 'shop') return dockPhone();
      if (!reveal && linkedPhone) return expandPhoneScreen();
      return Promise.all(
        panes.map((pane, i) =>
          play(
            pane,
            [
              { transform: transform(reveal ? 'rest' : 'cover', i) },
              { transform: transform(reveal ? 'reveal' : 'rest', i) },
            ],
            {
              duration:
                theme === 'open'
                  ? 280
                  : theme === 'shop'
                    ? 330
                    : reveal && ['album', 'warehouse'].includes(theme)
                      ? 320
                      : 240,
              delay: i * (theme === 'album' ? 18 : 10),
              hold: true,
            },
          ),
        ),
      );
    }
    async function expandPhoneScreen() {
      // Start from the held portal screen itself, preserving its pixels and bounds.
      // Its frame remains underneath until the expanded screen covers the room.
      const bridge = source.cloneNode(true),
        rect = sourceRect;
      bridge.classList.add('transition-screen-bridge');
      bridge.querySelector('.portal-screen-glint')?.remove();
      Object.assign(bridge.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: getComputedStyle(source).borderRadius,
      });
      const content = [...bridge.children],
        fill = document.createElement('i');
      fill.className = 'transition-screen-fill';
      bridge.append(fill);
      layer.querySelector('.transition-mask').append(bridge);
      panes.forEach((pane) => (pane.style.visibility = 'hidden'));
      const x = innerWidth / 2 - (rect.left + rect.width / 2),
        y = innerHeight / 2 - (rect.top + rect.height / 2);
      const end = `translate3d(${x}px,${y}px,0) scale(${(innerWidth + 192) / rect.width},${(innerHeight + 192) / rect.height})`;
      resizeBridge = () => player.finish();
      window.addEventListener('resize', resizeBridge);
      await Promise.all([
        play(bridge, [{ transform: 'translate3d(0,0,0) scale(1)' }, { transform: end }], {
          duration: 480,
          easing: 'cubic-bezier(.42,0,.24,1)',
          hold: true,
        }),
        play(fill, [{ opacity: 0 }, { opacity: 1 }], {
          duration: 330,
          delay: 100,
          easing: 'linear',
          hold: true,
        }),
        ...content.map((el) =>
          play(el, [{ opacity: 1 }, { opacity: 0 }], {
            duration: 180,
            delay: 40,
            easing: 'linear',
            hold: true,
          }),
        ),
      ]);
      panes.forEach((pane) => {
        pane.style.transform = transform('rest', 0);
        pane.style.visibility = '';
      });
      bridge.remove();
      player.release(bridge);
      player.release(fill);
      content.forEach((el) => player.release(el));
      window.removeEventListener('resize', resizeBridge);
      resizeBridge = null;
    }
    function dockPhone() {
      const screen = app.querySelector('.phone-screen'),
        rect = rectangle(screen);
      if (!rect?.width || !rect.height)
        return Promise.all(
          panes.map((pane) =>
            play(pane, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, hold: true }),
          ),
        );
      const dock = document.createElement('div');
      dock.className = 'transition-phone-dock';
      const place = () => {
        const r = rectangle(screen);
        Object.assign(dock.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          borderRadius: getComputedStyle(screen).borderRadius,
        });
      };
      place();
      layer.querySelector('.transition-mask').append(dock);
      panes.forEach((pane) => (pane.style.visibility = 'hidden'));
      const x = innerWidth / 2 - (rect.left + rect.width / 2),
        y = innerHeight / 2 - (rect.top + rect.height / 2);
      const start = `translate3d(${x}px,${y}px,0) scale(${(innerWidth + 192) / rect.width},${(innerHeight + 192) / rect.height})`;
      resizeDock = () => {
        place();
        player.finish();
      };
      window.addEventListener('resize', resizeDock);
      return Promise.all([
        play(
          dock,
          [
            { transform: start, easing: 'cubic-bezier(.32,.08,.25,1)' },
            {
              transform: 'translate3d(0,-4px,0) scale(1.012,1.008)',
              offset: 0.86,
              easing: 'cubic-bezier(.25,.55,.35,1)',
            },
            { transform: 'translate3d(0,0,0) scale(1,1)' },
          ],
          { duration: 520, easing: 'linear', hold: true },
        ),
        play(dock, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 130,
          delay: 480,
          easing: 'linear',
          hold: true,
        }),
      ]);
    }
    function artIn() {
      const tasks = [
        play(stage, [{ opacity: 0 }, { opacity: 1 }], {
          duration: linkedPhone ? 210 : 130,
          delay: linkedPhone ? 220 : 65,
          hold: true,
        }),
      ];
      const q = (selector) => layer.querySelector(selector);
      tasks.push(
        play(
          q('.transition-label'),
          [
            { transform: `translate3d(${-sign * 90}px,18px,0)`, opacity: 0 },
            { transform: 'translate3d(0,0,0)', opacity: 1 },
          ],
          { duration: 225, delay: 35, hold: true },
        ),
      );
      tasks.push(
        play(
          q('.transition-number'),
          [
            { transform: 'translate3d(0,-70px,0)', opacity: 0 },
            { transform: 'translate3d(0,0,0)', opacity: 0.23 },
          ],
          { duration: 240, delay: 30, hold: true },
        ),
      );
      tasks.push(
        play(
          q('.transition-word-echo'),
          [
            { transform: `translate3d(${sign * 140}px,0,0)`, opacity: 0 },
            { transform: 'translate3d(0,0,0)', opacity: 0.12 },
          ],
          { duration: 230, delay: 30, hold: true },
        ),
      );
      tasks.push(
        play(q('.transition-label i'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
          duration: 200,
          delay: 80,
          hold: true,
        }),
      );
      tasks.push(
        play(
          q('.transition-route'),
          [
            { transform: 'translate3d(35px,0,0)', opacity: 0 },
            { transform: 'translate3d(0,0,0)', opacity: 1 },
          ],
          { duration: 220, delay: 60, hold: true },
        ),
      );
      for (const [i, streak] of [...layer.querySelectorAll('.transition-streak')].entries())
        tasks.push(
          play(
            streak,
            [
              { transform: `translate3d(${-sign * 100}vw,0,0) skewX(-14deg)`, opacity: 0 },
              { opacity: 0.8, offset: 0.35 },
              { transform: `translate3d(${sign * 80}vw,0,0) skewX(-14deg)`, opacity: 0 },
            ],
            { duration: 260, delay: i * 18, hold: true },
          ),
        );
      const parts = layer.querySelectorAll(
        theme === 'album'
          ? '.motif-page'
          : theme === 'warehouse'
            ? '.motif-bin'
            : theme === 'settings'
              ? '.motif-rail'
              : theme === 'shop'
                ? '.motif-device,.motif-receipt'
                : '.record-rim,.record-arc,.motif-parcel',
      );
      const bases = [...parts].map((e) => getComputedStyle(e).transform);
      [...parts].forEach((part, i) =>
        tasks.push(
          play(
            part,
            [
              {
                transform: `translate3d(${theme === 'warehouse' ? 70 : 0}px,${theme === 'shop' ? 45 : 20}px,0) rotate(${theme === 'album' ? -30 : theme === 'open' ? 90 : 8}deg) scale(.7) ${bases[i] === 'none' ? '' : bases[i]}`,
                opacity: 0,
              },
              { transform: bases[i], opacity: 1 },
            ],
            { duration: 220, delay: i * 20, hold: true },
          ),
        ),
      );
      if (theme === 'open')
        tasks.push(
          play(
            q('.transition-echo'),
            [
              { transform: 'scale(.01)', opacity: 0.8 },
              { transform: 'scale(3.5)', opacity: 0 },
            ],
            { duration: 285, hold: true },
          ),
        );
      if (theme === 'open')
        for (const [i, flap] of [...layer.querySelectorAll('.parcel-flap')].entries()) {
          const base = getComputedStyle(flap).transform;
          tasks.push(
            play(
              flap,
              [
                {
                  transform: `translate3d(${i === 1 ? 36 : i === 2 ? -36 : 0}px,${i === 0 ? 35 : 0}px,0) scale(.25) ${base}`,
                  opacity: 0,
                },
                { transform: base, opacity: 1 },
              ],
              { duration: 200, delay: 65 + i * 10, hold: true },
            ),
          );
        }
      if (theme === 'shop')
        for (const [i, appIcon] of [...layer.querySelectorAll('.motif-device span')].entries())
          tasks.push(
            play(
              appIcon,
              [
                { transform: 'translate3d(0,20px,0) scale(.3)', opacity: 0 },
                { transform: 'none', opacity: 1 },
              ],
              { duration: 200, delay: 60 + i * 18, hold: true },
            ),
          );
      if (theme === 'settings')
        for (const [i, thumb] of [...layer.querySelectorAll('.motif-rail b')].entries())
          tasks.push(
            play(
              thumb,
              [
                { transform: `translate3d(${i % 2 ? -85 : 65}px,0,0)` },
                { transform: 'translate3d(0,0,0)' },
              ],
              { duration: 220, delay: 25 + i * 20, hold: true },
            ),
          );
      return Promise.all(tasks);
    }
    function artOut() {
      const q = (selector) => layer.querySelector(selector);
      return Promise.all([
        play(stage, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: 15, hold: true }),
        play(
          q('.transition-label'),
          [
            { transform: 'translate3d(0,0,0)' },
            { transform: `translate3d(${sign * 65}px,-15px,0)` },
          ],
          { duration: 230, hold: true },
        ),
        play(
          q('.transition-motif'),
          [
            { transform: 'scale(1) rotate(0deg)' },
            { transform: `scale(${theme === 'open' ? 1.3 : 0.86}) rotate(${sign * 12}deg)` },
          ],
          { duration: 260, hold: true },
        ),
        play(
          q('.transition-word-echo'),
          [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-sign * 100}px,0,0)` }],
          { duration: 250, hold: true },
        ),
      ]);
    }
    return (async () => {
      try {
        onStart?.();
        await nextPaint();
        await Promise.all([masks(), artIn()]);
        panes.forEach((pane) => (pane.style.transform = transform('rest', 0)));
        layer.dataset.phase = 'covered';
        if (theme === 'open') player.release(layer.querySelector('.record-arc'));
        commit(to);
        await ready(to);
        await nextPaint();
        layer.dataset.phase = 'revealing';
        await Promise.all([
          masks(true),
          artOut(),
          enterPage(app, to, player, { phoneDock: to === 'shop' }),
        ]);
        return true;
      } catch (error) {
        try {
          commit(from);
        } catch {}
        onError?.(error);
        return false;
      } finally {
        if (resizeDock) window.removeEventListener('resize', resizeDock);
        if (resizeBridge) window.removeEventListener('resize', resizeBridge);
        player.clear();
        layer.hidden = true;
        layer.replaceChildren();
        delete layer.dataset.phase;
        delete layer.dataset.origin;
        app.inert = priorInert;
        app.removeAttribute('aria-busy');
        document.body.classList.remove('navigating');
        active = false;
        onFinish?.();
        focusPage();
      }
    })();
  }
  async function intro() {
    await document.fonts.ready;
    await nextPaint();
    if (!active && getPage() === 'home') await enterPage(app, 'home', player, { intro: true });
  }
  return {
    go,
    intro,
    get busy() {
      return active;
    },
    enabled: player.enabled,
    finish: player.finish,
  };
}

export function createLocalTransitions({ motion }) {
  const player = createMotionPlayer(motion),
    { play } = player;
  let epoch = 0,
    sectionBusy = false,
    sectionFastForward = false;
  const finish = () => {
    if (sectionBusy) sectionFastForward = true;
    player.finish();
  };
  async function swap(host, html, { source, kind = 'app', back = false } = {}) {
    if (!host || host.dataset.localTransition) return false;
    const current = ++epoch;
    const box = rectangle(host),
      origin = rectangle(source),
      fromPhone = !!source?.closest('.phone'),
      tab = source?.dataset.tab;
    const old = host.firstElementChild,
      oldTab = old?.querySelector('[data-tab][aria-current="page"]')?.dataset.tab;
    const order = ['market', 'orders', 'wallet'],
      direction = kind === 'tab' && order.indexOf(tab) < order.indexOf(oldTab) ? -1 : 1;
    const focus = () => {
      if (fromPhone && host.isConnected)
        (tab
          ? host.querySelector(`[data-tab="${tab}"]`)
          : host.firstElementChild?.querySelector('button')
        )?.focus({ preventScroll: true });
    };
    host.innerHTML = html;
    const content = host.firstElementChild;
    if (!player.enabled()) {
      focus();
      return true;
    }
    host.dataset.localTransition = kind;
    const priorInert = host.inert;
    host.inert = true;
    if (old) {
      old.classList.add('local-outgoing');
      old.setAttribute('aria-hidden', 'true');
      old.inert = true;
      for (const el of old.querySelectorAll('[id],[data-action],[data-tab],[data-app]'))
        for (const attr of ['id', 'data-action', 'data-tab', 'data-app']) el.removeAttribute(attr);
      host.append(old);
    }
    const pivot =
      box && origin
        ? `${Math.max(0, Math.min(100, (((origin.left + origin.right) / 2 - box.left) / box.width) * 100))}% ${Math.max(0, Math.min(100, (((origin.top + origin.bottom) / 2 - box.top) / box.height) * 100))}%`
        : '50% 50%';
    if (content) content.style.transformOrigin = pivot;
    if (old) old.style.transformOrigin = pivot;
    const isTab = kind === 'tab',
      exit = back ? 'scale(.12)' : `translate3d(${-direction * 32}px,0,0) scale(.98)`;
    const entry = isTab
      ? `translate3d(${direction * 45}px,0,0)`
      : back
        ? 'translate3d(0,20px,0) scale(.94)'
        : 'scale(.12)';
    try {
      await Promise.all([
        play(
          old,
          [
            { transform: 'none', opacity: 1 },
            { transform: exit, opacity: 0 },
          ],
          { duration: 220, hold: true },
        ),
        play(
          content,
          [
            { transform: entry, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: isTab ? 270 : 300 },
        ),
        enterList(content, player, { direction }),
      ]);
    } finally {
      old?.remove();
      if (current === epoch) player.clear();
      content?.style.removeProperty('transform-origin');
      host.inert = priorInert;
      delete host.dataset.localTransition;
      focus();
    }
    return true;
  }
  async function book(element, back = false, { outgoing } = {}) {
    if (!element || !outgoing || !player.enabled()) return;
    const current = ++epoch;
    player.clear();
    const priorInert = element.inert;
    element.inert = true;
    const turningSide = back ? '.left-page' : '.right-page';
    const landingSide = back ? '.right-page' : '.left-page';
    const leaf = element.querySelector(turningSide);
    const baseRect = element.getBoundingClientRect();
    const rect = leaf.getBoundingClientRect();
    const stationaryRect = element.querySelector(landingSide).getBoundingClientRect();
    const hingeOffset =
      (back ? stationaryRect.left - rect.right : rect.left - stationaryRect.right) / 2;
    const layer = document.createElement('div');
    layer.className = 'book-turn-layer';
    layer.dataset.finishSnapshot = 'true';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    const sheet = document.createElement('div');
    sheet.className = 'book-turn-sheet';
    const front = outgoing.querySelector(turningSide).cloneNode(true);
    const reverse = element.querySelector(landingSide).cloneNode(true);
    const stationary = outgoing.querySelector(landingSide).cloneNode(true);
    copyFinishCanvases(outgoing.querySelector(turningSide), front);
    copyFinishCanvases(element.querySelector(landingSide), reverse);
    copyFinishCanvases(outgoing.querySelector(landingSide), stationary);
    front.classList.add('turn-front');
    reverse.classList.add('turn-back');
    stationary.classList.add('turn-stationary');
    for (const page of [front, reverse, stationary]) {
      for (const el of page.querySelectorAll(
        '[id],[data-action],[data-album-source],[data-album-drop]',
      )) {
        el.removeAttribute('id');
        el.removeAttribute('data-action');
        el.removeAttribute('data-album-source');
        el.removeAttribute('data-album-drop');
      }
    }
    Object.assign(sheet.style, {
      left: `${rect.left - baseRect.left + (back ? hingeOffset : -hingeOffset)}px`,
      top: `${rect.top - baseRect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      transformOrigin: back ? 'right center' : 'left center',
    });
    for (const side of [front, reverse]) {
      side.style.left = `${back ? -hingeOffset : hingeOffset}px`;
      side.style.right = 'auto';
      side.style.width = '100%';
    }
    Object.assign(stationary.style, {
      left: `${stationaryRect.left - baseRect.left}px`,
      top: `${stationaryRect.top - baseRect.top}px`,
      width: `${stationaryRect.width}px`,
      height: `${stationaryRect.height}px`,
    });
    sheet.append(front, reverse);
    layer.append(stationary, sheet);
    element.append(layer);
    const angle = back ? 180 : -180;
    try {
      await Promise.all([
        play(
          sheet,
          [
            { transform: 'rotateY(0deg)' },
            { transform: `rotateY(${angle * 0.45}deg) translateZ(12px)`, offset: 0.48 },
            { transform: `rotateY(${angle}deg)` },
          ],
          { duration: 600, easing: 'cubic-bezier(.4,.08,.22,1)', hold: true },
        ),
        play(stationary, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 110,
          delay: 420,
          hold: true,
        }),
      ]);
    } finally {
      layer.remove();
      element.inert = priorInert;
      if (current === epoch) player.clear();
    }
  }
  function list(host) {
    epoch++;
    player.clear();
    return enterList(host, player);
  }
  async function settingsSection(root, source, html, commit) {
    if (!root || sectionBusy) return;
    const preparedHost = document.createElement('div');
    preparedHost.innerHTML = html;
    const prepared = preparedHost.firstElementChild;
    if (!player.enabled()) {
      commit(prepared);
      return;
    }
    player.clear();
    sectionBusy = true;
    sectionFastForward = false;
    const priorInert = root.inert;
    root.inert = true;
    const layer = document.createElement('div');
    layer.className = 'settings-section-transition';
    layer.dataset.phase = 'moving';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    const reveal = document.createElement('div');
    reveal.className = 'settings-section-reveal';
    reveal.append(prepared);
    layer.append(reveal);
    document.body.append(layer);
    document.body.dataset.settingsTransition = 'section';
    const targetRoot = prepared.querySelector('.settings-persona');
    const secondarySwitch =
      root.classList.contains('is-config') && targetRoot.classList.contains('is-config');
    const returning = targetRoot.classList.contains('is-system');
    layer.dataset.kind = secondarySwitch ? 'switch' : returning ? 'return' : 'enter';
    const run = (tasks) => {
      if (sectionFastForward) player.finish();
      return Promise.all(tasks);
    };
    window.addEventListener('resize', finish);
    if (secondarySwitch) {
      const direction =
        root.querySelector('.settings-menu .active')?.dataset.section === 'settings-audio' ? 1 : -1;
      layer.dataset.direction = direction === 1 ? 'left' : 'right';
      reveal.className = 'settings-secondary-next';
      try {
        const tasks = [
          play(
            root.querySelector('.settings-config-orbit'),
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
            { duration: 1100, hold: true, easing: 'cubic-bezier(.4,0,.6,1)' },
          ),
        ];
        for (const selector of ['.settings-menu', '.settings-content', '.settings-persona-title']) {
          tasks.push(
            play(
              root.querySelector(selector),
              [{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 110}vw)` }],
              { duration: 600, hold: true, easing: 'cubic-bezier(.4,0,.25,1)' },
            ),
            play(
              prepared.querySelector(selector),
              [{ transform: `translateX(${direction * 110}vw)` }, { transform: 'translateX(0)' }],
              { duration: 600, hold: true, easing: 'cubic-bezier(.4,0,.25,1)' },
            ),
          );
        }
        await run(tasks);
        commit(prepared);
      } finally {
        window.removeEventListener('resize', finish);
        layer.remove();
        root.inert = priorInert;
        delete document.body.dataset.settingsTransition;
        sectionBusy = false;
        sectionFastForward = false;
        player.clear();
      }
      return;
    }
    const target = prepared.querySelector('.settings-card-display');
    const sourceCard = root.querySelector('.settings-card-display');
    const origin = rectangle(sourceCard);
    const width = sourceCard.offsetWidth,
      height = sourceCard.offsetHeight;
    const originTransform = `translate3d(${origin.x + origin.width / 2 - width / 2}px,${origin.y + origin.height / 2 - height / 2}px,0) ${getComputedStyle(sourceCard).transform}`;
    const flight = sourceCard.cloneNode(true);
    flight.className = 'settings-section-flight';
    flight.style.width = `${width}px`;
    flight.style.height = `${height}px`;
    flight.style.transform = originTransform;
    layer.append(flight);
    root.classList.add('is-section-departing');
    const targetTransform = () => {
      const box = rectangle(target);
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        transform: `translate3d(${box.x + box.width / 2 - width / 2}px,${box.y + box.height / 2 - height / 2}px,0) ${getComputedStyle(target).transform} scale(${target.offsetWidth / width})`,
      };
    };
    try {
      const destination = targetTransform();
      await run([
        play(
          flight,
          [
            {
              transform: originTransform,
            },
            { transform: destination.transform },
          ],
          { duration: 640, hold: true, easing: 'cubic-bezier(.25,.65,.2,1)' },
        ),
        play(
          root.querySelector(
            root.classList.contains('is-system')
              ? '.settings-system-orbit'
              : '.settings-config-orbit',
          ),
          [
            { transform: 'rotate(0deg)', opacity: 1 },
            { opacity: 1, offset: 0.6 },
            { transform: `rotate(${returning ? -84 : 84}deg)`, opacity: 0 },
          ],
          { duration: 640, hold: true, easing: 'cubic-bezier(.4,0,.65,1)' },
        ),
      ]);
      const landed = targetTransform();
      flight.style.transform = landed.transform;
      player.release(flight);
      layer.dataset.phase = 'revealing';
      const center = `${landed.x}px ${landed.y}px`;
      await run([
        play(
          reveal,
          [{ clipPath: `circle(10px at ${center})` }, { clipPath: `circle(145vmax at ${center})` }],
          {
            duration: 500,
            hold: true,
            easing: 'cubic-bezier(.65,0,.25,1)',
          },
        ),
        play(
          prepared.querySelector(returning ? '.settings-system-orbit' : '.settings-config-orbit'),
          [
            { transform: `rotate(${returning ? 84 : 70}deg)`, opacity: 0 },
            { opacity: 1, offset: 0.2 },
            { transform: 'rotate(0deg)', opacity: 1 },
          ],
          { duration: 760, hold: true, easing: 'cubic-bezier(.25,.65,.2,1)' },
        ),
      ]);
      commit(prepared);
    } finally {
      window.removeEventListener('resize', finish);
      layer.remove();
      root.classList.remove('is-section-departing');
      root.inert = priorInert;
      delete document.body.dataset.settingsTransition;
      sectionBusy = false;
      sectionFastForward = false;
      player.clear();
    }
  }
  async function settings(root) {
    if (!root || !player.enabled()) return;
    const system = root.classList.contains('is-system');
    const circles = [
      ...root.querySelectorAll(system ? '.settings-circle,.settings-scene' : '.settings-circle'),
    ].map((element) => ({ element, base: getComputedStyle(element).transform }));
    await Promise.all([
      ...circles.map(({ element, base }) =>
        play(
          element,
          [
            {
              transform: system
                ? 'translate3d(100px,-60px,0) scale(1.1)'
                : 'rotate(-10deg) scale(1.2)',
            },
            { transform: base },
          ],
          { duration: 430 },
        ),
      ),
      descendSettingsCard(root, player),
      revealSettingsArc(root, player),
      ...[
        ...root.querySelectorAll(
          '.settings-section:not([hidden]) .setting-row,.settings-section:not([hidden]) .settings-actions>button',
        ),
      ].map((el, i) =>
        play(
          el,
          [
            { transform: 'translateX(-35px)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 240, delay: 80 + i * 24 },
        ),
      ),
    ]);
  }
  return {
    swap,
    book,
    list,
    settings,
    settingsSection,
    finish,
    get settingsBusy() {
      return sectionBusy;
    },
  };
}
