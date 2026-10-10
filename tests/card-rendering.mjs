import { browserOptions } from './helpers/browser.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright'),
  sharp = require('sharp');
const browser = await chromium.launch({ ...browserOptions, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 460 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const T = await import('./src/vendor/three.module.js'),
      { createPackageLibrary } = await import('./src/scene/packages3d.js'),
      library = await createPackageLibrary(),
      rarities = ['N', 'SR', 'UR', 'SER', 'PSER'];
    document.body.replaceChildren();
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setSize(1000, 460);
    renderer.setClearColor('#071941');
    document.body.append(renderer.domElement);
    const scene = new T.Scene(),
      camera = new T.OrthographicCamera(-2.85, 2.85, 1.31, -1.31, 0.1, 20);
    camera.position.z = 4;
    scene.add(new T.HemisphereLight('#ffffff', '#102050', 2));
    const models = rarities.map((rarity, i) => {
        const c = library.createCard(rarity);
        c.position.x = (i - 2) * 1.08;
        scene.add(c);
        return c;
      }),
      calls = [];
    for (const c of models) {
      models.forEach((other) => (other.visible = other === c));
      renderer.render(scene, camera);
      const board = c.getObjectByName('card-board');
      calls.push({
        rarity: c.userData.rarity,
        calls: renderer.info.render.calls,
        groups: board.geometry.groups.length,
        materials: board.material.length,
      });
    }
    models.forEach((c) => (c.visible = true));
    renderer.render(scene, camera);
    return { calls, totalCalls: renderer.info.render.calls };
  });
  assert.deepEqual(errors, []);
  assert.ok(
    result.calls.every(
      (c) => c.calls <= (c.rarity === 'N' ? 5 : 6) && c.groups === 3 && c.materials === 3,
    ),
  );
  await fs.mkdir('test-results/room-performance', { recursive: true });
  await sharp(await page.screenshot())
    .png()
    .toFile('test-results/room-performance/card-materials.png');
  const backs = await page.evaluate(async () => {
    const T = await import('/src/vendor/three.module.js'),
      { createPackageLibrary } = await import('/src/scene/packages3d.js'),
      lib = await createPackageLibrary();
    document.body.replaceChildren();
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setSize(1000, 460);
    renderer.setClearColor('#071941');
    document.body.append(renderer.domElement);
    const scene = new T.Scene(),
      camera = new T.OrthographicCamera(-2.2, 2.2, 1.012, -1.012, 0.1, 20);
    camera.position.z = 4;
    scene.add(new T.HemisphereLight('#ffffff', '#102050', 2));
    const cards = [
      lib.createCard('N'),
      lib.createCard('PSER'),
      lib.createTableStack(Array.from({ length: 50 }, () => ({ rarity: 'UR' }))),
    ];
    cards.forEach((card, i) => {
      card.position.x = (i - 1) * 1.3;
      card.rotation.y = Math.PI;
      scene.add(card);
    });
    renderer.render(scene, camera);
    const maps = cards.map((card) => {
      let map;
      card.traverse((o) => {
        if (o.isMesh && Array.isArray(o.material) && o.material.length === 3)
          map = o.material[2].map;
      });
      return map;
    });
    return {
      shared: maps.every((m) => m === maps[0]),
      image: maps[0].image.currentSrc.split('/').at(-1),
      width: maps[0].image.width,
      height: maps[0].image.height,
    };
  });
  assert.deepEqual(backs, { shared: true, image: 'card-back.jpg', width: 512, height: 744 });
  await sharp(await page.screenshot())
    .webp({ quality: 86 })
    .toFile('test-results/room-performance/card-backs.webp');
  await fs.writeFile(
    'test-results/room-performance/card-rendering.json',
    JSON.stringify({ ...result, backs }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, ...result, backs }));
} finally {
  await browser.close();
}
