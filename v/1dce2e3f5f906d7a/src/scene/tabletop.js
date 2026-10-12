import * as THREE from '../vendor/three.module.js';

// Oriented volumes are shared by the placement preview, picking and regression tests.
export function volume(position, quaternion, size) {
  const center = new THREE.Vector3(
    position.x ?? position[0],
    position.y ?? position[1],
    position.z ?? position[2],
  );
  const q = new THREE.Quaternion(
    quaternion.x ?? quaternion[0],
    quaternion.y ?? quaternion[1],
    quaternion.z ?? quaternion[2],
    quaternion.w ?? quaternion[3],
  );
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ].map((v) => v.applyQuaternion(q));
  const half = size.map((n) => n / 2),
    corners = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        corners.push(
          center
            .clone()
            .addScaledVector(axes[0], x * half[0])
            .addScaledVector(axes[1], y * half[1])
            .addScaledVector(axes[2], z * half[2]),
        );
  return { center, q, axes, half, corners, bounds: new THREE.Box3().setFromPoints(corners) };
}
export function volumesOverlap(a, b, epsilon = 0.001) {
  if (!a.bounds.intersectsBox(b.bounds)) return false;
  const delta = b.center.clone().sub(a.center),
    axes = [...a.axes, ...b.axes];
  for (const x of a.axes)
    for (const y of b.axes) {
      const n = x.clone().cross(y);
      if (n.lengthSq() > 1e-10) axes.push(n.normalize());
    }
  return axes.every(
    (n) =>
      Math.abs(delta.dot(n)) <
      a.axes.reduce((r, x, i) => r + Math.abs(x.dot(n)) * a.half[i], 0) +
        b.axes.reduce((r, x, i) => r + Math.abs(x.dot(n)) * b.half[i], 0) -
        epsilon,
  );
}
export function footprintsOverlap(a, b) {
  if (
    a.bounds.max.x <= b.bounds.min.x ||
    a.bounds.min.x >= b.bounds.max.x ||
    a.bounds.max.z <= b.bounds.min.z ||
    a.bounds.min.z >= b.bounds.max.z
  )
    return false;
  // All projected edges of an oriented box provide the separating axes of its footprint.
  const axes = [...a.axes, ...b.axes]
    .filter((n) => n.x * n.x + n.z * n.z > 1e-10)
    .map((n) => new THREE.Vector3(-n.z, 0, n.x).normalize());
  return axes.every((n) => {
    const pa = a.corners.map((p) => p.dot(n)),
      pb = b.corners.map((p) => p.dot(n));
    return Math.max(...pa) > Math.min(...pb) + 0.001 && Math.max(...pb) > Math.min(...pa) + 0.001;
  });
}
export function surfacePosition(position, size, quaternion, obstacles, halfWidth, halfDepth) {
  const shape = volume([0, 0, 0], quaternion, size),
    half = shape.bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const x = THREE.MathUtils.clamp(
      position.x,
      -halfWidth + half.x + 0.08,
      halfWidth - half.x - 0.08,
    ),
    z = THREE.MathUtils.clamp(position.z, -halfDepth + half.z + 0.08, halfDepth - half.z - 0.08);
  let y = 0.044 + half.y;
  const candidate = volume([x, y, z], quaternion, size);
  for (const obstacle of obstacles)
    if (footprintsOverlap(candidate, obstacle))
      y = Math.max(y, obstacle.bounds.max.y + half.y + 0.004);
  return new THREE.Vector3(x, y, z);
}
