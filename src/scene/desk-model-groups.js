// Only physical objects used by gameplay belong in the opening space.
export const DESK_MODEL_GROUPS = Object.freeze([
  'Desk',
  'Mat',
  'Floor',
  'Binder',
  'BinderCover',
  'Warehouse',
  'WarehouseFlapFront',
  'WarehouseFlapBack',
  'PhonePad',
  'Phone',
]);

export const FLOOR_MATERIAL = 'Floor charcoal tile';

export function gameplayColliders(colliders) {
  return colliders.filter((collider) => DESK_MODEL_GROUPS.includes(collider.group));
}
