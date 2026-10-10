import * as THREE from '../../src/vendor/three.module.js';
import { createFinishLibrary } from '../../src/scene/material-finishes.js';

const $ = (id) => document.getElementById(id),
  stage = $('stage');
const shortLabels = Object.fromEntries(
  ['SR', 'UR', 'SER', 'UL', 'CR', 'PSER', 'GMR', 'UR-OF', 'PSER-OF'].map((id) => [
    id,
    id === 'UL' ? 'UTR' : id,
  ]),
);
let renderer,
  library,
  resizeObserver,
  frame = 0,
  disposed = false;
try {
  const response = await fetch(new URL('./samples.json', import.meta.url));
  if (!response.ok) throw new Error('样卡清单加载失败');
  const manifest = await response.json();
  library = await createFinishLibrary(manifest, import.meta.url);
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
  renderer.domElement.setAttribute('aria-label', '日版卡面，可拖动旋转和滚轮缩放');
  stage.append(renderer.domElement);
  $('status').hidden = true;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#edf5ff', '#263a50', 2.1));
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
  camera.position.z = 10.8;
  const cards = manifest.map((d) => library.create(d.id));
  cards.forEach((c) => scene.add(c));
  cards.forEach((c) => (c.userData.finish.uniforms.diffuseIntensity.value = 0.25));
  let selected = 0,
    cardType = 'overview',
    compare = false,
    auto = false,
    reverse = false,
    zoom = 1,
    rotX = 0.08,
    rotY = -0.16;
  let pointer = null,
    dragged = false,
    lastTime = 0,
    width = 0,
    height = 0,
    renderCount = 0;
  let lightAz = -25,
    lightEl = 30;
  const light = new THREE.Vector3(),
    labels = [];
  const styles = Object.keys(shortLabels);
  function visibleIndices() {
    return manifest
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => (cardType === 'overview' ? s.id === s.style : s.cardType === cardType))
      .sort((a, b) => styles.indexOf(a.s.style) - styles.indexOf(b.s.style))
      .map(({ i }) => i);
  }
  const buttons = manifest.map((sample, i) => {
    const button = document.createElement('button');
    button.className = 'sample';
    button.dataset.id = sample.id;
    button.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    const img = new Image();
    img.src = new URL(sample.front, import.meta.url).href;
    img.alt = '';
    img.loading = 'lazy';
    const body = document.createElement('span'),
      strong = document.createElement('strong'),
      small = document.createElement('small');
    strong.textContent = shortLabels[sample.style];
    small.textContent = shortLabels[sample.style];
    body.append(strong, small);
    const index = document.createElement('span');
    index.className = 'index';
    index.textContent = String(i + 1).padStart(2, '0');
    button.append(img, body, index);
    button.addEventListener('click', () => select(i));
    $('samples').append(button);
    return button;
  });
  function invalidate() {
    if (!frame && !document.hidden && !disposed) frame = requestAnimationFrame(draw);
  }
  function updateLight() {
    const a = THREE.MathUtils.degToRad(lightAz),
      e = THREE.MathUtils.degToRad(lightEl);
    light.set(Math.sin(a) * Math.cos(e) * 10, Math.sin(e) * 10, Math.cos(a) * Math.cos(e) * 10);
    cards.forEach((c) => c.userData.finish.uniforms.lightPosition.value.copy(light));
    $('azimuth').value = lightAz;
    $('elevation').value = lightEl;
    $('azimuth-value').textContent = `${Math.round(lightAz)}°`;
    $('elevation-value').textContent = `${Math.round(lightEl)}°`;
    $('light-dot').style.left = `${((lightAz + 80) / 160) * 100}%`;
    $('light-dot').style.top = `${((65 - lightEl) / 130) * 100}%`;
    $('light-pad').setAttribute('aria-valuenow', Math.round(lightAz));
    invalidate();
  }
  function info() {
    const s = manifest[selected];
    $('rarity').textContent = shortLabels[s.style];
    $('rarity-name').textContent = shortLabels[s.style];
    $('layout').textContent = s.overframe ? '超框' : '通常卡框';
    $('card-name').textContent = s.nameJa;
    $('card-id').textContent = s.cardId + (s.serial ? ` · ${s.serial}` : '');
    const visible = visibleIndices(),
      total = String(visible.length).padStart(2, '0');
    $('count').textContent =
      `${compare ? total : String(visible.indexOf(selected) + 1).padStart(2, '0')} / ${total}`;
    $('sample-total').textContent = total;
    buttons.forEach((b, i) => {
      b.hidden = !visible.includes(i);
      b.style.order = visible.indexOf(i);
      b.querySelector('.index').textContent = String(visible.indexOf(i) + 1).padStart(2, '0');
      b.setAttribute('aria-pressed', String(i === selected));
    });
  }
  function layout() {
    labels.splice(0).forEach((l) => l.remove());
    const visible = visibleIndices();
    cards.forEach((c) => (c.visible = false));
    if (compare) {
      const columns = 3,
        rows = Math.ceil(visible.length / columns);
      const usableH = Math.max(160, height - 16),
        cellW = width / columns,
        cellH = usableH / rows;
      const scale = Math.min(cellW / 3.6, cellH / 5.05) / 100;
      camera.position.z = 10.8;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      const worldPerPixel = visibleH / height;
      visible.forEach((i, tile) => {
        const c = cards[i];
        c.visible = true;
        c.scale.setScalar(scale * 100 * worldPerPixel * zoom);
        const col = tile % columns,
          row = Math.floor(tile / columns);
        c.position.set(
          ((col + 0.5) * cellW - width / 2) * worldPerPixel,
          (height / 2 - (row + 0.5) * cellH + 8) * worldPerPixel,
          0,
        );
        const label = document.createElement('span');
        label.className = 'compare-label';
        label.textContent = shortLabels[manifest[i].style];
        const small = document.createElement('small');
        small.textContent = manifest[i].overframe ? '超框' : '';
        label.append(small);
        label.style.left = `${(col + 0.5) * cellW}px`;
        label.style.top = `${(row + 1) * cellH - 20}px`;
        stage.append(label);
        labels.push(label);
      });
    } else {
      cards.forEach((c, i) => {
        c.visible = i === selected;
        c.position.set(0, 0, 0);
        c.scale.setScalar(1);
      });
      camera.position.z = Math.max(10.3, (10.3 / (width / height)) * 0.79) / zoom;
    }
    info();
    invalidate();
  }
  function size() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    layout();
  }
  function draw(time) {
    frame = 0;
    const dt = Math.min((time - lastTime) / 1000, 0.05) || 0;
    lastTime = time;
    if (auto && !pointer) {
      rotY += dt * 0.3;
      rotX = 0.1 + Math.sin(time * 0.00045) * 0.18;
    }
    for (const card of cards) {
      card.rotation.set(rotX, rotY + (reverse ? Math.PI : 0), 0);
    }
    renderer.render(scene, camera);
    renderCount++;
    if (auto) invalidate();
  }
  function select(i) {
    if (!visibleIndices().includes(i)) {
      cardType = manifest[i].cardType;
      $('card-type').value = cardType;
    }
    selected = i;
    reverse = false;
    $('back').setAttribute('aria-pressed', 'false');
    $('back').textContent = '查看背面';
    layout();
  }
  function mode(value) {
    compare = value;
    zoom = 1;
    $('single').setAttribute('aria-pressed', String(!value));
    $('compare').setAttribute('aria-pressed', String(value));
    layout();
  }
  $('single').addEventListener('click', () => mode(false));
  $('compare').addEventListener('click', () => mode(true));
  $('card-type').addEventListener('change', (e) => {
    const previousStyle = manifest[selected].style;
    cardType = e.target.value;
    const visible = visibleIndices();
    select(visible.find((i) => manifest[i].style === previousStyle) ?? visible[0]);
  });
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    dragged = false;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const dx = e.clientX - pointer.x,
      dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    dragged ||= Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 5;
    rotY += dx * 0.009;
    rotX = THREE.MathUtils.clamp(rotX + dy * 0.009, -1.25, 1.25);
    invalidate();
  });
  function release(e) {
    if (!pointer || pointer.id !== e.pointerId) return;
    if (compare && !dragged && e.type === 'pointerup') {
      const r = stage.getBoundingClientRect(),
        col = Math.min(2, Math.floor(((e.clientX - r.left) / width) * 3)),
        row = Math.floor(
          ((e.clientY - r.top) / (height - 16)) * Math.ceil(visibleIndices().length / 3),
        );
      const i = visibleIndices()[Math.max(0, row * 3 + col)];
      if (i !== undefined) {
        select(i);
        mode(false);
      }
    }
    pointer = null;
    invalidate();
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom * Math.exp(-e.deltaY * 0.001), 0.72, 1.8);
      layout();
    },
    { passive: false },
  );
  $('azimuth').addEventListener('input', (e) => {
    lightAz = Number(e.target.value);
    updateLight();
  });
  $('elevation').addEventListener('input', (e) => {
    lightEl = Number(e.target.value);
    updateLight();
  });
  $('exposure').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    cards.forEach((c) => (c.userData.finish.uniforms.exposure.value = v));
    $('exposure-value').textContent = `${Math.round(v * 100)}%`;
    invalidate();
  });
  $('ambient').addEventListener('input', (e) => {
    const value = Number(e.target.value) / 100;
    cards.forEach((c) => (c.userData.finish.uniforms.diffuseIntensity.value = value));
    $('ambient-value').textContent = `${Math.round(value * 100)}%`;
    invalidate();
  });
  let lightPointer = null;
  function padMove(e) {
    const r = $('light-pad').getBoundingClientRect();
    lightAz = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 160 - 80, -80, 80);
    lightEl = THREE.MathUtils.clamp(65 - ((e.clientY - r.top) / r.height) * 130, -65, 65);
    updateLight();
  }
  $('light-pad').addEventListener('pointerdown', (e) => {
    lightPointer = e.pointerId;
    $('light-pad').setPointerCapture(e.pointerId);
    padMove(e);
  });
  $('light-pad').addEventListener('pointermove', (e) => {
    if (lightPointer === e.pointerId) padMove(e);
  });
  for (const name of ['pointerup', 'pointercancel'])
    $('light-pad').addEventListener(name, () => (lightPointer = null));
  $('light-pad').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    lightAz = THREE.MathUtils.clamp(
      lightAz + (e.key === 'ArrowLeft' ? -3 : e.key === 'ArrowRight' ? 3 : 0),
      -80,
      80,
    );
    lightEl = THREE.MathUtils.clamp(
      lightEl + (e.key === 'ArrowDown' ? -3 : e.key === 'ArrowUp' ? 3 : 0),
      -65,
      65,
    );
    updateLight();
  });
  for (const [id, uniform] of [
    ['foil', 'foilEnabled'],
    ['relief', 'reliefEnabled'],
  ])
    $(id).addEventListener('change', (e) => {
      cards.forEach((c) => (c.userData.finish.uniforms[uniform].value = Number(e.target.checked)));
      invalidate();
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
    auto = false;
    reverse = false;
    rotX = 0.08;
    rotY = -0.16;
    zoom = 1;
    lightAz = -25;
    lightEl = 30;
    $('turn').setAttribute('aria-pressed', 'false');
    $('back').setAttribute('aria-pressed', 'false');
    $('back').textContent = '查看背面';
    updateLight();
    layout();
  });
  $('capture').addEventListener('click', () => {
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d'),
      ratio = canvas.width / width;
    ctx.fillStyle = '#102035';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderer.domElement, 0, 0);
    ctx.fillStyle = '#a0e6f5';
    ctx.font = `${Math.round(13 * ratio)}px Segoe UI`;
    ctx.textAlign = compare ? 'center' : 'left';
    if (compare) {
      labels.forEach((label, i) =>
        ctx.fillText(
          shortLabels[manifest[visibleIndices()[i]].style],
          parseFloat(label.style.left) * ratio,
          (parseFloat(label.style.top) + 14) * ratio,
        ),
      );
    } else {
      ctx.fillText(`${manifest[selected].id} · JP`, 18 * ratio, 24 * ratio);
    }
    const a = document.createElement('a');
    a.download = `LOCR-JP-${compare ? 'comparison' : manifest[selected].id}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
  resizeObserver = new ResizeObserver(size);
  resizeObserver.observe(stage);
  updateLight();
  info();
  size();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      lastTime = performance.now();
      invalidate();
    }
  });
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    $('status').hidden = false;
    $('status').textContent = '预览已暂停，请刷新恢复';
  });
  // Read-only diagnostics also used by the material/interaction review test.
  window.materialReview = {
    ready: true,
    manifest,
    inspect: () => {
      const geometry = cards[selected].children[0].geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      return {
        selected: manifest[selected].id,
        cardType,
        visible: visibleIndices().map((i) => manifest[i].id),
        compare,
        auto,
        reverse,
        zoom,
        rotX,
        rotY,
        renderCount,
        ambient: cards[selected].userData.finish.uniforms.diffuseIntensity.value,
        faceSize: [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y],
        calls: renderer.info.render.calls,
        textures: renderer.info.memory.textures,
        light: [...light],
      };
    },
    pose: (x, y) => {
      rotX = x;
      rotY = y;
      invalidate();
    },
    select: (id) => {
      const i = manifest.findIndex((d) => d.id === id);
      if (i < 0) throw new Error('Unknown sample');
      select(i);
    },
    mode,
    light: (az, el) => {
      lightAz = THREE.MathUtils.clamp(az, -80, 80);
      lightEl = THREE.MathUtils.clamp(el, -65, 65);
      updateLight();
    },
  };
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      library.dispose();
      renderer.dispose();
    },
    { once: true },
  );
} catch (error) {
  stage.classList.add('failed');
  $('status').hidden = false;
  $('status').textContent = '样卡加载失败，请刷新重试';
  library?.dispose();
  renderer?.dispose();
  console.error(error);
}
