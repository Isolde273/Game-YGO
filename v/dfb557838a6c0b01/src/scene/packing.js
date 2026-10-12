// Every physical dimension and content slot uses the same model scale.
export const MODEL_SCALE = 1.5;
export const BASE_SIZES = {
  case: [5.05, 1.72, 3.95],
  box: [0.78, 1.52, 0.9],
  pack: [0.7, 1.4, 0.052],
  bonus: [0.7, 1.4, 0.052],
};
export const BASE_WALL = { case: 0.024, box: 0.008 };
export const SIZES = Object.fromEntries(
  Object.entries(BASE_SIZES).map(([kind, size]) => [kind, size.map((v) => v * MODEL_SCALE)]),
);
export const CARD_SIZE = [0.59, 0.86, 0.0036].map((v) => v * MODEL_SCALE);
export const CARD_PAPER = 0.0028 * MODEL_SCALE;
export const CARD_STEP = 0.0041 * MODEL_SCALE;
export const PACK_STEP = 0.054 * MODEL_SCALE;
export const WALL = { case: BASE_WALL.case * MODEL_SCALE, box: BASE_WALL.box * MODEL_SCALE };
// Keep the tear line below the hanger hole, including a small film margin.
export const PACK_HOLE = {
  x: (127.5 / 256 - 0.5) * SIZES.pack[0],
  y: (0.5 - 50.5 / 512) * SIZES.pack[1],
  radius: 0.038 * MODEL_SCALE,
};
export const PACK_MOUTH = PACK_HOLE.y - PACK_HOLE.radius - 0.018 * MODEL_SCALE;
export const PACK_CARD_Y = -0.055 * MODEL_SCALE;
export const WITHDRAW_CARD = 1.24 * MODEL_SCALE;
export const WITHDRAW_PACK = 1.56 * MODEL_SCALE;
export const CASE_FLAP_ANGLE = (Math.PI * 3) / 2;
export const BOX_FLAP_ANGLE = 2.15;
export const smooth = (value, a = 0, b = 1) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const caseSlots = () =>
  Array.from({ length: 24 }, (_, i) => [
    ((i % 6) - 2.5) * (SIZES.box[0] + 0.055 * MODEL_SCALE),
    -SIZES.case[1] / 2 + WALL.case + SIZES.box[1] / 2 + 0.018 * MODEL_SCALE,
    (Math.floor(i / 6) - 1.5) * (SIZES.box[2] + 0.05 * MODEL_SCALE),
  ]);
export const boxSlots = () =>
  Array.from({ length: 15 }, (_, i) => [0, -0.036 * MODEL_SCALE, (i - 7) * PACK_STEP]);
export const cardSlots = (count = 4) =>
  Array.from({ length: count }, (_, i) => [0, PACK_CARD_Y, (i - (count - 1) / 2) * CARD_STEP]);
export const tabletopPacks = () =>
  Array.from({ length: 15 }, (_, i) => [0, 0, (i - 7) * PACK_STEP]);
export const tableCards = (i, count) => [0, 0, (i - (count - 1) / 2) * CARD_STEP];
export function pouchDepth(x, y, mouth = 0, empty = 0) {
  x /= MODEL_SCALE;
  y /= MODEL_SCALE;
  const half = BASE_SIZES.pack[0] / 2;
  const side = 1 - smooth(Math.abs(x), half - 0.03, half);
  const neck =
    1 -
    smooth(
      Math.abs(y),
      y > 0 ? PACK_MOUTH / MODEL_SCALE - 0.112 : 0.515,
      y > 0 ? PACK_MOUTH / MODEL_SCALE : BASE_SIZES.pack[1] / 2 - 0.025,
    );
  // The whole shoulder unfolds before cards cross it, leaving a full-width mouth.
  const opening = mouth * smooth(y, 0.4, 0.5);
  const thickness = 0.0009 + (0.024 - 0.0009) * side * Math.max(neck, opening);
  return thickness * (1 - empty * 0.76) * MODEL_SCALE;
}
export function cartonPose(progress) {
  const outer = smooth(progress, 0.18, 0.48),
    inner = smooth(progress, 0.52, 0.95);
  // Open the two outer flaps completely before moving the two inner flaps.
  return {
    peel: smooth(progress, 0, 0.17),
    angles: [
      inner * CASE_FLAP_ANGLE,
      -inner * CASE_FLAP_ANGLE,
      outer * CASE_FLAP_ANGLE,
      -outer * CASE_FLAP_ANGLE,
    ],
  };
}
export function boxPose(progress) {
  const lid = smooth(progress, 0.08, 0.51) * BOX_FLAP_ANGLE;
  const tabs = smooth(progress, 0.6, 0.95) * BOX_FLAP_ANGLE;
  const tuck = lid < 0.28 ? lid : lid + smooth(lid, 0.28, 0.75) * (Math.PI / 2 - lid);
  return { lid: -lid, tabs: [tabs, -tabs], tuck, wrap: 1 - smooth(progress, 0, 0.075) };
}
export function packPose(progress) {
  const detach = smooth(progress, 0, 0.34),
    peel = smooth(progress, 0.35, 0.9);
  return {
    strip: [1.08 * peel, 0.105 * detach + 0.33 * peel, 0.12 * peel].map((v) => v * MODEL_SCALE),
    stripAngle: 0.45 * peel,
    mouth: smooth(progress, 0.4, 0.98),
  };
}
