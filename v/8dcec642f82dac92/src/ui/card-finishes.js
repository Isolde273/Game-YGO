import * as THREE from '../vendor/three.module.js';
import { createGameFinishLibrary } from '../scene/game-card-finishes.js';
import { createFinishBatchRenderer } from './card-finish-batch.js';
import { movingFinishImages } from './motion/finish-motion.js';
import {
  backgroundResourcesAllowed,
  resourceSchedulerStats,
  scheduleResourceTask,
} from '../scene/resource-scheduler.js';

export function measureInspectorSpread(group) {
  // These identical cards only translate along one shared timeline. Two live
  // endpoints preserve fractional layout and ancestor motion without measuring
  // every rear card on every animation frame.
  const images = [...group.querySelectorAll('.inspect-card > img[data-finish-print]')];
  const rects = new Map();
  if (!images.length) return rects;
  const first = images[0],
    last = images.at(-1);
  const start = first.getBoundingClientRect(),
    end = last.getBoundingClientRect();
  const offsetOf = (image) =>
    parseFloat(image.parentElement.style.getPropertyValue('--card-offset')) || 0;
  const origin = offsetOf(first),
    distance = offsetOf(last) - origin;
  for (const image of images) {
    const fraction = distance ? (offsetOf(image) - origin) / distance : 0;
    rects.set(
      image,
      new DOMRect(
        start.left + (end.left - start.left) * fraction,
        start.top + (end.top - start.top) * fraction,
        start.width,
        start.height,
      ),
    );
  }
  return rects;
}

