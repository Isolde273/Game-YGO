// Packaging explicitly opts the website into a smaller resource budget.
// Source and native rendering retain their original settings.
export const FAST_WEB =
  typeof document !== 'undefined' && document.documentElement.dataset.webPerformance === 'fast';
export const roomPixelRatio = (ratio) => (FAST_WEB ? Math.min(0.85, ratio) : ratio);
