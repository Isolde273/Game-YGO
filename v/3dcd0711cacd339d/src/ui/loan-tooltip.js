import { loanLimitLabel } from './pages/shared.js';

export function createLoanTooltip({ getState, enabled }) {
  const tooltip = document.createElement('div');
  tooltip.id = 'loan-tooltip';
  tooltip.className = 'loan-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let target = null;

  function hide() {
    target?.removeAttribute('aria-describedby');
    target = null;
    tooltip.hidden = true;
  }
  function refresh() {
    if (!target) return;
    if (!target.isConnected || !enabled()) return hide();
    tooltip.textContent = loanLimitLabel(getState());
    tooltip.hidden = false;
    target.setAttribute('aria-describedby', tooltip.id);
    const rect = target.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - width) / 2, innerWidth - width - 8))}px`;
    tooltip.style.top = `${rect.bottom + height + 18 <= innerHeight ? rect.bottom + 10 : Math.max(8, rect.top - height - 10)}px`;
  }
  document.addEventListener('pointerover', (event) => {
    const balance = event.target.closest?.('[data-loan-balance]');
    if (!balance || !enabled()) return;
    target = balance;
    refresh();
  });
  document.addEventListener('pointerout', (event) => {
    if (target?.contains(event.target) && !target.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('pointerdown', hide);
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);
  return { refresh, hide };
}
