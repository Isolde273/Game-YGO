import * as THREE from '../vendor/three.module.js';
import { CARD_RARITIES, getCardView } from '../game/card-data.js';
import { createGameFinishLibrary } from './game-card-finishes.js';
import { acquireTextureImage } from './texture-images.js';
import { scheduleResourceTask } from './resource-scheduler.js';
import { createInstancedShadowMeshes } from './shadow-batch.js';
import {
  BASE_SIZES as SIZES,
  BASE_WALL as WALL,
  MODEL_SCALE,
  CARD_SIZE,
  CARD_PAPER,
  CARD_STEP,
  cartonPose,
  boxPose,
  packPose,
} from './packing.js';
import { createPouchGeometry, posePouchGeometry } from './pouch-geometry.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
export { SIZES } from './packing.js';
const asset = (name) => new URL(`../../public/assets/${name}`, import.meta.url).href;
// Explicit filenames let player packaging rewrite lossless image formats.
const packagingAssets = {
  LOCR: ['locr-box-front.webp', 'locr-box-side.webp', 'locr-box-top.webp', 'locr-pack-front.webp'],
  LOCH: ['loch-box-front.webp', 'loch-box-side.webp', 'loch-box-top.webp', 'loch-pack-front.webp'],
};
const printedCanvases = new Map();
let printedCanvasBytes = 0;
const texture = (draw, w = 1024, h = 1024, key = null) => {
  let canvas = key && printedCanvases.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    if (key) {
      printedCanvases.set(key, canvas);
      printedCanvasBytes += w * h * 4;
      while (printedCanvasBytes > 24 * 1024 * 1024) {
        const oldest = printedCanvases.keys().next().value;
        const oldCanvas = printedCanvases.get(oldest);
        printedCanvases.delete(oldest);
        printedCanvasBytes -= oldCanvas.width * oldCanvas.height * 4;
      }
    }
  } else {
    printedCanvases.delete(key);
    printedCanvases.set(key, canvas);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
};
const material = (map, extra = {}) =>
  new THREE.MeshStandardMaterial({ map, roughness: 0.82, ...extra });
const clamp = THREE.MathUtils.clamp;

