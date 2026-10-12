import { createMotionPlayer } from './motion-player.js';
import { copyFinishCanvases, markFinishImage } from '../card-surfaces.js';

// Map the upright UI card onto the four projected corners of its table model.
// A single image travels between the two views; WebGL readback is unnecessary.
export function cardTransform(quad, width, height) {
  const [p0, p1, p2, p3] = quad,
    [x0, y0] = p0,
    [x1, y1] = p1,
    [x2, y2] = p2,
    [x3, y3] = p3;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dy1 = y1 - y2,
    dy2 = y3 - y2,
    dx3 = x0 - x1 + x2 - x3,
    dy3 = y0 - y1 + y2 - y3,
    den = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(den) > 1e-8 ? (dx3 * dy2 - dx2 * dy3) / den : 0,
    h = Math.abs(den) > 1e-8 ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  return `matrix3d(${[(x1 - x0 + g * x1) / width, (y1 - y0 + g * y1) / width, 0, g / width, (x3 - x0 + h * x3) / height, (y3 - y0 + h * y3) / height, 0, h / height, 0, 0, 1, 0, x0, y0, 0, 1].join(',')})`;
}
const rectQuad = (r) => [
  [r.left, r.top],
  [r.right, r.top],
  [r.right, r.bottom],
  [r.left, r.bottom],
];

