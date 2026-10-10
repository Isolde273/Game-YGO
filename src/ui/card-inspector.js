import { getCardView, CARD_RARITIES as RARITIES } from '../game/card-data.js';
import {
  routeStackCards,
  bringStackCardToFront,
  trayCount,
  warehouseCount,
} from '../game/model.js';
import { icon } from './icons.js';
import {
  markFinishImage,
  copyFinishCanvases,
  setCardLightSelection,
  serialLabel,
} from './card-surfaces.js';
import { createInspectorMotion } from './motion/inspector-motion.js';
import { createMotionPlayer } from './motion/motion-player.js';
import { getCardPrice } from '../game/card-prices.js';

// This view belongs to the unboxing room. Unsorted cards stay in their saved table stack.
export function createCardInspector(
  host,
  state,
  stack,
  {
    save,
    sound,
    onRoute,
    onClose,
    onReorder = () => {},
    source = () => null,
    prepare = () => Promise.resolve(),
    complete = () => {},
    onEnter = () => {},
  },
) {
  const previousFocus = document.activeElement,
    view = document.createElement('section');
  view.className = 'card-inspector';
  view.dataset.phase = 'preparing';
  view.inert = true;
  view.setAttribute('role', 'dialog');
  view.setAttribute('aria-modal', 'true');
  view.setAttribute('aria-label', '整理桌面卡堆');
  view.tabIndex = -1;
  view.innerHTML = `<header class="inspect-header"><button class="inspect-return">← 放回桌面</button><div><small>CARD SORTING</small><h2>整理卡牌</h2></div><span class="inspect-count" aria-live="polite"></span></header><div class="inspect-layout"><aside class="card-destination destination-collection" data-destination="collection"><small>收藏册</small>${icon('album', 'destination-icon')}<h3>暂存区</h3><strong class="destination-total"></strong><div class="destination-preview"></div><button data-route-all="collection">全部暂存 <span>←</span></button></aside><main class="inspect-center"><div class="inspect-card-stage"></div><div class="inspect-card-caption"><b>待整理卡牌</b><span class="inspect-stack-count"></span><p>拖入两侧分配卡牌</p></div><div class="inspect-selected-actions"><button data-route-one="collection">此卡暂存</button><span class="inspect-selected-label"></span><button data-route-one="warehouse">此卡入仓</button></div></main><aside class="card-destination destination-warehouse" data-destination="warehouse"><small>STORAGE ROOM</small>${icon('warehouse', 'destination-icon')}<h3>仓库</h3><strong class="destination-total"></strong><div class="destination-preview"></div><button data-warehouse-picker>入仓 <span>→</span></button></aside></div><footer class="inspect-footer">Esc 放回桌面 · 保留未整理卡牌</footer>`;
  host.append(view);
  const price = document.createElement('span');
  price.className = 'inspect-selected-price';
  price.innerHTML = `${icon('coin')}<strong>—</strong>`;
  const cardMeta = document.createElement('div');
  cardMeta.className = 'inspect-card-meta';
  view.querySelector('.inspect-card-caption p').before(cardMeta);
  cardMeta.append(view.querySelector('.inspect-stack-count'), price);
  let selected = stack.cards.at(-1)?.id,
    drag = null,
    closed = false,
    removed = false,
    closing = null,
    dragFrame = 0,
    lastSize = null;
  const motion = createInspectorMotion(host, view, { motion: () => state.settings.motion, source });
  const localMotion = createMotionPlayer(() => state.settings.motion);
  const routeMotion = createMotionPlayer(() => state.settings.motion);
  const activeRoutes = new Set();
  const slotCount = stack.cards.length;
  const cardSlots = new Map(stack.cards.map((card, index) => [card.id, index]));
  const stage = view.querySelector('.inspect-card-stage');
  const warehouseButton = view.querySelector('[data-warehouse-picker]');
  warehouseButton.setAttribute('aria-expanded', 'false');
  warehouseButton.setAttribute('aria-controls', 'inspect-warehouse-picker');
  const picker = document.createElement('div');
  picker.id = 'inspect-warehouse-picker';
  picker.className = 'warehouse-route-picker';
  picker.hidden = true;
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', '按罕贵度入仓');
  picker.innerHTML = `<header><b>按罕贵度入仓</b><button data-picker-close aria-label="关闭入仓选择">×</button></header><div class="warehouse-rarity-list">${RARITIES.map((r) => `<label data-warehouse-rarity="${r.id}"><input type="checkbox" value="${r.id}"><b>${r.name}</b><span></span><strong></strong></label>`).join('')}</div><div class="warehouse-rarity-tools"><button data-rarity-select="all">全选</button><button data-rarity-select="none">清空</button></div><button class="warehouse-route-submit" data-route-confirm="warehouse">入仓 <span></span></button>`;
  warehouseButton.parentElement.append(picker);
  const reorderButton = document.createElement('button');
  reorderButton.className = 'inspect-reorder';
  reorderButton.textContent = '置于最前';
  view.querySelector('.inspect-selected-actions').append(reorderButton);
  view.querySelector('.inspect-card-caption p').textContent = '拖入两侧分配 · 拖到最前卡牌换序';
  const raritySelection = new Set(RARITIES.map((r) => r.id));
  const resizeObserver = new ResizeObserver(([entry]) => {
    const size = [entry.contentRect.width, entry.contentRect.height];
    if (lastSize && size.some((v, i) => Math.abs(v - lastSize[i]) > 1)) {
      cancelDrag();
      motion.finish();
      localMotion.clear();
      routeMotion.finish();
    }
    lastSize = size;
    layout();
  });
  resizeObserver.observe(stage.parentElement);
  function layout() {
    const width = stage.querySelector('.inspect-card')?.getBoundingClientRect().width ?? 290,
      available = stage.parentElement.clientWidth;
    const step = Math.min(
      22,
      (width - 2) / 8,
      Math.max(1, (available - width - 24) / Math.max(1, slotCount - 1)),
    );
    stage.style.setProperty('--fan-width', `${step * Math.max(0, slotCount - 1)}px`);
    stage
      .querySelectorAll('.inspect-card')
      .forEach((el) =>
        el.style.setProperty(
          '--card-offset',
          `${-(slotCount - 1 - cardSlots.get(el.dataset.card)) * step}px`,
        ),
      );
  }
  function update() {
    view.querySelector('.inspect-count').textContent = `剩余 ${stack.cards.length} 张`;
    view.querySelector('.inspect-stack-count').textContent = `${stack.cards.length} 张`;
    for (const destination of ['collection', 'warehouse']) {
      const panel = view.querySelector(`[data-destination="${destination}"]`),
        count = destination === 'collection' ? trayCount(state) : warehouseCount(state);
      panel.querySelector('.destination-total').textContent =
        `${count.toLocaleString('zh-CN')} 张已收纳`;
      panel.querySelector('.destination-preview').classList.toggle('has-cards', count > 0);
    }
    const card = stack.cards.find((c) => c.id === selected),
      rarity = RARITIES.find((r) => r.id === card?.rarity);
    // Reserve the caption height so emptying the fan does not finish route animations.
    // Inherit the caption's hidden state during preparation and entry.
    price.style.visibility = card ? '' : 'hidden';
    price.setAttribute('aria-hidden', String(!card));
    const cardPrice = getCardPrice(card?.printId);
    price.querySelector('strong').textContent =
      cardPrice === null ? '—' : cardPrice.toLocaleString('zh-CN');
    price.setAttribute(
      'aria-label',
      cardPrice === null ? '当前卡牌暂无集换价' : `当前卡牌售价 ${cardPrice}`,
    );
    view.querySelector('.inspect-selected-label').textContent =
      getCardView(card?.printId)?.label ?? rarity?.id ?? '';
    stage
      .querySelectorAll('.inspect-card')
      .forEach((el) => el.classList.toggle('selected', el.dataset.card === selected));
    reorderButton.disabled = !card || selected === stack.cards.at(-1)?.id;
    view.querySelectorAll('[data-route-one]').forEach((button) => (button.disabled = !card));
    view.querySelector('[data-route-all]').disabled = !stack.cards.length;
    warehouseButton.disabled = !stack.cards.length;
    updatePicker();
  }
  function renderCards() {
    // Keep decoded card surfaces and their original slots when other cards leave.
    const container = stage.querySelector('.inspect-spread-group') ?? stage;
    const existing = new Map([...container.children].map((el) => [el.dataset.card, el]));
    const remaining = new Set(stack.cards.map((card) => card.id));
    for (const [id, el] of existing) if (!remaining.has(id)) el.remove();
    stack.cards.forEach((card, i) => {
      const el = existing.get(card.id) ?? createCardElement(card);
      const data = getCardView(card.printId);
      el.style.zIndex = String(i + 1);
      el.setAttribute(
        'aria-label',
        card.serial
          ? `${data.name} GMR ${String(card.serial).padStart(3, '0')}/100，拖入收藏或仓库`
          : `第 ${i + 1} 张${data.name} ${data.label}，拖入收藏或仓库`,
      );
      if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
    });
    layout();
    update();
  }
  const cardElements = () => [...stage.querySelectorAll('.inspect-card')];
  const frontElement = () => cardElements().at(-1);
  function createCardElement(card) {
    const data = getCardView(card.printId);
    const el = document.createElement('button');
    el.className = `inspect-card rarity-${card.rarity}`;
    el.dataset.card = card.id;
    const image = new Image();
    image.src = data.image;
    image.alt = `${data.name} ${data.label}`;
    image.draggable = false;
    markFinishImage(image, card);
    el.append(image);
    if (card.serial) {
      el.insertAdjacentHTML('beforeend', serialLabel(card.serial));
      el.setAttribute(
        'aria-label',
        `${data.name} GMR ${String(card.serial).padStart(3, '0')}/100，拖入收藏或仓库`,
      );
    }
    const foil = document.createElement('span');
    foil.className = 'foil';
    el.append(foil);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag || closed || view.inert) return;
      e.preventDefault();
      motion.claimCard();
      complete(el);
      const order = cardElements();
      // A lifted card can expose its neighbour before the spread finishes.
      // Prepare that surface now, before any movement reveals its right side.
      complete(order[order.indexOf(el) - 1]);
      sound('card');
      setCardLightSelection(view, 'sorting', true);
      selected = card.id;
      update();
      const rect = el.getBoundingClientRect();
      drag = {
        id: e.pointerId,
        card: card.id,
        el,
        startX: e.clientX,
        startY: e.clientY,
        width: rect.width,
        height: rect.height,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        moved: false,
        frontRect: frontElement().getBoundingClientRect(),
        covers: cardElements().slice(cardElements().indexOf(el) + 1),
        extracted: false,
        panels: [...view.querySelectorAll('.card-destination')].map((panel) => ({
          panel,
          rect: panel.getBoundingClientRect(),
        })),
        x: e.clientX,
        y: e.clientY,
      };
      // Hold the current position immediately; the fan may continue moving
      // while the pointer is down but has not crossed the drag threshold.
      Object.assign(el.style, {
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        left: `${rect.left}px`,
        top: `${rect.top}px`,
      });
      el.classList.add('dragging');
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag.moved = true;
      }
      if (!drag.moved) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!dragFrame) dragFrame = requestAnimationFrame(paintDrag);
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      paintDrag();
      const active = drag,
        drop = active.moved
          ? [...view.querySelectorAll('.card-destination')].find((panel) => inside(panel, e))
          : null;
      const front = active.moved && insideRect(active.frontRect, e),
        rect = active.el.getBoundingClientRect();
      cancelDrag();
      if (drop) route([active.card], drop.dataset.destination, rect);
      else if (front) bringToFront(active.card, rect);
    });
    const cancelOwnDrag = (e) => {
      if (drag?.el === el && drag.id === e.pointerId) cancelDrag();
    };
    el.addEventListener('pointercancel', cancelOwnDrag);
    el.addEventListener('lostpointercapture', cancelOwnDrag);
    el.addEventListener('click', (event) => {
      if (event.detail === 0) sound('card');
      selected = card.id;
      update();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Home') {
        e.preventDefault();
        bringToFront(card.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const cards = [...stage.querySelectorAll('.inspect-card')],
          index = cards.indexOf(el),
          next =
            cards[
              Math.max(0, Math.min(cards.length - 1, index + (e.key === 'ArrowLeft' ? -1 : 1)))
            ];
        selected = next.dataset.card;
        sound('card');
        next.focus();
        update();
      }
    });
    return el;
  }
  function insideRect(r, e) {
    return (
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    );
  }
  function inside(panel, e) {
    return insideRect(panel.getBoundingClientRect(), e);
  }
  function paintDrag() {
    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    if (!drag?.moved) return;
    drag.el.style.setProperty('--drag-x', `${drag.x - drag.startX}px`);
    drag.el.style.setProperty('--drag-y', `${drag.y - drag.startY}px`);
    if (!drag.extracted) {
      const left = drag.x - drag.offsetX,
        top = drag.y - drag.offsetY;
      drag.extracted = !drag.covers.some((card) => {
        const cover = card.getBoundingClientRect();
        return (
          left < cover.right &&
          left + drag.width > cover.left &&
          top < cover.bottom &&
          top + drag.height > cover.top
        );
      });
      drag.el.classList.toggle('extracted', drag.extracted);
    }
    const point = { clientX: drag.x, clientY: drag.y };
    if (view.dataset.phase === 'entering') {
      const front = frontElement();
      if (front && front !== drag.el) drag.frontRect = front.getBoundingClientRect();
    }
    for (const { panel, rect } of drag.panels)
      panel.classList.toggle('drop-active', insideRect(rect, point));
    stage.classList.toggle(
      'front-drop-active',
      drag.card !== stack.cards.at(-1)?.id && insideRect(drag.frontRect, point),
    );
    if (view.dataset.phase === 'entering') dragFrame = requestAnimationFrame(paintDrag);
  }
  function cancelDrag() {
    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    if (!drag) return;
    const { el, id } = drag;
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    el.classList.remove('dragging', 'extracted');
    for (const key of ['width', 'height', 'left', 'top', '--drag-x', '--drag-y'])
      el.style.removeProperty(key);
    drag = null;
    setCardLightSelection(view, 'sorting', false);
    view.querySelectorAll('.drop-active').forEach((panel) => panel.classList.remove('drop-active'));
    stage.classList.remove('front-drop-active');
  }
  function bringToFront(id, startRect) {
    if (closed || view.inert || !bringStackCardToFront(state, stack.id, id)) return;
    motion.claimCard();
    if (view.dataset.phase === 'entering') motion.finish();
    complete(stage.querySelector(`[data-card="${id}"]`));
    localMotion.clear();
    // An explicit reorder uses the remaining occupied slots, including their gaps.
    const slots = stack.cards.map((card) => cardSlots.get(card.id)).sort((a, b) => a - b);
    stack.cards.forEach((card, index) => cardSlots.set(card.id, slots[index]));
    selected = id;
    save();
    sound('card');
    onReorder();
    renderCards();
    const card = frontElement();
    card.focus({ preventScroll: true });
    if (startRect) {
      const rect = card.getBoundingClientRect(),
        base = getComputedStyle(card).transform;
      void localMotion.play(
        card,
        [
          {
            transform: `translate3d(${startRect.left - rect.left}px,${startRect.top - rect.top}px,0) ${base}`,
            opacity: 0.8,
          },
          { transform: base, opacity: 1 },
        ],
        { duration: 170 },
      );
    }
  }
  function updatePicker() {
    const counts = Object.fromEntries(
      RARITIES.map((r) => [r.id, stack.cards.filter((c) => c.rarity === r.id).length]),
    );
    for (const label of picker.querySelectorAll('[data-warehouse-rarity]')) {
      const id = label.dataset.warehouseRarity,
        input = label.querySelector('input');
      input.disabled = !counts[id];
      input.checked = !!counts[id] && raritySelection.has(id);
      label.querySelector('strong').textContent = `${counts[id]} 张`;
    }
    const count = stack.cards.filter((c) => raritySelection.has(c.rarity)).length,
      submit = picker.querySelector('[data-route-confirm]');
    submit.disabled = !count;
    submit.querySelector('span').textContent = `${count} 张`;
  }
  function setPicker(open, focus = true) {
    picker.hidden = !open;
    warehouseButton.setAttribute('aria-expanded', String(open));
    if (open) {
      cancelDrag();
      updatePicker();
      picker.querySelector('input:not(:disabled)')?.focus({ preventScroll: true });
    } else if (focus) warehouseButton.focus({ preventScroll: true });
  }
  function route(ids, destination, startRect) {
    if (closed || view.inert || !ids.length) return;
    motion.claimCard();
    setCardLightSelection(view, 'sorting', false);
    const flightCards = ids
      .slice(-8)
      .map((id) => {
        const el = stage.querySelector(`[data-card="${id}"]`);
        return el ? { el, rect: startRect ?? el.getBoundingClientRect() } : null;
      })
      .filter(Boolean);
    for (const { el } of flightCards) complete(el);
    cancelDrag();
    const cards = routeStackCards(state, stack.id, ids, destination);
    if (!cards.length) return;
    save();
    sound('card');
    onRoute(cards, destination);
    const targetPanel = view.querySelector(`[data-destination="${destination}"]`);
    const target = targetPanel.querySelector('.destination-preview').getBoundingClientRect();
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const flights = [];
    if (routeMotion.enabled()) {
      for (const [index, { el, rect }] of flightCards.entries()) {
        const flight = document.createElement('div');
        flight.className = `inspect-route-flight ${[...el.classList].find((c) => c.startsWith('rarity-')) ?? ''}`;
        flight.setAttribute('aria-hidden', 'true');
        flight.innerHTML = el.innerHTML;
        copyFinishCanvases(el, flight);
        Object.assign(flight.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        view.append(flight);
        const dx = targetX - rect.left - rect.width / 2;
        const dy = targetY - rect.top - rect.height / 2;
        flights.push({
          flight,
          track: routeMotion.play(
            flight,
            [
              { transform: 'none', opacity: 1 },
              {
                transform: `translate3d(${dx * 0.35}px,${Math.min(-45, dy * 0.3)}px,0) rotate(${destination === 'collection' ? -14 : 14}deg) scale(.9)`,
                opacity: 1,
                offset: 0.42,
              },
              {
                transform: `translate3d(${dx}px,${dy}px,0) rotate(${destination === 'collection' ? -8 : 8}deg) scale(.14)`,
                opacity: 0,
              },
            ],
            { duration: 460, delay: index * 30, easing: 'cubic-bezier(.3,.04,.25,1)', hold: true },
          ),
        });
      }
      routeMotion.release(targetPanel);
      flights.push({
        track: routeMotion.play(
          targetPanel,
          [
            { transform: 'none' },
            { transform: 'scale(1.035)', offset: 0.7 },
            { transform: 'none' },
          ],
          { duration: 500 },
        ),
      });
    }
    // Flights only represent the last eight cards; every routed original must leave the fan.
    const routedIds = new Set(cards.map((card) => card.id));
    for (const el of stage.querySelectorAll('.inspect-card'))
      if (routedIds.has(el.dataset.card)) {
        localMotion.release(el);
        el.remove();
      }
    if (routedIds.has(selected)) selected = stack.cards.at(-1)?.id;
    complete(frontElement());
    update();
    const routing = Promise.all(flights.map((f) => f.track)).then(() => {
      flights.forEach(({ flight }) => {
        if (!flight) return;
        routeMotion.release(flight);
        flight.remove();
      });
      activeRoutes.delete(routing);
      if (!closed && !closing && !stack.cards.length && !activeRoutes.size) close(false);
    });
    activeRoutes.add(routing);
    return routing;
  }
  function detach() {
    if (removed) return;
    removed = true;
    setCardLightSelection(view, 'sorting', false);
    resizeObserver.disconnect();
    routeMotion.dispose();
    view.remove();
    const presented = onClose();
    const focus = previousFocus?.isConnected ? previousFocus : host.querySelector('canvas');
    focus?.focus({ preventScroll: true });
    return presented;
  }
  function dispose() {
    closed = true;
    cancelDrag();
    localMotion.dispose();
    routeMotion.dispose();
    motion.dispose();
    detach();
  }
  function close(playSound = true) {
    if (closed || closing) return closing;
    if (['preparing', 'loading'].includes(view.dataset.phase)) {
      dispose();
      return;
    }
    if (activeRoutes.size) {
      cancelDrag();
      view.inert = true;
      localMotion.finish();
      routeMotion.finish();
      closing = Promise.all([...activeRoutes]).then(() => {
        closing = null;
        return close(playSound);
      });
      return closing;
    }
    cancelDrag();
    localMotion.dispose();
    if (playSound) sound('back');
    setPicker(false, false);
    closed = true;
    view.dataset.phase = 'closing';
    view.inert = true;
    if (!motion.enabled()) {
      dispose();
      return;
    }
    closing = motion
      .leave(stack.cards.length > 0)
      .then(() => detach())
      .finally(() => motion.dispose());
    return closing;
  }
  view.querySelector('.inspect-return').onclick = close;
  view.querySelectorAll('[data-route-all]').forEach(
    (button) =>
      (button.onclick = () =>
        route(
          stack.cards.map((c) => c.id),
          button.dataset.routeAll,
        )),
  );
  view.querySelectorAll('[data-route-one]').forEach(
    (button) =>
      (button.onclick = () => {
        if (selected) route([selected], button.dataset.routeOne);
      }),
  );
  reorderButton.onclick = () => {
    if (selected) bringToFront(selected);
  };
  warehouseButton.onclick = () => {
    sound('card');
    setPicker(picker.hidden);
  };
  picker.querySelector('[data-picker-close]').onclick = () => {
    sound('back');
    setPicker(false);
  };
  picker.querySelectorAll('input').forEach(
    (input) =>
      (input.onchange = () => {
        sound('card');
        if (input.checked) raritySelection.add(input.value);
        else raritySelection.delete(input.value);
        updatePicker();
      }),
  );
  picker.querySelectorAll('[data-rarity-select]').forEach(
    (button) =>
      (button.onclick = () => {
        sound('card');
        raritySelection.clear();
        if (button.dataset.raritySelect === 'all')
          RARITIES.forEach((r) => raritySelection.add(r.id));
        updatePicker();
      }),
  );
  picker.querySelector('[data-route-confirm]').onclick = () => {
    const ids = stack.cards.filter((c) => raritySelection.has(c.rarity)).map((c) => c.id);
    setPicker(false);
    route(ids, 'warehouse');
  };
  function escape() {
    if (drag) {
      cancelDrag();
      setCardLightSelection(view, 'sorting', false);
    } else if (!picker.hidden) setPicker(false);
    else close();
  }
  view.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.target.closest('.inspect-card,button,input,label'))
        setCardLightSelection(view, 'sorting', false);
      if (!picker.hidden && !picker.contains(e.target) && !warehouseButton.contains(e.target))
        setPicker(false, false);
    },
    true,
  );
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      escape();
      return;
    }
    if (e.key !== 'Tab') return;
    const buttons = [...view.querySelectorAll('button,input')].filter(
        (el) => !el.disabled && el.getClientRects().length,
      ),
      first = buttons[0],
      last = buttons.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === view)) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last || document.activeElement === view)
    ) {
      e.preventDefault();
      first.focus();
    }
  });
  renderCards();
  let firstPrepared;
  const firstReady = new Promise((resolve) => (firstPrepared = resolve));
  view.dataset.phase = 'loading';
  const prepared = Promise.resolve(prepare(view, { onFirstReady: firstPrepared })).then(() =>
    firstPrepared(),
  );
  const ready = motion
    .enter({
      firstReady,
      prepared,
      onFlight: () => {
        if (!closed) onEnter();
      },
      onPrepared: () => {
        if (!closed) {
          view.dataset.phase = motion.enabled() ? 'entering' : 'open';
        }
      },
    })
    .then(() => {
      if (!closed) {
        view.dataset.phase = 'open';
        view.inert = false;
        view.focus({ preventScroll: true });
      }
    });
  return { close, dispose, escape, ready, element: view };
}
