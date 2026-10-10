import * as THREE from '../vendor/three.module.js';
import * as CANNON from '../vendor/cannon-es.js';
import { CARD_SIZE, CARD_STEP } from './packing.js';
import { volume, footprintsOverlap, volumesOverlap } from './tabletop.js';

export const CARD_PAD = { x: 0, z: 1.35, width: 5.8, depth: 3.8, bottom: 0.044, top: 0.084 };
export const CARD_PAD_QUATERNION = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
export const cardPadBounds = () => ({
  x0: CARD_PAD.x - CARD_PAD.width / 2,
  x1: CARD_PAD.x + CARD_PAD.width / 2,
  z0: CARD_PAD.z - CARD_PAD.depth / 2,
  z1: CARD_PAD.z + CARD_PAD.depth / 2,
});

// Reserve output before consuming packs. Prefer a free cell; pile only cards.
export function findCardPadPosition(count, stacks = [], obstacles = []) {
  const size = [CARD_SIZE[0], CARD_SIZE[1], count * CARD_STEP],
    q = CARD_PAD_QUATERNION,
    bounds = cardPadBounds(),
    gap = 0.18;
  const cols = Math.floor((CARD_PAD.width - 0.24) / (CARD_SIZE[0] + gap)),
    rows = Math.floor((CARD_PAD.depth - 0.24) / (CARD_SIZE[1] + gap)),
    candidates = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const x = CARD_PAD.x + (col - (cols - 1) / 2) * (CARD_SIZE[0] + gap),
        z = CARD_PAD.z + ((rows - 1) / 2 - row) * (CARD_SIZE[1] + gap);
      const probe = volume([x, 0, z], q, size);
      let y = CARD_PAD.top + size[2] / 2 + 0.004;
      for (const s of stacks)
        if (footprintsOverlap(probe, s)) y = Math.max(y, s.bounds.max.y + size[2] / 2 + 0.004);
      const v = volume([x, y, z], q, size);
      if (
        v.bounds.max.y > 5.5 ||
        v.bounds.min.x < bounds.x0 ||
        v.bounds.max.x > bounds.x1 ||
        v.bounds.min.z < bounds.z0 ||
        v.bounds.max.z > bounds.z1 ||
        obstacles.some((o) => volumesOverlap(v, o))
      )
        continue;
      candidates.push({ position: [x, y, z], height: y, row, col });
    }
  candidates.sort((a, b) => a.height - b.height || a.row - b.row || a.col - b.col);
  return candidates[0]?.position ?? null;
}

export function createCardPad(scene, physics) {
  const { width, depth, bottom, top, x, z } = CARD_PAD,
    height = top - bottom;
  const geometry = new THREE.BoxGeometry(width, height, depth),
    material = new THREE.MeshStandardMaterial({ color: '#fafaf5', roughness: 0.96, metalness: 0 });
  const root = new THREE.Mesh(geometry, material);
  root.name = 'white-card-pad';
  root.position.set(x, (bottom + top) / 2, z);
  root.receiveShadow = true;
  scene.add(root);
  const edgeGeometry = new THREE.EdgesGeometry(geometry),
    edgeMaterial = new THREE.LineBasicMaterial({ color: '#d7dcdf' }),
    edge = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  root.add(edge);
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)),
  });
  body.position.copy(root.position);
  physics.addBody(body);
  return {
    root,
    body,
    dispose() {
      scene.remove(root);
      physics.removeBody(body);
      geometry.dispose();
      material.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
    },
  };
}
