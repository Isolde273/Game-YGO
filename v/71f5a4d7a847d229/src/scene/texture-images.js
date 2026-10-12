// Share decoded pixels between the room and UI, while each owns its GPU texture.
// ImageBitmap prepares orientation off the main thread instead of at texImage2D.
import { backgroundResourcesAllowed } from './resource-scheduler.js';

const images = new Map();
const idleBudget = 32 * 1024 * 1024;
// Compressed prefetches never create images, materials or GPU textures.
const sources = new Map();
const sourceBudget = 32 * 1024 * 1024;
const pending = [];
const downloads = [];
// Keep CPU decode bursts smaller while the website also composites moving cards.
const decodeLimit =
  typeof document !== 'undefined' && document.documentElement.dataset.webRelease ? 2 : 4;
const downloadLimit = 16;
let decoding = 0;
let backgroundDecoding = 0;
let downloading = 0;
let backgroundDownloading = 0;
let retry = 0;

function enqueue(load, item, network = false) {
  return new Promise((resolve, reject) => {
    (network ? downloads : pending).push({ load, item, resolve, reject });
    queueMicrotask(pump);
  });
}
function pump() {
  clearTimeout(retry);
  retry = 0;
  pumpQueue(pending, false);
  pumpQueue(downloads, true);
  if (
    (pending.length && decoding < decodeLimit) ||
    (downloads.length &&
      downloading < downloadLimit &&
      downloading + pending.length < downloadLimit)
  )
    retry = setTimeout(pump, 50);
}
function pumpQueue(queue, network) {
  while (
    queue.length &&
    (network
      ? downloading < downloadLimit && downloading + pending.length < downloadLimit
      : decoding < decodeLimit)
  ) {
    queue.sort((a, b) => b.item.priority - a.item.priority);
    const job = queue[0];
    if (!job.item.refs) {
      queue.shift();
      job.reject(new Error('Card texture preparation cancelled'));
      continue;
    }
    const background = job.item.priority <= 0;
    if (
      background &&
      ((network ? backgroundDownloading : backgroundDecoding) ||
        (!network && !backgroundResourcesAllowed()))
    )
      break;
    queue.shift();
    if (network) {
      downloading++;
      if (background) backgroundDownloading++;
    } else {
      job.item.started = true;
      decoding++;
      if (background) backgroundDecoding++;
    }
    Promise.resolve()
      .then(job.load)
      .then(job.resolve, job.reject)
      .finally(() => {
        if (network) {
          downloading--;
          if (background) backgroundDownloading--;
        } else {
          decoding--;
          if (background) backgroundDecoding--;
        }
        pump();
      });
  }
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

function trimSources() {
  const idle = [...sources].filter(([, item]) => !item.refs && item.data);
  let bytes = idle.reduce((sum, [, item]) => sum + item.bytes, 0);
  for (const [url, item] of idle) {
    if (bytes <= sourceBudget) break;
    sources.delete(url);
    bytes -= item.bytes;
  }
}

export function prefetchTextureImage(url, { priority = 0 } = {}) {
  let item = sources.get(url);
  if (!item) {
    item = { refs: 0, priority, data: null, bytes: 0 };
    const current = item;
    item.ready = enqueue(
      async () => {
        current.controller = new AbortController();
        try {
          const response = await fetch(url, { signal: current.controller.signal });
          if (!response.ok) throw new Error(`Unable to load card texture: ${url}`);
          current.data = await response.blob();
          current.bytes = current.data.size || 0;
          trimSources();
          return current.data;
        } finally {
          current.controller = null;
        }
      },
      item,
      true,
    );
    item.ready.catch(() => {
      if (sources.get(url) === current) sources.delete(url);
    });
    sources.set(url, item);
  }
  sources.delete(url);
  sources.set(url, item);
  item.refs++;
  item.priority = Math.max(item.priority, priority);
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
      if (!--item.refs && !item.data) {
        item.controller?.abort();
        if (sources.get(url) === item) sources.delete(url);
      }
      queueMicrotask(pump);
      trimSources();
    },
  };
}