export async function createPackageLibrary(invalidate = () => {}, initialSets = ['LOCR', 'LOCH']) {
  const maps = [];
  const mapHandles = [];
  const loadedMaps = new Map();
  async function loadMap(name) {
    if (loadedMaps.has(name)) return loadedMaps.get(name);
    const handle = acquireTextureImage(asset(name), { retention: 1 });
    mapHandles.push(handle);
    const ready = handle.ready.then(({ image, flipY }) => {
      const map = new THREE.Texture(image);
      map.flipY = flipY;
      map.needsUpdate = true;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      maps.push(map);
      return map;
    });
    loadedMaps.set(name, ready);
    return ready;
  }
  const [cardArt, logo, cardBack] = await Promise.all(
    ['card-empty.svg', 'yugioh-logo.png', 'card-back.jpg'].map(loadMap),
  );
  maps.forEach((map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
  });
  await scheduleResourceTask(() => {});
  const cardboard = texture(
    (c, w, h) => {
      c.fillStyle = '#b18a52';
      c.fillRect(0, 0, w, h);
      let seed = 137;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < 30000; i++) {
        c.fillStyle = random() > 0.5 ? '#e9c89124' : '#49371616';
        c.fillRect(random() * w, random() * h, random() * 2 + 1, random() * 5 + 1);
      }
      c.strokeStyle = '#73563525';
      c.lineWidth = 1;
      for (let y = 0; y < h; y += 4) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
      c.strokeStyle = '#5137162b';
      c.lineWidth = 12;
      c.strokeRect(6, 6, w - 12, h - 12);
    },
    1024,
    1024,
    'cardboard',
  );
  function drawCartonLabel(set = 'LOCR') {
    return texture(
      (c, w, h) => {
        c.drawImage(cardboard.image, 0, 0, w, h);
        c.fillStyle = '#235084';
        c.fillRect(0, h * 0.74, w, h * 0.045);
        c.fillRect(0, h * 0.81, w, h * 0.012);
        c.fillStyle = '#eee6cc';
        c.fillRect(w * 0.1, h * 0.13, w * 0.47, h * 0.49);
        c.strokeStyle = '#796443';
        c.lineWidth = 2;
        c.strokeRect(w * 0.1, h * 0.13, w * 0.47, h * 0.49);
        c.fillStyle = '#282828';
        c.font = 'bold 36px Arial';
        c.fillText('KONAMI', w * 0.13, h * 0.21);
        c.drawImage(logo.image, w * 0.13, h * 0.23, w * 0.35, h * 0.105);
        c.font = 'bold 22px Arial';
        c.fillText('LIMIT OVER COLLECTION', w * 0.13, h * 0.395);
        c.font = '20px Arial';
        c.fillText(set === 'LOCH' ? 'THE HEROES / LOCH' : 'THE RIVALS / LOCR', w * 0.13, h * 0.437);
        c.fillText('24 BOXES · OCG', w * 0.13, h * 0.477);
        c.font = '17px monospace';
        c.fillText(
          set === 'LOCH' ? 'ITEM  CG2069   /   JPN' : 'ITEM  CG2070   /   JPN',
          w * 0.13,
          h * 0.52,
        );
        let x = w * 0.13;
        for (let i = 0; i < 75; i++) {
          const b = 1 + ((i * 7) % 3);
          c.fillRect(x, h * 0.545, b, 32);
          x += b + 2;
        }
        c.font = 'bold 24px Arial';
        c.fillStyle = '#244d79';
        c.fillText('Yu-Gi-Oh! OCG', w * 0.62, h * 0.25);
        c.font = '17px Arial';
        c.fillText('OFFICIAL CARD GAME', w * 0.62, h * 0.29);
        c.strokeStyle = '#244d79';
        c.lineWidth = 6;
        [w * 0.7, w * 0.83].forEach((x) => {
          c.beginPath();
          c.moveTo(x, h * 0.58);
          c.lineTo(x, h * 0.39);
          c.lineTo(x - 13, h * 0.415);
          c.moveTo(x, h * 0.39);
          c.lineTo(x + 13, h * 0.415);
          c.stroke();
        });
        c.strokeRect(w * 0.655, h * 0.35, w * 0.25, h * 0.29);
        c.font = '19px Arial';
        c.fillText('KEEP DRY', w * 0.7, h * 0.69);
      },
      1024,
      640,
      `carton-label-${set}`,
    );
  }
  function drawCartonSide(set = 'LOCR') {
    return texture(
      (c, w, h) => {
        c.drawImage(cardboard.image, 0, 0, w, h);
        c.fillStyle = '#244d79';
        c.fillRect(0, h * 0.74, w, h * 0.045);
        c.fillRect(0, h * 0.81, w, h * 0.012);
        c.font = 'bold 45px Arial';
        c.fillText('KONAMI', w * 0.12, h * 0.25);
        c.font = '30px Arial';
        c.fillText('Yu-Gi-Oh! OCG', w * 0.12, h * 0.35);
        c.font = '23px monospace';
        c.fillText(`${set} / 24 BOXES`, w * 0.12, h * 0.48);
        c.fillStyle = '#eee6cc';
        c.fillRect(w * 0.11, h * 0.54, w * 0.52, h * 0.14);
        c.fillStyle = '#35302b';
        c.font = '22px monospace';
        c.fillText(set === 'LOCH' ? 'CG2069  JPN' : 'CG2070  JPN', w * 0.14, h * 0.61);
      },
      1024,
      640,
      `carton-side-${set}`,
    );
  }
  const tapeMap = texture(
    (c, w, h) => {
      c.fillStyle = '#c2a67e';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e3d3ab42';
      for (let x = 0; x < w; x += 3) c.fillRect(x, 0, 1, h);
      c.fillStyle = '#66513e';
      c.font = 'bold 28px Arial';
      c.textAlign = 'center';
      for (let y = 55; y < h; y += 155) {
        c.fillText('KONAMI', w / 2, y);
        c.font = '18px Arial';
        c.fillText('SEALED', w / 2, y + 28);
        c.font = 'bold 28px Arial';
      }
    },
    256,
    1024,
    'carton-tape',
  );
  const cardboardMat = material(cardboard),
    insideMat = material(cardboard, { color: '#ccb081' }),
    edgeMat = material(cardboard, { color: '#76592f' });
  const tapeMat = material(tapeMap, {
    roughness: 0.48,
    color: '#e8cfaa',
    transparent: true,
    opacity: 0.92,
  });
  function drawBoxSide(set = 'LOCR') {
    return texture(
      (c, w, h) => {
        c.fillStyle = '#eae5d7';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#cda952';
        for (let i = -h; i < w; i += 70) {
          c.beginPath();
          c.moveTo(i, 0);
          c.lineTo(i + h, h);
          c.stroke();
        }
        c.fillStyle = '#ae2926';
        c.font = 'bold 48px Arial';
        c.fillText('KONAMI', 50, 90);
        c.save();
        c.translate(w * 0.55, h * 0.54);
        c.rotate(-Math.PI / 2);
        c.fillStyle = '#6b532a';
        c.font = 'bold 43px Georgia';
        c.textAlign = 'center';
        c.fillText('LIMIT OVER COLLECTION', 0, 0);
        c.font = '28px Arial';
        c.fillText(set === 'LOCH' ? 'THE HEROES' : 'THE RIVALS', 0, 53);
        c.restore();
        c.strokeStyle = '#d1b264';
        c.lineWidth = 13;
        c.strokeRect(18, 18, w - 36, h - 36);
      },
      512,
      1024,
      `box-back-${set}`,
    );
  }
  // A near-coplanar transparent cube flickers in depth and cannot be sorted
  // per object in an instanced batch. Put the coating on the printed surface.
  const coated = (map, roughness, metalness) =>
    new THREE.MeshPhysicalMaterial({
      map,
      roughness,
      metalness,
      clearcoat: 0.38,
      clearcoatRoughness: 0.22,
    });
  const whiteMat = material(null, { color: '#d8d4c3' });
  const foilEdge = material(null, {
    color: '#d9d2b1',
    roughness: 0.36,
    metalness: 0.72,
    shadowSide: THREE.FrontSide,
  });
  let bonusFrontMat;
  function drawPackBack(set = 'LOCR') {
    return texture(
      (c, w, h) => {
        c.fillStyle = '#ece8de';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ac2d29';
        c.font = 'bold 43px Arial';
        c.fillText('KONAMI', 42, 68);
        c.fillStyle = '#4c4841';
        c.font = 'bold 29px Arial';
        c.fillText('Yu-Gi-Oh! OCG', 42, 138);
        c.font = '23px monospace';
        c.fillText('LIMIT OVER COLLECTION', 42, 197);
        c.fillText(set === 'LOCH' ? 'THE HEROES' : 'THE RIVALS', 42, 237);
        c.font = '19px Arial';
        for (let y = 312; y < 730; y += 36) c.fillText('遊戯王 オフィシャルカードゲーム', 42, y);
        for (let i = 0; i < 100; i++) c.fillRect(65 + i * 3.6, 805, 1 + (i % 3), 92);
        c.font = '20px Arial';
        c.fillText('© STUDIO DICE / SHUEISHA', 42, 958);
      },
      512,
      1024,
      `pack-back-${set}`,
    );
  }
  const families = {};
  const familyLoads = new Map();
  const templates = {};
  async function prepareSets(sets) {
    for (const set of new Set(sets.map((set) => (set === 'LOSP' ? 'LOCR' : set)))) {
      if (!['LOCR', 'LOCH'].includes(set)) throw new Error(`Unknown packaging set: ${set}`);
      if (!familyLoads.has(set)) {
        const ready = (async () => {
          const [front, side, top, pack] = await Promise.all(packagingAssets[set].map(loadMap));
          if (disposed) return;
          const valid = () => !disposed;
          const faceMat = await scheduleResourceTask(() => material(drawCartonLabel(set)), {
            valid,
          });
          const sideMat = await scheduleResourceTask(() => material(drawCartonSide(set)), {
            valid,
          });
          const back = await scheduleResourceTask(() => drawBoxSide(set), { valid });
          const packBack = await scheduleResourceTask(() => drawPackBack(set), { valid });
          if (!valid()) return;
          families[set] = {
            faceMat,
            sideMat,
            cartonPanel: [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, insideMat],
            boxFrontMat: coated(front, 0.38, 0.16),
            boxSideMat: coated(side, 0.48, 0.11),
            boxBackMat: coated(back, 0.48, 0.11),
            boxTopMat: coated(top, 0.4, 0.18),
            packFrontMat: material(pack, {
              roughness: 0.4,
              metalness: 0.25,
              shadowSide: THREE.FrontSide,
            }),
            packBackMat: material(packBack, {
              roughness: 0.46,
              metalness: 0.16,
              shadowSide: THREE.FrontSide,
            }),
          };
          for (const kind of ['case', 'box', 'pack']) {
            await scheduleResourceTask(
              () => {
                templates[set === 'LOCH' ? `loch-${kind}` : kind] = create(kind, false, set);
              },
              { valid },
            );
          }
          if (set === 'LOCR') {
            const bonusMap = await loadMap('special-pack-vol2.svg');
            if (!valid()) return;
            bonusFrontMat = material(bonusMap, { roughness: 0.38, metalness: 0.45 });
            await scheduleResourceTask(
              () => {
                templates.bonus = create('bonus', false);
              },
              { valid },
            );
          }
        })().catch((error) => {
          familyLoads.delete(set);
          throw error;
        });
        familyLoads.set(set, ready);
      }
      await familyLoads.get(set);
    }
  }
  const cardFront = material(cardArt, { roughness: 0.49 }),
    cardBackMat = material(cardBack, { roughness: 0.6 });
  const rarityColors = {
    ...Object.fromEntries(CARD_RARITIES.map((r) => [r.id, r.color])),
    N: '#aeb6bb',
    SR: '#7cb8d7',
    UR: '#d2ae60',
    SER: '#b297d2',
    PSER: '#ed8b87',
  };
  const cardFinishes = createGameFinishLibrary(invalidate);
  let disposed = false;
  function cardFace(card, owner) {
    const data = getCardView(card.printId ?? card.rarity);
    if (!data || data.legacy) return cardFront;
    const finish = cardFinishes.acquire(card);
    owner.userData.finish = finish.material;
    owner.userData.finishReady = finish.ready;
    owner.userData.releaseFinish = finish.release;
    return finish.material;
  }
  const rarityLabels = Object.fromEntries(
    Object.entries({ ...rarityColors, 'UR-OF': rarityColors.UR, 'PSER-OF': rarityColors.PSER }).map(
      ([id, color]) => [
        id,
        material(
          texture(
            (c, w, h) => {
              c.fillStyle = color;
              c.fillRect(0, 0, w, h);
              c.strokeStyle = '#efe1bd';
              c.lineWidth = 5;
              c.strokeRect(3, 3, w - 6, h - 6);
              c.fillStyle = '#222731';
              c.font = `bold ${id.length > 4 ? 45 : 63}px Arial`;
              c.textAlign = 'center';
              c.textBaseline = 'middle';
              c.fillText(id, w / 2, h / 2 + 3);
            },
            256,
            112,
          ),
          { roughness: 0.45, metalness: 0.14 },
        ),
      ],
    ),
  );
  const packShellGeometry = createPouchGeometry(),
    packStripGeometry = createPouchGeometry(true);
  const sealedGeometry = (strip, resolution) => {
    const result = createPouchGeometry(strip, resolution);
    const original = result.index.array;
    const groups = [...result.groups];
    const indices = [];
    result.clearGroups();
    for (const [index, group] of groups.entries()) {
      // Closed pouches hide both inward-facing film sheets. Retain the exact
      // exterior vertices, normals, UVs and hole walls; opening uses all layers.
      if (index === 1 || index === 3) continue;
      const start = indices.length;
      indices.push(...original.slice(group.start, group.start + group.count));
      result.addGroup(start, group.count, group.materialIndex);
    }
    result.setIndex(indices);
    return result;
  };
  const sealedShellGeometry = sealedGeometry(false, { cols: 12, rows: 18 }),
    sealedStripGeometry = sealedGeometry(true, { cols: 12, rows: 2 });
  // The special pack uses inward-facing shadow casting. Keep its full closed
  // film geometry so its existing shadow remains unchanged.
  const sealedBonusShellGeometry = createPouchGeometry(false, { cols: 12, rows: 18 }),
    sealedBonusStripGeometry = createPouchGeometry(true, { cols: 12, rows: 2 });
  const sharedGeometry = new Map();
  const geometry = (w, h, d) => {
    const key = `${w},${h},${d}`;
    if (!sharedGeometry.has(key))
      sharedGeometry.set(
        key,
        new THREE.BoxGeometry(w * MODEL_SCALE, h * MODEL_SCALE, d * MODEL_SCALE),
      );
    return sharedGeometry.get(key);
  };
  function cuboid(parent, w, h, d, mat, x = 0, y = 0, z = 0, name = '') {
    const mesh = new THREE.Mesh(geometry(w, h, d), mat);
    mesh.position.set(x * MODEL_SCALE, y * MODEL_SCALE, z * MODEL_SCALE);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function hinge(parent, axis, position, dimensions, mat, direction, name) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(...position.map((v) => v * MODEL_SCALE));
    parent.add(pivot);
    const [w, h, d] = dimensions;
    cuboid(
      pivot,
      w,
      h,
      d,
      mat,
      axis === 'z' ? (direction * w) / 2 : 0,
      0,
      axis === 'x' ? (direction * d) / 2 : 0,
      name + '-panel',
    );
    return { pivot, axis, direction };
  }
  function cartonFlap(parent, axis, position, dimensions, mat, direction, name) {
    const lengthAxis = axis === 'z' ? 0 : 2;
    const length = dimensions[lengthAxis];
    // The long lid creases again at the carton base, keeping its tail above the table.
    const sideLength = position[1] + SIZES.case[1] / 2 - 0.065;
    const side = [...dimensions];
    side[lengthAxis] = sideLength;
    const flap = hinge(parent, axis, position, side, mat, direction, name);
    const tail = [...dimensions];
    tail[lengthAxis] = length - sideLength - 0.014;
    const tailPosition = [0, 0, 0];
    tailPosition[lengthAxis] = direction * (sideLength + 0.014);
    flap.tail = hinge(flap.pivot, axis, tailPosition, tail, mat, direction, `${name}-tail`);
    flap.position = flap.pivot.position.clone();
    return flap;
  }
  function create(kind, detail = true, set = 'LOCR') {
    const {
      faceMat,
      sideMat,
      cartonPanel,
      boxFrontMat,
      boxSideMat,
      boxBackMat,
      boxTopMat,
      packFrontMat,
      packBackMat,
    } = families[set === 'LOSP' ? 'LOCR' : set];
    const g = new THREE.Group();
    g.name = `${set}-${kind}-model`;
    g.userData.set = set;
    g.userData.kind = kind;
    g.userData.flaps = [];
    g.userData.tape = [];
    const [w, h, d] = SIZES[kind];
    if (kind === 'case') {
      const t = WALL.case;
      cuboid(g, w, t, d, insideMat, 0, -h / 2 + t / 2, 0, 'carton-bottom');
      const rim = 0.28,
        frontHeight = h - rim - 0.042;
      cuboid(
        g,
        w - 2 * t,
        rim,
        t,
        cartonPanel,
        0,
        -h / 2 + rim / 2,
        d / 2 - t / 2,
        'carton-front-rim',
      );
      const front = new THREE.Group();
      front.position.set(0, (-h / 2 + rim + 0.012) * MODEL_SCALE, (d / 2 - t / 2) * MODEL_SCALE);
      g.add(front);
      g.userData.frontPanel = front;
      cuboid(front, w - 2 * t, frontHeight, t, cartonPanel, 0, frontHeight / 2, 0, 'carton-front');
      cuboid(
        g,
        w - 2 * t,
        h - 0.066,
        t,
        [edgeMat, edgeMat, edgeMat, edgeMat, insideMat, faceMat],
        0,
        -0.033,
        -d / 2 + t / 2,
        'carton-back',
      );
      cuboid(
        g,
        t,
        h - 0.066,
        d,
        [sideMat, insideMat, edgeMat, edgeMat, edgeMat, edgeMat],
        w / 2 - t / 2,
        -0.033,
        0,
        'carton-right',
      );
      cuboid(
        g,
        t,
        h - 0.066,
        d,
        [insideMat, sideMat, edgeMat, edgeMat, edgeMat, edgeMat],
        -w / 2 + t / 2,
        -0.033,
        0,
        'carton-left',
      );
      const flaps = g.userData.flaps;
      flaps.push(
        cartonFlap(
          g,
          'z',
          [-w / 2 + t / 2, h / 2 - 0.042, 0],
          [w / 2 - 0.024, 0.018, d - 2 * t],
          insideMat,
          1,
          'carton-left-flap',
        ),
      );
      flaps.push(
        cartonFlap(
          g,
          'z',
          [w / 2 - t / 2, h / 2 - 0.042, 0],
          [w / 2 - 0.024, 0.018, d - 2 * t],
          insideMat,
          -1,
          'carton-right-flap',
        ),
      );
      flaps.push(
        cartonFlap(
          g,
          'x',
          [0, h / 2 - 0.016, d / 2 - t / 2],
          [w - 2 * t, 0.018, d / 2 - 0.024],
          cardboardMat,
          -1,
          'carton-front-flap',
        ),
      );
      flaps.push(
        cartonFlap(
          g,
          'x',
          [0, h / 2 - 0.016, -d / 2 + t / 2],
          [w - 2 * t, 0.018, d / 2 - 0.024],
          cardboardMat,
          1,
          'carton-back-flap',
        ),
      );
      [-1, 1].forEach((sign) => {
        const tape = cuboid(
          g,
          w * 0.43,
          0.004,
          0.18,
          tapeMat,
          sign * w * 0.215,
          h / 2 - 0.004,
          0,
          'carton-sealing-tape',
        );
        g.userData.tape.push(tape);
      });
    } else if (kind === 'box') {
      const t = WALL.box;
      const surfaces = [boxFrontMat, boxSideMat, boxBackMat, boxTopMat].map((mat) => {
        if (!detail) return mat;
        const own = mat.clone();
        own.userData.uniquePackageSurface = true;
        return own;
      });
      const [front, side, back, lid] = surfaces;
      g.userData.coating = detail ? surfaces : [];
      cuboid(g, w, t, d, whiteMat, 0, -h / 2 + t / 2, 0, 'box-bottom');
      cuboid(
        g,
        w - 2 * t,
        h - 0.026,
        t,
        [whiteMat, whiteMat, whiteMat, whiteMat, front, whiteMat],
        0,
        -0.013,
        d / 2 - t / 2,
        'box-front',
      );
      cuboid(
        g,
        w - 2 * t,
        h - 0.026,
        t,
        [whiteMat, whiteMat, whiteMat, whiteMat, whiteMat, back],
        0,
        -0.013,
        -d / 2 + t / 2,
        'box-back',
      );
      cuboid(
        g,
        t,
        h - 0.026,
        d,
        [side, whiteMat, whiteMat, whiteMat, whiteMat, whiteMat],
        w / 2 - t / 2,
        -0.013,
        0,
        'box-right',
      );
      cuboid(
        g,
        t,
        h - 0.026,
        d,
        [whiteMat, side, whiteMat, whiteMat, whiteMat, whiteMat],
        -w / 2 + t / 2,
        -0.013,
        0,
        'box-left',
      );
      const top = hinge(
        g,
        'x',
        [0, h / 2 - 0.004, -d / 2 + t / 2],
        [w, t, d - t],
        [whiteMat, whiteMat, lid, whiteMat, whiteMat, whiteMat],
        1,
        'box-lid',
      );
      g.userData.flaps.push(top);
      g.userData.flaps.push(
        hinge(
          g,
          'z',
          [-w / 2 + t, h / 2 - 0.016, -0.06],
          [w * 0.35, 0.004, d - 0.15],
          whiteMat,
          1,
          'box-left-tab',
        ),
      );
      g.userData.flaps.push(
        hinge(
          g,
          'z',
          [w / 2 - t, h / 2 - 0.016, -0.06],
          [w * 0.35, 0.004, d - 0.15],
          whiteMat,
          -1,
          'box-right-tab',
        ),
      );
      const tuck = new THREE.Group();
      tuck.position.set(0, -0.006 * MODEL_SCALE, (d - 0.02) * MODEL_SCALE);
      top.pivot.add(tuck);
      cuboid(tuck, w - 0.05, 0.1, 0.004, whiteMat, 0, -0.05, 0, 'box-tuck');
      g.userData.tuck = tuck;
    } else {
      const mesh = new THREE.Mesh(
        detail
          ? packShellGeometry
          : kind === 'bonus'
            ? sealedBonusShellGeometry
            : sealedShellGeometry,
        [kind === 'bonus' ? bonusFrontMat : packFrontMat, packBackMat, foilEdge],
      );
      mesh.name = 'foil-pack-body';
      mesh.castShadow = true;
      // Thin printed film must not sample its own front/back shadow layers.
      // Keep its ground shadow and smooth lighting while the pack moves.
      mesh.receiveShadow = false;
      g.add(mesh);
      g.userData.wrapper = mesh;
      const strip = new THREE.Group();
      strip.name = 'pack-tear-strip';
      g.add(strip);
      g.userData.strip = strip;
      const seal = new THREE.Mesh(
        detail
          ? packStripGeometry
          : kind === 'bonus'
            ? sealedBonusStripGeometry
            : sealedStripGeometry,
        [kind === 'bonus' ? bonusFrontMat : packFrontMat, packBackMat, foilEdge],
      );
      seal.name = 'pack-top-seal';
      seal.receiveShadow = false;
      strip.add(seal);
    }
    return g;
  }
  function poseOpening(g, progress) {
    const kind = g.userData.kind,
      p = clamp(progress, 0, 1);
    if (kind === 'case') {
      const pose = cartonPose(p);
      g.userData.tape.forEach((t, i) => {
        t.position.y = (SIZES.case[1] / 2 - 0.004 + pose.peel * 0.22) * MODEL_SCALE;
        t.rotation.z = (i ? 1 : -1) * pose.peel * 0.5;
        t.visible = pose.peel < 1;
      });
      g.userData.flaps.forEach((flap, i) => {
        const { pivot, axis, tail, position } = flap;
        const angle = pose.angles[i];
        const down = THREE.MathUtils.smoothstep(Math.abs(angle), Math.PI * 0.8, Math.PI);
        pivot.rotation[axis] = angle;
        pivot.position.copy(position);
        const offset = (WALL.case / 2 + 0.034) * MODEL_SCALE * down;
        if (axis === 'z') pivot.position.x -= flap.direction * offset;
        else pivot.position.z -= flap.direction * offset;
        tail.pivot.rotation[axis] =
          -Math.sign(angle) *
          (Math.PI / 2) *
          THREE.MathUtils.smoothstep(Math.abs(angle), Math.PI, Math.PI * 1.4);
      });
    } else if (kind === 'box') {
      const pose = boxPose(p);
      g.userData.coating.forEach((mat) => (mat.clearcoat = 0.38 * pose.wrap));
      g.userData.tuck.rotation.x = pose.tuck;
      g.userData.flaps.forEach(({ pivot, axis }, i) => {
        pivot.rotation[axis] = i === 0 ? pose.lid : pose.tabs[i - 1];
      });
    } else {
      const pose = packPose(p);
      g.userData.strip.position.set(...pose.strip);
      g.userData.strip.rotation.z = -pose.stripAngle;
      const wrapper = g.userData.wrapper;
      if (!wrapper.userData.uniqueGeometry) {
        wrapper.geometry = wrapper.geometry.clone();
        wrapper.userData.uniqueGeometry = true;
      }
      posePouchGeometry(wrapper.geometry, pose.mouth, 0);
    }
  }
  function createCard(record, faceVisible = true) {
    const card = typeof record === 'string' ? { rarity: record, printId: record } : record;
    const rarity = card.rarity;
    const realPrint = !getCardView(card.printId ?? rarity)?.legacy;
    const group = new THREE.Group();
    group.name = 'LOCR-card';
    const edge = new THREE.MeshStandardMaterial({
      color: realPrint ? '#dad4c6' : rarityColors[rarity],
      roughness: 0.34,
      metalness: 0.55,
    });
    const [w, h] = CARD_SIZE;
    if (!sharedGeometry.has('card-board-batched')) {
      const board = new THREE.BoxGeometry(w, h, CARD_PAPER);
      board.clearGroups();
      board.addGroup(0, 24, 0);
      board.addGroup(24, 6, 1);
      board.addGroup(30, 6, 2);
      sharedGeometry.set('card-board-batched', board);
      const strips = [];
      for (const sign of [-1, 1])
        strips.push(
          new THREE.BoxGeometry(0.003 * MODEL_SCALE, h, 0.0003 * MODEL_SCALE).translate(
            sign * (w / 2 - 0.0015 * MODEL_SCALE),
            0,
            0.00165 * MODEL_SCALE,
          ),
          new THREE.BoxGeometry(w, 0.003 * MODEL_SCALE, 0.0003 * MODEL_SCALE).translate(
            0,
            sign * (h / 2 - 0.0015 * MODEL_SCALE),
            0.00165 * MODEL_SCALE,
          ),
        );
      sharedGeometry.set('card-frame-batched', mergeGeometries(strips));
      strips.forEach((g) => g.dispose());
    }
    const board = new THREE.Mesh(sharedGeometry.get('card-board-batched'), [
      edge,
      faceVisible ? cardFace(card, group) : cardBackMat,
      cardBackMat,
    ]);
    board.name = 'card-board';
    board.castShadow = true;
    board.receiveShadow = true;
    group.add(board);
    const frame = new THREE.Mesh(sharedGeometry.get('card-frame-batched'), edge);
    frame.name = 'card-foil-frame';
    frame.visible = !realPrint;
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14 * MODEL_SCALE, 0.061 * MODEL_SCALE),
      rarityLabels[getCardView(card.printId)?.label] ?? rarityLabels[rarity],
    );
    label.position.set(0.2 * MODEL_SCALE, -0.374 * MODEL_SCALE, 0.00179 * MODEL_SCALE);
    group.add(label);
    label.name = 'rarity-label';
    label.visible = !realPrint;
    if (rarity !== 'N' && !realPrint) {
      const foil = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          time: { value: 0 },
          strength: { value: rarity === 'PSER' ? 0.36 : rarity === 'SER' ? 0.25 : 0.15 },
        },
        vertexShader:
          'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'varying vec2 vUv; uniform float time; uniform float strength; void main(){float s=sin(vUv.x*17.0+vUv.y*11.0+time*1.8)*.5+.5; vec3 c=.5+.5*cos(6.2831*(vUv.xyx+vec3(0.0,.33,.67))+time*.5);float a=pow(s,7.0)*strength;gl_FragColor=vec4(c,a);}',
      });
      const sheen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.58 * MODEL_SCALE, 0.852 * MODEL_SCALE),
        foil,
      );
      sheen.position.z = 0.00176 * MODEL_SCALE;
      group.add(sheen);
      group.userData.foil = foil;
    }
    group.userData.rarity = rarity;
    return group;
  }
  const tableEdges = Object.fromEntries(
    Object.entries(rarityColors).map(([r, color]) => [
      r,
      new THREE.MeshStandardMaterial({ color, roughness: 0.68 }),
    ]),
  );
  function createTableStack(cards, top = createCard(cards.at(-1))) {
    const count = cards.length,
      rarity = cards.at(-1).rarity,
      depth = Math.max(0.004 * MODEL_SCALE, count * CARD_STEP),
      group = new THREE.Group();
    top.position.set(0, 0, ((count - 1) * CARD_STEP) / 2);
    top.quaternion.identity();
    group.add(top);
    group.userData.finish = top.userData.finish;
    group.userData.finishReady = top.userData.finishReady;
    const edgeTop = top.position.z - CARD_PAPER / 2;
    const edgeDepth = edgeTop + depth / 2;
    const key = `table-stack-${count}`;
    if (!sharedGeometry.has(key)) {
      const board = new THREE.BoxGeometry(CARD_SIZE[0], CARD_SIZE[1], edgeDepth);
      board.clearGroups();
      board.addGroup(0, 24, 0);
      board.addGroup(30, 6, 1);
      sharedGeometry.set(key, board);
    }
    const board = new THREE.Mesh(sharedGeometry.get(key), [tableEdges[rarity], cardBackMat]);
    board.position.z = edgeTop - edgeDepth / 2;
    board.name = 'stack-paper-edges';
    board.castShadow = true;
    board.receiveShadow = true;
    group.add(board);
    return group;
  }
  const steel = new THREE.MeshStandardMaterial({
    color: '#c8d4d9',
    metalness: 0.9,
    roughness: 0.22,
    side: THREE.DoubleSide,
  });
  const grip = new THREE.MeshStandardMaterial({ color: '#9c302c', roughness: 0.65 });
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.1, -0.027);
  bladeShape.lineTo(0.57, -0.016);
  bladeShape.lineTo(0.68, 0);
  bladeShape.lineTo(0.57, 0.024);
  bladeShape.lineTo(-0.1, 0.027);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.004,
    bevelEnabled: false,
  });
  const handleGeometry = new THREE.TorusGeometry(0.115, 0.026, 8, 36);
  const pivotGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.026, 20);
  function createScissors() {
    const root = new THREE.Group();
    root.name = 'five-pack-scissors';
    root.scale.setScalar(MODEL_SCALE);
    root.userData.arms = [];
    for (const sign of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.y = sign * 0.004;
      root.add(arm);
      root.userData.arms.push(arm);
      const blade = new THREE.Mesh(bladeGeometry, steel);
      blade.rotation.x = -Math.PI / 2;
      arm.add(blade);
      cuboid(arm, 0.26, 0.008, 0.038, steel, -0.14, 0, 0, 'scissor-shank');
      const handle = new THREE.Mesh(handleGeometry, grip);
      handle.rotation.x = -Math.PI / 2;
      handle.position.x = -0.36;
      arm.add(handle);
    }
    root.add(new THREE.Mesh(pivotGeometry, steel));
    root.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return root;
  }
  function poseScissors(root, progress) {
    root.userData.arms.forEach((arm, i) => {
      arm.rotation.y =
        (i ? 1 : -1) * (0.04 + 0.24 * (0.5 + 0.5 * Math.cos(progress * Math.PI * 12)));
    });
  }
  function dispose() {
    disposed = true;
    cardFinishes.dispose();
    const geometries = new Set([
        ...sharedGeometry.values(),
        packShellGeometry,
        packStripGeometry,
        sealedShellGeometry,
        sealedStripGeometry,
        sealedBonusShellGeometry,
        sealedBonusStripGeometry,
      ]),
      materials = new Set(),
      textures = new Set(maps);
    for (const template of Object.values(templates))
      template.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material)
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
    [
      ...Object.values(families).flatMap((f) => Object.values(f).flat()),
      cardFront,
      cardBackMat,
      ...Object.values(rarityLabels),
      ...Object.values(tableEdges),
    ].forEach((m) => materials.add(m));
    materials.forEach((m) => {
      if (m.map) textures.add(m.map);
      m.dispose();
    });
    textures.forEach((t) => t.dispose());
    mapHandles.forEach((handle) => handle.release());
    geometries.forEach((g) => g.dispose());
  }
  try {
    await prepareSets(initialSets);
  } catch (error) {
    dispose();
    throw error;
  }
  templates.scissors = createScissors();
  return {
    templates,
    prepareSets,
    create,
    poseOpening,
    createCard,
    createTableStack,
    updateCardLight: cardFinishes.updateLight,
    finishStats: cardFinishes.stats,
    createScissors,
    poseScissors,
    dispose,
  };
}

