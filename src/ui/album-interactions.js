import { moveBinderCard, transferCollectionToWarehouse } from '../game/model.js';
import { cloneMovingFinish, renderRetainingAlbumFinishes } from './card-surfaces.js';

// The root persists across rendering so a drag can continue onto another spread.
export function createAlbumInteractions({
  host,
  getState,
  getPage,
  refresh: render,
  turn,
  jump,
  save,
  toast,
  sound,
}) {
  let pointer = null,
    suppressClick = false,
    frame = 0;
  const flights = new Set();
  function refresh() {
    renderRetainingAlbumFinishes(host, render);
  }
  const sourceOf = (el) =>
    el.dataset.albumSource === 'slot'
      ? { slot: Number(el.dataset.slot) }
      : { printId: el.dataset.rarity };
  const sourceElement = (source) =>
    source?.slot !== undefined
      ? host.querySelector(`[data-slot="${source.slot}"]`)
      : host.querySelector(`.tray-card[data-rarity="${source?.printId ?? source?.rarity}"]`);
  const enabled = () =>
    getState().settings.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rarityOf = (source) =>
    source?.slot !== undefined
      ? getState().binder.slots[source.slot]?.printId
      : (source?.printId ?? source?.rarity);
  const focusSource = (source) => sourceElement(source)?.focus({ preventScroll: true });
  function clearPointer() {
    cancelAnimationFrame(frame);
    pointer?.ghost?.remove();
    host
      .querySelectorAll('.is-drag-source,.is-drop-target')
      .forEach((el) => el.classList.remove('is-drag-source', 'is-drop-target'));
    pointer = null;
  }
  function fly(image, from, target, kind) {
    if (!enabled() || !image || !from || !target) return;
    const to = (
      target.querySelector(kind === 'warehouse' ? '.icon' : 'img') || target
    ).getBoundingClientRect();
    if (!to.width || !to.height) return;
    const ghost = cloneMovingFinish(image);
    ghost.className = 'album-flight';
    ghost.dataset.kind = kind;
    ghost.alt = '';
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    document.body.append(ghost);
    flights.add(ghost);
    const animation = ghost.animate(
      [
        { transform: 'translate(0,0) rotate(-3deg)', opacity: 1 },
        {
          transform: `translate(${(to.left - from.left) * 0.55}px,${(to.top - from.top) * 0.55 - 28}px) rotate(4deg)`,
          opacity: 0.95,
          offset: 0.55,
        },
        {
          transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width},${to.height / from.height}) rotate(0deg)`,
          opacity: 0.2,
        },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.25,1)' },
    );
    animation.finished
      .catch(() => {})
      .finally(() => {
        ghost.remove();
        flights.delete(ghost);
      });
    for (const face of target.querySelectorAll(
      '.pocket-window > img,.pocket-window > .card-finish-canvas',
    ))
      face.animate([{ transform: 'translateY(-22px)' }, { transform: 'translateY(0)' }], {
        duration: 330,
        delay: 80,
        easing: 'ease-out',
      });
  }
  function place(destination, source, origin = null, heldImage = null) {
    const el = sourceElement(source),
      image = heldImage || el?.querySelector('img');
    const from = origin || image?.getBoundingClientRect(),
      rarity = rarityOf(source);
    try {
      if (destination === 'warehouse') {
        transferCollectionToWarehouse(getState(), source);
        save();
        sound('card');
        refresh();
        const target = host.querySelector('.collection-warehouse');
        fly(image, from, target, 'warehouse');
        toast('已转回仓库');
        return;
      }
      if (!moveBinderCard(getState(), source, destination)) {
        refresh();
        focusSource(source);
        return;
      }
      save();
      sound('card');
      refresh();
      const target =
        destination === 'tray'
          ? host.querySelector(`.tray-card[data-rarity="${rarity}"]`)
          : host.querySelector(`[data-slot="${destination}"]`);
      fly(
        image,
        from,
        target,
        destination === 'tray' ? 'remove' : source.slot === undefined ? 'insert' : 'move',
      );
      target?.focus({ preventScroll: true });
      toast(
        destination === 'tray'
          ? '卡牌已取出到暂存区'
          : `已放入第 ${Math.floor(destination / 6) + 1} 页，第 ${(destination % 6) + 1} 格`,
      );
    } catch (error) {
      toast(error.message);
    }
  }
  function click(e) {
    if (getPage() !== 'album') return;
    if (e.detail === 0 && e.target.closest('[data-album-source]')) sound('card');
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('[data-album-source],[data-slot]')) e.stopPropagation();
  }
  function dragTick() {
    if (!pointer?.dragging) return;
    const { x, y } = pointer;
    const under = document.elementFromPoint(x, y),
      drop = under?.closest('[data-slot],[data-album-drop]');
    // Keep a hovered pager stationary until the held card crosses to the next spread.
    if (!under?.closest('[data-album-turn]')) {
      if (y < 65) window.scrollBy(0, -10);
      else if (y > innerHeight - 65) window.scrollBy(0, 10);
    }
    host.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    if (drop && !drop.closest('.book-outgoing')) drop.classList.add('is-drop-target');
    const direction = under?.closest('[data-album-turn]:not(:disabled)')?.dataset.albumTurn;
    if (direction !== pointer.hover) {
      pointer.hover = direction;
      pointer.hoverAt = performance.now();
    }
    if (direction && performance.now() - pointer.hoverAt > 650) {
      pointer.hoverAt = performance.now();
      turn(Number(direction));
    }
    frame = requestAnimationFrame(dragTick);
  }
  function down(e) {
    if (getPage() !== 'album' || e.button !== 0 || pointer) return;
    const el = e.target.closest('[data-album-source]');
    if (!el || el.closest('.book-outgoing') || el.closest('[inert]')) return;
    sound('card');
    pointer = {
      id: e.pointerId,
      source: sourceOf(el),
      el,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
  }
  function move(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (
      !pointer.dragging &&
      Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 7
    ) {
      pointer.dragging = true;
      const status = host.querySelector('#album-drag-status');
      if (status) status.textContent = '正在拖动，放到卡位、暂存区或仓库区';
      const image = pointer.el.querySelector('img');
      pointer.ghost = cloneMovingFinish(image);
      pointer.ghost.className = 'album-drag-ghost';
      pointer.ghost.alt = '';
      pointer.ghost.setAttribute('aria-hidden', 'true');
      document.body.append(pointer.ghost);
      pointer.el.classList.add('is-drag-source');
      frame = requestAnimationFrame(dragTick);
    }
    if (pointer.dragging) {
      e.preventDefault();
      Object.assign(pointer.ghost.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
    }
  }
  function up(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const current = pointer;
    if (current.dragging) {
      e.preventDefault();
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      const drop = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-slot],[data-album-drop]');
      const origin = current.ghost.getBoundingClientRect();
      const heldImage = current.ghost.querySelector('img');
      clearPointer();
      if (drop && !drop.closest('.book-outgoing'))
        place(
          drop.dataset.slot !== undefined ? Number(drop.dataset.slot) : drop.dataset.albumDrop,
          current.source,
          origin,
          heldImage,
        );
      else {
        sound('card');
        refresh();
        focusSource(current.source);
        toast('未放入目标区域，卡牌已返回原位');
      }
    } else {
      clearPointer();
    }
  }
  function cancel() {
    if (pointer) {
      clearPointer();
      if (getPage() === 'album') refresh();
    }
  }
  function key(e) {
    if (getPage() !== 'album') return;
    if (document.querySelector('#overlay')?.children.length) return;
    if (e.key === 'Escape' && pointer) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearPointer();
      refresh();
      sound('card');
    }
  }
  function submit(e) {
    if (e.target.id !== 'album-jump-form') return;
    e.preventDefault();
    const page = Number(host.querySelector('#album-jump').value);
    if (Number.isInteger(page) && page >= 1 && page <= 100) jump(page);
    else toast('请输入 1–100 的整数页码');
  }
  const preventNative = (e) => {
    if (e.target.closest('[data-album-source]')) e.preventDefault();
  };
  host.addEventListener('click', click);
  host.addEventListener('pointerdown', down);
  host.addEventListener('submit', submit);
  host.addEventListener('dragstart', preventNative);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  document.addEventListener('keydown', key, true);
  return {
    get dragging() {
      return !!pointer?.dragging;
    },
    sync() {
      if (getPage() !== 'album') {
        clearPointer();
      }
    },
    dispose() {
      clearPointer();
      flights.forEach((el) => el.remove());
      host.removeEventListener('click', click);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('submit', submit);
      host.removeEventListener('dragstart', preventNative);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('keydown', key, true);
    },
  };
}
