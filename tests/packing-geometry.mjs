import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const T = await import('/src/vendor/three.module.js');
    const P = await import('/src/scene/packing.js');
    const { createPackageLibrary } = await import('/src/scene/packages3d.js');
    const library = await createPackageLibrary();
    const failures = [];
    let checks = 0;
    // Separating axis theorem for real panel geometry and full-size contents.
    const obb = (size, matrix, name) => {
      const position = new T.Vector3(),
        q = new T.Quaternion(),
        scale = new T.Vector3();
      matrix.decompose(position, q, scale);
      return {
        name,
        position,
        half: size.map((n, i) => (n * scale.getComponent(i)) / 2),
        axes: [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)].map((v) =>
          v.applyQuaternion(q),
        ),
      };
    };
    const overlap = (a, b) => {
      const delta = b.position.clone().sub(a.position);
      const axes = [
        ...a.axes,
        ...b.axes,
        ...a.axes.flatMap((x) => b.axes.map((y) => x.clone().cross(y))),
      ];
      for (const v of axes) {
        if (v.lengthSq() < 1e-12) continue;
        v.normalize();
        const distance = Math.abs(delta.dot(v));
        const extent = (o) => o.half.reduce((n, h, i) => n + h * Math.abs(o.axes[i].dot(v)), 0);
        if (distance >= extent(a) + extent(b) - 0.00001) return false;
      }
      return true;
    };
    const panelOBBs = (model) => {
      const out = [];
      model.updateMatrixWorld(true);
      model.traverseVisible((m) => {
        const p = m.geometry?.parameters;
        if (
          !m.isMesh ||
          !m.visible ||
          !p?.width ||
          m.name.includes('wrap') ||
          m.name.includes('tape')
        )
          return;
        out.push(obb([p.width, p.height, p.depth], m.matrixWorld, m.name));
      });
      return out;
    };
    for (const kind of ['case', 'box']) {
      const model = library.create(kind),
        childKind = kind === 'case' ? 'box' : 'pack',
        slots = kind === 'case' ? P.caseSlots() : P.boxSlots();
      // The sealed physical envelope must contain the actual lid and body panels.
      const envelope = new T.Box3().setFromObject(model),
        size = P.SIZES[kind];
      for (let i = 0; i < 3; i++) {
        checks++;
        if (
          envelope.min.getComponent(i) < -size[i] / 2 - 0.00031 * P.MODEL_SCALE ||
          envelope.max.getComponent(i) > size[i] / 2 + 0.00031 * P.MODEL_SCALE
        )
          failures.push({
            kind: 'physical-envelope',
            package: kind,
            axis: i,
            min: envelope.min.getComponent(i),
            max: envelope.max.getComponent(i),
            size: size[i],
          });
      }
      const contents = slots.map((slot, i) =>
        obb(P.SIZES[childKind], new T.Matrix4().makeTranslation(...slot), `content-${i}`),
      );
      for (let step = 0; step <= 500; step++) {
        const progress = step / 500;
        library.poseOpening(model, progress);
        const panels = panelOBBs(model);
        for (const content of contents)
          for (const panel of panels) {
            checks++;
            if (overlap(content, panel) && failures.length < 20)
              failures.push({ kind, progress, a: content.name, b: panel.name });
          }
        // Folding surfaces must also clear one another, including the tuck tongue.
        const folding = panels.filter((p) => /flap|lid|tab|tuck/.test(p.name));
        for (const panel of folding)
          for (const other of panels) {
            if (panel === other) continue;
            checks++;
            if (overlap(panel, other) && failures.length < 20)
              failures.push({ kind, progress, a: panel.name, b: other.name });
          }
      }
      for (let i = 0; i < contents.length; i++)
        for (let j = i + 1; j < contents.length; j++) {
          checks++;
          if (overlap(contents[i], contents[j])) failures.push({ kind, a: i, b: j });
        }
      library.poseOpening(model, 1);
      const panels = panelOBBs(model);
      if (kind === 'case') {
        const highest = new T.Box3().setFromObject(model).max.y;
        for (const slot of slots)
          for (let step = 0; step <= 250; step++) {
            const y = slot[1] + ((highest + P.SIZES.box[1] / 2 + 0.12 - slot[1]) * step) / 250;
            const box = obb(
              P.SIZES.box,
              new T.Matrix4().makeTranslation(slot[0], y, slot[2]),
              'extract-box',
            );
            for (const panel of panels) {
              checks++;
              if (overlap(box, panel) && failures.length < 20)
                failures.push({ kind: 'extract-all-slots', slot, step, b: panel.name });
            }
          }
      } else {
        for (const slot of slots)
          for (let step = 0; step <= 250; step++) {
            const pack = obb(
              P.SIZES.pack,
              new T.Matrix4().makeTranslation(
                slot[0],
                slot[1] + (1.56 * P.MODEL_SCALE * step) / 250,
                slot[2],
              ),
              'withdraw-pack',
            );
            for (const panel of panels) {
              checks++;
              if (overlap(pack, panel) && failures.length < 20)
                failures.push({ kind: 'withdraw-through-mouth', step, b: panel.name });
            }
          }
      }
    }
    // Sweep every card edge through the opened pouch shoulder and mouth.
    for (let step = 0; step <= 500; step++) {
      const dy = (P.WITHDRAW_CARD * step) / 500;
      for (const slot of P.cardSlots())
        for (const x of [-P.CARD_SIZE[0] / 2, 0, P.CARD_SIZE[0] / 2])
          for (let j = 0; j <= 20; j++) {
            const y = slot[1] + dy + P.CARD_SIZE[1] * (j / 20 - 0.5);
            if (y > P.PACK_MOUTH - 0.004) continue;
            const filmInside = P.pouchDepth(x, y, 1) - 0.00045;
            checks++;
            if (
              Math.abs(slot[2]) + P.CARD_SIZE[2] / 2 > filmInside + 0.00001 &&
              failures.length < 20
            )
              failures.push({ kind: 'pack', dy, x, y, z: slot[2], filmInside });
          }
    }
    for (const count of [4, 20])
      for (let step = 0; step <= 200; step++) {
        const progress = step / 200,
          spread = P.smooth(progress, 0.6, 1);
        const cards = Array.from({ length: count }, (_, i) => {
          const slot = P.tableCards(i, count),
            initial =
              (Math.floor(i / 4) - (count / 4 - 1) / 2) * 0.058 * P.MODEL_SCALE +
              P.cardSlots()[i % 4][2];
          return obb(
            P.CARD_SIZE,
            new T.Matrix4().makeTranslation(
              slot[0] * spread,
              0,
              initial + (slot[2] - initial) * P.smooth(progress, 0, 0.6),
            ),
            `card-${i}`,
          );
        });
        for (let i = 0; i < count; i++)
          for (let j = i + 1; j < count; j++) {
            checks++;
            if (overlap(cards[i], cards[j]) && failures.length < 20)
              failures.push({ kind: 'stack-offset', count, progress, a: i, b: j });
          }
      }
    for (let step = 0; step <= 250; step++) {
      const t = step / 250,
        spread = P.smooth(t, 0, 0.6),
        flatten = P.smooth(t, 0.65, 1);
      const rotation = new T.Matrix4().makeRotationX((-Math.PI / 2) * t);
      const packs = P.tabletopPacks().map((slot, i) =>
        obb(
          P.SIZES.pack,
          rotation.clone().multiply(new T.Matrix4().makeTranslation(...slot)),
          `pack-${i}`,
        ),
      );
      for (let i = 0; i < 15; i++)
        for (let j = i + 1; j < 15; j++) {
          checks++;
          if (overlap(packs[i], packs[j]) && failures.length < 20)
            failures.push({ kind: 'neat-packs', step, a: i, b: j });
        }
    }
    const pack = library.create('pack');
    library.poseOpening(pack, 1);
    const body = pack.userData.wrapper.geometry;
    for (let step = 0; step <= 100; step++) {
      library.poseOpening(pack, step / 100);
      const p = body.attributes.position,
        layer = p.count / 4;
      for (let i = 0; i < layer; i++) {
        checks++;
        if (
          !(
            p.getZ(i) > p.getZ(i + layer) &&
            p.getZ(i + layer) > 0 &&
            p.getZ(i + 2 * layer) < p.getZ(i + 3 * layer) &&
            p.getZ(i + 3 * layer) < 0
          ) &&
          failures.length < 20
        )
          failures.push({ kind: 'film-layers', step, i });
      }
    }
    const strip = pack.getObjectByName('pack-top-seal').geometry;
    const edgeY = Math.max(...body.userData.pouch.map((p) => p.y));
    const mouth = body.userData.pouch.flatMap((p, i) =>
      p.front && !p.inside && Math.abs(p.y - edgeY) < 1e-7 ? [i] : [],
    );
    for (const i of mouth) {
      checks++;
      if (Math.abs(body.attributes.position.getY(i) - edgeY) > 1e-7)
        failures.push({ kind: 'mouth-not-straight', i });
      const v = body.attributes.uv.getY(i),
        u = strip.attributes.uv.getY(0);
      checks++;
      if (Math.abs(v - u) > 1e-6) failures.push({ kind: 'strip-uv-seam', i, v, u });
    }
    return {
      checks,
      failures,
      pack: {
        type: body.type,
        vertices: body.attributes.position.count,
        groups: body.groups.length,
      },
      front: library.templates.box.getObjectByName('box-front').material[4].map.image.src,
      side: library.templates.box.getObjectByName('box-right').material[0].map.image.src,
      top: library.templates.box.getObjectByName('box-lid-panel').material[2].map.image.src,
    };
  });
  await fs.writeFile('test-results/packing-geometry.json', JSON.stringify(result, null, 2));
  assert.deepEqual(result.failures, []);
  assert.equal(result.pack.type, 'BufferGeometry');
  assert.ok(result.pack.vertices > 4000);
  assert.match(result.front, /locr-box-front/);
  assert.match(result.side, /locr-box-side/);
  assert.match(result.top, /locr-box-top/);
  console.log(`包装几何验证通过：${result.checks} 次面板/内容物/袋口/卡牌间隙检查。`);
} finally {
  await browser.close();
}
