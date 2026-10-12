import { SAVE_KEY, SAVE_VERSION, LEGACY_BACKUP_KEY, freshState, validateState } from './model.js';
import { hasLegacyPlaceholders, retireLegacyPlaceholders } from './card-inventory.js';
export const PLACEHOLDER_BACKUP_KEY = 'ygo-duel-archive-placeholder-backup';

export function readStoredState(storage) {
  const raw = storage.getItem(SAVE_KEY);
  return raw ? retireLegacyPlaceholders(validateState(JSON.parse(raw))) : freshState();
}

export function writeStoredState(storage, state) {
  const previous = storage.getItem(SAVE_KEY);
  if (previous) {
    let version;
    let prior;
    try {
      prior = JSON.parse(previous);
      version = prior.version;
    } catch {
      version = 1;
    }
    // If this write fails, leave the original save intact and report the failure.
    const backupKey = version === 1 ? LEGACY_BACKUP_KEY : `ygo-duel-archive-v${version}-backup`;
    if (
      Number.isInteger(version) &&
      version >= 1 &&
      version < SAVE_VERSION &&
      !storage.getItem(backupKey)
    )
      storage.setItem(backupKey, previous);
    if (
      hasLegacyPlaceholders(prior ?? {}) &&
      !hasLegacyPlaceholders(state) &&
      !storage.getItem(PLACEHOLDER_BACKUP_KEY)
    )
      storage.setItem(PLACEHOLDER_BACKUP_KEY, previous);
  }
  storage.setItem(SAVE_KEY, JSON.stringify(state));
}
