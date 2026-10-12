import * as THREE from '../vendor/three.module.js';
import { getCardView } from '../game/card-data.js';
import { createFinishMaterial } from './material-finishes.js';
import { acquireTextureImage } from './texture-images.js';
import { scheduleResourceTask } from './resource-scheduler.js';

function texturePaths(data) {
  return [
    data.rarity === 'GMR'
      ? (data.blankFront ?? data.front.replace('-front.jpg', '-blank.jpg'))
      : data.front,
    data.mask,
    data.normal,
    data.border,
    data.accent,
  ];
}

function textureURL(data, path) {
  return new URL(`../../public/${data.assetRoot ?? 'locr-catalog'}/${path}`, import.meta.url).href;
}

export function cardFinishTextureURLs(records) {
  const urls = new Set();
  for (const record of [...records].reverse()) {
    const data = getCardView(record.printId ?? record.rarity);
    if (!data || data.legacy) continue;
    // Include the original face used by the DOM fallback, also for GMR.
    for (const path of [...texturePaths(data), data.front]) {
      if (path) urls.add(textureURL(data, path));
    }
  }
  return [...urls];
}

// Texture references follow visible cards, not the full catalog or save inventory.
export function createGameFinishLibrary(invalidate = () => {}) {
  const textures = new Map(),
    entries = new Map();
  const retired = new Set();
  let disposed = false;
  const light = new THREE.Vector3(-3, 4.5, 7);
  function solid(rgba) {
    const map = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
    map.needsUpdate = true;
    return map;
  }
  const black = solid([0, 0, 0, 255]);
  const paper = solid([30, 35, 42, 255]);
  const flat = solid([128, 128, 255, 255]);
  const constants = new Map();
  function constantTexture(rgba) {
    const key = rgba.join(',');
    let map = constants.get(key);
    if (!map) {
      map = solid(rgba);
      constants.set(key, map);
    }
    return { map, ready: Promise.resolve(map), release() {} };
  }
  function texture(data, path, srgb = false, priority = 2) {
    if (!path) return { map: black, ready: Promise.resolve(black), release() {} };
    const url = textureURL(data, path);
    let item = textures.get(url);
    if (!item) {
      const pixels = acquireTextureImage(url, { priority });
      const map = new THREE.Texture();
      map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      map.anisotropy = 4;
      item = { map, refs: 0, dead: false, pixels };
      const current = item;
      item.ready = pixels.ready.then(({ image, flipY }) => {
        if (!current.dead) {
          map.image = image;
          map.flipY = flipY;
          map.needsUpdate = true;
        }
        return map;
      });
      textures.set(url, item);
    }
    item.refs++;
    item.pixels.promote(priority);
    return {
      map: item.map,
      ready: item.ready,
      promote: item.pixels.promote,
      release() {
        if (--item.refs === 0) {
          item.dead = true;
          item.map.dispose();
          item.pixels.release();
          if (textures.get(url) === item) textures.delete(url);
        }
      },
    };
  }
  function destroy(key, entry) {
    entries.delete(key);
    entry.dead = true;
    retired.add(entry);
    if (disposed || !entry.material.userData.ready) finishDestroy(entry);
    else
      void scheduleResourceTask(() => finishDestroy(entry), {
        priority: 1,
        valid: () => retired.has(entry),
      });
  }
  function finishDestroy(entry) {
    if (!retired.delete(entry)) return;
    entry.material.dispose();
    entry.maps.forEach((item) => item.release());
    entry.stamp?.dispose();
  }
  function trim() {
    const idle = [...entries].filter(([, entry]) => entry.refs === 0);
    for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - 6))) destroy(key, entry);
  }
  function acquire(record, { priority = 2 } = {}) {
    if (disposed) throw new Error('Card finish library is disposed');
    const data = getCardView(record.printId ?? record.rarity);
    if (!data || data.legacy) return null;
    const key = `${data.id}:${record.serial ?? ''}`;
    let entry = entries.get(key);
    if (!entry) {
      const paths = texturePaths(data);
      const maps = paths.map((path, index) => {
        const value =
          data.textureConstants?.[['front', 'mask', 'normal', 'border', 'accent'][index]];
        return value ? constantTexture(value) : texture(data, path, index === 0, priority);
      });
      let stamp = null;
      if (data.rarity === 'GMR' && record.serial) {
        const canvas = document.createElement('canvas');
        // Supersample the small engraved number so it stays crisp when enlarged.
        const scale = 4;
        canvas.width = 160 * scale;
        canvas.height = 28 * scale;
        const context = canvas.getContext('2d');
        context.scale(scale, scale);
        context.fillStyle = '#000';
        context.fillRect(0, 0, 160, 28);
        context.fillStyle = '#fff';
        context.font = '22px Arial';
        context.textBaseline = 'alphabetic';
        context.fillText(`${String(record.serial).padStart(3, '0')}/100`, 6, 22);
        stamp = new THREE.CanvasTexture(canvas);
        stamp.colorSpace = THREE.NoColorSpace;
        stamp.anisotropy = 4;
      }
      const material = createFinishMaterial({
        data,
        print: paper,
        finish: black,
        relief: flat,
        border: black,
        accent: black,
        serialMap: stamp ?? black,
        serialMode: data.rarity === 'GMR' ? 1 : 0,
      });
      material.userData.gameCardFinish = true;
      material.userData.printId = data.id;
      material.userData.serial = record.serial ?? null;
      material.uniforms.lightPosition.value.copy(light);
      entry = { material, maps, stamp, refs: 0, dead: false };
      const current = entry;
      entry.ready = Promise.all(maps.map((item) => item.ready)).then((loaded) => {
        if (!current.dead && !disposed) {
          ['printMap', 'finishMap', 'reliefMap', 'borderMap', 'accentMap'].forEach((name, i) => {
            material.uniforms[name].value = loaded[i];
          });
          material.userData.ready = true;
          invalidate();
        }
        return material;
      });
      // Retain the original print as the DOM fallback if a local asset cannot load.
      entry.ready.catch(() => {
        material.userData.failed = true;
      });
      entries.set(key, entry);
    }
    entries.delete(key);
    entries.set(key, entry);
    entry.refs++;
    entry.maps.forEach((map) => map.promote?.(priority));
    let released = false;
    return {
      material: entry.material,
      ready: entry.ready,
      promote(priority) {
        entry.maps.forEach((map) => map.promote?.(priority));
      },
      release() {
        if (released || entry.dead) return;
        released = true;
        entry.refs--;
        if (!entry.refs && !entry.material.userData.ready) destroy(key, entry);
        else trim();
      },
    };
  }
  function updateLight(position) {
    light.copy(position);
    for (const entry of entries.values()) entry.material.uniforms.lightPosition.value.copy(light);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [key, entry] of [...entries]) destroy(key, entry);
    for (const entry of retired) finishDestroy(entry);
    black.dispose();
    paper.dispose();
    flat.dispose();
    for (const map of constants.values()) map.dispose();
    constants.clear();
  }
  return {
    acquire,
    updateLight,
    dispose,
    stats: () => ({
      entries: entries.size,
      active: [...entries.values()].filter((entry) => entry.refs > 0).length,
      textures: textures.size,
    }),
  };
}
