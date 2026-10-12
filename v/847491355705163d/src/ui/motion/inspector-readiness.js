// Ready cards form a contiguous prefix from the physical top of the stack.
export function createInspectorReadiness(total) {
  let count = 0;
  const listeners = new Set();
  const advance = (next) => {
    const value = Math.min(total, Math.max(count, next));
    if (value === count) return;
    count = value;
    for (const listener of [...listeners]) listener(count);
  };
  return {
    total,
    count: () => count,
    fraction: () => (total > 1 ? Math.max(0, count - 1) / (total - 1) : 1),
    advance,
    finish: () => advance(total),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    wait(minimum) {
      if (count >= Math.min(total, minimum)) return Promise.resolve(count);
      return new Promise((resolve) => {
        const unsubscribe = this.subscribe((value) => {
          if (value >= Math.min(total, minimum)) {
            unsubscribe();
            resolve(value);
          }
        });
      });
    },
  };
}
