import { trackFinishMotion } from './finish-motion.js';

const ease = 'cubic-bezier(.16,.82,.2,1)';
export const entryPlaybackRate = (page) =>
  ['open', 'album', 'warehouse'].includes(page) ? 0.85 : 1;
export const nextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// Motion owns temporary compositor layers only for the lifetime of its tracks.
export function createMotionPlayer(motion, playbackRate = () => 1) {
  const active = new Set(),
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => motion() && !reduced.matches;
  const finish = () => {
    for (const animation of active) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
  };
  const clear = () => {
    for (const animation of active) animation.cancel();
    active.clear();
  };
  const release = (element) => {
    for (const animation of active)
      if (animation.effect?.target === element) {
        animation.cancel();
        active.delete(animation);
      }
    element?.style.removeProperty('will-change');
  };
  const preferenceChanged = () => {
    if (!enabled()) finish();
  };
  reduced.addEventListener('change', preferenceChanged);
  async function play(
    element,
    keyframes,
    { duration = 280, delay = 0, easing = ease, hold = false, onStart = () => {} } = {},
  ) {
    if (!element?.isConnected || !enabled()) return;
    const previous = element.style.willChange;
    element.style.willChange = keyframes.some((frame) => frame.opacity !== undefined)
      ? 'transform, opacity'
      : 'transform';
    const animation = element.animate(keyframes, { duration, delay, easing, fill: 'both' });
    trackFinishMotion(animation);
    animation.playbackRate = playbackRate();
    active.add(animation);
    const cleanup = onStart(animation);
    try {
      await animation.finished;
    } catch {
    } finally {
      cleanup?.();
      if (!hold) {
        active.delete(animation);
        animation.cancel();
        element.style.willChange = previous;
      }
    }
  }
  const dispose = () => {
    clear();
    reduced.removeEventListener('change', preferenceChanged);
  };
  return { play, enabled, finish, clear, release, dispose };
}

// Read every base transform before starting tracks, avoiding layout read/write loops.
export function enterPage(
  app,
  page,
  player,
  { intro = false, phoneDock = false, settingsBackdropReady = false } = {},
) {
  if (!player.enabled()) return Promise.resolve();
  const tracks = [];
  function add(
    selector,
    {
      x = 0,
      y = 16,
      rotate = 0,
      scale = 1,
      delay = 0,
      stagger = 22,
      duration = 320,
      limit = 4,
    } = {},
  ) {
    [...app.querySelectorAll(selector)].slice(0, limit).forEach((element, i) => {
      const base = getComputedStyle(element).transform;
      tracks.push({
        element,
        base,
        start: `translate3d(${x}px,${y}px,0) rotate(${rotate}deg) scale(${scale})`,
        delay: delay + i * stagger,
        duration,
      });
    });
  }
  if (page === 'home') {
    add('.home-title', { x: -28, y: 0, duration: 300, limit: 1 });
    add('.menu-tile', { x: -44, y: 0, delay: 20, stagger: 20, duration: 260, limit: 6 });
    add('.hero-dragon', { x: 35, y: 0, rotate: 5, scale: 1.04, duration: 360, limit: 1 });
    add('.home-save', { y: 10, delay: 150, duration: 240, limit: 1 });
  } else {
    add('.heading-number', { y: -28, duration: 270, limit: 1 });
    add('.heading-title', { x: -30, y: 0, delay: 24, duration: 290, limit: 1 });
    add('.mini-nav', { x: 20, y: 0, duration: 270, limit: 1 });
    if (page === 'warehouse') {
      add('.stock-summary', { x: -24, y: 0, duration: 300, limit: 1 });
      add('.warehouse-product,.warehouse-card', {
        x: 32,
        y: 6,
        delay: 25,
        stagger: 18,
        duration: 300,
        limit: 6,
      });
    } else if (page === 'shop') {
      if (!phoneDock) add('.phone', { x: 0, y: 24, rotate: 3, delay: 0, duration: 330, limit: 1 });
      add('.shop-app-guide>button', {
        x: -24,
        y: 0,
        delay: 35,
        stagger: 30,
        duration: 280,
        limit: 3,
      });
      add('.phone-apps>button', {
        y: 14,
        scale: 0.8,
        delay: phoneDock ? 260 : 70,
        stagger: 22,
        duration: phoneDock ? 160 : 240,
        limit: 3,
      });
      add('.shop-budget', { y: 20, delay: 80, duration: 300, limit: 1 });
    } else if (page === 'settings') {
      if (!settingsBackdropReady)
        add('.is-system .settings-circle,.is-system .settings-scene', {
          x: 100,
          y: -60,
          scale: 1.1,
          delay: 0,
          stagger: 0,
          duration: 560,
          limit: 2,
        });
      add('.settings-menu>button', {
        x: 40,
        y: 0,
        delay: 100,
        stagger: 50,
        duration: 270,
        limit: 4,
      });
    } else if (page === 'open') {
      add('.unboxing-hud>div,.space-return', {
        y: -22,
        delay: 0,
        stagger: 18,
        duration: 260,
        limit: 4,
      });
      add('.world-controls,.space-actions', { y: 20, delay: 35, duration: 260, limit: 2 });
    }
  }
  // Initial navigation stays interactive; startup tracks can be cancelled by go().
  return Promise.all([
    ...tracks.map(({ element, base, start, delay, duration }) =>
      player.play(
        element,
        [
          { opacity: 0, transform: `${start} ${base === 'none' ? '' : base}` },
          { opacity: 1, transform: base },
        ],
        { duration: intro ? duration + 40 : duration, delay },
      ),
    ),
    ...(page === 'settings'
      ? [
          descendSettingsCard(app.querySelector('.settings-persona'), player),
          revealSettingsArc(app.querySelector('.settings-persona'), player),
        ]
      : []),
  ]);
}

