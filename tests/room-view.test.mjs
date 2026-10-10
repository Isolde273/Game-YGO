import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_ZOOM, ROOM_PHI, clampRoomDistance, roomDropHeight } from '../src/scene/room-view.js';
import * as THREE from '../src/vendor/three.module.js';
import { cardTransform } from '../src/ui/motion/inspector-motion.js';

test('桌面缩放保留拉近范围，远端限制在参考取景，旧存档距离归一化', () => {
  assert.equal(ROOM_ZOOM.max, 23.716);
  for (const value of [90, 10000, undefined, NaN, Infinity])
    assert.equal(clampRoomDistance(value), ROOM_ZOOM.max);
  assert.equal(clampRoomDistance(12), 12);
  assert.equal(clampRoomDistance(-1), 4);
});
test('卡牌透视矩阵准确连接四角，包含平行与倾斜桌面', () => {
  for (const quad of [
    [
      [10, 20],
      [210, 20],
      [210, 320],
      [10, 320],
    ],
    [
      [460, 340],
      [532, 342],
      [559, 395],
      [453, 390],
    ],
    [
      [980, 270],
      [928, 285],
      [895, 345],
      [974, 326],
    ],
  ]) {
    const m = cardTransform(quad, 290, 421).slice(9, -1).split(',').map(Number);
    for (const [i, [x, y]] of [
      [0, 0],
      [290, 0],
      [290, 421],
      [0, 421],
    ].entries()) {
      const w = m[3] * x + m[7] * y + m[15],
        actual = [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
      actual.forEach((v, j) => assert.ok(Math.abs(v - quad[i][j]) < 1e-7));
    }
  }
});

test('物品掉落起点在最远镜头的上边缘之外，覆盖各种位置、尺寸和窗口比例', () => {
  for (const aspect of [0.46, 1, 1.6, 2.4]) {
    const camera = new THREE.PerspectiveCamera(38, aspect, 0.08, 150);
    camera.position.set(
      0,
      0.04 + Math.cos(ROOM_PHI) * ROOM_ZOOM.max,
      Math.sin(ROOM_PHI) * ROOM_ZOOM.max,
    );
    camera.lookAt(0, 0.04, 0);
    camera.updateMatrixWorld();
    for (const z of [-12, -6, 0, 6, 12])
      for (const radius of [0.5, 1.5, 3]) {
        const y = roomDropHeight(z, radius);
        for (const dy of [-radius, 0, radius])
          for (const dz of [-radius, 0, radius]) {
            if (Math.hypot(dy, dz) > radius + 0.001) continue;
            const projected = new THREE.Vector3(0, y + dy, z + dz).project(camera);
            assert.ok(projected.y > 1 || projected.z <= -1 || projected.z >= 1);
          }
      }
  }
});
