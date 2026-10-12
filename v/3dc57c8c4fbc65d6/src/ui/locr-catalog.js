import * as THREE from '../vendor/three.module.js';
import { createFinishLibrary } from '../scene/material-finishes.js';
import { CARD_CATALOG } from '../game/card-data.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const baseUrl = new URL('../../public/locr-catalog/', import.meta.url);
const shortLabels = Object.fromEntries(
  ['SR', 'UR', 'SER', 'UL', 'CR', 'PSER', 'GMR', 'UR-OF', 'PSER-OF'].map((id) => [
    id,
    id === 'UL' ? 'UTR' : id,
  ]),
);
let library,
  renderer,
  observer,
  frame = 0,
  disposed = false,
  loading = 0;
try {
  const manifestResponse = await fetch(new URL('manifest.json', baseUrl));
  if (!manifestResponse.ok) throw new Error('全卡清单加载失败');
  const manifest = await manifestResponse.json(),
    catalog = CARD_CATALOG;
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.setClearColor('#000000', 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.setAttribute('aria-label', 'LOCR 卡面，可拖动旋转和滚轮缩放');
  stage.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
  camera.position.z = 10.8;
  let cards = [],
    entries = [],
    selected = 0,
    currentCard = '',
    compare = false,
    auto = false,
    reverse = false;
  let zoom = 1,
    rotX = 0.08,
    rotY = -0.16,
    lastTime = 0,
    width = 0,
    height = 0,
    renderCount = 0;
  let lightAz = -25,
    lightEl = 30,
    pointer = null,
    lightPointer = null;
  const labels = [];
  function invalidate() {
    if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function draw(time) {
    frame = 0;
    const dt = Math.min((time - lastTime) / 1000, 0.05) || 0;
    lastTime = time;
    if (auto && !pointer) {
      rotY += dt * 0.3;
      rotX = 0.1 + Math.sin(time * 0.00045) * 0.18;
    }
    cards.forEach((card) => card.rotation.set(rotX, rotY + (reverse ? Math.PI : 0), 0));
    renderer.render(scene, camera);
    renderCount++;
    if (auto) invalidate();
  }
  function uniforms() {
    const az = THREE.MathUtils.degToRad(lightAz),
      el = THREE.MathUtils.degToRad(lightEl);
    const light = new THREE.Vector3(
      Math.sin(az) * Math.cos(el) * 10,
      Math.sin(el) * 10,
      Math.cos(az) * Math.cos(el) * 10,
    );
    cards.forEach((card) => {
      const u = card.userData.finish.uniforms;
      u.lightPosition.value.copy(light);
      u.exposure.value = Number($('exposure').value) / 100;
      u.diffuseIntensity.value = Number($('ambient').value) / 100;
      u.foilEnabled.value = Number($('foil').checked);
      u.reliefEnabled.value = Number($('relief').checked);
    });
    $('azimuth').value = lightAz;
    $('elevation').value = lightEl;
    $('azimuth-value').textContent = `${Math.round(lightAz)}°`;
    $('elevation-value').textContent = `${Math.round(lightEl)}°`;
    $('exposure-value').textContent = `${$('exposure').value}%`;
    $('ambient-value').textContent = `${$('ambient').value}%`;
    $('light-dot').style.left = `${((lightAz + 80) / 160) * 100}%`;
    $('light-dot').style.top = `${((65 - lightEl) / 130) * 100}%`;
    $('light-pad').setAttribute('aria-valuenow', Math.round(lightAz));
    invalidate();
  }
  function info() {
    const entry = entries[selected];
    if (!entry) return;
    $('rarity').textContent = shortLabels[entry.style];
    $('rarity-name').textContent = shortLabels[entry.style];
    $('layout').textContent =
      entry.rarity === 'GMR' ? 'GMR 卡框' : entry.overframe ? '出框' : '普通卡框';
    $('card-name').textContent = entry.nameZh + ' · ' + entry.nameJa;
    $('card-id').textContent = entry.cardId;
    $('serial-note').hidden = entry.rarity !== 'GMR';
    $('count').textContent = `${selected + 1} / ${entries.length} · 318规格`;
    $('variants').replaceChildren(
      ...entries.map((data, index) => {
        const button = document.createElement('button');
        button.textContent = shortLabels[data.style];
        button.dataset.style = data.style;
        button.setAttribute('aria-pressed', String(index === selected));
        button.addEventListener('click', () => {
          selected = index;
          reverse = false;
          $('back').textContent = '查看背面';
          $('back').setAttribute('aria-pressed', 'false');
          layout();
        });
        return button;
      }),
    );
  }
  function layout() {
    labels.splice(0).forEach((label) => label.remove());
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.position.z = compare ? 10.8 : Math.max(10.3, (10.3 / camera.aspect) * 0.79) / zoom;
    camera.updateProjectionMatrix();
    const columns = entries.length > 3 ? 3 : entries.length;
    const rows = Math.ceil(entries.length / Math.max(columns, 1));
    const worldPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z) / height;
    cards.forEach((card, index) => {
      card.visible = compare || index === selected;
      card.position.set(0, 0, 0);
      card.scale.setScalar(1);
      if (!compare) return;
      const cellW = width / columns,
        cellH = (height - 16) / rows;
      card.scale.setScalar(Math.min(cellW / 3.6, cellH / 5.05) * worldPerPixel * zoom);
      card.position.set(
        (((index % columns) + 0.5) * cellW - width / 2) * worldPerPixel,
        (height / 2 - (Math.floor(index / columns) + 0.5) * cellH + 8) * worldPerPixel,
        0,
      );
      const label = document.createElement('span');
      label.className = 'compare-label';
      label.textContent = shortLabels[entries[index].style];
      label.style.left = `${((index % columns) + 0.5) * cellW}px`;
      label.style.top = `${(Math.floor(index / columns) + 1) * cellH - 20}px`;
      stage.append(label);
      labels.push(label);
    });
    info();
    invalidate();
  }
  function resize() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    layout();
  }
  const buttons = catalog.map((card) => {
    const button = document.createElement('button');
    button.className = 'sample';
    button.dataset.cardId = card.cardId;
    const img = new Image();
    img.src = new URL(manifest.find((entry) => entry.cardId === card.cardId).front, baseUrl).href;
    img.alt = '';
    img.loading = 'lazy';
    const body = document.createElement('span'),
      name = document.createElement('strong'),
      detail = document.createElement('small');
    name.textContent = card.nameZh;
    detail.textContent = `${card.cardId} · ${card.variants.length}规格`;
    body.append(name, detail);
    button.append(img, body);
    button.addEventListener('click', () => selectCard(card.cardId).catch(fail));
    $('samples').append(button);
    return button;
  });
  function filter() {
    const query = $('search').value.trim().toLocaleLowerCase(),
      type = $('card-type').value,
      style = $('rarity-filter').value;
    let count = 0;
    catalog.forEach((card, index) => {
      const matches =
        [card.nameZh, card.nameJa, card.cardId, String(card.password)]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query) &&
        (type === 'all' || card.cardType === type) &&
        (style === 'all' ||
          card.variants.some((id) => manifest.find((entry) => entry.id === id).style === style));
      buttons[index].hidden = !matches;
      if (matches) count++;
    });
    $('sample-total').textContent = count;
    $('empty').hidden = count !== 0;
  }
  async function selectCard(id) {
    const data = manifest.filter((entry) => entry.cardId === id);
    if (!data.length) throw new Error(`Unknown card: ${id}`);
    const token = ++loading,
      previousStyle = entries[selected]?.style;
    window.locrCatalog.ready = false;
    $('status').hidden = false;
    $('status').textContent = '加载卡面…';
    const nextLibrary = await createFinishLibrary(data, baseUrl);
    if (token !== loading || disposed) {
      nextLibrary.dispose();
      return;
    }
    cards.forEach((card) => scene.remove(card));
    library?.dispose();
    library = nextLibrary;
    entries = data;
    cards = data.map((entry) => library.create(entry.id));
    cards.forEach((card) => scene.add(card));
    currentCard = id;
    selected = Math.max(
      0,
      data.findIndex(
        (entry) =>
          entry.style ===
          ($('rarity-filter').value === 'all' ? previousStyle : $('rarity-filter').value),
      ),
    );
    reverse = false;
    $('back').setAttribute('aria-pressed', 'false');
    $('back').textContent = '查看背面';
    buttons.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.cardId === id)),
    );
    $('status').hidden = true;
    uniforms();
    layout();
    window.locrCatalog.ready = true;
  }
  function mode(value) {
    compare = value;
    zoom = 1;
    $('single').setAttribute('aria-pressed', String(!value));
    $('compare').setAttribute('aria-pressed', String(value));
    layout();
  }
  function fail(error) {
    $('status').hidden = false;
    $('status').textContent = error.message;
    console.error(error);
  }
  ['search', 'card-type', 'rarity-filter'].forEach((id) =>
    $(id).addEventListener(id === 'search' ? 'input' : 'change', filter),
  );
  $('single').addEventListener('click', () => mode(false));
  $('compare').addEventListener('click', () => mode(true));
  stage.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
    }
  });
  stage.addEventListener('pointermove', (event) => {
    if (pointer?.id !== event.pointerId) return;
    rotY += (event.clientX - pointer.x) * 0.009;
    rotX = THREE.MathUtils.clamp(rotX + (event.clientY - pointer.y) * 0.009, -1.25, 1.25);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    invalidate();
  });
  ['pointerup', 'pointercancel'].forEach((name) =>
    stage.addEventListener(name, () => {
      pointer = null;
    }),
  );
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.72, 1.8);
      layout();
    },
    { passive: false },
  );
  ['azimuth', 'elevation', 'exposure', 'ambient'].forEach((id) =>
    $(id).addEventListener('input', () => {
      lightAz = Number($('azimuth').value);
      lightEl = Number($('elevation').value);
      uniforms();
    }),
  );
  ['foil', 'relief'].forEach((id) => $(id).addEventListener('change', uniforms));
  function padMove(event) {
    const rect = $('light-pad').getBoundingClientRect();
    lightAz = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 160 - 80, -80, 80);
    lightEl = THREE.MathUtils.clamp(65 - ((event.clientY - rect.top) / rect.height) * 130, -65, 65);
    uniforms();
  }
  $('light-pad').addEventListener('pointerdown', (event) => {
    lightPointer = event.pointerId;
    $('light-pad').setPointerCapture(event.pointerId);
    padMove(event);
  });
  $('light-pad').addEventListener('pointermove', (event) => {
    if (event.pointerId === lightPointer) padMove(event);
  });
  ['pointerup', 'pointercancel'].forEach((name) =>
    $('light-pad').addEventListener(name, () => {
      lightPointer = null;
    }),
  );
  $('light-pad').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    lightAz = THREE.MathUtils.clamp(
      lightAz + (event.key === 'ArrowLeft' ? -3 : event.key === 'ArrowRight' ? 3 : 0),
      -80,
      80,
    );
    lightEl = THREE.MathUtils.clamp(
      lightEl + (event.key === 'ArrowDown' ? -3 : event.key === 'ArrowUp' ? 3 : 0),
      -65,
      65,
    );
    uniforms();
  });
  $('turn').addEventListener('click', () => {
    auto = !auto;
    $('turn').setAttribute('aria-pressed', String(auto));
    lastTime = performance.now();
    invalidate();
  });
  $('back').addEventListener('click', () => {
    reverse = !reverse;
    $('back').setAttribute('aria-pressed', String(reverse));
    $('back').textContent = reverse ? '查看正面' : '查看背面';
    invalidate();
  });
  $('reset').addEventListener('click', () => {
    auto = reverse = false;
    rotX = 0.08;
    rotY = -0.16;
    zoom = 1;
    lightAz = -25;
    lightEl = 30;
    $('turn').setAttribute('aria-pressed', 'false');
    $('back').setAttribute('aria-pressed', 'false');
    $('back').textContent = '查看背面';
    uniforms();
    layout();
  });
  $('capture').addEventListener('click', () => {
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.download = compare ? `${currentCard}-comparison.png` : `${entries[selected].id}.png`;
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
  });
  window.locrCatalog = {
    ready: false,
    manifest,
    catalog,
    selectCard,
    mode,
    selectVariant(style) {
      const index = entries.findIndex((entry) => entry.style === style);
      if (index < 0) throw new Error(`Unavailable style: ${style}`);
      selected = index;
      layout();
    },
    light(az, el) {
      lightAz = az;
      lightEl = el;
      uniforms();
    },
    inspect: () => ({
      cardId: currentCard,
      selected: entries[selected]?.id,
      entries: entries.map((entry) => entry.id),
      compare,
      renderCount,
      textures: renderer.info.memory.textures,
      calls: renderer.info.render.calls,
      programs: renderer.info.programs.length,
    }),
  };
  observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      lastTime = performance.now();
      invalidate();
    }
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    $('status').hidden = false;
    $('status').textContent = '预览已暂停，请刷新恢复';
  });
  addEventListener(
    'pagehide',
    () => {
      disposed = true;
      loading++;
      cancelAnimationFrame(frame);
      observer.disconnect();
      library?.dispose();
      renderer.dispose();
    },
    { once: true },
  );
  const initial = new URLSearchParams(location.search).get('card');
  await selectCard(catalog.some((card) => card.cardId === initial) ? initial : catalog[0].cardId);
} catch (error) {
  $('status').hidden = false;
  $('status').textContent = `无法打开全卡图鉴：${error.message}`;
  console.error(error);
}
