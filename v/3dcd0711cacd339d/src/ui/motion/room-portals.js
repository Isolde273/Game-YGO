import { createMotionPlayer, entryPlaybackRate } from './motion-player.js';
import { cardTransform } from './inspector-motion.js';
import { icon } from '../icons.js';

export const ROOM_PORTAL_MS = { shop: 1150, album: 680, warehouse: 820 };
const labels = { shop: '购买', album: '收藏册', warehouse: '仓库' };

// This connector is entirely DOM/WAAPI. The Blender model supplies only its
// projected entrance corners; no rendered animation or WebGL readback is used.
export function createRoomPortals({ app, motion, onStart, onFinish }) {
  let destination;
  const player = createMotionPlayer(motion, () => entryPlaybackRate(destination));
  let active = false,
    layer = null,
    phase = null,
    disposed = false;
  const finish = () => player.finish();
  async function go(page, source, navigate) {
    if (active || disposed) return false;
    if (!ROOM_PORTAL_MS[page] || !source || !player.enabled()) return navigate();
    destination = page;
    active = true;
    const priorInert = app.inert;
    let handoff = false,
      handoffObserver = null;
    app.inert = true;
    app.setAttribute('aria-busy', 'true');
    onStart?.();
    layer = document.createElement('div');
    layer.className = `room-portal-layer portal-${page}`;
    layer.dataset.portal = page;
    layer.dataset.phase = 'entering';
    layer.setAttribute('aria-hidden', 'true');
    const content =
      page === 'shop'
        ? `<div class="portal-handset"><div class="portal-device-screen"><i class="portal-screen-glint"></i>${icon('shop')}<strong>${labels[page]}</strong><div class="portal-app-row"><i></i><i></i><i></i></div></div></div>`
        : page === 'album'
          ? `<div class="portal-book"><div class="portal-page-block"><i></i><i></i><i></i></div><div class="portal-book-cover">${icon('album')}<strong>${labels[page]}</strong><i></i></div></div>`
          : `<div class="portal-carton"><div class="portal-carton-model"><div class="portal-carton-face carton-back"></div><div class="portal-carton-face carton-left"></div><div class="portal-carton-face carton-right"></div><div class="portal-carton-face carton-floor"><i></i></div><div class="portal-carton-face carton-front">${icon('warehouse')}<strong>${labels[page]}</strong></div><div class="portal-carton-hinge hinge-left"><div class="portal-carton-leaf leaf-left"></div></div><div class="portal-carton-hinge hinge-right"><div class="portal-carton-leaf leaf-right"></div></div></div></div>`;
    layer.innerHTML = `<div class="room-portal-shade"></div><i class="room-portal-trail"></i><div class="room-portal-flight">${content}</div>`;
    document.body.append(layer);
    phase = 'entering';
    const flight = layer.querySelector('.room-portal-flight'),
      width =
        page === 'warehouse'
          ? Math.min(innerWidth * 0.43, 330)
          : Math.min(innerWidth * 0.72, page === 'shop' ? 250 : 330),
      height = Math.min(
        innerHeight * 0.56,
        width * (page === 'shop' ? 1.8 : page === 'album' ? 1.23 : 0.78),
      );
    flight.style.width = `${width}px`;
    flight.style.height = `${height}px`;
    if (page === 'warehouse') {
      flight.style.setProperty('--carton-width', `${width}px`);
      flight.style.setProperty('--carton-height', `${height * 0.65}px`);
      flight.style.setProperty('--carton-depth', `${width * 0.54}px`);
    }
    const left = (innerWidth - width) / 2,
      top = (innerHeight - height) / 2,
      target = cardTransform(
        [
          [left, top],
          [left + width, top],
          [left + width, top + height],
          [left, top + height],
        ],
        width,
        height,
      );
    const safe =
      source.quad?.length === 4 &&
      source.quad.flat().every(Number.isFinite) &&
      source.quad.every((p) => Math.abs(p[0]) < innerWidth * 4 && Math.abs(p[1]) < innerHeight * 4);
    const origin = safe ? cardTransform(source.quad, width, height) : `${target} scale(.15)`;
    flight.style.transform = origin;
    flight.style.opacity = '0';
    window.addEventListener('resize', finish);
    try {
      const play = (selector, frames, options) =>
        player.play(layer.querySelector(selector), frames, { hold: true, ...options });
      let flightFrames = [
        { transform: origin, opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: `${target} scale(1.018)`, opacity: 1, offset: 0.5 },
        { transform: target, opacity: 1, offset: 0.56 },
        { transform: target, opacity: 1 },
      ];
      if (page === 'shop') {
        const quad = safe
            ? source.quad
            : [
                [left, top],
                [left + width, top],
                [left + width, top + height],
                [left, top + height],
              ],
          cx = quad.reduce((n, p) => n + p[0], 0) / 4,
          cy = quad.reduce((n, p) => n + p[1], 0) / 4;
        const lift = cardTransform(
          quad.map(([x, y]) => [
            cx + (x - cx) * 1.12 + (innerWidth / 2 - cx) * 0.08,
            cy + (y - cy) * 1.12 - 28,
          ]),
          width,
          height,
        );
        flightFrames = [
          { transform: origin, opacity: 0, easing: 'cubic-bezier(.35,0,.6,1)' },
          { transform: lift, opacity: 1, offset: 0.22, easing: 'cubic-bezier(.32,.08,.24,1)' },
          {
            transform: `${target} translate3d(10px,-6px,0) rotate(-1.4deg)`,
            opacity: 1,
            offset: 0.86,
            easing: 'cubic-bezier(.25,.45,.4,1)',
          },
          { transform: target, opacity: 1 },
        ];
      }
      const tasks = [
        player.play(flight, flightFrames, {
          duration: ROOM_PORTAL_MS[page],
          easing: page === 'shop' ? 'linear' : undefined,
          hold: true,
        }),
        play('.room-portal-shade', [{ opacity: 0 }, { opacity: 1 }], {
          duration: page === 'shop' ? 520 : 300,
        }),
        play(
          '.room-portal-trail',
          [
            { transform: 'translate3d(-110vw,0,0) skewX(-24deg)', opacity: 0 },
            { opacity: 0.7, offset: 0.45 },
            { transform: 'translate3d(110vw,0,0) skewX(-24deg)', opacity: 0 },
          ],
          { duration: page === 'shop' ? 550 : 330, delay: page === 'shop' ? 370 : 180 },
        ),
      ];
      if (page === 'shop') {
        tasks.push(
          play(
            '.portal-screen-glint',
            [
              { transform: 'translate3d(-180%,0,0)', opacity: 0 },
              { opacity: 0.45, offset: 0.45 },
              { transform: 'translate3d(180%,0,0)', opacity: 0 },
            ],
            { duration: 420, delay: 530 },
          ),
        );
        [...layer.querySelectorAll('.portal-app-row i')].forEach((el, i) =>
          tasks.push(
            player.play(
              el,
              [
                { transform: 'translate3d(0,12px,0) scale(.75)', opacity: 0 },
                { transform: 'none', opacity: 1 },
              ],
              { duration: 210, delay: 760 + i * 65, hold: true },
            ),
          ),
        );
      } else if (page === 'album') {
        tasks.push(
          play(
            '.portal-book-cover',
            [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-112deg)' }],
            { duration: 320, delay: 400 },
          ),
        );
        [...layer.querySelectorAll('.portal-page-block i')].forEach((el, i) =>
          tasks.push(
            player.play(
              el,
              [
                { transform: 'translate3d(24px,0,0) scaleX(.7)', opacity: 0 },
                { transform: 'none', opacity: 1 },
              ],
              { duration: 160, delay: 440 + i * 30, hold: true },
            ),
          ),
        );
      } else {
        tasks.push(
          play(
            '.portal-carton-model',
            [
              { transform: 'rotateX(-4deg) rotateY(-3deg)' },
              { transform: 'rotateX(-18deg) rotateY(-16deg)' },
            ],
            { duration: 240, delay: 300 },
          ),
        );
        tasks.push(
          play('.hinge-left', [{ transform: 'rotateZ(0deg)' }, { transform: 'rotateZ(-155deg)' }], {
            duration: 390,
            delay: 430,
            easing: 'cubic-bezier(.4,0,.2,1)',
          }),
          play('.hinge-right', [{ transform: 'rotateZ(0deg)' }, { transform: 'rotateZ(155deg)' }], {
            duration: 390,
            delay: 475,
            easing: 'cubic-bezier(.4,0,.2,1)',
          }),
        );
      }
      await Promise.all(tasks);
      if (disposed) return false;
      phase = 'handoff';
      layer.dataset.phase = phase;
      // Keep the connector until the existing mask completely covers the scene.
      // Remove it before revealing the destination to avoid two overlapping UIs.
      const transition = document.querySelector('#page-transition');
      if (transition) {
        handoffObserver = new MutationObserver(() => {
          if (['covered', 'revealing'].includes(transition.dataset.phase)) {
            layer?.remove();
            player.clear();
            handoffObserver.disconnect();
          }
        });
        handoffObserver.observe(transition, { attributes: true, attributeFilter: ['data-phase'] });
      }
      app.inert = priorInert;
      app.removeAttribute('aria-busy');
      handoff = true;
      return await navigate(
        page === 'shop'
          ? { source: layer.querySelector('.portal-device-screen'), phonePortal: true }
          : undefined,
      );
    } finally {
      window.removeEventListener('resize', finish);
      handoffObserver?.disconnect();
      player.clear();
      layer?.remove();
      layer = null;
      phase = null;
      active = false;
      if (!handoff) {
        app.inert = priorInert;
        app.removeAttribute('aria-busy');
      }
      onFinish?.();
    }
  }
  return {
    go,
    finish,
    get busy() {
      return active;
    },
    get phase() {
      return phase;
    },
    dispose() {
      disposed = true;
      finish();
      player.dispose();
      layer?.remove();
    },
  };
}