export function prefetchTextureImages(urls, { priority = 0, concurrency = 4 } = {}) {
  const ordered = [...new Set(urls)].filter((url) => /^https?:/.test(url));
  const active = new Set();
  let next = 0,
    cancelled = false;
  const load = async () => {
    while (!cancelled && next < ordered.length) {
      const url = ordered[next++];
      // Existing pixels or their download already serve this texture.
      if (images.has(url)) continue;
      const handle = prefetchTextureImage(url, { priority });
      active.add(handle);
      try {
        await handle.ready;
      } catch {
        // Foreground loading retries failures and retains the DOM fallback.
      } finally {
        active.delete(handle);
        handle.release();
      }
    }
  };
  return {
    ready: Promise.all(
      Array.from({ length: Math.min(ordered.length, concurrency, downloadLimit) }, load),
    ),
    promote(nextPriority) {
      priority = Math.max(priority, nextPriority);
      for (const handle of active) handle.promote(priority);
    },
    cancel() {
      cancelled = true;
      for (const handle of active) handle.release();
    },
  };
}

export function textureImageStats() {
  return {
    downloading,
    decoding,
    queuedDownloads: downloads.length,
    queuedDecodes: pending.length,
    compressedBytes: [...sources.values()].reduce((sum, item) => sum + item.bytes, 0),
    idleCompressedBytes: [...sources.values()]
      .filter((item) => !item.refs)
      .reduce((sum, item) => sum + item.bytes, 0),
    compressedRefs: [...sources.values()].reduce((sum, item) => sum + item.refs, 0),
  };
}

export function acquireTextureImage(url, { priority = 2, retention = 0 } = {}) {
  let item = images.get(url);
  if (!item) {
    item = { refs: 0, bytes: 0, data: null, priority, retention };
    const current = item;
    // Download compressed bytes ahead of decoding. Slow network requests must
    // not occupy decode slots; keep at most sixteen queued/in-flight
    // compressed sources, with foreground work taking priority in both queues.
    // Native file URLs keep the original Electron image loader.
    const remote = /^https?:/.test(url);
    const lease = remote ? prefetchTextureImage(url, { priority }) : null;
    item.source = lease;
    const source = lease?.ready ?? Promise.resolve(null);
    item.ready = source
      .then((blob) =>
        enqueue(
          () =>
            new Promise((resolve, reject) => {
              const image = new Image();
              const objectURL = blob ? URL.createObjectURL(blob) : null;
              const cleanup = () => {
                if (objectURL) URL.revokeObjectURL(objectURL);
              };
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
                  cleanup();
                  resolve(current.data);
                  trim();
                } catch (error) {
                  cleanup();
                  if (images.get(url) === current) images.delete(url);
                  reject(new Error(`Unable to decode card texture: ${url}`, { cause: error }));
                }
              };
              image.onerror = () => {
                cleanup();
                if (images.get(url) === current) images.delete(url);
                reject(new Error(`Unable to load card texture: ${url}`));
              };
              image.src = objectURL ?? url;
            }),
          item,
        ),
      )
      .finally(() => {
        lease?.release();
        current.source = null;
      });
    item.ready.catch(() => {
      if (images.get(url) === current) images.delete(url);
    });
    images.set(url, item);
  }
  item.priority = Math.max(item.priority, priority);
  item.source?.promote(priority);
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
      item.source?.promote(priority);
      queueMicrotask(pump);
    },
    release() {
      if (released) return;
      released = true;
      item.refs--;
      if (!item.refs && !item.started) item.source?.release();
      if (!item.refs && !item.started && !item.data && images.get(url) === item) images.delete(url);
      queueMicrotask(pump);
      trim();
    },
  };
}
