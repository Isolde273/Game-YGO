import * as THREE from '../vendor/three.module.js';

// Retain the native, multisampled room buffer. Repaint the old/new footprints
// of changed objects, including their full directional-shadow volumes. The
// original scene still renders inside that scissor: lighting and depth tests
// are identical to a full redraw, including transparent objects behind it.
export function createRoomDamage(renderer, scene, camera, light) {
  let previous = new Map();
  let projectionKey = '';
  let invalid = true;
  const size = new THREE.Vector2();
  const matrix = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const lightPosition = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();
  const bounds = new THREE.Box3();
  const boundsVersions = new WeakMap();
  const stats = { full: 0, partial: 0, pixels: 0, fullPixels: 0 };
  // This includes the room floor below the desk, so shadows falling onto any
  // scenery remain in the damage volume. Filter support extends the volume.
  const floor = new THREE.Box3().setFromObject(scene).min.y - 0.2;
  const shadowPadding =
    Math.max(
      (light.shadow.camera.right - light.shadow.camera.left) / light.shadow.mapSize.x,
      (light.shadow.camera.top - light.shadow.camera.bottom) / light.shadow.mapSize.y,
    ) *
      4 +
    light.shadow.normalBias;

  function materialKey(object) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials
      .map((material) => {
        const uniforms = Object.values(material.uniforms ?? {}).map(({ value }) =>
          value?.isTexture
            ? value.version
            : value?.toArray
              ? value.toArray().join(',')
              : typeof value === 'number' || typeof value === 'boolean'
                ? value
                : '',
        );
        return [
          material.id,
          material.version,
          material.opacity,
          material.color?.getHex(),
          material.emissive?.getHex(),
          material.roughness,
          material.metalness,
          material.clearcoat,
          material.map?.version,
          material.normalMap?.version,
          material.bumpMap?.version,
          ...uniforms,
        ].join(':');
      })
      .join('|');
  }
  function footprint(object, world) {
    const geometry = object.geometry;
    if (
      !geometry.boundingBox ||
      boundsVersions.get(geometry) !== geometry.attributes.position.version
    ) {
      geometry.computeBoundingBox();
      boundsVersions.set(geometry, geometry.attributes.position.version);
    }
    bounds.copy(geometry.boundingBox).applyMatrix4(world).expandByScalar(shadowPadding);
    const rectangle = [Infinity, Infinity, -Infinity, -Infinity];
    const project = () => {
      point.project(camera);
      if (point.z < -1 || point.z > 1) {
        // A volume crossing the camera's clipping plane cannot safely use a
        // corner-only projection; use the full viewport in that case.
        rectangle[0] = rectangle[1] = -1;
        rectangle[2] = rectangle[3] = 1;
        return;
      }
      rectangle[0] = Math.min(rectangle[0], point.x);
      rectangle[1] = Math.min(rectangle[1], point.y);
      rectangle[2] = Math.max(rectangle[2], point.x);
      rectangle[3] = Math.max(rectangle[3], point.y);
    };
    for (let corner = 0; corner < 8; corner++) {
      const x = corner & 1 ? bounds.max.x : bounds.min.x;
      const y = corner & 2 ? bounds.max.y : bounds.min.y;
      const z = corner & 4 ? bounds.max.z : bounds.min.z;
      point.set(x, y, z);
      project();
      if (object.castShadow && direction.y < -0.0001 && y > floor) {
        point.set(x, y, z).addScaledVector(direction, (floor - y) / direction.y);
        project();
      }
    }
    return rectangle;
  }
  function collect() {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    light.getWorldPosition(lightPosition);
    light.target.getWorldPosition(targetPosition);
    direction.subVectors(targetPosition, lightPosition).normalize();
    renderer.getDrawingBufferSize(size);
    const key = [
      size.x,
      size.y,
      renderer.toneMappingExposure,
      scene.background?.getHex(),
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
      ...lightPosition.toArray(),
      ...targetPosition.toArray(),
      light.intensity,
    ].join(':');
    let full = invalid || projectionKey !== key || stats.full + stats.partial === 1;
    // Stored footprints use the old camera/light projection. Rebuild them on
    // a full invalidation so a later move or removal clears the right pixels.
    if (full) previous.clear();
    projectionKey = key;
    invalid = false;
    const next = new Map();
    const damage = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (rectangle) => {
      damage[0] = Math.min(damage[0], rectangle[0]);
      damage[1] = Math.min(damage[1], rectangle[1]);
      damage[2] = Math.max(damage[2], rectangle[2]);
      damage[3] = Math.max(damage[3], rectangle[3]);
    };
    scene.traverseVisible((object) => {
      if (!object.isMesh || !object.layers.test(camera.layers)) return;
      const appearance = `${object.geometry.id}:${object.geometry.attributes.position.version}:${object.renderOrder}:${object.castShadow}:${materialKey(object)}`;
      for (let index = 0; index < (object.isInstancedMesh ? object.count : 1); index++) {
        if (object.isInstancedMesh) {
          object.getMatrixAt(index, instance);
          matrix.multiplyMatrices(object.matrixWorld, instance);
        } else matrix.copy(object.matrixWorld);
        const id = `${object.id}:${index}`;
        const old = previous.get(id);
        if (
          old &&
          old.appearance === appearance &&
          old.matrix.every((value, i) => value === matrix.elements[i])
        ) {
          next.set(id, old);
          previous.delete(id);
          continue;
        }
        if (old) add(old.rectangle);
        const rectangle = footprint(object, matrix);
        add(rectangle);
        next.set(id, { appearance, matrix: matrix.elements.slice(), rectangle });
        previous.delete(id);
      }
    });
    for (const old of previous.values()) add(old.rectangle);
    previous = next;
    // An explicit render with no detectable geometry/material change may be
    // caused by a global lighting setting. Conservatively refresh that frame.
    if (!Number.isFinite(damage[0])) full = true;
    const padding = 3;
    const x0 = full ? 0 : Math.max(0, Math.floor(((damage[0] + 1) * size.x) / 2) - padding);
    const y0 = full ? 0 : Math.max(0, Math.floor(((damage[1] + 1) * size.y) / 2) - padding);
    const x1 = full
      ? size.x
      : Math.min(size.x, Math.ceil(((damage[2] + 1) * size.x) / 2) + padding);
    const y1 = full
      ? size.y
      : Math.min(size.y, Math.ceil(((damage[3] + 1) * size.y) / 2) + padding);
    stats[full ? 'full' : 'partial']++;
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    stats.lastFraction = area / (size.x * size.y);
    stats.pixels += area;
    stats.fullPixels += size.x * size.y;
    return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  }
  return {
    render() {
      const rectangle = collect();
      const ratio = renderer.getPixelRatio();
      renderer.setScissor(...rectangle.map((value) => value / ratio));
      renderer.setScissorTest(true);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setScissorTest(false);
      }
    },
    invalidate() {
      invalid = true;
    },
    stats: () => ({ ...stats }),
    dispose() {
      previous.clear();
    },
  };
}
