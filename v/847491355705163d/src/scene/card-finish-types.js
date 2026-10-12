// Keep 0–6 stable for existing LOCR/LOSP data and sealed saves.
export const CARD_FINISH_KINDS = Object.freeze({
  SR: 0,
  UR: 1,
  SER: 2,
  UL: 3,
  CR: 4,
  PSER: 5,
  GMR: 6,
  N: 7,
  NR: 7,
  R: 8,
});

export function cardFinishKind(data) {
  // Ordinary printing and rare silver names never inherit a foil template.
  if (['N', 'NR', 'R'].includes(data.rarity)) return CARD_FINISH_KINDS[data.rarity];
  const kind = data.kind ?? CARD_FINISH_KINDS[data.rarity];
  if (!Number.isInteger(kind) || kind < 0 || kind > 8)
    throw new Error(`Unsupported card finish: ${data.rarity}`);
  return kind;
}
