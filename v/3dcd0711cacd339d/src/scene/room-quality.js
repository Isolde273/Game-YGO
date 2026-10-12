// GPU-bound rooms need feedback from delivered frame intervals, not only the
// synchronous duration of WebGLRenderer.render(), which just submits GPU work.
export class RoomQuality {
  constructor(width, height, dpr) {
    this.resize(width, height, dpr);
    this.interval = 16.7;
    this.slow = 0;
    this.fast = 0;
  }
  resize(width, height, dpr) {
    // Never enlarge a sub-native buffer across the room. Supersampling may
    // adapt under load, while native pixels remain the minimum quality.
    this.ceiling = Math.max(1, Math.min(dpr, 2, Math.sqrt(8300000 / Math.max(1, width * height))));
    const ratio = Math.min(this.ratio ?? this.ceiling, this.ceiling),
      changed = ratio !== this.ratio;
    this.ratio = ratio;
    return changed;
  }
  observe(ms) {
    if (ms < 5 || ms > 160) return false;
    this.interval = this.interval * 0.75 + ms * 0.25;
    this.slow = this.interval > 18.5 ? this.slow + 1 : Math.max(0, this.slow - 1);
    this.fast = this.interval < 18 ? this.fast + 1 : 0;
    if (this.slow >= 8 && this.ratio > 1) {
      this.ratio = Math.max(1, this.ratio * Math.max(0.72, Math.sqrt(16.7 / this.interval)));
      this.slow = 0;
      this.fast = 0;
      return true;
    }
    if (this.fast >= 180 && this.ratio < this.ceiling) {
      this.ratio = Math.min(this.ceiling, this.ratio * 1.06);
      this.fast = 0;
      return true;
    }
    return false;
  }
  restore() {
    if (this.ratio === this.ceiling) return false;
    this.ratio = this.ceiling;
    this.slow = this.fast = 0;
    this.interval = 16.7;
    return true;
  }
}
