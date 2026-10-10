import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomQuality } from '../src/scene/room-quality.js';
test('GPU frame delivery adapts supersampling while preserving native pixels, idle gaps do not', () => {
  const q = new RoomQuality(1920, 1080, 1.5),
    initial = q.ratio;
  for (let i = 0; i < 20; i++) assert.equal(q.observe(1200), false);
  assert.equal(q.ratio, initial);
  for (let i = 0; i < 20; i++) q.observe(40);
  assert.ok(q.ratio < initial);
  assert.ok(q.ratio >= 1);
  for (let i = 0; i < 120; i++) q.observe(100);
  assert.equal(q.ratio, 1);
});
test('healthy delivery restores resolution gradually within pixel budget', () => {
  const q = new RoomQuality(1440, 900, 2);
  for (let i = 0; i < 30; i++) q.observe(40);
  const low = q.ratio;
  for (let i = 0; i < 210; i++) q.observe(16.7);
  assert.ok(q.ratio > low);
  assert.ok(q.ratio <= q.ceiling && q.ratio <= 2);
});
test('resize clamps immediately and preserves learned quality on smaller viewports', () => {
  const q = new RoomQuality(800, 600, 2);
  assert.equal(q.ratio, 2);
  assert.equal(q.resize(3840, 2160, 2), true);
  assert.ok(q.ratio >= 1);
  const lower = q.ratio;
  assert.equal(q.resize(800, 600, 2), false);
  assert.equal(q.ratio, lower);
  assert.equal(q.ceiling, 2);
});
test('settled rooms restore full clarity without waiting for more moving frames', () => {
  const q = new RoomQuality(1440, 900, 2);
  for (let i = 0; i < 30; i++) q.observe(80);
  assert.equal(q.ratio, 1);
  assert.equal(q.restore(), true);
  assert.equal(q.ratio, 2);
  assert.equal(q.restore(), false);
});
