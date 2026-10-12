import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// Opaque, immobile scenery shares a depth program even when its visible
// materials differ. Merge that pass without changing the visible meshes.
export function createStaticShadowBatch(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const sources = [];
  const meshes = [];
  const sides = {
    [THREE.FrontSide]: THREE.BackSide,
    [THREE.BackSide]: THREE.FrontSide,
    [THREE.DoubleSide]: THREE.DoubleSide,
  };
  root.traverse((object) => {
    const material = object.material;
    if (
      !object.isMesh ||
      !object.castShadow ||
      object.isSkinnedMesh ||
      object.isInstancedMesh ||
      object.customDepthMaterial ||
      Object.keys(object.geometry.morphAttributes).length
    )
      return;
    const materials = Array.isArray(material) ? material : [material];
    const side = materials[0].shadowSide ?? sides[materials[0].side];
    if (
      materials.some(
        (m) =>
          m.transparent ||
          m.alphaTest ||
          m.alphaHash ||
          m.displacementMap ||
          m.clippingPlanes?.length ||
          (m.shadowSide ?? sides[m.side]) !== side,
      )
    )
      return;
    const key = `${side}:${!!object.geometry.index}:${Object.keys(object.geometry.attributes).sort().join(',')}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { side, sources: [], geometries: [] }));
    const geometry = object.geometry.clone();
    // The visible batches already live in root coordinates. Avoid applying
    // inverse(root)*root again: it needlessly renormalizes their normals.
    if (object.parent !== root || !object.matrix.equals(new THREE.Matrix4()))
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    bucket.geometries.push(geometry);
    bucket.sources.push(object);
  });
  for (const bucket of buckets.values()) {
    if (bucket.sources.length < 2) {
      bucket.geometries.forEach((geometry) => geometry.dispose());
      continue;
    }
    const geometry = mergeGeometries(bucket.geometries);
    bucket.geometries.forEach((part) => part.dispose());
    if (!geometry) continue;
    const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    material.shadowSide = bucket.side;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'static-shadow-batch';
    mesh.userData.shadowOnly = true;
    mesh.castShadow = true;
    mesh.raycast = () => {};
    // The shadow pass precedes the colour pass. The original geometry remains
    // available for shadows; the colour pass submits no duplicate triangles.
    mesh.onBeforeShadow = () => geometry.setDrawRange(0, Infinity);
    mesh.onBeforeRender = () => geometry.setDrawRange(0, 0);
    mesh.onAfterRender = () => geometry.setDrawRange(0, Infinity);
    for (const source of bucket.sources) source.castShadow = false;
    sources.push(...bucket.sources);
    meshes.push(mesh);
    root.add(mesh);
  }
  return {
    stats: () => ({ sources: sources.length, batches: meshes.length }),
    setEnabled(enabled) {
      for (const source of sources) source.castShadow = !enabled;
      for (const mesh of meshes) mesh.visible = enabled;
    },
    dispose() {
      for (const source of sources) source.castShadow = true;
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      sources.length = meshes.length = 0;
    },
  };
}

export function createInstancedShadowMeshes(meshes, parts, count) {
  const root = new THREE.Group();
  const proxies = meshes.map((source, index) => {
    const proxy = new THREE.Mesh(source.geometry, source.material);
    proxy.castShadow = source.castShadow;
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(parts[index]);
    root.add(proxy);
    return proxy;
  });
  const batch = createStaticShadowBatch(root);
  const sources = [];
  for (let i = 0; i < proxies.length; i++)
    if (meshes[i].castShadow && !proxies[i].castShadow) {
      sources.push(meshes[i]);
      meshes[i].castShadow = false;
    }
  const shadows = root.children
    .filter((mesh) => mesh.userData.shadowOnly)
    .map((source) => {
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, count);
      mesh.name = 'package-shadow-instances';
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      mesh.onBeforeShadow = source.onBeforeShadow;
      mesh.onBeforeRender = source.onBeforeRender;
      mesh.onAfterRender = source.onAfterRender;
      return mesh;
    });
  return {
    meshes: shadows,
    stats: batch.stats,
    setEnabled(enabled) {
      for (const source of sources) source.castShadow = !enabled;
      for (const mesh of shadows) mesh.visible = enabled;
    },
    dispose() {
      for (const source of sources) source.castShadow = true;
      batch.dispose();
    },
  };
}
