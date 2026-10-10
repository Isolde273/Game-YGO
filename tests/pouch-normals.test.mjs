import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPouchGeometry, posePouchGeometry, PACK_HOLE } from '../src/scene/pouch-geometry.js';
import * as THREE from '../src/vendor/three.module.js';
import { SIZES, PACK_MOUTH } from '../src/scene/packing.js';

test('sealed and opening pouches keep the same lighting across the model handoff', () => {
  for (const strip of [false, true]) {
    const sealed = createPouchGeometry(strip, { cols: 12, rows: strip ? 2 : 18 }),
      opening = createPouchGeometry(strip);
    for (const progress of [0, 0.4, 1]) {
      posePouchGeometry(sealed, progress, 0);
      posePouchGeometry(opening, progress, 0);
      for (let layer = 0; layer < 4; layer++)
        for (const u of [0, 0.25, 0.5, 0.75, 1])
          for (const v of [0, 0.5, 1]) {
            const bottom = strip ? PACK_MOUTH : -SIZES.pack[1] / 2,
              top = strip ? SIZES.pack[1] / 2 : PACK_MOUTH;
            const descriptor = opening.userData.pouch.find(
              (p) =>
                p.front === layer < 2 &&
                p.inside === (layer % 2 === 1) &&
                Math.abs(p.x - (u - 0.5) * SIZES.pack[0]) < 1e-6 &&
                Math.abs(p.y - (bottom + (top - bottom) * v)) < 1e-6,
            );
            const find = (geometry) =>
              geometry.userData.pouch.findIndex(
                (p) =>
                  p.front === descriptor.front &&
                  p.inside === descriptor.inside &&
                  Math.abs(p.x - descriptor.x) < 1e-6 &&
                  Math.abs(p.y - descriptor.y) < 1e-6,
              );
            const small = find(sealed),
              large = find(opening);
            assert.ok(small >= 0 && large >= 0);
            const a = sealed.attributes.normal,
              b = opening.attributes.normal;
            for (const get of ['getX', 'getY', 'getZ'])
              assert.ok(Math.abs(a[get](small) - b[get](large)) < 1e-6);
            assert.ok(Math.abs(Math.hypot(a.getX(small), a.getY(small), a.getZ(small)) - 1) < 1e-6);
          }
    }
    sealed.dispose();
    opening.dispose();
  }
});

test('hanger hole stays open through all four film layers and opening poses', () => {
  assert.ok(PACK_MOUTH < PACK_HOLE.y - PACK_HOLE.radius);
  for (const resolution of [null, { cols: 12, rows: 18 }]) {
    const geometry = createPouchGeometry(true, resolution);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();
    for (const progress of [0, 0.4, 1])
      for (const empty of [0, 1]) {
        posePouchGeometry(geometry, progress, empty);
        mesh.updateMatrixWorld(true);
        for (const direction of [-1, 1])
          for (const offset of [0, 0.5, 0.9]) {
            ray.set(
              new THREE.Vector3(
                PACK_HOLE.x + PACK_HOLE.radius * offset,
                PACK_HOLE.y,
                direction * 10,
              ),
              new THREE.Vector3(0, 0, -direction),
            );
            assert.equal(
              ray.intersectObject(mesh).length,
              0,
              'front/back rays must pass through the opening',
            );
          }
        ray.set(
          new THREE.Vector3(PACK_HOLE.x + PACK_HOLE.radius * 1.1, PACK_HOLE.y, 10),
          new THREE.Vector3(0, 0, -1),
        );
        assert.ok(
          ray.intersectObject(mesh).length > 0,
          'film immediately outside the hole remains present',
        );
      }
    geometry.dispose();
    mesh.material.dispose();
  }
});

test('body and tear strip meet below the hole without overlap or missing film', () => {
  for (const resolution of [null, { cols: 12, rows: 18 }]) {
    const body = createPouchGeometry(false, resolution),
      strip = createPouchGeometry(true, resolution);
    const bodyYs = body.userData.pouch.map((p) => p.y),
      stripYs = strip.userData.pouch.map((p) => p.y);
    assert.ok(Math.abs(Math.max(...bodyYs) - PACK_MOUTH) < 1e-12);
    assert.ok(Math.abs(Math.min(...stripYs) - PACK_MOUTH) < 1e-12);
    for (const x of [-0.5, 0, 0.5]) {
      const a = body.userData.pouch.findIndex(
        (p) =>
          p.front &&
          !p.inside &&
          Math.abs(p.x - x * SIZES.pack[0]) < 1e-12 &&
          Math.abs(p.y - PACK_MOUTH) < 1e-12,
      );
      const b = strip.userData.pouch.findIndex(
        (p) =>
          p.front &&
          !p.inside &&
          Math.abs(p.x - x * SIZES.pack[0]) < 1e-12 &&
          Math.abs(p.y - PACK_MOUTH) < 1e-12,
      );
      // The shared endpoints are present at every mesh resolution.
      assert.ok(a >= 0 && b >= 0);
      for (const get of ['getX', 'getY', 'getZ'])
        assert.equal(body.attributes.position[get](a), strip.attributes.position[get](b));
    }
    body.dispose();
    strip.dispose();
  }
});
