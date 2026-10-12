const files = {
  hover: 'p3r-hover.wav',
  navigate: 'p3r-navigate.wav',
  tab: 'p3r-tab.wav',
  confirm: 'p3r-confirm.wav',
  'card-2': 'card-2.wav',
};
const hoverPages = new Set(['open', 'album', 'warehouse', 'shop', 'settings']);
const scales = {
  click: 0.7,
  hover: 0.55,
  navigate: 0.45,
  tab: 0.7,
  confirm: 0.6,
  card: 2 / 3,
};

// XHR also loads local file URLs in the offline desktop application.
function loadSample(file) {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('GET', new URL(`../../public/assets/audio/${file}`, import.meta.url));
    request.responseType = 'arraybuffer';
    request.onload = () =>
      resolve(request.status === 0 || request.status === 200 ? request.response : null);
    request.onerror = () => resolve(null);
    request.send();
  });
}

export function createSounds(getSettings, getContext) {
  let ownedContext;
  getContext ??= () => (ownedContext ??= new (window.AudioContext || window.webkitAudioContext)());
  const samples = new Map();
  const decoded = new Map();
  const buffers = new Map();
  const active = new Map();
  let unlocked = false;
  let disposed = false;

  function decode(key, context) {
    if (!decoded.has(key)) {
      if (!samples.has(key)) samples.set(key, loadSample(files[key]));
      decoded.set(
        key,
        samples.get(key).then(async (bytes) => {
          if (!bytes?.byteLength) return null;
          try {
            const buffer = await context.decodeAudioData(bytes);
            if (disposed) return null;
            buffers.set(key, buffer);
            return buffer;
          } catch {
            return null;
          }
        }),
      );
    }
    return decoded.get(key);
  }

  function unlock() {
    if (disposed || !getSettings().sound) return;
    try {
      const context = getContext();
      void context.resume().catch(() => {});
      unlocked = true;
      for (const key of Object.keys(files)) void decode(key, context);
    } catch {
      // Sound is optional on devices without Web Audio.
    }
  }

  function sync() {
    if (disposed) return;
    const settings = getSettings();
    for (const [source, { gain, scale }] of active) {
      if (!settings.sound) {
        source.stop();
        active.delete(source);
      } else gain.gain.value = Math.max(0, Math.min(1, settings.volume / 100)) * scale;
    }
  }

  function play(type = 'click') {
    if (disposed || !getSettings().sound) return;
    if (type === 'hover' && !unlocked) return;
    const key = type === 'card' ? 'card-2' : type === 'click' ? 'tab' : type;
    if (!files[key]) return;
    try {
      const context = getContext();
      if (type === 'hover' && context.state !== 'running') return;
      const resumed = context.state === 'running' ? null : context.resume().catch(() => {});
      const start = (buffer) => {
        if (disposed || !buffer || !getSettings().sound || context.state !== 'running') return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        const scale = (scales[type] ?? 0.7) * 0.5;
        source.buffer = buffer;
        gain.gain.value = Math.max(0, Math.min(1, getSettings().volume / 100)) * scale;
        source.connect(gain);
        gain.connect(context.destination);
        active.set(source, { gain, scale });
        source.onended = () => {
          active.delete(source);
          source.disconnect();
          gain.disconnect();
        };
        source.start();
      };
      if (buffers.has(key) && context.state === 'running') start(buffers.get(key));
      else void Promise.all([decode(key, context), resumed]).then(([buffer]) => start(buffer));
    } catch {
      // Interactions remain available if playback is unsupported.
    }
  }

  function hover(event) {
    if (event.pointerType === 'touch') return;
    const target = event.target.closest('.home-menu .menu-tile,.mini-nav button');
    const page =
      target?.dataset.action === 'navigate' ? target.dataset.page : target?.dataset.action;
    if (
      !target ||
      !hoverPages.has(page) ||
      target.disabled ||
      target.closest('[inert]') ||
      target.contains(event.relatedTarget)
    )
      return;
    play('hover');
  }
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('pointerover', hover);
  return {
    play,
    sync,
    dispose() {
      disposed = true;
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('pointerover', hover);
      for (const source of active.keys()) source.stop();
      active.clear();
      void ownedContext?.close().catch(() => {});
    },
  };
}
