import * as CANNON from '../vendor/cannon-es.js';

class RoomContactSolver extends CANNON.GSSolver {
  solve(dt, world) {
    // A carton outweighs a foil pack by over 200x. Eight relaxation passes
    // leave that contact oscillating and repeatedly waking the whole stack.
    // Spend extra iterations only in connected islands with unequal masses.
    let ratio = 1;
    for (const { bi, bj } of this.equations)
      if (bi.mass > 0 && bj.mass > 0)
        ratio = Math.max(ratio, Math.max(bi.mass, bj.mass) / Math.min(bi.mass, bj.mass));
    this.iterations = ratio >= 100 ? 128 : ratio >= 10 ? 64 : 8;
    return super.solve(dt, world);
  }
}

export function createRoomSolver() {
  const solver = new CANNON.SplitSolver(new RoomContactSolver());
  solver.iterations = 8;
  return solver;
}
