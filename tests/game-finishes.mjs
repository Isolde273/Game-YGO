import { freshState } from './helpers/starter-state.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import sharp from 'sharp';
import { browserOptions, navigatePage } from './helpers/browser.mjs';
import {
  addCards,
  transferWarehouseToTray,
  moveBinderCard,
  validateState,
} from '../src/game/model.js';
import { CARD_PRINTS, makeCardRecord } from '../src/game/card-data.js';

const desktop = process.env.YGO_FINISH_DESKTOP === '1';
const output = 'test-results/game-finishes';
const prefix = desktop ? 'desktop' : 'browser';
await fs.mkdir(output, { recursive: true });
const state = freshState();
state.items = [];
state.settings.sound = false;
state.settings.motion = false;
const styles = ['SR', 'UR', 'SER', 'UL', 'CR', 'PSER', 'UR-OF', 'PSER-OF', 'GMR'];
const prints = styles.map((style) => CARD_PRINTS.find((print) => print.style === style));
prints.push(CARD_PRINTS.at(-1));
prints.forEach((print, i) => {
  addCards(state, print.id, 2, print.rarity === 'GMR' ? [37, 88] : undefined);
  transferWarehouseToTray(state, print.id);
  moveBinderCard(state, { printId: print.id }, i);
});
const stackCard = makeCardRecord(
  prints[8].id,
  state.numberedCards.find((card) => card.serial === 88).id,
  88,
);
state.cardStacks.push({
  id: crypto.randomUUID(),
  cards: [stackCard],
  pose3d: { position: [0, 0.09, 1.35], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
});
validateState(structuredClone(state));
let application;
const errors = [];
try {
  let page;
  if (desktop) {
    const env = {
      ...process.env,
      YGO_SMOKE_TEST: '1',
      YGO_SMOKE_USERDATA: path.resolve(`${output}/profile-${Date.now()}`),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: path.resolve('portable/游戏王开盒模拟器/游戏王开盒模拟器.exe'),
      env,
    });
    page = await application.firstWindow();
    await page.locator('.home-menu').waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
    await page.context().setOffline(true);
  } else {
    application = await chromium.launch({ ...browserOptions, headless: true });
    page = await application.newPage({ viewport: { width: 1440, height: 900 } });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 220));
  });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('finish-fixture')) {
      localStorage.setItem('ygo-duel-archive-v1', JSON.stringify(state));
      localStorage.setItem('finish-fixture', '1');
    }
  }, state);
  if (desktop) await page.reload();
  else await page.goto('http://127.0.0.1:5173');
  const shot = async (name) =>
    sharp(await page.screenshot())
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 86 })
      .toFile(`${output}/${prefix}-${name}.webp`);
  const settle = () =>
    page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
  const pixels = (selector) =>
    page.locator(selector).evaluateAll((canvases) =>
      canvases.map((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
        return hash >>> 0;
      }),
    );
  const brightness = (selector) =>
    page.locator(selector).evaluateAll((canvases) =>
      canvases.map((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let luminance = 0,
          white = 0;
        for (let i = 0; i < data.length; i += 4) {
          luminance += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
          if (Math.min(data[i], data[i + 1], data[i + 2]) >= 245) white++;
        }
        return { mean: luminance / (data.length / 4), whiteFraction: white / (data.length / 4) };
      }),
    );
  const lighting = {};
  await navigatePage(page, 'album');
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('.pocket-window .card-finish-canvas[data-ready="true"]')
          .length === 10,
      null,
      { timeout: 10000 },
    )
    .catch(async (error) => {
      console.log(
        JSON.stringify({
          errors,
          cards: await page.locator('.pocket-window').evaluateAll((nodes) =>
            nodes.map((node) => ({
              print: node.querySelector('img')?.dataset.finishPrint,
              ready: node.querySelector('canvas')?.dataset.ready,
              width: node.querySelector('img')?.clientWidth,
              height: node.querySelector('img')?.clientHeight,
            })),
          ),
        }),
      );
      await shot('failed-album');
      throw error;
    });
  assert.equal(await page.locator('.pocket-window img[data-finish-serial="37"]').count(), 1);
  await shot('album');
  const copies = await page.evaluate(async () => {
    const { copyFinishCanvases, cloneFinishedImage } = await import(
      new URL('./src/ui/card-surfaces.js', location.href)
    );
    const page = document.querySelector('.left-page'),
      clone = page.cloneNode(true);
    copyFinishCanvases(page, clone);
    const original = [...page.querySelectorAll('.card-finish-canvas')];
    const retained = [...clone.querySelectorAll('.card-finish-canvas')].every(
      (canvas, index) => canvas.toDataURL() === original[index].toDataURL(),
    );
    const image = document.querySelector('.pocket-window img[data-finish-serial="37"]');
    const ghost = cloneFinishedImage(image);
    return {
      retained,
      snapshot: ghost.src.startsWith('data:image/png') && !ghost.dataset.finishPrint,
    };
  });
  assert.deepEqual(copies, { retained: true, snapshot: true });
  const albumCanvases = '.pocket-window .card-finish-canvas';
  await page.mouse.move(35, 180);
  await settle();
  const albumLeft = await pixels(albumCanvases);
  await page.mouse.move(1400, 180);
  await settle();
  const albumRight = await pixels(albumCanvases);
  assert.equal(
    albumRight.filter((value, i) => value !== albumLeft[i]).length,
    10,
    'Every visible album card must follow the mouse outside the card bounds',
  );
  await page.locator('.album-slot[data-slot="8"]').click();
  assert.equal(await page.locator('.album-slot.is-selected,[data-album-command]').count(), 0);
  const albumRect = await page.locator('.album-slot[data-slot="8"] img').boundingBox();
  await page.mouse.move(albumRect.x + albumRect.width / 2, albumRect.y + albumRect.height / 2);
  await settle();
  await page.mouse.down();
  const albumBeforeDrag = await pixels(albumCanvases);
  await page.mouse.move(950, 430);
  await page.waitForFunction(
    () => document.querySelector('.album-drag-ghost .card-finish-canvas')?.dataset.ready === 'true',
  );
  await settle();
  await page.mouse.move(1100, 430);
  await settle();
  assert.equal((await pixels('.album-drag-ghost .card-finish-canvas')).length, 1);
  assert.notDeepEqual(
    (await pixels(albumCanvases)).filter((_, i) => i !== 8),
    albumBeforeDrag.filter((_, i) => i !== 8),
    'Album light keeps moving across the stationary cards during a drag',
  );
  await shot('album-held');
  await page.mouse.move(710, 165);
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pocket-window .card-finish-canvas[data-ready="true"]').length ===
      10,
  );
  await settle();
  const albumReleased = await pixels(albumCanvases);
  await page.mouse.move(1400, 180);
  await settle();
  assert.notDeepEqual(
    await pixels(albumCanvases),
    albumReleased,
    'Releasing an album drag resumes pointer light',
  );
  lighting.album = {
    global: true,
    dragLocked: true,
    moving: true,
    resumed: true,
    brightness: await brightness(albumCanvases),
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('album-narrow');
  const aligned = await page.locator('.pocket-window').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.querySelector('img'))
      .every((node) => {
        const image = node.querySelector('img').getBoundingClientRect(),
          canvas = node.querySelector('canvas').getBoundingClientRect();
        return Math.abs(image.left - canvas.left) < 1.5 && Math.abs(image.top - canvas.top) < 1.5;
      }),
  );
  assert.ok(aligned);
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigatePage(page, 'warehouse');
  await page.waitForFunction(
    () =>
      document.querySelector('.inventory-preview-art .card-finish-canvas')?.dataset.ready ===
      'true',
  );
  await page.locator('[data-action="card-detail"]').first().click();
  await page.waitForFunction(
    () => document.querySelector('.detail-card .card-finish-canvas')?.dataset.ready === 'true',
  );
  await page.keyboard.press('Escape');
  await navigatePage(page, 'open');
  await page.locator('canvas[data-presented="true"]').waitFor();
  await page.waitForFunction(
    () => document.querySelector('canvas').world3D.snapshot().stacks[0]?.finish?.ready,
  );
  const tableFinish = await page.evaluate(
    () => document.querySelector('canvas').world3D.snapshot().stacks[0].finish,
  );
  assert.deepEqual(tableFinish, { shader: true, kind: 6, serial: 88, ready: true });
  await page.locator('.world-stack').press('Enter');
  await page.locator('.card-inspector[data-phase="open"]').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.inspect-card .card-finish-canvas')?.dataset.ready === 'true',
  );
  assert.equal(await page.locator('.inspect-card img').getAttribute('data-finish-serial'), '88');
  await shot('sorting-gmr');
  const sortingCanvas = '.inspect-card .card-finish-canvas';
  const sortingRect = await page.locator('.inspect-card').boundingBox();
  const cardPoint = async (x, y) => {
    const rect = await page.locator('.inspect-card').boundingBox();
    await page.mouse.move(rect.x + rect.width * x, rect.y + rect.height * y);
    await settle();
  };
  await cardPoint(0.25, 0.3);
  const sortingLeft = await pixels(sortingCanvas);
  await cardPoint(0.75, 0.65);
  const sortingRight = await pixels(sortingCanvas);
  assert.notDeepEqual(sortingRight, sortingLeft, 'Light follows the mouse on the sorting card');
  await page.mouse.move(35, 140);
  await settle();
  await page.mouse.move(1400, 140);
  await settle();
  assert.deepEqual(
    await pixels(sortingCanvas),
    sortingRight,
    'Outside the card retains its last light',
  );
  await page.locator('.inspect-card').click();
  await cardPoint(0.2, 0.25);
  const afterClick = await pixels(sortingCanvas);
  await cardPoint(0.8, 0.75);
  assert.notDeepEqual(
    await pixels(sortingCanvas),
    afterClick,
    'Clicking does not leave the sorting light locked',
  );
  await page.mouse.move(
    sortingRect.x + sortingRect.width / 2,
    sortingRect.y + sortingRect.height / 2,
  );
  await settle();
  await page.mouse.down();
  const sortingLocked = await pixels(sortingCanvas);
  await page.mouse.move(
    sortingRect.x + sortingRect.width / 2 + 130,
    sortingRect.y + sortingRect.height / 2 + 40,
  );
  await settle();
  assert.notDeepEqual(
    await pixels(sortingCanvas),
    sortingLocked,
    'Moving a sorting card changes reflection under held light',
  );
  await shot('sorting-held');
  await page.mouse.up();
  const sortingResponses = [];
  for (let round = 0; round < 3; round++) {
    await cardPoint(0.2, 0.3);
    const left = await pixels(sortingCanvas);
    const rect = await page.locator('.inspect-card').boundingBox();
    await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height * 0.7);
    // No timeout: the very next paint must respond after releasing a drag.
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    assert.notDeepEqual(
      await pixels(sortingCanvas),
      left,
      'Released sorting light responds without a waiting period',
    );
    sortingResponses.push(true);
    if (round < 2) {
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width * 0.8 + 35, rect.y + rect.height * 0.7 + 20);
      await page.mouse.up();
    }
  }
  lighting.sorting = {
    cardOnly: true,
    outsideRetained: true,
    moving: true,
    immediateResponses: sortingResponses,
    brightness: await brightness(sortingCanvas),
  };
  await page.locator('[data-route-one="warehouse"]').click();
  await page.waitForFunction(() => !document.querySelector('.card-inspector'));
  await navigatePage(page, 'home');

  const sweep = await page.evaluate(async () => {
    const base = new URL('./src/', location.href);
    const T = await import(new URL('vendor/three.module.js', base));
    const { createGameFinishLibrary } = await import(new URL('scene/game-card-finishes.js', base));
    const { CARD_PRINTS } = await import(new URL('game/card-data.js', base));
    const { createPackageLibrary } = await import(new URL('scene/packages3d.js', base));
    const packages = await createPackageLibrary();
    const openingCards = [...new Set(CARD_PRINTS.map((print) => print.style))].map((style) =>
      packages.createCard({
        ...CARD_PRINTS.find((print) => print.style === style),
        printId: CARD_PRINTS.find((print) => print.style === style).id,
        ...(style === 'GMR' ? { serial: 88 } : {}),
      }),
    );
    await Promise.all(openingCards.map((card) => card.userData.finishReady));
    const opening = openingCards.every(
      (card) =>
        card.userData.finish?.isShaderMaterial &&
        !card.userData.foil &&
        !card.getObjectByName('rarity-label').visible &&
        !card.getObjectByName('card-foil-frame').visible,
    );
    openingCards.forEach((card) => {
      card.userData.releaseFinish();
      card.getObjectByName('card-board').material[0].dispose();
      card.getObjectByName('rarity-label').geometry.dispose();
    });
    packages.dispose();
    const library = createGameFinishLibrary();
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(236, 344);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const scene = new T.Scene(),
      camera = new T.OrthographicCamera(-1.475, 1.475, 2.15, -2.15, 0.1, 30);
    camera.position.z = 10.8;
    const plane = new T.Mesh(new T.PlaneGeometry(2.95, 4.3));
    scene.add(plane);
    const contact = document.createElement('canvas');
    contact.width = 1180;
    contact.height = 688;
    const context = contact.getContext('2d');
    const samples = new Set(),
      kinds = new Set(),
      changes = [],
      stats = [];
    let cell = 0;
    const hash = () => {
      const pixels = new Uint8Array(236 * 344 * 4);
      renderer
        .getContext()
        .readPixels(
          0,
          0,
          236,
          344,
          renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE,
          pixels,
        );
      let result = 2166136261;
      for (const pixel of pixels) result = Math.imul(result ^ pixel, 16777619) >>> 0;
      return result;
    };
    for (const data of CARD_PRINTS) {
      const handle = library.acquire({
        printId: data.id,
        ...(data.rarity === 'GMR' ? { serial: 37 } : {}),
      });
      await handle.ready;
      plane.material = handle.material;
      library.updateLight(new T.Vector3(-3, 4.5, 7));
      renderer.render(scene, camera);
      kinds.add(handle.material.uniforms.kind.value);
      const group = data.assetRoot === 'vol2-catalog' ? 'vol.2' : data.style;
      if (!samples.has(group)) {
        samples.add(group);
        context.drawImage(renderer.domElement, (cell % 5) * 236, Math.floor(cell / 5) * 344);
        cell++;
        const first = hash();
        library.updateLight(new T.Vector3(5, -2, 7));
        renderer.render(scene, camera);
        changes.push({ group, changed: first !== hash() });
      }
      handle.release();
      stats.push(library.stats());
    }
    const serial37 = library.acquire({
      printId: CARD_PRINTS.find((data) => data.rarity === 'GMR').id,
      serial: 37,
    });
    await serial37.ready;
    plane.material = serial37.material;
    renderer.render(scene, camera);
    const hash37 = hash();
    const serial88 = library.acquire({ printId: serial37.material.userData.printId, serial: 88 });
    await serial88.ready;
    plane.material = serial88.material;
    renderer.render(scene, camera);
    const numbered = hash37 !== hash() && serial88.material.uniforms.serialMode.value === 1;
    serial37.release();
    serial88.release();
    const result = {
      count: CARD_PRINTS.length,
      kinds: [...kinds].sort(),
      changes,
      numbered,
      opening,
      maxEntries: Math.max(...stats.map((item) => item.entries)),
      maxTextures: Math.max(...stats.map((item) => item.textures)),
      active: library.stats().active,
      contact: contact.toDataURL('image/png'),
    };
    library.dispose();
    result.disposed = library.stats();
    plane.geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    return result;
  });
  await fs.writeFile(
    `${output}/${prefix}-contact.png`,
    Buffer.from(sweep.contact.split(',')[1], 'base64'),
  );
  delete sweep.contact;
  assert.equal(sweep.count, 328);
  assert.deepEqual(sweep.kinds, [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(
    sweep.changes.every((item) => item.changed),
    JSON.stringify(sweep.changes),
  );
  assert.ok(sweep.numbered);
  assert.ok(sweep.opening);
  assert.ok(sweep.maxEntries <= 6 && sweep.maxTextures <= 30, JSON.stringify(sweep));
  assert.equal(sweep.active, 0);
  assert.deepEqual(sweep.disposed, { entries: 0, active: 0, textures: 0 });
  // Lock while the global light is still easing towards a new mouse position.
  await navigatePage(page, 'settings');
  await page.locator('[data-action="settings-section"][data-section="settings-audio"]').click();
  await page.locator('[data-setting="motion"]').click();
  await navigatePage(page, 'album');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pocket-window .card-finish-canvas[data-ready="true"]').length ===
        10 &&
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== 'running' ||
            !animation.effect?.target?.closest?.('.album-studio'),
        ),
  );
  await page.mouse.move(35, 180);
  await settle();
  const smoothRect = await page.locator('.album-slot[data-slot="8"] img').boundingBox();
  await page.mouse.move(smoothRect.x + smoothRect.width / 2, smoothRect.y + smoothRect.height / 2);
  await page.mouse.down();
  await settle();
  const easedLock = await pixels(albumCanvases);
  await page.mouse.move(35, 180);
  await settle();
  await settle();
  assert.notDeepEqual(
    (await pixels(albumCanvases)).filter((_, i) => i !== 8),
    easedLock.filter((_, i) => i !== 8),
    'Holding a card allows the light to follow another pointer position',
  );
  lighting.album.dragLightFollows = true;
  await page.mouse.move(710, 165);
  await page.mouse.up();
  const gmrSource = await page.locator('.album-slot[data-slot="8"]').boundingBox();
  const warehouseDrop = await page.locator('[data-album-drop="warehouse"]').boundingBox();
  await page.mouse.move(gmrSource.x + gmrSource.width / 2, gmrSource.y + gmrSource.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    warehouseDrop.x + warehouseDrop.width / 2,
    warehouseDrop.y + warehouseDrop.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  const warehouseState = validateState(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ygo-duel-archive-v1'))),
  );
  assert.equal(warehouseState.binder.slots[8], undefined);
  assert.equal(warehouseState.collection[prints[8].id], 0);
  assert.deepEqual(
    warehouseState.numberedCards
      .filter((card) => card.printId === prints[8].id)
      .map((card) => ({ serial: card.serial, collected: card.inCollection })),
    [
      { serial: 37, collected: false },
      { serial: 88, collected: false },
    ],
  );
  lighting.album.numberedWarehouseDrop = true;
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/${prefix}-report.json`,
    JSON.stringify({ sweep, lighting, errors }, null, 2),
  );
  console.log(
    `Game finishes ${prefix}: 328 shaders rendered, 10 light-responsive groups, actual GMR stamps, all UI surfaces and bounded disposal passed.`,
  );
} finally {
  await application?.close();
}