export function revealSettingsArc(root, player) {
  if (!root?.classList.contains('is-system')) return Promise.resolve();
  return player.play(
    root.querySelector('.settings-system-orbit'),
    [
      { transform: 'rotate(84deg)', opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { transform: 'rotate(0deg)', opacity: 1 },
    ],
    { duration: 800, delay: 40, easing: 'cubic-bezier(.25,.65,.2,1)' },
  );
}

export function descendSettingsCard(root, player) {
  const card = root?.querySelector('.settings-card-display');
  const sweep = root?.querySelector('.settings-card-sweep');
  if (!card || !player.enabled()) return Promise.resolve();
  const base = getComputedStyle(card).transform;
  const start = -card.getBoundingClientRect().bottom - 30;
  const left = card.offsetLeft - 28;
  const right = card.offsetLeft + card.offsetWidth + 28;
  const bottom = card.offsetTop + card.offsetHeight + 32;
  const clip = (y) =>
    `polygon(${left}px 0, ${right}px 0, ${right - 35}px ${y}px, ${left + 20}px ${y}px)`;
  const timing = { duration: 900, delay: 30, easing: 'cubic-bezier(.22,.68,.23,1)' };
  return Promise.all([
    player.play(
      card,
      [{ transform: `translate3d(0,${start}px,0) ${base}` }, { transform: base }],
      timing,
    ),
    player.play(
      sweep,
      [
        { clipPath: clip(0), opacity: 0 },
        { opacity: 0.8, offset: 0.12 },
        { opacity: 0.8, offset: 0.78 },
        { clipPath: clip(bottom), opacity: 0 },
      ],
      timing,
    ),
  ]);
}

export function enterList(host, player, { direction = 1 } = {}) {
  if (!host || !player.enabled()) return Promise.resolve();
  const elements = [
    ...host.querySelectorAll(
      '.warehouse-card,.warehouse-product,.jhs-product,.tao-product,.chat-message,.app-history>div,.wallet-card,.phone-apps>button',
    ),
  ]
    .filter((e) => !e.hidden)
    .slice(0, 6);
  return Promise.all(
    elements.map((element, i) =>
      player.play(
        element,
        [
          { opacity: 0, transform: `translate3d(${direction * 18}px,12px,0) scale(.96)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 240, delay: 30 + i * 20 },
      ),
    ),
  );
}
