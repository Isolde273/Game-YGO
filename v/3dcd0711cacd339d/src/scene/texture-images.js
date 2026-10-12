// Share decoded pixels between the room and UI, while each owns its GPU texture.
// ImageBitmap prepares orientation off the main thread instead of at texImage2D.
import { backgroundResourcesAllowed } from './resource-scheduler.js';

const images = new Map();
const idleBudget = 32 * 1024 * 1024;
const pending = [];
const decodeLimit = 4;
let decoding = 0;
let backgroundDecoding = 0;
let retry = 0;

function enqueue(load, item) {
  return new Promise((resolve, reject) => {
    pending.push({ load, item, resolve, reject });
    queueMicrotask(pump);
  });
}
function pump() {
  clearTimeout(retry);
  retry = 0;
  while (decoding < decodeLimit && pending.length) {
    pending.sort((a, b) => b.item.priority - a.item.priority);
    const job = pending[0];
    if (!job.item.refs) {
      pending.shift();
      job.reject(new Error('Card texture preparation cancelled'));
      continue;
    }
    const background = job.item.priority <= 0;
    if (background && (backgroundDecoding || !backgroundResourcesAllowed())) break;
    pending.shift();
    job.item.started = true;
    decoding++;
    if (background) backgroundDecoding++;
    Promise.resolve()
      .then(job.load)
      .then(job.resolve, job.reject)
      .finally(() => {
        decoding--;
        if (background) backgroundDecoding--;
        pump();
      });
  }
  if (pending.length && decoding < decodeLimit) retry = setTimeout(pump, 50);
}

function trim() {
  const idle = [...images]
    .filter(([, item]) => item.refs === 0 && item.data)
    .sort((a, b) => a[1].retention - b[1].retention);
  let bytes = idle.reduce((sum, [, item]) => sum + item.bytes, 0);
  for (const [url, item] of idle) {
    if (bytes <= idleBudget) break;
    images.delete(url);
    item.data.image.close?.();
    bytes -= item.bytes;
  }
}

export function acquireTextureImage(url, { priority = 2, retention = 0 } = {}) {
  let item = images.get(url);
  if (!item) {
    item = { refs: 0, bytes: 0, data: null, priority, retention };
    const current = item;
    item.ready = enqueue(
      () =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = async () => {
            try {
              // onload already confirms a decoded image. Electron can reject the
              // redundant decode() under a large batch; keep the loaded pixels.
              try {
                await image.decode();
              } catch (error) {
                if (!image.complete || !image.naturalWidth || !image.naturalHeight) throw error;
              }
              let pixels = image;
              let flipY = true;
              if (typeof createImageBitmap === 'function') {
                try {
                  pixels = await createImageBitmap(image, {
                    imageOrientation: 'flipY',
                    premultiplyAlpha: 'none',
                    colorSpaceConversion: 'none',
                  });
                  flipY = false;
                } catch {
                  // Older browsers retain the original full-quality upload path.
                }
              }
              current.data = { image: pixels, flipY };
              current.bytes = pixels.width * pixels.height * 4;
              resolve(current.data);
              trim();
            } catch (error) {
              if (images.get(url) === current) images.delete(url);
              reject(new Error(`Unable to decode card texture: ${url}`, { cause: error }));
            }
          };
          image.onerror = () => {
            if (images.get(url) === current) images.delete(url);
            reject(new Error(`Unable to load card texture: ${url}`));
          };
          image.src = url;
        }),
      item,
    );
    item.ready.catch(() => {
      if (images.get(url) === current) images.delete(url);
    });
    images.set(url, item);
  }
  item.priority = Math.max(item.priority, priority);
  item.retention = Math.max(item.retention, retention);
  images.delete(url);
  images.set(url, item);
  item.refs++;
  queueMicrotask(pump);
  let released = false;
  return {
    ready: item.ready,
    promote(priority) {
      item.priority = Math.max(item.priority, priority);
      queueMicrotask(pump);
    },
    release() {
      if (released) return;
      released = true;
      item.refs--;
      if (!item.refs && !item.started && !item.data && images.get(url) === item) images.delete(url);
      queueMicrotask(pump);
      trim();
    },
  };
}
