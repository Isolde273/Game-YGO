import * as THREE from '../vendor/three.module.js';
import { prepareRenderer } from './prepare-renderer.js';

// Static opaque scenery can populate depth before the original colour pass.
// Keep the original colour order, materials and native multisampled buffer.
// Transparent, cut-out, displaced and custom geometry remains in that pass.
export function createRoomDepthPrepass(renderer, scene, camera, root) {
  const depthScene = new THREE.Scene();
  const proxies = [];
  const materials = new Map();
  let disposed = false;
  root?.traverse((source) => {
    const material = source.material;
    if (
      !source.isMesh ||
      source.isInstancedMesh ||
      source.isSkinnedMesh ||
      source.userData.shadowOnly ||
      Array.isArray(material) ||
      !(material?.isMeshStandardMaterial || material?.isMeshBasicMaterial) ||
      material.transparent ||
      material.alphaTest ||
      material.alphaHash ||
      material.displacementMap ||
      material.clippingPlanes?.length ||
      material.wireframe ||
      material.polygonOffset ||
      !material.depthWrite ||
      !material.depthTest ||
      !material.colorWrite ||
      material.depthFunc !== THREE.LessEqualDepth ||
      Object.keys(source.geometry.morphAttributes).length
    )
      return;
    let depth = materials.get(material.side);
    if (!depth) {
      depth = new THREE.MeshDepthMaterial({
        colorWrite: false,
        side: material.side,
        // A conservative bias prevents the depth-only vertex program from
        // rejecting the original surface at coplanar, multisampled edges.
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      });
      materials.set(material.side, depth);
    }
    const proxy = new THREE.Mesh(source.geometry, depth);
    proxy.matrixAutoUpdate = false;
    depthScene.add(proxy);
    proxies.push({ source, proxy });
  });

  return {
    prepare: (valid) => prepareRenderer(renderer, depthScene, camera, () => !disposed && valid()),
    render() {
      if (disposed || !proxies.length) {
        renderer.render(scene, camera);
        return;
      }
      for (const { source, proxy } of proxies) {
        let parent = source;
        while (parent && parent !== scene && parent.visible) parent = parent.parent;
        proxy.visible = parent === scene && scene.visible && source.material.visible;
        proxy.matrix.copy(source.matrixWorld);
        proxy.matrixWorldNeedsUpdate = true;
      }
      const shadowUpdate = renderer.shadowMap.needsUpdate;
      const clearDepth = renderer.autoClearDepth;
      renderer.shadowMap.needsUpdate = false;
      try {
        renderer.render(depthScene, camera);
      } finally {
        renderer.shadowMap.needsUpdate = shadowUpdate;
      }
      try {
        renderer.autoClearDepth = false;
        renderer.render(scene, camera);
      } finally {
        renderer.autoClearDepth = clearDepth;
      }
    },
    dispose() {
      disposed = true;
      depthScene.clear();
      proxies.length = 0;
      for (const material of materials.values()) material.dispose();
      materials.clear();
    },
  };
}
