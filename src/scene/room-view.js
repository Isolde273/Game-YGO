// Reference framing: the original 9.8-unit room at its default front camera.
export const ROOM_ZOOM = { min: 4, max: 9.8 * 2.42 };
export const ROOM_PHI = 0.18;
export function roomDropHeight(z, radius, { phi = ROOM_PHI, fov = 38, targetY = 0.04 } = {}) {
  const halfFov = (fov * Math.PI) / 360;
  const tangent = Math.tan(halfFov);
  return (
    targetY +
    (ROOM_ZOOM.max * tangent +
      z * (Math.cos(phi) - Math.sin(phi) * tangent) +
      (radius + 0.35) / Math.cos(halfFov)) /
      (Math.sin(phi) + Math.cos(phi) * tangent)
  );
}
export const clampRoomDistance = (distance) =>
  Number.isFinite(distance)
    ? Math.max(ROOM_ZOOM.min, Math.min(ROOM_ZOOM.max, distance))
    : ROOM_ZOOM.max;
