import { quoteIncome } from './wallet.js';
export const WORK_REWARD = 1000;
export const WORK_COOLDOWN = 1000;

export function workCooldown(state, now = Date.now()) {
  return Math.max(0, (state.workReadyAt ?? 0) - now);
}

export function performWork(state, now = Date.now()) {
  if (workCooldown(state, now) > 0) throw new Error('打工冷却中');
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + WORK_COOLDOWN) ||
    Number.isNaN(new Date(now).valueOf())
  )
    throw new Error('时间不正确');
  Object.assign(state, quoteIncome(state, WORK_REWARD));
  state.workReadyAt = now + WORK_COOLDOWN;
  state.history.unshift({ text: `打工 · ＋${WORK_REWARD}`, date: new Date(now).toISOString() });
  state.history = state.history.slice(0, 60);
  return WORK_REWARD;
}
