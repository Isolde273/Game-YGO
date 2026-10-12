// Only physical objects used by gameplay belong in the opening space.
export const DESK_MODEL_GROUPS = Object.freeze([
  'Desk',
  'Mat',
  'Binder',
  'BinderCover',
  'Warehouse',
  'WarehouseFlapFront',
  'WarehouseFlapBack',
  'PhonePad',
  'Phone',
]);

export function gameplayColliders(colliders) {
  return colliders.filter((collider) => DESK_MODEL_GROUPS.includes(collider.group));
}
