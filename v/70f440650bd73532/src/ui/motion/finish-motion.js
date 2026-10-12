// Keep the small set of moving finish surfaces separate from browser-wide
// animation discovery, which forces style updates on each render frame.
const tracks = new Map();

export function trackFinishMotion(animation) {
  const target = animation.effect?.target;
  if (
    !target ||
    !animation.effect
      .getKeyframes()
      .some((frame) =>
        ['transform', 'translate', 'rotate', 'scale', '--inspect-spread'].some(
          (name) => name in frame,
        ),
      )
  )
    return animation;
  const images = [...target.querySelectorAll('img[data-finish-print]')];
  if (target.matches('img[data-finish-print]')) images.push(target);
  if (!images.length) return animation;
  tracks.set(animation, { target, images });
  const remove = () => tracks.delete(animation);
  animation.finished.then(remove, remove);
  return animation;
}

export function movingFinishImages(root) {
  const images = new Set();
  for (const [animation, track] of tracks) {
    if (!track.target.isConnected) {
      tracks.delete(animation);
      continue;
    }
    if (animation.playState !== 'running' || !root.contains(track.target)) continue;
    for (const image of track.images) if (image.isConnected) images.add(image);
  }
  return images;
}
