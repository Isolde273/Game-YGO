// Share a small preparation budget between the room and DOM card renderer.
// The timer after rAF lets the current animation frame present before uploads.
const tasks = [];
let scheduled = false;
let submitted = 0;
let completed = 0;
let maxTurnMs = 0;
let interactionUntil = 0;
if (typeof window !== 'undefined') {
  const defer = () => {
    interactionUntil = performance.now() + 150;
  };
  for (const name of ['pointerdown', 'wheel', 'keydown'])
    window.addEventListener(name, defer, { passive: true });
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.buttons) defer();
    },
    { passive: true },
  );
}

export function backgroundResourcesAllowed() {
  if (typeof document === 'undefined') return true;
  if (performance.now() < interactionUntil) return false;
  return !document.querySelector(
    'canvas[data-opening],.card-inspector:not([data-phase="open"]):not([data-phase="entering"]),.inspect-card.dragging,.album-drag-ghost,#page-transition:not([hidden])',
  );
}

function schedule() {
  if (scheduled || !tasks.length) return;
  scheduled = true;
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() => setTimeout(flush, 0));
  else setTimeout(flush, 0);
}

function flush() {
  scheduled = false;
  const start = performance.now();
  const spreading =
    typeof document !== 'undefined' &&
    !!document.querySelector('.card-inspector[data-phase="entering"]');
  const limit = spreading ? 1 : 2;
  const budgetMs = spreading ? 2 : 4;
  let count = 0;
  for (let index = tasks.length - 1; index >= 0; index--) {
    if (!tasks[index].valid()) tasks.splice(index, 1)[0].resolve(false);
  }
  while (tasks.length && count < limit && performance.now() - start < budgetMs) {
    tasks.sort((a, b) => b.priority() - a.priority() || a.order - b.order);
    if (tasks[0].priority() <= 0 && !backgroundResourcesAllowed()) break;
    const job = tasks.shift();
    if (!job.valid()) {
      job.resolve(false);
      continue;
    }
    try {
      job.resolve(job.run());
    } catch (error) {
      job.reject(error);
    }
    completed++;
    count++;
  }
  maxTurnMs = Math.max(maxTurnMs, performance.now() - start);
  schedule();
}

export function scheduleResourceTask(run, { priority = 2, valid = () => true } = {}) {
  return new Promise((resolve, reject) => {
    tasks.push({
      run,
      valid,
      priority: typeof priority === 'function' ? priority : () => priority,
      order: submitted++,
      resolve,
      reject,
    });
    schedule();
  });
}

export function resourceSchedulerStats() {
  return { pending: tasks.length, submitted, completed, maxTurnMs };
}
