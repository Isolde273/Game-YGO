import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { browserOptions } from './helpers/browser.mjs';

const output = 'test-results/room-sorting-performance-20261010';
const baseline = 'D:/Game-YGO-backups/20261010-room-sorting-performance';
const browser = await chromium.launch({ ...browserOptions, headless: true });
const pages = [];
const checks = [];
try {
  for (const variant of ['before', 'after']) {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    if (variant === 'before') {
      const body = await fs.readFile(`${baseline}/src/scene/packages3d.js`, 'utf8');
      await page.route('**/src/scene/packages3d.js', (route) =>
        route.fulfill({ contentType: 'application/javascript', body }),
      );
    }
    await page.route('**/pouch-render.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}</style>' }),
    );
    await page.goto('http://127.0.0.1:5173/pouch-render.html');
    await page.evaluate(async () => {
      const THREE = await import('/src/vendor/three.module.js');
      const { createPackageLibrary, SIZES } = await import('/src/scene/packages3d.js');
      const library = await createPackageLibrary();
      const images = new Set();
      for (const template of Object.values(library.templates))
        template.traverse((mesh) => {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (material?.map?.image?.decode) images.add(material.map.image);
          }
        });
      await Promise.all([...images].map((image) => image.decode()));
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(512, 512);
      renderer.setClearColor('#43505b');
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.85;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      document.body.append(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#ffffff', '#44342b', 1.2));
      const light = new THREE.DirectionalLight('#fff1d4', 2);
      light.position.set(-6, 8, 5);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      Object.assign(light.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
      scene.add(light);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: '#a6a6a6', roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -4;
      ground.receiveShadow = true;
      scene.add(ground);
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
      camera.position.set(0, 3, 10);
      camera.lookAt(0, 0, 0);
      window.pouchProbe = { THREE, library, renderer, scene, camera, SIZES, object: null };
    });
    pages.push(page);
  }
  for (const kind of ['pack', 'bonus']) {
    for (const flat of [false, true]) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const triangles = [];
        const images = [];
        for (const page of pages) {
          triangles.push(
            await page.evaluate(
              ({ kind, flat, yaw }) => {
                const probe = window.pouchProbe;
                probe.object?.removeFromParent();
                probe.object = probe.library.create(kind, false);
                probe.object.rotation.set(flat ? -Math.PI / 2 : 0, yaw, 0);
                probe.scene.add(probe.object);
                probe.renderer.info.reset();
                probe.renderer.render(probe.scene, probe.camera);
                return probe.renderer.info.render.triangles;
              },
              { kind, flat, yaw },
            ),
          );
          images.push(
            await sharp(await page.locator('canvas').screenshot())
              .raw()
              .toBuffer(),
          );
        }
        let maximum = 0;
        let changed = 0;
        let totalDifference = 0;
        const points = [];
        for (let i = 0; i < images[0].length; i++) {
          const difference = Math.abs(images[0][i] - images[1][i]);
          maximum = Math.max(maximum, difference);
          if (difference) changed++;
          totalDifference += difference;
          if (difference > 2) {
            const pixel = Math.floor(i / 3);
            points.push([pixel % 512, Math.floor(pixel / 512)]);
          }
        }
        const objectChanges = await pages[0].evaluate((points) => {
          const probe = window.pouchProbe;
          const ray = new probe.THREE.Raycaster();
          return points.filter(([x, y]) => {
            ray.setFromCamera(
              new probe.THREE.Vector2((x + 0.5) / 256 - 1, 1 - (y + 0.5) / 256),
              probe.camera,
            );
            return ray.intersectObject(probe.object, true).length > 0;
          }).length;
        }, points);
        checks.push({
          kind,
          flat,
          yaw,
          maximum,
          changed,
          meanDifference: totalDifference / images[0].length,
          objectChanges,
          triangles,
        });
        if (maximum > 2) {
          await pages[0].screenshot({ path: `${output}/pouch-before.png` });
          await pages[1].screenshot({ path: `${output}/pouch-after.png` });
        }
        assert.equal(objectChanges, 0, `${kind}/${flat}/${yaw}: printed pouch changed`);
        assert.ok(
          totalDifference / images[0].length <= 0.001,
          'shadow outline changed beyond subpixel fringe',
        );
        assert.equal(flat ? maximum : 0, 0, 'tabletop rendering must remain pixel-identical');
        assert.ok(kind === 'pack' ? triangles[1] < triangles[0] : triangles[1] === triangles[0]);
      }
    }
  }
  console.log(
    `Closed pouch rendering: ${checks.length} comparisons passed; printed pouch unchanged, all flat views pixel-identical; shadow-only mean difference below 0.001.`,
  );
} finally {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    `${output}/sealed-pouch-pixels.json`,
    JSON.stringify(
      {
        passed:
          checks.length === 16 &&
          checks.every(
            (check) =>
              check.objectChanges === 0 &&
              check.meanDifference <= 0.001 &&
              (!check.flat || check.maximum === 0),
          ),
        checks,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
