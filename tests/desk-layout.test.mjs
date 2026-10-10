import test from 'node:test';
import assert from 'node:assert/strict';
import { planDeskLayout, tidyQuaternion } from '../src/scene/desk-layout.js';

const item = (id, kind, size, offset) => ({ id, kind, size, offset });
const bounds = (p, e) => {
  const o = e.offset ?? [0, 0, 0],
    c = p.position.map((v, i) => v + o[i]);
  return { min: c.map((v, i) => v - e.size[i] / 2), max: c.map((v, i) => v + e.size[i] / 2) };
};
function verify(entries, obstacles, w, d) {
  const copy = structuredClone(entries),
    plan = planDeskLayout(entries, obstacles, w, d);
  assert.ok(plan);
  assert.equal(plan.length, entries.length);
  assert.equal(new Set(plan.map((p) => p.id)).size, entries.length);
  const boxes = plan.map((p) =>
    bounds(
      p,
      entries.find((e) => e.id === p.id),
    ),
  );
  for (const b of boxes) {
    assert.ok(b.min[0] >= -w && b.max[0] <= w && b.min[2] >= -d && b.max[2] <= d);
    assert.ok(b.min[1] >= 0.0439 && b.max[1] <= 5.55);
    for (const o of obstacles)
      assert.ok(b.max[0] <= o.x0 || b.min[0] >= o.x1 || b.max[2] <= o.z0 || b.min[2] >= o.z1);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      assert.ok(
        boxes[i].min.some((v, k) => v >= boxes[j].max[k] || boxes[i].max[k] <= boxes[j].min[k]),
        `overlap ${i}, ${j}`,
      );
  assert.deepEqual(entries, copy);
  assert.deepEqual(planDeskLayout(entries, obstacles, w, d), plan);
  return plan;
}
test('mixed inventory avoids props and preserves opened carton envelope', () => {
  const entries = [
    item('carton', 'container', [6, 1.76, 7], [0, 0.02, -0.6]),
    item('case', 'case', [2.72, 1.72, 2.96]),
    ...Array.from({ length: 18 }, (_, i) => item(`box${i}`, 'box', [0.78, 1.52, 0.66])),
    ...Array.from({ length: 128 }, (_, i) => item(`pack${i}`, 'pack', [0.7, 0.052, 1.4])),
    ...Array.from({ length: 6 }, (_, i) => item(`cards${i}`, 'cards', [0.59, 0.205, 0.86])),
  ];
  const obstacles = [
    { x0: -9.7, x1: -7, z0: -6, z1: -1 },
    { x0: 7, x1: 9.7, z0: -6, z1: 1 },
    { x0: -2, x1: 2, z0: 5, z1: 7 },
  ];
  verify(entries, obstacles, 9.8, 7.056);
});
test('tight desk piles equal footprints without collisions or excessive height', () => {
  const entries = [
    ...Array.from({ length: 40 }, (_, i) => item(`p${i}`, 'pack', [0.7, 0.052, 1.4])),
    ...Array.from({ length: 8 }, (_, i) => item(`b${i}`, 'box', [0.78, 1.52, 0.66])),
  ];
  const plan = verify(entries, [], 2, 2);
  assert.ok(plan.some((p) => p.position[1] > 0.2));
});
test('failed layout is transactional, empty inventory is safe', () => {
  const entries = [item('too-big', 'container', [20, 2, 20])],
    copy = structuredClone(entries);
  assert.equal(planDeskLayout(entries, [], 2, 2), null);
  assert.deepEqual(entries, copy);
  assert.deepEqual(planDeskLayout([], [], 2, 2), []);
});
test('packs and cards lie face-up while boxes remain upright', () => {
  assert.deepEqual(tidyQuaternion('pack'), [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  assert.deepEqual(tidyQuaternion('cards'), tidyQuaternion('pack'));
  assert.deepEqual(tidyQuaternion('box'), [0, 0, 0, 1]);
});
