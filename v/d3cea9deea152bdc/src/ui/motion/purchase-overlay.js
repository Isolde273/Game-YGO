import { createMotionPlayer } from './motion-player.js';

export function createPurchaseOverlay({ app, motion, onStart, onFinish, onDismiss }) {
  const player = createMotionPlayer(motion);
  let root = null,
    active = false,
    previousFocus = null,
    priorInert = false;
  const pose = 'rotate(-6deg)';
  const targetPose = () => (innerWidth <= 700 ? 'none' : pose);
  async function open(html) {
    if (root) return refresh(html);
    active = true;
    previousFocus = document.activeElement;
    priorInert = app.inert;
    app.inert = true;
    onStart?.();
    document.body.classList.add('purchase-open');
    const template = document.createElement('template');
    template.innerHTML = html;
    root = template.content.firstElementChild;
    root.addEventListener('click', (event) => {
      if (!active && !event.target.closest('.phone')) onDismiss?.();
    });
    root.dataset.phase = 'entering';
    root.inert = true;
    document.body.append(root);
    const handset = root.querySelector('.phone-wrap');
    const buttons = [...root.querySelectorAll('.phone-apps>button')];
    buttons.forEach((el) => {
      el.style.opacity = '0';
    });
    try {
      await player.play(
        handset,
        [
          { transform: 'translate3d(110vw,38vh,0) rotate(32deg)' },
          { transform: 'translate3d(6px,-10px,0) rotate(-8deg)', offset: 0.76 },
          { transform: targetPose() },
        ],
        { duration: 560, easing: 'cubic-bezier(.18,.72,.18,1)' },
      );
      await Promise.all(
        buttons.map((el, i) =>
          player.play(
            el,
            [
              { transform: 'translateX(80px)', opacity: 0 },
              { transform: 'none', opacity: 1 },
            ],
            { duration: 200, delay: i * 55, hold: true },
          ),
        ),
      );
    } finally {
      buttons.forEach((el) => el.style.removeProperty('opacity'));
      player.clear();
      buttons.forEach((el) => el.style.removeProperty('will-change'));
      if (root) {
        root.dataset.phase = 'open';
        root.inert = false;
        root.querySelector('.phone-apps button,.phone-close')?.focus({ preventScroll: true });
      }
      active = false;
    }
  }
  function refresh(html) {
    if (!root) return;
    const template = document.createElement('template');
    template.innerHTML = html;
    const replacement = template.content.firstElementChild;
    root.replaceChildren(...replacement.childNodes);
  }
  async function close() {
    if (!root || active) return false;
    active = true;
    const closing = root;
    closing.inert = true;
    closing.dataset.phase = 'closing';
    try {
      await player.play(
        closing.querySelector('.phone-wrap'),
        [{ transform: targetPose() }, { transform: 'translate3d(110vw,45vh,0) rotate(30deg)' }],
        { duration: 340, easing: 'cubic-bezier(.5,0,.8,.3)' },
      );
    } finally {
      player.clear();
      closing.remove();
      root = null;
      app.inert = priorInert;
      document.body.classList.remove('purchase-open');
      active = false;
      onFinish?.();
      previousFocus?.isConnected && previousFocus.focus({ preventScroll: true });
    }
    return true;
  }
  function keydown(event) {
    if (!root || event.key !== 'Tab') return;
    const controls = [...root.querySelectorAll('button,input,select')].filter(
      (el) => !el.disabled && el.getClientRects().length,
    );
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  document.addEventListener('keydown', keydown);
  window.addEventListener('resize', () => player.finish());
  return {
    open,
    refresh,
    close,
    finish: player.finish,
    get busy() {
      return active;
    },
    get visible() {
      return !!root;
    },
  };
}
