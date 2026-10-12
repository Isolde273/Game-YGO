export function createBackgroundMusic(getSettings) {
  const track = new Audio(
    new URL('../../public/assets/audio/background.m4a', import.meta.url).href,
  );
  track.loop = true;
  track.preload = 'auto';
  let pending = null;
  let disposed = false;

  function sync() {
    if (disposed) return;
    const settings = getSettings();
    track.volume = Math.max(0, Math.min(1, settings.musicVolume / 100));
    if (!settings.music) {
      pending = null;
      track.pause();
      return;
    }
    if (!track.paused || pending) return;
    const attempt = track.play();
    pending = attempt;
    // A blocked autoplay is retried on the next pointer or keyboard gesture.
    void attempt
      .catch(() => {})
      .finally(() => {
        if (pending !== attempt) return;
        pending = null;
        if (disposed || !getSettings().music) track.pause();
      });
  }
  document.addEventListener('pointerdown', sync);
  document.addEventListener('keydown', sync);
  return {
    sync,
    dispose() {
      disposed = true;
      document.removeEventListener('pointerdown', sync);
      document.removeEventListener('keydown', sync);
      track.pause();
      track.removeAttribute('src');
      track.load();
    },
  };
}
