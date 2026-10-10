import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/three.module.js';
import {
  volume,
  volumesOverlap,
  surfacePosition,
  footprintsOverlap,
} from '../src/scene/tabletop.js';

const identity = [0, 0, 0, 1],
  flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
test('体积碰撞区分垂直堆叠与穿透', () => {
  const lower = volume([0, 1.044, 0], identity, [2, 2, 2]);
  const target = surfacePosition(new THREE.Vector3(0, 0, 0), [1, 1, 1], identity, [lower], 8, 6),
    upper = volume(target, identity, [1, 1, 1]);
  assert.ok(target.y > 2.54 && target.y < 2.56);
  assert.equal(volumesOverlap(lower, upper), false);
  assert.equal(footprintsOverlap(lower, upper), true);
  assert.equal(volumesOverlap(lower, volume([0, 1.8, 0], identity, [1, 1, 1])), true);
});
test('旋转体积采用分离轴判断，避免轴对齐包围盒的误碰撞', () => {
  const q = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)
    .toArray();
  const a = volume([0, 1, 0], q, [3, 1, 0.15]),
    b = volume([0.6, 1, 0.6], q, [3, 1, 0.15]);
  assert.equal(a.bounds.intersectsBox(b.bounds), true);
  assert.equal(volumesOverlap(a, b), false);
  assert.equal(footprintsOverlap(a, b), false);
});
test('卡包和卡堆按平放后的真实厚度放置，朝向保持不变', () => {
  const base = volume([0, 0.147, 0], flat, [0.59, 0.86, 0.205]);
  const p = surfacePosition(new THREE.Vector3(0, 4, 0), [0.7, 1.4, 0.052], flat, [base], 8, 6);
  assert.ok(Math.abs(p.y - (0.147 + 0.205 / 2 + 0.052 / 2 + 0.004)) < 1e-8);
  assert.equal(volumesOverlap(base, volume(p, flat, [0.7, 1.4, 0.052])), false);
  const clear = surfacePosition(new THREE.Vector3(4, 3, 3), [0.7, 1.4, 0.052], flat, [base], 8, 6);
  assert.ok(Math.abs(clear.y - 0.07) < 1e-8);
});
test('整个旋转体积被限制在桌面内，放置不改变输入状态', () => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7).toArray(),
    original = [...q],
    position = new THREE.Vector3(100, 4, -100);
  const p = surfacePosition(position, [2.72, 1.72, 2.96], q, [], 8, 6),
    box = volume(p, q, [2.72, 1.72, 2.96]);
  assert.ok(box.bounds.max.x <= 8 && box.bounds.min.z >= -6);
  assert.deepEqual(q, original);
  assert.equal(position.x, 100);
});