export function createInspectorMotion(host, view, { motion, source }) {
  const player = createMotionPlayer(motion);
  let layer = null,
    flight = null,
    spreadGroups = [],
    stopSpreadReadiness = null,
    disposed = false,
    run = 0;
  const enabled = () => player.enabled();
  const frontCard = () => [...view.querySelectorAll('.inspect-card')].at(-1);
  function destination() {
    return frontCard()?.getBoundingClientRect();
  }
  function spreadDestination(rect) {
    const shift =
      parseFloat(view.querySelector('.inspect-card')?.style.getPropertyValue('--card-offset')) || 0;
    return cardTransform(
      rectQuad({
        left: rect.left + shift,
        right: rect.right + shift,
        top: rect.top,
        bottom: rect.bottom,
      }),
      rect.width,
      rect.height,
    );
  }
  function groupSpread(readiness) {
    const stage = view.querySelector('.inspect-card-stage');
    const cards = [...stage.querySelectorAll('.inspect-card')];
    const element = document.createElement('div');
    element.className = 'inspect-spread-group';
    stage.append(element);
    element.append(...cards);
    spreadGroups = [element];
    // The animation fills its initial value during the delay. Keep the base
    // at its destination so cancelling a finished track cannot collapse it.
    element.style.setProperty('--inspect-spread', '1');
    if (readiness) {
      element.dataset.progressive = 'true';
      const update = () =>
        element.style.setProperty('--inspect-ready-spread', readiness.fraction());
      update();
      stopSpreadReadiness = readiness.subscribe(update);
    }
    return spreadGroups;
  }
  function restoreSpread() {
    stopSpreadReadiness?.();
    stopSpreadReadiness = null;
    for (const group of spreadGroups) group.replaceWith(...group.children);
    spreadGroups = [];
  }
  function gateSpread(animation, readiness, token) {
    const { delay, duration } = animation.effect.getTiming();
    let frame = 0,
      gated = false;
    const update = () => {
      if (
        disposed ||
        token !== run ||
        animation.playState === 'finished' ||
        animation.playState === 'idle'
      )
        return;
      const limit = delay + duration * readiness.fraction();
      if (readiness.fraction() < 1 && Number(animation.currentTime) >= limit) {
        if (!gated || Number(animation.currentTime) > limit + 0.001) {
          animation.currentTime = limit;
          animation.pause();
        }
        gated = true;
      } else if (gated) {
        gated = false;
        animation.play();
      }
    };
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    const unsubscribe = readiness.subscribe(update);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }
  function tableQuad() {
    const quad = source()?.quad;
    if (
      quad?.length === 4 &&
      quad.flat().every(Number.isFinite) &&
      quad.every((p) => Math.abs(p[0]) < innerWidth * 3 && Math.abs(p[1]) < innerHeight * 3)
    )
      return quad;
    return rectQuad({
      left: innerWidth / 2 - 24,
      right: innerWidth / 2 + 24,
      top: innerHeight * 0.62 - 32,
      bottom: innerHeight * 0.62 + 32,
    });
  }
  function setup() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'inspect-transition-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML =
      '<i class="inspect-sweep sweep-blue"></i><i class="inspect-sweep sweep-cyan"></i><div class="inspect-flight-card"><img draggable="false"></div>';
    host.append(layer);
    flight = layer.querySelector('.inspect-flight-card');
    flight.dataset.finishSurface = 'sorting';
    const image = frontCard()?.querySelector('img');
    flight.querySelector('img').src = image?.src ?? '';
    const canvas = image?.parentElement.querySelector('.card-finish-canvas[data-ready="true"]');
    if (canvas) {
      flight.classList.add('has-real-finish');
      flight.append(canvas.cloneNode());
      copyFinishCanvases(image.parentElement, flight);
    }
    // Copied pixels cover the first frame; retain identity so moving light
    // angles are rendered throughout the flight instead of freezing the foil.
    if (image?.dataset.finishPrint)
      markFinishImage(flight.querySelector('img'), {
        printId: image.dataset.finishPrint,
        serial: Number(image.dataset.finishSerial) || undefined,
      });
  }
  function configureFlight() {
    const rect = destination();
    if (!rect?.width || !rect.height) return null;
    setup();
    flight.style.width = `${rect.width}px`;
    flight.style.height = `${rect.height}px`;
    return rect;
  }
  function sweep(returning) {
    const direction = returning ? -1 : 1;
    return [...layer.querySelectorAll('.inspect-sweep')].map((el, i) =>
      player.play(
        el,
        [
          { transform: `translate3d(${-direction * 115}vw,0,0) skewX(-24deg)`, opacity: 0 },
          {
            transform: `translate3d(${-direction * 18}vw,0,0) skewX(-24deg)`,
            opacity: i ? 0.6 : 0.32,
            offset: 0.45,
          },
          { transform: `translate3d(${direction * 115}vw,0,0) skewX(-24deg)`, opacity: 0 },
        ],
        { duration: returning ? 310 : 420, delay: i * 24, easing: 'cubic-bezier(.3,.04,.25,1)' },
      ),
    );
  }
  async function enter({ firstReady, prepared, readiness, onFlight, onPrepared }) {
    const token = ++run;
    if (!enabled()) {
      await firstReady;
      if (disposed || token !== run) return;
      onFlight();
      const rect = configureFlight();
      if (rect) {
        flight.style.transform = cardTransform(rectQuad(rect), rect.width, rect.height);
        flight.style.opacity = '1';
      }
      await prepared;
      if (!disposed && token === run) {
        onPrepared();
        layer?.remove();
        layer = null;
        flight = null;
      }
      return;
    }
    const stage = view.querySelector('.inspect-card-stage'),
      panels = [...view.querySelectorAll('.card-destination')],
      header = view.querySelector('.inspect-header'),
      actions = view.querySelector('.inspect-selected-actions'),
      caption = view.querySelector('.inspect-card-caption');
    // Start the interface on the click. Only the fan and its caption remain
    // hidden while their canvases are prepared at the final layout.
    const intro = [
      player.play(view, [{ opacity: 0 }, { opacity: 1 }], { duration: 350 }),
      player.play(
        header,
        [
          { transform: 'translateY(-28px)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 290, delay: 120 },
      ),
      ...panels.map((el, i) =>
        player.play(
          el,
          [
            { transform: `translateX(${i ? 90 : -90}px) rotate(${i ? 3 : -3}deg)`, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 370, delay: 110 + i * 35 },
        ),
      ),
    ];
    await firstReady;
    if (disposed || token !== run) return;
    onFlight();
    const rect = configureFlight();
    if (!rect) {
      await prepared;
      if (!disposed && token === run) onPrepared();
      await Promise.all(intro);
      return;
    }
    const target = spreadDestination(rect),
      origin = cardTransform(tableQuad(), rect.width, rect.height),
      started = performance.now();
    flight.style.transform = target;
    flight.style.opacity = '1';
    const flying = [
      player.play(flight, [{ transform: origin }, { transform: target }], { duration: 480 }),
      ...sweep(false),
    ];
    if (readiness) await readiness.wait(2);
    else await prepared;
    if (disposed || token !== run) return;
    // A resize while textures load can change the slot width. Rebuild the
    // collapsed layout before exposing any partially painted card.
    const readyRect = configureFlight(),
      readyTarget = spreadDestination(readyRect);
    if (readyTarget !== target) {
      player.finish();
      flight.style.transform = readyTarget;
    }
    const groups = groupSpread(readiness);
    onPrepared();
    const elapsed = performance.now() - started,
      delay = (at) => Math.max(0, at - elapsed);
    // The motion player cancels finished tracks. Keep the faded snapshot's
    // underlying style hidden so it cannot reappear while the fan unfolds.
    flight.style.opacity = '0';
    await Promise.all([
      ...intro,
      ...flying,
      // The ready prefix covers every unfinished card while the fan grows.
      player.play(flight, [{ opacity: 1 }, { opacity: 0 }], {
        duration: 100,
        delay: delay(380),
        easing: 'linear',
      }),
      player.play(stage, [{ opacity: 0 }, { opacity: 1 }], { duration: 110, delay: delay(340) }),
      ...[actions, caption].map((el, i) =>
        player.play(
          el,
          [
            { transform: 'translateY(18px)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 220, delay: delay(270 + i * 20) },
        ),
      ),
      // Reveal from the top. Unready rear cards remain fully overlapped at
      // the left edge; every exposed neighbour gap fits its painted eighth.
      ...groups.map((el) => {
        const track = player.play(el, [{ '--inspect-spread': 0 }, { '--inspect-spread': 1 }], {
          duration: el.querySelectorAll('.inspect-card').length * 16,
          delay: delay(450) + 110,
          easing: readiness ? 'linear' : 'ease-in-out',
          onStart: readiness ? (animation) => gateSpread(animation, readiness, token) : undefined,
        });
        // This inherited progress is not a transform layer. A transform hint
        // would make fixed-position early drags relative to this group.
        el.style.removeProperty('will-change');
        return track;
      }),
      prepared,
    ]);
    if (!disposed && token === run) {
      restoreSpread();
      layer.remove();
      layer = null;
      flight = null;
    }
  }
  async function leave(returnCard) {
    if (!enabled()) return;
    const spreadRect = spreadGroups.length ? destination() : null;
    const currentFlight =
        flight && Number(getComputedStyle(flight).opacity) > 0
          ? getComputedStyle(flight).transform
          : spreadRect
            ? cardTransform(rectQuad(spreadRect), spreadRect.width, spreadRect.height)
            : null,
      opacity = getComputedStyle(view).opacity;
    const panels = [
      ['.destination-collection', 'translateX(-65px)'],
      ['.destination-warehouse', 'translateX(65px)'],
      ['.inspect-header', 'translateY(-24px)'],
      ['.inspect-selected-actions', 'translateY(20px)'],
    ].map(([selector, end]) => {
      const el = view.querySelector(selector),
        style = getComputedStyle(el);
      return { el, end, transform: style.transform, opacity: style.opacity };
    });
    ++run;
    player.clear();
    restoreSpread();
    // Empty fans still fade the panels out, without creating a returning card.
    const rect = returnCard ? configureFlight() : null;
    if (returnCard && !rect) return;
    setup();
    flight.hidden = !returnCard;
    const tracks = [
      player.play(view, [{ opacity }, { opacity: 0 }], { duration: 290, hold: true }),
      ...sweep(true),
    ];
    if (returnCard) {
      const start = currentFlight ?? cardTransform(rectQuad(rect), rect.width, rect.height),
        end = cardTransform(tableQuad(), rect.width, rect.height);
      flight.style.transform = end;
      flight.style.opacity = '1';
      view.querySelector('.inspect-card-stage').style.visibility = 'hidden';
      tracks.push(
        player.play(
          flight,
          [
            { transform: start, opacity: 1 },
            { transform: end, opacity: 1 },
          ],
          { duration: 340 },
        ),
      );
    }
    for (const { el, end, transform, opacity } of panels)
      tracks.push(
        player.play(
          el,
          [
            { transform, opacity },
            { transform: end, opacity: 0 },
          ],
          { duration: 230, hold: true },
        ),
      );
    await Promise.all(tracks);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    ++run;
    player.dispose();
    restoreSpread();
    layer?.remove();
    layer = null;
    flight = null;
  }
  function claimCard() {
    // Early pickup hands the complete flight snapshot to the actual stack.
    // Only its opacity/flight tracks stop; the remaining cards keep spreading.
    if (!spreadGroups.length) return;
    if (flight) {
      player.release(flight);
      flight.hidden = true;
    }
    const stage = view.querySelector('.inspect-card-stage');
    player.release(stage);
    stage.style.opacity = '1';
  }
  return { enter, leave, dispose, enabled, claimCard, finish: player.finish };
}
