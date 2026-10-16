import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { createStaticShadowBatch } from './shadow-batch.js';
import { cardShopMeta } from '../generated/card-shop-meta.js';
import { FAST_WEB } from './web-performance.js';
import { DESK_MODEL_GROUPS, FLOOR_MATERIAL, gameplayColliders } from './desk-model-groups.js';

// Blender-authored glTF embedded for Electron file:// and offline use. The parsed
// template is CPU-only; each visit owns its own GPU resources.
const buffer = document.documentElement.dataset.webRelease
  ? await fetch(
      new URL(
        `../../public/assets/models/${FAST_WEB ? 'card-shop-web.glb' : 'card-shop-gameplay.glb'}`,
        import.meta.url,
      ),
    ).then((response) => {
      if (!response.ok) throw new Error('Unable to load the card shop model');
      return response.arrayBuffer();
    })
  : Uint8Array.from(atob((await import('../generated/card-shop-glb.js')).cardShopGLB), (c) =>
      c.charCodeAt(0),
    ).buffer;
const template = await new Promise((resolve, reject) =>
  new GLTFLoader().parse(buffer, '', (g) => resolve(g.scene), reject),
);
// The native source asset remains available for authoring, but decorations must
// also disappear in source previews and file:// games, not just the web export.
const surroundings = template.children.find((child) => child.userData.assetGroup === 'Room');
if (surroundings) {
  const decorations = [];
  surroundings.traverse((child) => {
    if (child.isMesh && child.material.name !== FLOOR_MATERIAL) decorations.push(child);
  });
  decorations.forEach((child) => child.removeFromParent());
  surroundings.userData.assetGroup = 'Floor';
  surroundings.name = 'Floor';
}
for (const child of [...template.children])
  if (!DESK_MODEL_GROUPS.includes(child.userData.assetGroup)) child.removeFromParent();