// Every inventory object is rendered; instancing avoids a draw call per carton panel.
export class PackageBatch {
  constructor(scene, template, records) {
    this.scene = scene;
    this.records = records;
    this.meshes = [];
    this.parts = [];
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      // Corrugation is reserved for the close-up model; the sealed silhouette is identical.
      if (o.name.includes('corrugated') || o.name.includes('crimp') || o.name === 'pack-torn-edge')
        return;
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, records.length);
      mesh.name = o.name + '-instances';
      mesh.castShadow = o.castShadow;
      mesh.receiveShadow = o.receiveShadow;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Three clears ranges after updates, but its first full upload leaves them.
      mesh.instanceMatrix.onUpload(() => mesh.instanceMatrix.clearUpdateRanges());
      mesh.userData.records = records;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.parts.push(o.matrixWorld.clone());
    });
    this.shadowBatch = createInstancedShadowMeshes(this.meshes, this.parts, records.length);
    for (const mesh of this.shadowBatch.meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.onUpload(() => mesh.instanceMatrix.clearUpdateRanges());
      mesh.userData.records = records;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.parts.push(new THREE.Matrix4());
    }
    this.matrix = new THREE.Matrix4();
    this.world = new THREE.Matrix4();
    this.scale = new THREE.Vector3(1, 1, 1);
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.last = new Float64Array(records.length * 8);
    this.last.fill(NaN);
    this.updates = 0;
  }
  update() {
    let changed = false;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i],
        body = r.body,
        interpolating =
          body.type === body.constructor.DYNAMIC && body.sleepState !== body.constructor.SLEEPING,
        p = interpolating ? body.interpolatedPosition : body.position,
        q = interpolating ? body.interpolatedQuaternion : body.quaternion;
      const offset = i * 8,
        visible = r.hidden ? 0 : 1,
        last = this.last;
      if (
        p.x === last[offset] &&
        p.y === last[offset + 1] &&
        p.z === last[offset + 2] &&
        q.x === last[offset + 3] &&
        q.y === last[offset + 4] &&
        q.z === last[offset + 5] &&
        q.w === last[offset + 6] &&
        visible === last[offset + 7]
      )
        continue;
      last[offset] = p.x;
      last[offset + 1] = p.y;
      last[offset + 2] = p.z;
      last[offset + 3] = q.x;
      last[offset + 4] = q.y;
      last[offset + 5] = q.z;
      last[offset + 6] = q.w;
      last[offset + 7] = visible;
      changed = true;
      this.updates++;
      this.position.set(p.x, p.y, p.z);
      this.rotation.set(q.x, q.y, q.z, q.w);
      this.scale.setScalar(r.hidden ? 0 : 1);
      this.world.compose(this.position, this.rotation, this.scale);
      for (let j = 0; j < this.meshes.length; j++) {
        this.meshes[j].setMatrixAt(i, this.matrix.multiplyMatrices(this.world, this.parts[j]));
        this.meshes[j].instanceMatrix.addUpdateRange(i * 16, 16);
      }
    }
    if (changed)
      this.meshes.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
      });
    return changed;
  }
  dispose() {
    this.meshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.dispose();
    });
    this.shadowBatch.dispose();
  }
}
