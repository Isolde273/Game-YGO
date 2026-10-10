import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_PAD,
  CARD_PAD_QUATERNION,
  cardPadBounds,
  findCardPadPosition,
  createCardPad,
} from '../src/scene/card-pad.js';
import * as THREE from '../src/vendor/three.module.js';
import * as CANNON from '../src/vendor/cannon-es.js';
import {
  SIZES,
  BASE_SIZES,
  MODEL_SCALE,
  CARD_SIZE,
  CARD_STEP,
  PACK_STEP,
  caseSlots,
  cardSlots,
} from '../src/scene/packing.js';
import { volume, volumesOverlap } from '../src/scene/tabletop.js';
import { planDeskLayout } from '../src/scene/desk-layout.js';
const shape = (p, count) =>
  volume(p, CARD_PAD_QUATERNION, [CARD_SIZE[0], CARD_SIZE[1], count * CARD_STEP]);
test('all packages, cards, slot spacing and physical thickness scale uniformly by 1.5', () => {
  assert.equal(MODEL_SCALE, 1.5);
  for (const kind of ['case', 'box', 'pack'])
    assert.deepEqual(
      SIZES[kind],
      BASE_SIZES[kind].map((v) => v * 1.5),
    );
  assert.deepEqual(
    CARD_SIZE,
    [0.59, 0.86, 0.0036].map((v) => v * 1.5),
  );
  assert.equal(PACK_STEP, 0.054 * 1.5);
  assert.equal(cardSlots()[3][2] - cardSlots()[0][2], 3 * CARD_STEP);
  assert.equal(caseSlots().length, 24);
});
test('card pad fills free cells before piling, with all output inside its surface', () => {
  const stackVolumes = [],
    bounds = cardPadBounds();
  let piled = false;
  for (let i = 0; i < 26; i++) {
    const p = findCardPadPosition(50, stackVolumes),
      v = shape(p, 50);
    assert.ok(p);
    assert.ok(v.bounds.min.y > CARD_PAD.top);
    assert.ok(
      v.bounds.min.x >= bounds.x0 &&
        v.bounds.max.x <= bounds.x1 &&
        v.bounds.min.z >= bounds.z0 &&
        v.bounds.max.z <= bounds.z1,
    );
    assert.ok(stackVolumes.every((o) => !volumesOverlap(v, o)));
    piled ||= v.bounds.min.y > CARD_PAD.top + 0.1;
    stackVolumes.push(v);
  }
  assert.equal(piled, true);
});
test('card pad refuses blocked output without modifying reservations', () => {
  const blockers = [
      volume([CARD_PAD.x, 2, CARD_PAD.z], [0, 0, 0, 1], [CARD_PAD.width, 4, CARD_PAD.depth]),
    ],
    stacks = [];
  assert.equal(findCardPadPosition(10, stacks, blockers), null);
  assert.deepEqual(stacks, []);
});
test('tidy reserves the white pad for cards and keeps packages outside', () => {
  const entries = [
      { id: 'case', kind: 'case', size: SIZES.case },
      { id: 'box', kind: 'box', size: SIZES.box },
      { id: 'pack', kind: 'pack', size: [SIZES.pack[0], SIZES.pack[2], SIZES.pack[1]] },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `cards${i}`,
        kind: 'cards',
        size: [CARD_SIZE[0], 50 * CARD_STEP, CARD_SIZE[1]],
      })),
    ],
    zone = { ...cardPadBounds(), top: CARD_PAD.top },
    plan = planDeskLayout(entries, [], 12, 8.64, { cardZone: zone });
  assert.ok(plan);
  for (const p of plan) {
    const e = entries.find((e) => e.id === p.id),
      x = p.position[0],
      z = p.position[2];
    if (e.kind === 'cards')
      assert.ok(
        x - e.size[0] / 2 >= zone.x0 &&
          x + e.size[0] / 2 <= zone.x1 &&
          z - e.size[2] / 2 >= zone.z0 &&
          z + e.size[2] / 2 <= zone.z1 &&
          p.position[1] - e.size[1] / 2 >= zone.top,
      );
    else
      assert.ok(
        x + e.size[0] / 2 <= zone.x0 ||
          x - e.size[0] / 2 >= zone.x1 ||
          z + e.size[2] / 2 <= zone.z0 ||
          z - e.size[2] / 2 >= zone.z1,
      );
  }
});
test('white pad collider matches the model and releases all scene and physics resources', () => {
  const scene = new THREE.Scene(),
    physics = new CANNON.World(),
    pad = createCardPad(scene, physics),
    bounds = new THREE.Box3().setFromObject(pad.root),
    disposed = new Set();
  assert.ok(
    Math.abs(bounds.min.y - CARD_PAD.bottom) < 1e-6 && Math.abs(bounds.max.y - CARD_PAD.top) < 1e-6,
  );
  assert.equal(pad.body.shapes[0].halfExtents.x, CARD_PAD.width / 2);
  for (const mesh of [pad.root, ...pad.root.children])
    for (const r of [mesh.geometry, mesh.material])
      r.addEventListener('dispose', () => disposed.add(r));
  pad.dispose();
  assert.equal(disposed.size, 4);
  assert.equal(scene.children.length, 0);
  assert.equal(physics.bodies.length, 0);
});