// One WebGL context renders into retained 2D canvases, including moving DOM cards.
// Intersection-driven references keep long warehouses from loading the whole pool.
export function createCardFinishes(root, settings) {
  const views = new Map(),
    pending = new Set(),
    deferred = new Set();
  const library = createGameFinishLibrary();
  const textureUploads = new Map(),
    uploadedTextures = new WeakMap();
  const lights = new Map(
    ['album', 'sorting'].map((surface) => [
      surface,
      {
        current: new THREE.Vector2(innerWidth * 0.25, innerHeight * 0.2),
        target: new THREE.Vector2(innerWidth * 0.25, innerHeight * 0.2),
        locked: false,
      },
    ]),
  );
  const pointer = new THREE.Vector2(innerWidth * 0.25, innerHeight * 0.2);
  let renderer,
    scene,
    camera,
    plane,
    batchRenderer,
    frame = 0,
    disposed = false,
    draws = 0,
    pixels = 0,
    scanNeeded = true;
  let warmKey = '',
    warmRun = 0,
    warmHandles = [],
    programsReady = null;
  let programPriority = 0;
  let completionPixelBudget = 32768;
  let lastCompletionFrame = 0;
  let lastLiveFrame = 0;
  let lastBrowserFrame = 0;
  let shortestBrowserFrame = 1000 / 60;
  const nextFrame = () => new Promise(requestAnimationFrame);
  function preparePrograms(material, priority = 2) {
    programPriority = Math.max(programPriority, priority);
    return (programsReady ??= scheduleResourceTask(
      () => {
        setup();
        return batchRenderer.prepare(material);
      },
      { valid: () => !disposed, priority: () => programPriority },
    ));
  }
  function uploadMaterial(material, valid, priority = 2) {
    if (disposed || !valid()) return Promise.resolve();
    const textures = new Set(
      Object.values(material.uniforms)
        .map((uniform) => uniform.value)
        .filter((value) => value?.isTexture),
    );
    const ready = [...textures].map((texture) => {
      if (uploadedTextures.get(texture) === texture.version) return Promise.resolve();
      let upload = textureUploads.get(texture);
      if (!upload) {
        const waiters = [];
        upload = { waiters };
        upload.ready = scheduleResourceTask(
          () => {
            renderer.initTexture(texture);
            uploadedTextures.set(texture, texture.version);
          },
          {
            valid: () => !disposed && waiters.some((waiter) => waiter.valid()),
            priority: () =>
              Math.max(
                ...waiters.filter((waiter) => waiter.valid()).map((waiter) => waiter.priority),
              ),
          },
        ).finally(() => textureUploads.delete(texture));
        textureUploads.set(texture, upload);
      }
      upload.waiters.push({ valid, priority });
      return upload.ready;
    });
    return Promise.all(ready);
  }
  function warm(records) {
    // Repeated prints share one material and its textures; warm each only once.
    // A web visit must not queue an entire saved stack ahead of the next pack.
    // The inspector loads rear cards in its own ordered preparation batches.
    const candidates = records.slice(document.documentElement.dataset.webRelease ? -1 : -8);
    const unique = new Map(
      [...candidates].reverse().map((card) => [`${card.printId}:${card.serial ?? ''}`, card]),
    );
    const key = [...unique.keys()].join('|');
    if (key === warmKey || disposed) return;
    warmKey = key;
    const token = ++warmRun;
    warmHandles.forEach((handle) => handle.release());
    warmHandles = [];
    // Keep only a small near-top working set, and prepare one hidden card at a
    // time. Foreground preparation promotes any shared image already queued.
    const load = async () => {
      const records = [...unique.values()];
      const valid = () => !disposed && token === warmRun;
      for (const [index, record] of records.entries()) {
        const priority = index === 0 ? 1 : 0;
        await scheduleResourceTask(() => {}, { priority, valid });
        if (!valid()) return;
        const handle = library.acquire(record, { priority });
        if (!handle) continue;
        warmHandles.push(handle);
        await handle.ready
          .then(async () => {
            if (!valid()) return;
            await preparePrograms(handle.material, priority);
            if (valid()) await uploadMaterial(handle.material, valid, priority);
          })
          .catch(() => {});
      }
    };
    load().catch(() => {});
  }
  function schedule(view) {
    if (disposed) return;
    if (view) pending.add(view);
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function refresh() {
    for (const view of views.values()) {
      view.layout = null;
      if (view.visible) schedule(view);
    }
  }
  function surfaceOf(image) {
    if (image.closest('.card-inspector,[data-finish-surface="sorting"]')) return 'sorting';
    if (image.closest('.album-studio,[data-finish-surface="album"]')) return 'album';
    return null;
  }
  function selection(event) {
    const light = lights.get(event.detail?.surface);
    if (!light || light.locked === event.detail.selected) return;
    light.locked = event.detail.selected;
    // Freeze the displayed light, including an unfinished smooth pointer move.
    light.target.copy(light.locked || event.detail.surface === 'sorting' ? light.current : pointer);
    refresh();
  }
  function relativeLight(view, light, rect, angleOf) {
    const scale = Math.max(1, Math.min(innerWidth, innerHeight) / 12);
    const x = (light.current.x - rect.left - rect.width / 2) / scale;
    const y = (rect.top + rect.height / 2 - light.current.y) / scale;
    // Rotate the incident direction into the moving card's unchanged film axes.
    const angle = angleOf(view.image);
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    view.target.set(x * cos + y * sin, -x * sin + y * cos, 7);
    view.light.copy(view.target);
  }
  function release(view) {
    view.handle?.release();
    view.handle = null;
    view.signature = null;
    pending.delete(view);
    deferred.delete(view);
  }
  function removeStrip(view) {
    view.strip?.remove();
    view.strip = null;
    view.canvas.style.removeProperty('visibility');
    view.image.style.removeProperty('visibility');
  }
  function stripContext(view, { w, h, renderW, left, top, width, height }) {
    if (!view.strip) {
      view.strip = document.createElement('canvas');
      view.strip.className = 'card-finish-strip';
      view.strip.setAttribute('aria-hidden', 'true');
      view.canvas.after(view.strip);
    }
    const stripWidth = Math.min(w, Math.ceil(Math.max(renderW, Math.ceil(w / 16) * 2) / 32) * 32);
    if (view.strip.width < stripWidth || view.strip.height !== h) {
      view.strip.width = stripWidth;
      view.strip.height = h;
    }
    Object.assign(view.strip.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${(width * view.strip.width) / w}px`,
      height: `${height}px`,
    });
    view.canvas.style.visibility = 'hidden';
    view.image.style.visibility = 'hidden';
    return view.strip.getContext('2d');
  }
  function setup() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    // The new renderer already uses DPR 1. Reapplying it resizes and clears
    // its hidden default buffer before the batch renderer reserves real tiles.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10.8;
    plane = new THREE.Mesh(new THREE.PlaneGeometry(2.95, 4.3), null);
    scene.add(plane);
    batchRenderer = createFinishBatchRenderer(renderer, scene, camera, plane);
  }
  function activate(view, priority = 2) {
    if (disposed) return;
    if (view.handle) {
      view.handle.promote(priority);
      return;
    }
    if (view.image.dataset.finishSrc && !view.image.getAttribute('src'))
      view.image.src = view.image.dataset.finishSrc;
    const serial = Number(view.image.dataset.finishSerial) || undefined;
    const handle = library.acquire(
      { printId: view.image.dataset.finishPrint, serial },
      { priority },
    );
    if (!handle) return;
    view.handle = handle;
    if (view.partial) deferred.add(view);
    handle.ready
      .then(() => {
        if (!disposed && view.handle === handle && view.image.isConnected) schedule(view);
      })
      .catch(() => {});
  }
  const intersection = new IntersectionObserver((changes) => {
    for (const change of changes) {
      const view = views.get(change.target);
      if (!view) continue;
      view.visible = change.isIntersecting;
      view.layout = null;
      if (view.visible) {
        if (!view.preparing) activate(view);
        schedule(view);
      } else if (!view.preparing) release(view);
    }
  });
  const resize = new ResizeObserver((changes) => {
    for (const change of changes) {
      const view = views.get(change.target);
      if (view) view.layout = null;
      schedule(view);
    }
  });
  function scan() {
    scanNeeded = false;
    for (const [image, view] of views) {
      if (
        !image.isConnected ||
        view.key !== `${image.dataset.finishPrint}:${image.dataset.finishSerial ?? ''}`
      ) {
        release(view);
        intersection.unobserve(image);
        resize.unobserve(image);
        view.canvas.remove();
        removeStrip(view);
        image.removeEventListener('load', view.loaded);
        views.delete(image);
      }
    }
    for (const image of root.querySelectorAll('img[data-finish-print]')) {
      if (image.closest('[data-finish-snapshot]')) continue;
      if (views.has(image)) continue;
      const parent = image.parentElement;
      const canvas =
        parent.querySelector(':scope > .card-finish-canvas') ?? document.createElement('canvas');
      canvas.className = 'card-finish-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.printId = image.dataset.finishPrint;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.classList.add('has-real-finish');
      if (!canvas.isConnected) image.after(canvas);
      const view = {
        image,
        canvas,
        context: canvas.getContext('2d'),
        key: `${image.dataset.finishPrint}:${image.dataset.finishSerial ?? ''}`,
        light: new THREE.Vector3(-3, 4.5, 7),
        target: new THREE.Vector3(-3, 4.5, 7),
      };
      view.loaded = () => {
        view.layout = null;
        schedule(view);
      };
      image.addEventListener('load', view.loaded);
      views.set(image, view);
      intersection.observe(image);
      resize.observe(image);
    }
  }
  function draw(preparedViews = null, { sortingEntry = false } = {}) {
    // requestAnimationFrame supplies a timestamp, explicit preparation supplies views.
    const frameTime = typeof preparedViews === 'number' ? preparedViews : 0;
    if (frameTime) {
      const interval = frameTime - lastBrowserFrame;
      if (lastBrowserFrame && interval >= 5)
        shortestBrowserFrame = Math.min(shortestBrowserFrame, interval);
      lastBrowserFrame = frameTime;
    }
    // DOM motion follows the display refresh rate. Full-quality film updates
    // use a 60 Hz cadence so a 120/144 Hz display cannot flood the shared GPU
    // and compositor with redundant canvas snapshots. Explicit preparation and
    // pickup/resize completion remain synchronous.
    if (frameTime && lastLiveFrame && frameTime - lastLiveFrame < 1000 / 60 - 1) {
      frame = 0;
      schedule();
      return;
    }
    const deliveredMs = frameTime && lastCompletionFrame ? frameTime - lastCompletionFrame : 0;
    lastCompletionFrame = 0;
    if (!Array.isArray(preparedViews)) preparedViews = null;
    frame = 0;
    if (scanNeeded) scan();
    let following = false;
    const followingSurfaces = new Set();
    for (const [surface, light] of lights) {
      if (light.locked) continue;
      light.current.lerp(light.target, surface === 'sorting' || !settings().motion ? 1 : 0.22);
      if (light.current.distanceToSquared(light.target) > 0.04) {
        following = true;
        followingSurfaces.add(surface);
      } else light.current.copy(light.target);
    }
    // DOM transforms and Web Animations move the card relative to the screen light.
    // Poll only while a card is moving; idle cards retain their last pixels.
    // Entry owns a live drawing lifecycle. Inherited CSS progress may not be
    // discoverable as a transform track on each card; never let that pause
    // lighting or retain the final-layout pixels while the stack spreads.
    const enteringImages = new Set(
      root.querySelectorAll(
        '.card-inspector[data-phase="entering"] .inspect-card img[data-finish-print]',
      ),
    );
    const movingImages = new Set([
      ...enteringImages,
      ...movingFinishImages(root),
      ...root.querySelectorAll(
        '.inspect-card.dragging img[data-finish-print],.album-drag-ghost img[data-finish-print]',
      ),
    ]);
    const moving = movingImages.size > 0;
    for (const view of views.values()) {
      const surface = surfaceOf(view.image);
      if ((!view.visible && !enteringImages.has(view.image)) || !surface) continue;
      if (followingSurfaces.has(surface) || movingImages.has(view.image)) pending.add(view);
    }
    // Spread frames keep visible lighting first, then fill one small hidden
    // suffix. Other moving/dragged cards and recent interactions still yield.
    const completingDuringEntry = enteringImages.size > 0 && backgroundResourcesAllowed();
    const eligible = (view) =>
      (view.visible || enteringImages.has(view.image)) &&
      (view.image.closest('.card-inspector')?.dataset.phase === 'open' ||
        (completingDuringEntry && enteringImages.has(view.image)));
    const completing = new Set(
      preparedViews || (moving && !completingDuringEntry)
        ? []
        : [...deferred].filter(eligible).slice(0, completingDuringEntry ? 1 : 2),
    );
    const batch = preparedViews ?? [...new Set([...pending, ...completing])];
    for (const view of batch) pending.delete(view);
    // Pointer light changes do not move the sorting fan. Reuse its measured
    // layout until resize/mutation, while reading animated and dragged cards live.
    for (const image of movingImages) {
      const view = views.get(image);
      if (view) view.layout = null;
    }
    const rects = new Map();
    const spreadRects = new Map();
    const rectOf = (image) => {
      if (!rects.has(image)) {
        const group = image.parentElement.parentElement;
        if (group.matches('.inspect-spread-group') && !group.querySelector('.dragging')) {
          if (!spreadRects.has(group)) {
            for (const [item, rect] of measureInspectorSpread(group)) rects.set(item, rect);
            spreadRects.set(group, true);
          }
        } else rects.set(image, views.get(image)?.layout?.rect ?? image.getBoundingClientRect());
      }
      return rects.get(image);
    };
    const angles = new Map();
    const spreadCards = new Map();
    function* followingCards(card) {
      if (card.parentElement.matches('.inspect-spread-group')) {
        const stage = card.parentElement.parentElement;
        if (!spreadCards.has(stage))
          spreadCards.set(stage, [...stage.querySelectorAll('.inspect-card')]);
        const cards = spreadCards.get(stage);
        for (let index = cards.indexOf(card) + 1; index < cards.length; index++) yield cards[index];
      } else {
        for (let next = card.nextElementSibling; next; next = next.nextElementSibling) yield next;
      }
    }
    const angleOf = (el) => {
      if (!el || el === root) return 0;
      if (!angles.has(el)) {
        const transform = getComputedStyle(el).transform;
        const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
        angles.set(el, angleOf(el.parentElement) - (matrix ? Math.atan2(matrix.b, matrix.a) : 0));
      }
      return angles.get(el);
    };
    const jobs = [];
    let completionPixels = completingDuringEntry
      ? Math.min(completionPixelBudget, 16384)
      : completionPixelBudget;
    for (const view of batch) {
      if (
        (view.preparing && !preparedViews) ||
        (!preparedViews &&
          view.image.closest(
            '.card-inspector[data-phase="preparing"],.card-inspector[data-phase="loading"]',
          )) ||
        (!preparedViews &&
          view.image.closest('.card-inspector[data-phase="closing"] .inspect-card-stage')) ||
        (!view.visible && !view.preparing && !enteringImages.has(view.image)) ||
        !view.image.isConnected ||
        !view.handle?.material.userData.ready
      )
        continue;
      const { image, canvas, context, handle } = view;
      if (view.preparing) view.layout = null;
      const surface = surfaceOf(image);
      const measured = view.layout ?? {
        width: image.clientWidth,
        height: image.clientHeight,
        left: image.offsetLeft,
        top: image.offsetTop,
      };
      const { width, height, left, top } = measured;
      if (!width || !height) continue;
      setup();
      const ratio = Math.min(devicePixelRatio, 1.5, 860 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * ratio)),
        h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        removeStrip(view);
        canvas.width = w;
        canvas.height = h;
        delete canvas.dataset.ready;
        view.coverage = 0;
        view.partial = null;
        deferred.delete(view);
      }
      const dimensions = `${left}:${top}:${width}:${height}`;
      if (view.dimensions !== dimensions) {
        view.dimensions = dimensions;
        Object.assign(canvas.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
        });
      }
      if (surface) {
        measured.rect ??= rectOf(image);
        // A spreading card/image has no rotation of its own; all share the
        // group's film axes. Flying and dragged surfaces still measure live.
        measured.angle ??= angleOf(
          image.parentElement.parentElement.matches('.inspect-spread-group') &&
            !image.parentElement.classList.contains('dragging')
            ? image.parentElement.parentElement
            : image,
        );
        relativeLight(view, lights.get(surface), measured.rect, () => measured.angle);
        if (surface === 'sorting' && !view.preparing && !movingImages.has(image))
          view.layout = measured;
      } else view.light.lerp(view.target, settings().motion ? 0.22 : 1);
      const uniforms = handle.material.uniforms;
      const brightness = (settings().brightness ?? 85) / 85;
      let toneMappingExposure = surface ? 0.86 : 1.12;
      let exposure = brightness * (surface ? 0.68 : 1);
      let renderW = w;
      const light = view.light.clone();
      const entryPartial =
        sortingEntry && image.parentElement.matches('.inspect-card:not(:last-child)');
      if (entryPartial) {
        // Keep the boundary on the original 2x2 fragment-derivative grid.
        renderW = Math.min(w, Math.ceil(w / 16) * 2);
      }
      // One spread timeline keeps unfinished suffixes covered. Refresh only
      // the currently exposed strips as the cards move.
      const spreading = image.parentElement.parentElement.matches('.inspect-spread-group');
      // Once prepared, stationary rear cards also update only their exposed strip.
      if (
        !entryPartial &&
        !view.preparing &&
        canvas.dataset.ready === 'true' &&
        image.parentElement.matches('.inspect-card:not(.dragging)') &&
        (!movingImages.has(image) || spreading)
      ) {
        const rect = rectOf(image);
        let visibleW = w;
        for (const next of followingCards(image.parentElement)) {
          if (next.classList.contains('dragging')) continue;
          const nextImage = next.querySelector('img[data-finish-print]');
          if (!nextImage || (!spreading && movingImages.has(nextImage))) continue;
          const cover = rectOf(nextImage);
          if (
            cover.top <= rect.top + 0.5 &&
            cover.bottom >= rect.bottom - 0.5 &&
            cover.right >= rect.right
          ) {
            visibleW =
              cover.left <= rect.left + 0.1
                ? 0
                : Math.max(0, Math.ceil(((cover.left - rect.left) * w) / rect.width));
            renderW = Math.min(renderW, visibleW ? visibleW + 2 : 0);
            break;
          }
        }
        // The slot width already fits inside the prepared prefix. Keep the
        // crop's sampling margin from growing that prefix on narrow screens.
        // Normal neighbour gaps stay inside the prefix. Early pickup/routing
        // can expose more; draw that newly visible area instead of clipping it.
        const preparedPrefix = Math.min(w, Math.ceil(w / 16) * 2);
        if (spreading && visibleW <= preparedPrefix) renderW = Math.min(renderW, preparedPrefix);
      }
      const signature = [
        w,
        h,
        0,
        renderW,
        ...light.toArray(),
        exposure,
        toneMappingExposure,
        uniforms.foilEnabled.value,
        uniforms.reliefEnabled.value,
      ].join(':');
      const job = {
        view,
        context,
        material: handle.material,
        light,
        exposure,
        toneMappingExposure,
        w,
        h,
        renderW,
        renderX: 0,
        entryPartial,
      };
      if (renderW && view.signature !== signature) {
        // Updating a small exposed edge on a full-size DOM canvas republishes
        // its entire backing texture to the compositor. Keep that edge in a
        // bounded, narrow overlay; the prepared full face remains underneath
        // for pickup, routing and suffix completion.
        if (
          renderW < w &&
          !view.preparing &&
          image.parentElement.matches('.inspect-card:not(.dragging)')
        ) {
          job.context = stripContext(view, { w, h, renderW, left, top, width, height });
        } else if (view.strip) {
          removeStrip(view);
        }
        view.signature = signature;
        jobs.push(job);
        draws++;
        pixels += renderW * h;
      }
      // Completion is a separate hidden job. It must never suppress the live
      // visible strip or replace its current light with preparation-time light.
      if (completing.has(view) && view.partial) {
        const renderX = view.coverage;
        const suffixWidth = Math.min(w - renderX, Math.floor(completionPixels / h / 2) * 2);
        if (suffixWidth > 0) {
          const suffixPixels = suffixWidth * h;
          completionPixels -= suffixPixels;
          jobs.push({ ...job, context, renderX, renderW: suffixWidth, entryPartial: false });
          draws++;
          pixels += suffixPixels;
        }
      }
      if (!surface && view.light.distanceToSquared(view.target) > 0.0004) schedule(view);
    }
    if (jobs.length) {
      if (frameTime) lastLiveFrame = frameTime;
      const started = performance.now();
      batchRenderer.draw(jobs);
      if (jobs.every((job) => job.renderX > 0)) {
        const area = jobs.reduce((sum, job) => sum + job.renderW * job.h, 0);
        // At 144 Hz the 60 Hz limit intentionally uses three display ticks
        // (~20.8 ms). Do not treat that cadence as a GPU overrun and permanently
        // shrink the hidden-completion budget to its minimum.
        const cadence = Math.ceil((1000 / 60 - 1) / shortestBrowserFrame) * shortestBrowserFrame;
        const target =
          (area * 4) /
          Math.max(
            0.25,
            performance.now() - started,
            deliveredMs > cadence + 2 ? deliveredMs - cadence : 0,
          );
        completionPixelBudget = Math.round(
          Math.max(16384, Math.min(131072, completionPixelBudget * 0.5 + target * 0.5)),
        );
        lastCompletionFrame = frameTime;
      }
      for (const {
        view,
        material,
        w,
        renderX,
        renderW,
        entryPartial,
        light,
        exposure,
        toneMappingExposure,
      } of jobs) {
        view.coverage = Math.max(view.coverage ?? 0, renderX + renderW);
        if (entryPartial && view.coverage < w) {
          view.partial = { light: light.clone(), exposure, toneMappingExposure };
          deferred.add(view);
          // Allocate and paint the narrow display texture in the existing
          // preparation batch, rather than allocating all rear layers on the
          // first visible spread frame.
          stripContext(view, {
            w,
            h: view.canvas.height,
            renderW,
            left: view.image.offsetLeft,
            top: view.image.offsetTop,
            width: view.image.clientWidth,
            height: view.image.clientHeight,
          }).drawImage(
            view.canvas,
            0,
            0,
            renderW,
            view.canvas.height,
            0,
            0,
            renderW,
            view.canvas.height,
          );
        } else if (view.coverage === w) {
          view.partial = null;
          deferred.delete(view);
        }
        // A pointer/light change may have arrived during suffix completion.
        // Refresh the exposed strip on the next frame with the current light.
        if (renderX) schedule(view);
        view.canvas.dataset.ready = 'true';
        view.canvas.dataset.renderedWidth = String(view.coverage);
        view.canvas.dataset.complete = String(view.coverage === w);
        view.canvas.dataset.kind = String(material.uniforms.kind.value);
        view.image.parentElement.dataset.finishReady = 'true';
      }
    }
    if (following || moving || [...deferred].some(eligible)) schedule();
  }
  function complete(host) {
    if (!host || disposed) return;
    const cards = [...views.values()].filter(
      (view) => (view.partial || view.strip) && host.contains(view.image),
    );
    if (!cards.length) return;
    cancelAnimationFrame(frame);
    for (const view of cards) view.preparing = true;
    try {
      draw(cards);
    } finally {
      for (const view of cards) view.preparing = false;
    }
  }
  function move(event) {
    pointer.set(event.clientX, event.clientY);
    const album = lights.get('album'),
      sorting = lights.get('sorting');
    if (!album.locked) album.target.copy(pointer);
    const card = event.target.closest?.('.inspect-card');
    const cardRect = sorting.locked ? null : card?.getBoundingClientRect();
    const overCard =
      cardRect &&
      event.clientX >= cardRect.left &&
      event.clientX <= cardRect.right &&
      event.clientY >= cardRect.top &&
      event.clientY <= cardRect.bottom;
    if (!sorting.locked && overCard) sorting.target.copy(pointer);
    for (const view of views.values()) {
      const surface = surfaceOf(view.image);
      if (
        view.visible &&
        ((surface === 'album' && !album.locked) ||
          (surface === 'sorting' && overCard && !sorting.locked))
      )
        schedule(view);
    }
    const parent = event.target.closest?.('.has-real-finish');
    if (!parent) return;
    const image = parent.querySelector('img[data-finish-print]'),
      view = views.get(image);
    if (!view?.visible) return;
    if (surfaceOf(image)) return;
    const rect = image.getBoundingClientRect();
    view.target.set(
      ((event.clientX - rect.left) / rect.width - 0.5) * 12,
      (1 - (event.clientY - rect.top) / rect.height) * 8 - 1,
      7,
    );
    schedule(view);
  }
  function leave(event) {
    const parent = event.target.closest?.('.has-real-finish');
    if (!parent || parent.contains(event.relatedTarget)) return;
    const view = views.get(parent.querySelector('img[data-finish-print]'));
    if (view && !surfaceOf(view.image)) {
      view.target.set(-3, 4.5, 7);
      schedule(view);
    }
  }
  const mutations = new MutationObserver((changes) => {
    if (
      changes.every((change) => change.target.matches?.('.card-finish-canvas,.card-finish-strip'))
    )
      return;
    let refreshAll = false;
    for (const change of changes) {
      if (change.target.matches?.('.card-finish-canvas,.card-finish-strip')) continue;
      if (change.attributeName === 'data-phase') {
        // Start entry drawing immediately, and invalidate its last moving
        // geometry at the final handoff. Closing still skips the hidden fan.
        if (change.target.matches?.('.card-inspector')) refreshAll = true;
        continue;
      }
      if (change.type === 'childList' || change.attributeName?.startsWith('data-finish-'))
        scanNeeded = true;
      if (change.target.matches?.('.inspect-card.dragging')) {
        schedule(views.get(change.target.querySelector('img[data-finish-print]')));
      } else if (!(
        change.attributeName === 'class' &&
        change.target.matches?.('.card-destination,.inspect-card-stage')
      )) {
        refreshAll = true;
      }
    }
    if (refreshAll) refresh();
    schedule();
  });
  mutations.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-finish-print', 'data-finish-serial', 'class', 'style', 'data-phase'],
  });
  window.addEventListener('pointermove', move);
  root.addEventListener('pointerout', leave);
  root.addEventListener('card-light-selection', selection);
  window.addEventListener('resize', refresh);
  window.addEventListener('scroll', refresh, true);
  scan();
  return {
    refresh,
    warm,
    complete,
    async prepare(
      host,
      { incremental = false, sortingEntry = false, onFirstReady = () => {} } = {},
    ) {
      if (!host || disposed) return;
      if (!incremental || !sortingEntry)
        await Promise.all(
          [...host.querySelectorAll('img')].map((image) => image.decode().catch(() => {})),
        );
      if (disposed || !host.isConnected) return;
      scan();
      const prepared = [...views.values()].filter((view) => host.contains(view.image));
      try {
        for (const view of prepared) view.preparing = true;
        // Render at the final layout and light position before committing these nodes.
        const ordered = [...prepared].reverse();
        // Two rear strips keep the first draw small, while sharing their atlas
        // copy. The complete top card is always prepared separately first.
        const count = incremental ? 2 : Math.max(1, ordered.length);
        for (let i = 0; i < ordered.length;) {
          // Release the complete top card first so its flight overlaps the
          // remaining strips' decoding, texture uploads and initial drawing.
          const batch = ordered.slice(i, i + (i === 0 && sortingEntry ? 1 : count));
          for (const view of batch) activate(view, i === 0 ? 3 : 2);
          await Promise.allSettled(
            batch.map(async (view) => {
              await view.image.decode().catch(() => {});
              await view.handle?.ready;
            }),
          );
          if (disposed || !host.isConnected) return;
          if (incremental && i === 0 && batch[0]?.handle)
            await preparePrograms(batch[0].handle.material);
          if (disposed || !host.isConnected) return;
          if (incremental)
            await Promise.all(
              batch
                .filter((view) => view.handle?.material.userData.ready)
                .map((view) =>
                  uploadMaterial(view.handle.material, () => !disposed && host.isConnected),
                ),
            );
          if (incremental) await nextFrame();
          if (disposed || !host.isConnected) return;
          cancelAnimationFrame(frame);
          draw(batch, { sortingEntry });
          if (i === 0) onFirstReady();
          i += batch.length;
          // Overlap a bounded window of downloads with the current batch's
          // decoding/uploads. Keep the first full card ahead of rear assets;
          // only the active pair is uploaded or painted by this preparation loop.
          if (incremental && sortingEntry && document.documentElement.dataset.webRelease) {
            for (const upcoming of ordered.slice(i, i + 6)) activate(upcoming, 1);
          }
        }
      } finally {
        for (const view of prepared) view.preparing = false;
        schedule();
      }
    },
    stats: () => ({
      ...library.stats(),
      ...batchRenderer?.stats(),
      views: views.size,
      draws,
      pixels,
      liveStripPixels: [...views.values()].reduce(
        (sum, view) => sum + (view.strip ? view.strip.width * view.strip.height : 0),
        0,
      ),
      contexts: renderer ? 1 : 0,
      resources: resourceSchedulerStats(),
      completionPixelBudget,
    }),
    dispose() {
      disposed = true;
      ++warmRun;
      warmHandles.forEach((handle) => handle.release());
      warmHandles = [];
      cancelAnimationFrame(frame);
      textureUploads.clear();
      mutations.disconnect();
      intersection.disconnect();
      resize.disconnect();
      window.removeEventListener('pointermove', move);
      root.removeEventListener('pointerout', leave);
      root.removeEventListener('card-light-selection', selection);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
      for (const view of views.values()) {
        release(view);
        view.canvas.remove();
        removeStrip(view);
        view.image.removeEventListener('load', view.loaded);
      }
      views.clear();
      pending.clear();
      library.dispose();
      plane?.geometry.dispose();
      batchRenderer?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
    },
  };
}
