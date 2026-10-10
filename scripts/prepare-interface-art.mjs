// Scalable charcoal and chipped pigment matching prepare-home-art.py.
import fs from 'node:fs/promises';

const out = new URL('../public/assets/', import.meta.url);
function texture(accent, seed, split = false) {
  let n = seed;
  const random = () => (n = (Math.imul(1664525, n) + 1013904223) >>> 0) / 4294967296;
  const between = (a, b) => a + random() * (b - a);
  const polygons = [];
  function brush(x, y, width, height, color, opacity = 1) {
    const points = [];
    const jagged = Math.min(height * 0.24, 18);
    for (let i = 0; i <= 24; i++)
      points.push([x + (width * i) / 24 + between(-9, 9), y + between(-jagged, jagged)]);
    for (let i = 24; i >= 0; i--)
      points.push([
        x + (width * i) / 24 - height * 0.36 + between(-10, 10),
        y + height + between(-jagged, jagged),
      ]);
    polygons.push(
      `<polygon fill="${color}" opacity="${opacity}" points="${points.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`,
    );
  }
  for (let i = 0; i < 65; i++)
    brush(
      between(-180, 1600),
      between(-80, 1000),
      between(180, 600),
      between(60, 220),
      ['#20262d', '#252c32', '#151b21'][i % 3],
      0.9,
    );
  if (split) {
    polygons.push('<path d="M1030 0H1600V1000H690Z" fill="#d3cdbb"/>');
    polygons.push('<g clip-path="url(#paper)">');
    for (let i = 0; i < 70; i++)
      brush(
        between(680, 1650),
        between(-30, 1000),
        between(45, 230),
        between(6, 40),
        ['#b7b4a8', '#c2bdad', '#ded7c5'][i % 3],
        0.65,
      );
    polygons.push('</g>');
  } else if (accent) {
    for (let i = 0; i < 30; i++)
      brush(
        between(1070, 1390),
        between(30, 890),
        between(90, 280),
        between(50, 190),
        accent,
        between(0.65, 1),
      );
    for (let i = 0; i < 50; i++)
      brush(
        between(1000, 1620),
        between(-20, 1000),
        between(25, 180),
        between(8, 45),
        '#171d23',
        0.95,
      );
  }
  for (let i = 0; i < 600; i++) {
    const x = between(0, 1600),
      y = between(0, 1000);
    polygons.push(
      `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${between(1, 15).toFixed(1)} ${between(-4, -1).toFixed(1)}" stroke="#d9d3bf" opacity=".1"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="none"><defs><clipPath id="paper"><path d="M1030 0H1600V1000H690Z"/></clipPath></defs><path fill="#171d23" d="M0 0h1600v1000H0z"/>${polygons.join('')}</svg>`;
}
for (const [name, accent, seed, split] of [
  ['ink', null, 51],
  ['red', '#a9322d', 52],
  ['blue', '#28546a', 53],
  ['shop', null, 54, true],
]) {
  await fs.writeFile(new URL(`interface-${name}.svg`, out), texture(accent, seed, split));
}
console.log('Interface brush textures prepared.');