function canvasTexture(draw, w = 256, h = 256, color = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Cache CPU-only, immutable batches for repeated visits to the same room size.
// Each visit clones its own geometry and owns all of its GPU resources.
const geometryCache = new Map();
function mergeByMaterial(root, cacheKey) {
  const cached = geometryCache.get(cacheKey);
  if (cached) {
    const old = [];
    root.traverse((o) => {
      if (o.isMesh) old.push(o);
    });
    old.forEach((o) => o.removeFromParent());
    const materials = new Map(old.map((o) => [o.material.name, o.material]));
    for (const batch of cached) {
      const mesh = new THREE.Mesh(batch.geometry.clone(), materials.get(batch.material));
      mesh.name = `blender-batch-${batch.material}`;
      mesh.castShadow = batch.cast;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    return { parts: old.length, batches: cached.length };
  }
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    buckets = new Map(),
    old = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    // Keep the welded export indices when batching, so detailed props share vertices.
    for (const name of Object.keys(geometry.attributes))
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.attributes.uv)
      geometry.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2),
      );
    if (!geometry.index)
      geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
    const key = o.material.uuid + ':' + o.castShadow;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: o.material, geometries: [], cast: o.castShadow };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geometry);
    old.push(o);
  });
  // These source geometries belong to the CPU template, never to this visit.
  old.forEach((o) => o.removeFromParent());
  const cachedBatches = [];
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries);
    bucket.geometries.forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = `blender-batch-${bucket.material.name}`;
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = true;
    root.add(mesh);
    cachedBatches.push({
      geometry: geometry.clone(),
      material: bucket.material.name,
      cast: bucket.cast,
    });
  }
  geometryCache.set(cacheKey, cachedBatches);
  if (geometryCache.size > 3) {
    const oldest = geometryCache.keys().next().value;
    geometryCache.get(oldest).forEach((batch) => batch.geometry.dispose());
    geometryCache.delete(oldest);
  }
  return { parts: old.length, batches: buckets.size };
}
export function createDeskScene(scene, halfWidth, halfDepth) {
  const root = template.clone(true);
  root.name = 'blender-card-shop';
  scene.add(root);
  const materials = new Set(),
    textures = new Set(),
    materialClones = new Map(),
    textureClones = new Map();
  const ownTexture = (t) => (textures.add(t), t);
  const cloneMaterial = (original) => {
    if (materialClones.has(original)) return materialClones.get(original);
    const material = FAST_WEB
      ? new THREE.MeshLambertMaterial({
          name: original.name,
          color: original.color,
          map: original.map,
          emissive: original.emissive,
          emissiveIntensity: original.emissiveIntensity,
          transparent: original.transparent,
          opacity: original.opacity,
          side: original.side,
          alphaTest: original.alphaTest,
        })
      : original.clone();
    materialClones.set(original, material);
    materials.add(material);
    for (const key of Object.keys(material))
      if (material[key]?.isTexture) {
        const t = material[key];
        if (!textureClones.has(t)) textureClones.set(t, ownTexture(t.clone()));
        material[key] = textureClones.get(t);
        material[key].anisotropy = 8;
      }
    return material;
  };
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = cloneMaterial(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const named = new Map(root.children.map((o) => [o.userData.assetGroup, o]));
  const dx = halfWidth - 9.8,
    dz = halfDepth - 7.056;
  for (const name of ['Desk', 'Mat', 'Floor']) {
    const o = named.get(name);
    o.scale.x = halfWidth / 9.8;
    o.scale.z = halfDepth / 7.056;
    if (name === 'Mat') o.position.x = -halfWidth * 0.1;
  }
  for (const name of ['Binder', 'BinderCover']) named.get(name).position.x -= dx;
  for (const name of ['Phone', 'PhonePad', 'Warehouse', 'WarehouseFlapFront', 'WarehouseFlapBack'])
    named.get(name).position.x += dx;
  for (const name of [
    'Binder',
    'BinderCover',
    'Warehouse',
    'WarehouseFlapFront',
    'WarehouseFlapBack',
  ])
    named.get(name).position.z -= dz;
  named.get('Floor').traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  const environment = FAST_WEB
    ? null
    : ownTexture(
        canvasTexture(
          (c, w, h) => {
            const gradient = c.createLinearGradient(0, 0, 0, h);
            gradient.addColorStop(0, '#92999e');
            gradient.addColorStop(0.5, '#6c6860');
            gradient.addColorStop(1, '#232c2c');
            c.fillStyle = gradient;
            c.fillRect(0, 0, w, h);
            c.fillStyle = '#fff4d7';
            c.fillRect(w * 0.1, h * 0.15, w * 0.16, h * 0.45);
            c.fillStyle = '#bfd7ea';
            c.fillRect(w * 0.68, h * 0.18, w * 0.18, h * 0.29);
          },
          512,
          256,
        ),
      );
  if (environment) environment.mapping = THREE.EquirectangularReflectionMapping;
  const weave = FAST_WEB
    ? null
    : ownTexture(
        canvasTexture(
          (c, w, h) => {
            const im = c.createImageData(w, h);
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4,
                  v = 110 + (x % 4 < 2 ? 14 : 0) + (y % 4 < 2 ? 9 : 0);
                im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
                im.data[i + 3] = 255;
              }
            c.putImageData(im, 0, 0);
          },
          256,
          256,
          false,
        ),
      );
  if (weave) {
    weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
    weave.repeat.set(36, 28);
  }
  for (const m of materials) {
    if (!FAST_WEB && /brass|steel|porcelain|Coffee|glass/i.test(m.name)) {
      m.envMap = environment;
      m.envMapIntensity = 0.5;
    }
    // Blender's height textures are not tangent-space normal maps. Recreate
    // their bump effect here instead of lighting the surface with grayscale normals.
    if (!FAST_WEB && /leather|Woven/.test(m.name)) {
      m.normalMap = null;
      m.bumpMap = weave;
      m.bumpScale = 0.006;
    }
    if (!FAST_WEB && m.name === 'Oiled walnut') {
      m.normalMap = null;
      m.bumpMap = m.map;
      m.bumpScale = 0.008;
    }
    if (!m.transparent) m.side = THREE.FrontSide;
    if (m.transparent) {
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
    }
  }
  const phoneRoot = named.get('Phone');
  phoneRoot.removeFromParent();
  const colliders = gameplayColliders(cardShopMeta.colliders).map((p) => {
    const source = template.children.find((o) => o.userData.assetGroup === p.group),
      adjusted = named.get(p.group);
    return {
      name: p.name,
      size: [...p.size],
      position: [
        p.position[0] + adjusted.position.x - source.position.x,
        p.position[1],
        p.position[2] + adjusted.position.z - source.position.z,
      ],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw)
        .toArray(),
    };
  });
  const props = [...named].map(([name, o]) => ({ name, position: o.position.toArray() }));
  const entrances = Object.fromEntries(
    [
      ['shop', 'Phone'],
      ['album', 'Binder'],
      ['warehouse', 'Warehouse'],
    ].map(([page, name]) => {
      const o = named.get(name);
      return [page, { position: o.position.clone(), quaternion: o.quaternion.clone() }];
    }),
  );
  const staticBatch = mergeByMaterial(root, `room:${halfWidth}:${halfDepth}`);
  const shadowBatch = createStaticShadowBatch(root);
  let phoneBatch = null,
    phoneAdded = false,
    disposed = false;
  function createPhone(screen) {
    ownTexture(screen);
    screen.anisotropy = 8;
    screen.flipY = false;
    phoneRoot.traverse((o) => {
      if (o.isMesh && o.material.name === 'PhoneScreen') {
        const m = o.material;
        m.map = screen;
        m.emissiveMap = screen;
        m.emissive.set('#ffffff');
        m.emissiveIntensity = 0.66;
        m.color.set('#ffffff');
        m.roughness = 0.24;
        m.envMap = environment;
        m.envMapIntensity = 0.22;
        m.needsUpdate = true;
      }
    });
    scene.add(phoneRoot);
    phoneAdded = true;
    phoneBatch = mergeByMaterial(phoneRoot, 'phone');
    return phoneRoot;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    shadowBatch.dispose();
    const geometries = new Set();
    for (const group of [root, phoneRoot]) {
      group.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
      });
      group.removeFromParent();
    }
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
  function snapshot() {
    let triangles = 0;
    for (const group of [root, phoneAdded ? phoneRoot : null])
      group?.traverse((o) => {
        if (o.isMesh && !o.userData.shadowOnly)
          triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      });
    return {
      name: 'blender-card-shop',
      authoring: 'Blender ' + cardShopMeta.blender,
      source: cardShopMeta.source,
      sourceParts: cardShopMeta.sourceParts,
      staticParts: staticBatch.parts,
      staticBatches: staticBatch.batches,
      shadowBatch: shadowBatch.stats(),
      phoneBatches: phoneBatch?.batches ?? 0,
      triangles,
      props,
      colliderNames: colliders.map((collider) => collider.name),
    };
  }
  return { root, colliders, entrances, createPhone, dispose, snapshot, shadowBatch };
}
