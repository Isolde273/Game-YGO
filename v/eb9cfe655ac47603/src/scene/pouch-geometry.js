import * as THREE from '../vendor/three.module.js';
import { SIZES, MODEL_SCALE, PACK_MOUTH, PACK_HOLE, pouchDepth } from './packing.js';

// Registered to the circular hanger opening in the 1024x2048 pack artwork.
export { PACK_HOLE };

function filmFace(strip, cols, rows) {
  const [w, h] = SIZES.pack;
  const bottom = strip ? PACK_MOUTH : -h / 2;
  const top = strip ? h / 2 : PACK_MOUTH;
  const xs = Array.from({ length: cols + 1 }, (_, i) => (i / cols - 0.5) * w);
  const ys = Array.from({ length: rows + 1 }, (_, i) => bottom + ((top - bottom) * i) / rows);
  const { x: cx, y: cy, radius } = PACK_HOLE;
  const left = cx - radius,
    right = cx + radius;
  const low = cy - radius,
    high = cy + radius;
  const hasHole = low > bottom && high < top;
  if (hasHole) {
    xs.push(left, right);
    ys.push(low, high);
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
  }
  const points = ys.flatMap((y) => xs.map((x) => new THREE.Vector2(x, y)));
  const triangles = [];
  for (let iy = 0; iy < ys.length - 1; iy++)
    for (let ix = 0; ix < xs.length - 1; ix++) {
      if (hasHole && xs[ix] >= left && xs[ix + 1] <= right && ys[iy] >= low && ys[iy + 1] <= high)
        continue;
      const a = iy * xs.length + ix,
        b = a + 1,
        c = a + xs.length,
        d = c + 1;
      triangles.push([a, b, d], [a, d, c]);
    }
  let hole = [];
  if (hasHole) {
    // Match the grid along the patch boundary, then triangulate its circular void.
    const contour = [
      ...xs.filter((x) => x >= left && x < right).map((x) => new THREE.Vector2(x, low)),
      ...ys.filter((y) => y >= low && y < high).map((y) => new THREE.Vector2(right, y)),
      ...xs
        .filter((x) => x > left && x <= right)
        .reverse()
        .map((x) => new THREE.Vector2(x, high)),
      ...ys
        .filter((y) => y > low && y <= high)
        .reverse()
        .map((y) => new THREE.Vector2(left, y)),
    ];
    const ring = Array.from({ length: 48 }, (_, i) => {
      const angle = (-i * Math.PI * 2) / 48;
      return new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    });
    const base = points.length;
    points.push(...contour, ...ring);
    triangles.push(
      ...THREE.ShapeUtils.triangulateShape(contour, [ring]).map((t) => t.map((i) => base + i)),
    );
    hole = ring.map((_, i) => base + contour.length + i);
  }
  const sides = [ys.map((_, i) => i * xs.length), ys.map((_, i) => i * xs.length + xs.length - 1)];
  return { points, triangles, sides, lower: strip ? [] : xs.map((_, i) => i), hole };
}

// A welded pillow pouch: four thin film surfaces, rounded side seams and a cut
// mouth. There is no cuboid underneath the artwork and no solid top after tearing.
export function createPouchGeometry(strip = false, resolution = null) {
  const cols = resolution?.cols ?? 32,
    rows = resolution?.rows ?? (strip ? 4 : 38);
  const geometry = new THREE.BufferGeometry();
  const positions = [],
    uvs = [],
    indices = [],
    descriptors = [];
  const [w, h] = SIZES.pack;
  const face = filmFace(strip, cols, rows);
  for (let layer = 0; layer < 4; layer++) {
    const front = layer < 2,
      inside = layer % 2 === 1;
    const start = positions.length / 3;
    for (const { x, y } of face.points) {
      const u = x / w + 0.5;
      descriptors.push({ x, y, front, inside, strip });
      positions.push(x, y, 0);
      uvs.push(front ? u : 1 - u, (y + h / 2) / h);
    }
    const faceStart = indices.length;
    for (const triangle of face.triangles) {
      const reverse = front ? inside : !inside;
      indices.push(...(reverse ? [...triangle].reverse() : triangle).map((i) => start + i));
    }
    geometry.addGroup(faceStart, indices.length - faceStart, inside ? 2 : front ? 0 : 1);
  }
  // Join the side and lower seams, leaving a straight mouth after opening.
  const vertexCount = face.points.length;
  const frontBase = 0,
    backBase = vertexCount * 2;
  const seamStart = indices.length;
  for (const [side, path] of face.sides.entries())
    for (let i = 0; i < path.length - 1; i++) {
      const a = frontBase + path[i],
        b = frontBase + path[i + 1];
      const c = backBase + path[i],
        d = backBase + path[i + 1];
      indices.push(...(side === 0 ? [a, d, c, a, b, d] : [a, c, d, a, d, b]));
    }
  for (let i = 0; i < face.lower.length - 1; i++) {
    const a = face.lower[i],
      b = face.lower[i + 1];
    indices.push(a, backBase + a, backBase + b, a, backBase + b, b);
  }
  for (let i = 0; i < face.hole.length; i++) {
    const a = face.hole[i],
      b = face.hole[(i + 1) % face.hole.length];
    indices.push(a, backBase + a, backBase + b, a, backBase + b, b);
  }
  geometry.addGroup(seamStart, indices.length - seamStart, 2);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData.pouch = descriptors;
  geometry.userData.strip = strip;
  posePouchGeometry(geometry, 0, 0);
  return geometry;
}
export function posePouchGeometry(geometry, mouth = 0, empty = 0) {
  const positions = geometry.attributes.position;
  if (!geometry.attributes.normal)
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3),
    );
  const normals = geometry.attributes.normal,
    delta = 0.0025 * MODEL_SCALE,
    layerSize = positions.count / 4;
  const depth = (x, y) =>
    pouchDepth(x, y, geometry.userData.strip ? 0 : mouth, geometry.userData.strip ? 0 : empty);
  geometry.userData.pouch.forEach((p, i) => {
    let half = p.strip ? pouchDepth(p.x, p.y, 0) : pouchDepth(p.x, p.y, mouth, empty);
    const x = p.x / MODEL_SCALE,
      y = p.y / MODEL_SCALE;
    const edge = Math.max(0, Math.min(1, (Math.abs(x) - 0.285) / 0.065));
    const crimp = Math.abs(y) > 0.635 ? 0.00023 * Math.cos(x * 570) * MODEL_SCALE : 0;
    const wrinkle = 0.0012 * Math.sin(y * 82 + x * 113) * edge * MODEL_SCALE;
    half = Math.max(0.0008 * MODEL_SCALE, half + wrinkle + crimp);
    if (p.inside) half -= 0.00045 * MODEL_SCALE;
    positions.setXYZ(i, p.x, p.y, (p.front ? 1 : -1) * half);
    // Lighting follows the smooth pillow, not subpixel crimp triangles. The
    // same continuous normal is used by sealed instances and opening models.
    if (i < layerSize) {
      const dx = (depth(p.x + delta, p.y) - depth(p.x - delta, p.y)) / (2 * delta),
        dy = (depth(p.x, p.y + delta) - depth(p.x, p.y - delta)) / (2 * delta),
        length = Math.hypot(dx, dy, 1);
      normals.setXYZ(i, -dx / length, -dy / length, 1 / length);
    } else {
      const base = i % layerSize,
        sign = p.inside ? -1 : 1;
      normals.setXYZ(
        i,
        normals.getX(base) * sign,
        normals.getY(base) * sign,
        normals.getZ(base) * (p.front ? 1 : -1) * sign,
      );
    }
  });
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}
