import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';
import { freshState, purchase, makeItem, openBoxFully } from '../src/game/model.js';

const output = 'test-results/room-sorting-performance-20261010';
const variant = process.env.YGO_PERF_VARIANT ?? 'current';
const state = freshState();
state.settings = { ...state.settings, sound: false, motion: false };
purchase(state, 'box', 3);
for (const box of state.items.filter((item) => item.kind === 'box')) openBoxFully(state, box.id);
state.cardStacks.forEach((stack, i) => {
  stack.pose3d.position = [((i % 3) - 1) * 1.5, 0.16, 1.2 + Math.floor(i / 3) * 2.2];
});
state.items = Array.from({ length: 64 }, (_, i) => ({
  ...makeItem('pack'),
  isNew: false,
  pose3d: {
    position: [((i % 8) - 3.5) * 1.15, 0.1, (Math.floor(i / 8) - 3.5) * 1.3],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  },
}));
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1.5,
  });
  if (process.env.YGO_PROFILE_BASELINE === '1') {
    const baseline = 'D:/Game-YGO-backups/20261010-room-sorting-performance';
    for (const name of ['world3d', 'packages3d']) {
      const body = await fs.readFile(`${baseline}/src/scene/${name}.js`, 'utf8');
      await page.route(`**/src/scene/${name}.js`, (route) =>
        route.fulfill({ contentType: 'application/javascript', body }),
      );
    }
  }
  await page.route('**/render-profile.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main id="profile" style="position:fixed;inset:0"></main>',
    }),
  );
  await page.goto('http://127.0.0.1:5173/render-profile.html');
  const result = await page.evaluate(async (state) => {
    const { createWorld3D } = await import('/src/scene/world3d.js');
    const host = document.querySelector('#profile');
    const world = createWorld3D(host, { state, save() {}, sound() {}, toast() {}, open() {} });
    await world.ready;
    world.setNavigationPaused(true);
    world.renderer.setDrawingBufferSize(host.clientWidth, host.clientHeight, 1.5);
    Object.assign(world.canvas.style, { width: '100%', height: '100%', visibility: 'visible' });
    world.renderer.shadowMap.needsUpdate = true;
    world.renderer.render(world.scene, world.camera);
    world.renderer.shadowMap.needsUpdate = false;
    const groups = world.scene.children
      .filter((object) => object.visible)
      .map((object) => {
        let triangles = 0;
        object.traverse((mesh) => {
          if (mesh.isMesh)
            triangles +=
              ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3) *
              (mesh.isInstancedMesh ? mesh.count : 1);
        });
        return { name: object.name || object.type, triangles };
      })
      .sort((a, b) => b.triangles - a.triangles)
      .slice(0, 10);
    let sceneNodes = 0;
    world.scene.traverse(() => sceneNodes++);
    const cardSceneNodes = world.cards.filter((card) => card.mesh.parent).length;
    const measure = async () => {
      const samples = [];
      const intervals = [];
      let previous = performance.now();
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now();
        intervals.push(start - previous);
        previous = start;
        world.renderer.info.reset();
        world.renderer.render(world.scene, world.camera);
        world.renderer.getContext().finish();
        samples.push(performance.now() - start);
      }
      const values = samples.slice(5).sort((a, b) => a - b);
      const frames = intervals.slice(5).sort((a, b) => a - b);
      return {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p95: values[Math.floor(values.length * 0.95)],
        frameMean: frames.reduce((a, b) => a + b, 0) / frames.length,
        frameP95: frames[Math.floor(frames.length * 0.95)],
        calls: world.renderer.info.render.calls,
        triangles: world.renderer.info.render.triangles,
      };
    };
    const all = await measure();
    const stacks = world.tableStacks.map((stack) => stack.root);
    stacks.forEach((root) => (root.visible = false));
    const noCards = await measure();
    stacks.forEach((root) => (root.visible = true));
    const packs = world.batches.flatMap((batch) => batch.meshes);
    packs.forEach((mesh) => (mesh.visible = false));
    const noPacks = await measure();
    packs.forEach((mesh) => (mesh.visible = true));
    const desk = world.scene.getObjectByName('blender-card-shop');
    desk.visible = false;
    const noDesk = await measure();
    desk.visible = true;
    return {
      buffer: [world.renderer.domElement.width, world.renderer.domElement.height],
      sceneNodes,
      cardSceneNodes,
      groups,
      all,
      noCards,
      noPacks,
      noDesk,
    };
  }, state);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(`${output}/render-profile-${variant}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ variant, ...result }));
} finally {
  await browser.close();
}
