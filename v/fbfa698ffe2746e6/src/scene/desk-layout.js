const gap = 0.18,
  base = 0.044,
  flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
export const tidyQuaternion = (kind) =>
  kind === 'pack' || kind === 'bonus' || kind === 'cards' ? flat.slice() : [0, 0, 0, 1];
const intersects = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
function subtract(rect, cut) {
  if (!intersects(rect, cut)) return [rect];
  const x0 = Math.max(rect.x0, cut.x0),
    x1 = Math.min(rect.x1, cut.x1),
    z0 = Math.max(rect.z0, cut.z0),
    z1 = Math.min(rect.z1, cut.z1);
  return [
    { x0: rect.x0, x1: x0, z0: rect.z0, z1: rect.z1 },
    { x0: x1, x1: rect.x1, z0: rect.z0, z1: rect.z1 },
    { x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: z0 },
    { x0: rect.x0, x1: rect.x1, z0: z1, z1: rect.z1 },
  ].filter((r) => r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01);
}
const prune = (rects) =>
  rects.filter(
    (r, i) =>
      !rects.some(
        (other, j) =>
          i !== j &&
          other.x0 <= r.x0 &&
          other.x1 >= r.x1 &&
          other.z0 <= r.z0 &&
          other.z1 >= r.z1 &&
          (j < i || other.x0 < r.x0 || other.x1 > r.x1 || other.z0 < r.z0 || other.z1 > r.z1),
      ),
  );

// Plan first, then commit once. Fixed props are excluded; opened cartons occupy
// their full unfolded envelope. A pile contains only equal-size items of one kind.
export function planDeskLayout(entries, obstacles, halfWidth, halfDepth, options = {}) {
  if (options.cardZone) {
    const zone = options.cardZone,
      packages = planDeskLayout(
        entries.filter((e) => e.kind !== 'cards'),
        [...obstacles, zone],
        halfWidth,
        halfDepth,
      );
    const cards = planDeskLayout(
      entries.filter((e) => e.kind === 'cards'),
      obstacles,
      halfWidth,
      halfDepth,
      { region: zone, surfaceY: zone.top + 0.004 },
    );
    return packages && cards ? [...packages, ...cards] : null;
  }
  const r = options.region,
    initial = r
      ? { x0: r.x0 + 0.12, x1: r.x1 - 0.12, z0: r.z0 + 0.12, z1: r.z1 - 0.12 }
      : { x0: -halfWidth + 0.3, x1: halfWidth - 0.3, z0: -halfDepth + 0.3, z1: halfDepth - 0.3 };
  const order = ['container', 'case', 'box', 'pack', 'bonus', 'cards'];
  for (const limits of [
    { container: 1, case: 1, box: 1, pack: 15, bonus: 15, cards: 1 },
    { container: 1, case: 4, box: 4, pack: 25, bonus: 25, cards: 4 },
    { container: 1, case: 32, box: 32, pack: 100, bonus: 100, cards: 20 },
  ]) {
    let free = [initial];
    for (const o of obstacles) {
      const cut = {
        x0: o.x0 - gap / 2,
        x1: o.x1 + gap / 2,
        z0: o.z0 - gap / 2,
        z1: o.z1 + gap / 2,
      };
      free = prune(free.flatMap((r) => subtract(r, cut)));
    }
    const groups = [];
    for (const kind of order) {
      const list = entries.filter((e) => e.kind === kind);
      for (let i = 0; i < list.length;) {
        const members = [list[i++]],
          first = members[0];
        let pileHeight = first.size[1];
        while (
          i < list.length &&
          members.length < limits[kind] &&
          pileHeight + list[i].size[1] + 0.004 <= 5.5 &&
          Math.abs(list[i].size[0] - first.size[0]) < 0.00001 &&
          Math.abs(list[i].size[2] - first.size[2]) < 0.00001
        ) {
          pileHeight += list[i].size[1] + 0.004;
          members.push(list[i++]);
        }
        groups.push({ kind, members, width: first.size[0] + gap, depth: first.size[2] + gap });
      }
    }
    const placements = [];
    let fits = true;
    for (const group of groups) {
      const candidates = free
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.x1 - r.x0 >= group.width && r.z1 - r.z0 >= group.depth);
      candidates.sort((a, b) => a.r.z0 - b.r.z0 || a.r.x0 - b.r.x0);
      if (!candidates.length) {
        fits = false;
        break;
      }
      const { r } = candidates[0],
        cut = { x0: r.x0, x1: r.x0 + group.width, z0: r.z0, z1: r.z0 + group.depth };
      free = prune(free.flatMap((r) => subtract(r, cut)));
      let height = options.surfaceY ?? base;
      for (const entry of group.members) {
        const offset = entry.offset ?? [0, 0, 0],
          position = [
            (cut.x0 + cut.x1) / 2 - offset[0],
            height + entry.size[1] / 2 - offset[1],
            (cut.z0 + cut.z1) / 2 - offset[2],
          ];
        if (position.some((v) => Math.abs(v) > 75)) {
          fits = false;
          break;
        }
        placements.push({
          id: entry.id,
          kind: entry.kind,
          position,
          quaternion: tidyQuaternion(entry.kind),
        });
        height += entry.size[1] + 0.004;
      }
      if (!fits) break;
    }
    if (fits) return placements;
  }
  return null;
}
