import { getCardPrint } from '../game/card-data.js';

export function warehouseNumberedCards(state) {
  const placed = new Set(
    [...Object.values(state.binder.slots), ...state.cardStacks.flatMap((stack) => stack.cards)].map(
      (card) => card.id,
    ),
  );
  const cards = new Map();
  for (const card of state.numberedCards) {
    if (card.inCollection || placed.has(card.id)) continue;
    const previous = cards.get(card.printId);
    if (!previous || card.serial < previous.serial) cards.set(card.printId, card);
  }
  return cards;
}

export function serialLabel(serial) {
  const number = `${String(serial).padStart(3, '0')}/100`;
  return `<span class="gmr-serial"><svg viewBox="0 0 100 28" xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 92,0 100,28 0,28" fill="#101214"/><text x="6" y="22" fill="currentColor">${number}</text></svg></span>`;
}

export function finishAttributes(record) {
  const id = typeof record === 'string' ? record : (record.printId ?? record.id ?? record.rarity);
  if (getCardPrint(id)?.legacy || !getCardPrint(id)) return '';
  return `data-finish-print="${id}"${record.serial ? ` data-finish-serial="${record.serial}"` : ''}`;
}
export function markFinishImage(image, record) {
  const id = record.printId ?? record.id ?? record.rarity;
  if (getCardPrint(id)?.legacy || !getCardPrint(id)) return;
  image.dataset.finishPrint = id;
  if (record.serial) image.dataset.finishSerial = record.serial;
}
export function copyFinishCanvases(source, target) {
  const originals = source.querySelectorAll('.card-finish-canvas');
  target.querySelectorAll('.card-finish-canvas').forEach((canvas, index) => {
    if (originals[index]) {
      const context = canvas.getContext('2d');
      context.drawImage(originals[index], 0, 0);
      const strip = originals[index].parentElement.querySelector('.card-finish-strip');
      if (strip) {
        context.drawImage(strip, 0, 0);
        canvas.style.removeProperty('visibility');
        canvas.parentElement.querySelector('img')?.style.removeProperty('visibility');
      }
    }
  });
  if (target !== source)
    target.querySelectorAll('.card-finish-strip').forEach((canvas) => canvas.remove());
  return target;
}

// Local album updates keep decoded images, pixels and active material references.
// Recreating these surfaces would expose the brighter print before the next draw.
export function renderRetainingAlbumFinishes(host, render) {
  const key = (image) => `${image.dataset.finishPrint}:${image.dataset.finishSerial ?? ''}`;
  const position = (image) => image.closest('[data-slot]')?.dataset.slot ?? 'tray';
  const snapshots = [...host.querySelectorAll('.album-studio img[data-finish-print]')]
    .filter((image) => !image.closest('.book-outgoing'))
    .map((image) => ({
      image,
      canvas: image.parentElement.querySelector('.card-finish-canvas[data-ready="true"]'),
      key: key(image),
      position: position(image),
    }))
    .filter((surface) => surface.canvas);
  const previous = [...snapshots];
  render();
  const replacements = [...host.querySelectorAll('.album-studio img[data-finish-print]')];
  // Reserve unchanged pockets first so duplicate prints do not steal their face.
  const mount = (image, canvas) => {
    const parent = image.parentElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    if (!image.clientHeight) image.style.aspectRatio = '59 / 86';
    parent.querySelector('.card-finish-canvas')?.remove();
    image.after(canvas);
    parent.classList.add('has-real-finish');
    parent.dataset.finishReady = 'true';
    Object.assign(canvas.style, {
      left: `${image.offsetLeft}px`,
      top: `${image.offsetTop}px`,
      width: `${image.clientWidth}px`,
      height: `${image.clientHeight}px`,
    });
  };
  const restore = (image, surface) => {
    previous.splice(previous.indexOf(surface), 1);
    image.replaceWith(surface.image);
    mount(surface.image, surface.canvas);
  };
  const unmatched = [];
  for (const image of replacements) {
    const surface = previous.find(
      (entry) => entry.key === key(image) && entry.position === position(image),
    );
    if (surface) restore(image, surface);
    else unmatched.push(image);
  }
  for (const image of unmatched) {
    const surface = previous.find((entry) => entry.key === key(image));
    if (surface) restore(image, surface);
    else {
      // A grouped tray may remain while producing another pocket or a numbered
      // GMR face. Keep its pixels until the new identity's material is ready.
      const snapshot =
        snapshots.find((entry) => entry.key === key(image)) ??
        snapshots.find(
          (entry) =>
            entry.key === `${image.dataset.finishPrint}:` ||
            (!image.dataset.finishSerial && entry.key.startsWith(`${image.dataset.finishPrint}:`)),
        );
      if (!snapshot) continue;
      const canvas = snapshot.canvas.cloneNode();
      canvas.getContext('2d').drawImage(snapshot.canvas, 0, 0);
      mount(image, canvas);
    }
  }
}

export function cloneFinishedImage(image) {
  const clone = image.cloneNode();
  const canvas = image.parentElement?.querySelector('.card-finish-canvas[data-ready="true"]');
  if (canvas) {
    const strip = image.parentElement.querySelector('.card-finish-strip');
    if (strip) {
      const merged = canvas.cloneNode();
      merged.getContext('2d').drawImage(canvas, 0, 0);
      merged.getContext('2d').drawImage(strip, 0, 0);
      clone.src = merged.toDataURL('image/png');
      clone.style.removeProperty('visibility');
    } else clone.src = canvas.toDataURL('image/png');
  }
  delete clone.dataset.finishPrint;
  delete clone.dataset.finishSerial;
  return clone;
}

// A moving card keeps its print identity so its reflection can be rendered live.
export function cloneMovingFinish(image) {
  const surface = document.createElement('div');
  surface.dataset.finishSurface = 'album';
  const clone = image.cloneNode();
  clone.alt = '';
  clone.draggable = false;
  surface.append(clone);
  const canvas = image.parentElement?.querySelector('.card-finish-canvas');
  if (canvas) {
    surface.append(canvas.cloneNode());
    copyFinishCanvases(image.parentElement, surface);
  }
  return surface;
}

export function setCardLightSelection(host, surface, selected) {
  host.dispatchEvent(
    new CustomEvent('card-light-selection', { bubbles: true, detail: { surface, selected } }),
  );
}
