import * as THREE from '../vendor/three.module.js';
import * as CANNON from '../vendor/cannon-es.js';
import { createPackageLibrary, PackageBatch, SIZES } from './packages3d.js';
import {
  caseSlots,
  boxSlots,
  cardSlots,
  MODEL_SCALE,
  CARD_SIZE,
  CARD_STEP,
  PACK_STEP,
  WITHDRAW_CARD,
  WITHDRAW_PACK,
  smooth,
  tabletopPacks,
  tableCards,
} from './packing.js';
import { extractItem, openPacks, openBoxFully, PRODUCTS, routeStackCards } from '../game/model.js';
import { itemProduct, productIdOf } from '../game/products.js';
import { stackSaleValue, sellStack } from '../game/sales.js';
import { createCardInspector } from '../ui/card-inspector.js';
import { createRoomDamage } from './room-damage.js';
import { createRoomSolver } from './room-solver.js';
import { volume, surfacePosition } from './tabletop.js';
import { createDeskScene } from './desk-scene.js';
import { RoomQuality } from './room-quality.js';
import { prepareRenderer } from './prepare-renderer.js';
import { FAST_WEB, roomPixelRatio } from './web-performance.js';
import { scheduleResourceTask } from './resource-scheduler.js';
import { ROOM_ZOOM, ROOM_PHI, clampRoomDistance, roomDropHeight } from './room-view.js';
import { planDeskLayout } from './desk-layout.js';
import {
  CARD_PAD,
  CARD_PAD_QUATERNION,
  cardPadBounds,
  createCardPad,
  findCardPadPosition,
} from './card-pad.js';

const names = { case: '整箱', box: '卡盒', pack: '卡包', bonus: '特别包 vol.2' };
const isPack = (kind) => kind === 'pack' || kind === 'bonus';
const ease = (t) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = THREE.MathUtils.lerp;

export function createWorld3D(host, options) {
  return new UnboxingWorld(host, options);
}

class UnboxingWorld {
  constructor(host, options) {
    this.host = host;
    this.options = options;
    this.records = [];
    this.batches = [];
    this.cards = [];
    this.containers = [];
    this.disposed = false;
    this.organizeButton = host.querySelector('[data-action="organize-space"]');
    if (this.organizeButton) this.organizeButton.disabled = true;
    this.start = performance.now();
    this.elapsed = 0;
    this.frame = 0;
    this.previous = this.start;
    this.animations = [];
    this.tableStacks = [];
    this.selected = new Set();
    this.pointer = null;
    this.drag = null;
    this.hover = null;
    this.effects = [];
    this.resources = [];
    this.needsRender = true;
    this.shadowDirty = true;
    this.renderPrepared = false;
    this.saveDirty = false;
    this.stats = {
      renders: 0,
      physicsSteps: 0,
      frameMs: 0,
      quality: 1,
      ticks: 0,
      shadowUpdates: 0,
      obscuredTicks: 0,
      stackCompactions: 0,
      stackBodies: 0,
    };
    this.lastRenderAt = 0;
    this.lastShadowAt = -Infinity;
    this.quality = new RoomQuality(
      host.clientWidth,
      host.clientHeight,
      FAST_WEB ? 1 : window.devicePixelRatio,
    );
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.point = new THREE.Vector3();
    const inventory = options.state.items.length;
    const originalWidth = Math.max(9.8, Math.min(28, Math.sqrt(inventory) * 0.8));
    this.halfWidth = originalWidth + 2.2;
    this.halfDepth = this.halfWidth * 0.72;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04143f');
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.08, 150);
    this.orbit = { theta: 0, phi: ROOM_PHI, distance: ROOM_ZOOM.max };
    this.target = new THREE.Vector3(0, 0.04, 0);
    const view = options.state.spaceView;
    if (view) this.orbit.distance = clampRoomDistance(view.orbit.distance);
    this.viewClamped = !!view && view.orbit.distance !== this.orbit.distance;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !FAST_WEB,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // applyRenderSize sets the full requested DPR before the first draw. Avoid
    // reallocating the default, hidden 300x150 buffer during construction.
    this.renderer.shadowMap.enabled = !FAST_WEB;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.toneMappingExposure = (0.85 * options.state.settings.brightness) / 85;
    this.canvas = this.renderer.domElement;
    this.canvas.dataset.finishWarmIdle = 'false';
    this.canvas.className = 'world3d-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      'aria-label',
      '开卡桌面。拖动拿取和叠放，保持物品朝向。双击拆封，右键批量操作卡盒、卡包和卡堆，滚轮缩放。点击手机购买、左上收藏册进入收藏、右上纸箱进入仓库。',
    );
    this.canvas.dataset.engine = 'three-webgl';
    this.canvas.dataset.ready = 'false';
    this.canvas.style.visibility = 'hidden';
    host.prepend(this.canvas);
    this.canvas.world3D = {
      snapshot: () => this.snapshot(),
      geometry: () => this.geometrySnapshot(),
      projectItem: (id) => this.projectItem(id),
      projectCard: (i) => this.projectCard(i),
      projectPoint: (p) => this.projectPoint(p),
      hitAt: (x, y) => this.hitAt(x, y),
      escape: () => this.escape(),
    };
    this.accessibility = document.createElement('div');
    this.accessibility.className = 'world3d-accessibility';
    this.accessibility.setAttribute('aria-label', '可拆封物品与卡牌');
    host.append(this.accessibility);
    this.physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0), allowSleep: true });
    this.physics.broadphase = new CANNON.SAPBroadphase(this.physics);
    this.physics.solver = createRoomSolver();
    this.physics.defaultContactMaterial.friction = 0.7;
    this.physics.defaultContactMaterial.restitution = 0;
    this.createRoom();
    this.updateCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => {
      // Input can arrive faster than presentation. Only the newest position
      // needs collision placement; pointer-up flushes it before releasing.
      if (this.pointer) {
        if (this.pointer.id !== e.pointerId) return;
        this.pendingPointerMove = {
          pointerId: e.pointerId,
          clientX: e.clientX,
          clientY: e.clientY,
        };
      } else this.pendingHover = { clientX: e.clientX, clientY: e.clientY };
      this.wake();
    };
    this.onUp = (e) => this.pointerUp(e);
    this.onWheel = (e) => {
      e.preventDefault();
      if (this.inspector) return;
      const distance = clampRoomDistance(
        this.orbit.distance * Math.exp(Math.max(-20, Math.min(20, e.deltaY * 0.001))),
      );
      if (distance === this.orbit.distance) return;
      this.zoomActive = true;
      this.orbit.distance = distance;
      this.updateCamera();
      clearTimeout(this.viewSaveTimer);
      this.viewSaveTimer = setTimeout(() => {
        if (!this.disposed) {
          this.zoomActive = false;
          this.lastRenderAt = 0;
          this.persist();
        }
      }, 180);
    };
    this.onContext = (e) => e.preventDefault();
    this.onCancel = (e) => this.cancelPointer(e);
    this.onLost = (e) => {
      e.preventDefault();
      this.options.toast('3D 显示暂时中断，请返回主界面后重新进入开盒空间。');
    };
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.onDouble = (e) => {
      const hit = this.hit(e);
      if (hit?.record && this.lastClick === hit.record.item.id && !this.drag)
        this.openRecord(hit.record);
      this.lastClick = null;
    };
    this.canvas.addEventListener('dblclick', this.onDouble);
    this.onKey = (e) => {
      if (e.key !== 'Enter' || this.pointer || this.inspector) return;
      e.preventDefault();
      const record = this.records.find((r) => this.selected.has(r.item.id));
      if (e.shiftKey && this.selected.size === 1 && isPack(record?.item.kind)) {
        const packs = this.nearestPacks(record);
        if (packs.length === 5) this.openPackRecords(packs);
        else this.options.toast('至少需要 5 包才能一起打开');
      } else this.openSelected();
    };
    this.canvas.addEventListener('keydown', this.onKey);
    this.onCaptureLost = () => {
      if (this.pointer) this.cancelPointer();
    };
    this.canvas.addEventListener('lostpointercapture', this.onCaptureLost);
    const help = document.createElement('div');
    help.className = 'desk-help';
    help.innerHTML =
      '<span><kbd>双击</kbd> 拆封</span><span><kbd>右键</kbd> 批量操作卡盒、卡包和卡堆</span><span><kbd>滚轮</kbd> 缩放</span>';
    host.append(help);
    this.help = help;
    const initialSets = [
      ...this.options.state.items.map((item) => itemProduct(item).set),
      ...(this.options.state.containers ?? []).map(
        (container) => PRODUCTS[container.productId ?? 'case'].set,
      ),
    ];
    this.ready = createPackageLibrary(() => {
      this.needsRender = true;
      this.wake();
    }, initialSets)
      .then(async (library) => {
        if (this.disposed) {
          library.dispose();
          return;
        }
        this.library = library;
        this.migrateModelScale();
        for (const container of (this.options.state.containers ??= [])) {
          await scheduleResourceTask(() => this.addContainer(container), {
            valid: () => !this.disposed,
          });
        }
        const initial = [...this.options.state.items].sort(
          (a, b) => Number(b.isNew) - Number(a.isNew),
        );
        for (let index = 0; index < initial.length; index += 4) {
          await scheduleResourceTask(
            () => {
              initial
                .slice(index, index + 4)
                .forEach((item, offset) =>
                  this.addRecord(item, { initial: true, index: index + offset }),
                );
            },
            { valid: () => !this.disposed },
          );
        }
        if (this.disposed) return;
        this.clearEmptyContainers();
        this.rebuildBatches();
        this.syncAccessibility();
        for (const stack of (this.options.state.cardStacks ??= [])) {
          await scheduleResourceTask(() => this.restoreCardStack(stack), {
            valid: () => !this.disposed,
          });
        }
        await Promise.all(this.tableStacks.map((stack) => stack.visual?.userData.finishReady));
        if (this.disposed) return;
        await prepareRenderer(this.renderer, this.scene, this.camera, () => !this.disposed);
        if (this.disposed) return;
        await this.preparePackageSamples(this.options.state.items);
        if (this.disposed) return;
        this.damageRenderer = createRoomDamage(
          this.renderer,
          this.scene,
          this.camera,
          this.keyLight,
          this.desk.root,
        );
        await this.damageRenderer.prepare(() => !this.disposed);
        await scheduleResourceTask(
          () => {
            this.applyRenderSize();
            // Prime the complete native-buffer pipeline while the canvas is
            // hidden. The next delivered frame is the first visible room frame.
            for (const model of this.warmPackages) this.scene.add(model);
            try {
              this.damageRenderer.render();
            } finally {
              for (const model of this.warmPackages) this.scene.remove(model);
            }
            this.damageRenderer.invalidate();
          },
          { valid: () => !this.disposed },
        );
        if (this.disposed) return;
        this.renderPrepared = true;
        if (this.scaleMigrated) this.organize({ silent: true });
        else if (this.viewClamped) this.persist();
        delete this.canvas.dataset.presented;
        this.canvas.dataset.ready = 'true';
        this.needsRender = true;
        this.options.warmFinishes?.(this.tableStacks.at(-1)?.data.cards ?? []);
      })
      .catch((error) => {
        if (!this.disposed) {
          console.error(error);
          this.options.toast('3D 包装素材加载失败，请重新进入开盒空间。');
          this.canvas.dataset.error = error.message;
        }
      });
    this.tick = this.tick.bind(this);
    this.tickBound = true;
    this.wake();
  }
  get needsRender() {
    return this._needsRender;
  }
  set needsRender(value) {
    this._needsRender = value;
    if (value) this.wake();
  }
  wake() {
    if (!this.tickBound || this.ticking || this.disposed || this.navigationPaused || this.frame)
      return;
    this.previous = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }
  get anim() {
    return this.animations[0] ?? null;
  }
  migrateModelScale() {
    const state = this.options.state;
    if (state.spaceModelScale === MODEL_SCALE) return;
    const oldScale =
        Number.isFinite(state.spaceModelScale) && state.spaceModelScale > 0
          ? state.spaceModelScale
          : 1,
      ratio = MODEL_SCALE / oldScale;
    for (const owner of [...state.items, ...(state.containers ?? []), ...(state.cardStacks ?? [])])
      if (owner.pose3d)
        owner.pose3d.position[1] = 0.044 + (owner.pose3d.position[1] - 0.044) * ratio;
    state.spaceModelScale = MODEL_SCALE;
    this.scaleMigrated = true;
  }
  updateOrganizeState() {
    if (!this.organizeButton) return;
    const disabled =
      !this.library ||
      !!this.pointer ||
      !!this.drag ||
      !!this.inspector ||
      this.animations.length > 0;
    this.organizeButton.disabled = disabled;
    this.organizeButton.title = disabled
      ? '拆封或拿取结束后可整理'
      : '按类型整理桌面上的箱、盒、包和卡堆';
  }
  organize({ silent = false } = {}) {
    if (!this.library || this.pointer || this.drag || this.inspector || this.animations.length) {
      this.options.toast('拆封或拿取结束后再整理');
      return false;
    }
    const entries = [],
      owners = new Map();
    const add = (id, kind, owner, size, offset = [0, 0, 0]) => {
      entries.push({ id, kind, size, offset });
      owners.set(id, owner);
    };
    for (const c of this.containers) {
      const bounds = new THREE.Box3();
      c.body.shapes.forEach((shape, i) => {
        if (shape.halfExtents)
          bounds.union(
            volume(c.body.shapeOffsets[i], c.body.shapeOrientations[i], [
              shape.halfExtents.x * 2,
              shape.halfExtents.y * 2,
              shape.halfExtents.z * 2,
            ]).bounds,
          );
      });
      add(
        c.data.id,
        'container',
        c,
        bounds.getSize(new THREE.Vector3()).toArray(),
        bounds.getCenter(new THREE.Vector3()).toArray(),
      );
    }
    const records = new Map(this.records.map((r) => [r.item.id, r]));
    for (const item of this.options.state.items) {
      if (item.containerId) continue;
      const r = records.get(item.id);
      if (!r) continue;
      const dimensions = isPack(item.kind)
        ? [SIZES.pack[0], SIZES.pack[2], SIZES.pack[1]]
        : SIZES[item.kind];
      add(item.id, item.kind, r, dimensions);
    }
    for (const s of this.tableStacks)
      if (s.ready) add(s.data.id, 'cards', s, [s.size[0], s.size[2], s.size[1]]);
    // Build fixed obstacles directly: carton panels belong to the movable plan.
    const obstacles = [];
    for (const body of [...this.sceneryBodies, this.phone.body])
      body.shapes.forEach((shape, i) => {
        if (!shape.halfExtents) return;
        const q = new THREE.Quaternion().copy(body.quaternion),
          p = new THREE.Vector3()
            .copy(body.shapeOffsets[i])
            .applyQuaternion(q)
            .add(new THREE.Vector3().copy(body.position));
        q.multiply(new THREE.Quaternion().copy(body.shapeOrientations[i]));
        const b = volume(p, q, [
          shape.halfExtents.x * 2,
          shape.halfExtents.y * 2,
          shape.halfExtents.z * 2,
        ]).bounds;
        obstacles.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z });
      });
    // Leave the entrance covers and player-facing carton label visible after
    // automatic organization, even when tall sealed cases are on the table.
    for (const page of ['album', 'warehouse']) {
      const p = this.desk.entrances[page].position;
      obstacles.push({ x0: p.x - 2, x1: p.x + 2, z0: p.z - 1.3, z1: p.z + 3.2 });
    }
    const plan = planDeskLayout(entries, obstacles, this.halfWidth, this.halfDepth, {
      cardZone: { ...cardPadBounds(), top: CARD_PAD.top },
    });
    if (!plan) {
      if (!silent) this.options.toast('桌面空间不足，请先开盒或收纳卡牌');
      return false;
    }
    this.closeMenu();
    this.selected.clear();
    this.renderSelection();
    this.hover = null;
    this.hoverStack = null;
    this.pendingHover = null;
    this.lastClick = null;
    for (const placement of plan) {
      const owner = owners.get(placement.id),
        body = owner.body;
      body.position.set(...placement.position);
      body.quaternion.set(...placement.quaternion);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.force.set(0, 0, 0);
      body.torque.set(0, 0, 0);
      body.aabbNeedsUpdate = true;
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion);
      body.interpolatedQuaternion.copy(body.quaternion);
      if (owner.item) {
        owner.hidden = false;
        owner.scheduled = 0;
        owner.item.isNew = false;
        this.settleRecord(owner);
      } else if (placement.kind === 'container') {
        owner.model.position.copy(body.position);
        owner.model.quaternion.copy(body.quaternion);
        owner.model.updateMatrixWorld(true);
        owner.data.pose3d = {
          position: body.position.toArray(),
          quaternion: body.quaternion.toArray(),
        };
        for (const r of this.records.filter((r) => r.item.containerId === owner.data.id)) {
          r.basePosition = owner.model.localToWorld(
            new THREE.Vector3(...caseSlots()[r.item.slotIndex]),
          );
          r.hoverLift = 0;
          r.body.position.copy(r.basePosition);
          r.body.quaternion.copy(body.quaternion);
          r.body.velocity.set(0, 0, 0);
          r.body.angularVelocity.set(0, 0, 0);
          r.body.aabbNeedsUpdate = true;
          r.body.previousPosition.copy(r.body.position);
          r.body.interpolatedPosition.copy(r.body.position);
          r.body.previousQuaternion.copy(r.body.quaternion);
          r.body.interpolatedQuaternion.copy(r.body.quaternion);
        }
      } else {
        owner.root.position.copy(body.position);
        owner.root.quaternion.copy(body.quaternion);
        body.sleep();
        this.saveStack(owner);
      }
    }
    this.physics.broadphase.dirty = true;
    this.shadowDirty = true;
    this.needsRender = true;
    this.syncAccessibility();
    this.persist();
    if (!silent) {
      this.organizeButton?.classList.add('organized');
      clearTimeout(this.organizeFeedbackTimer);
      this.organizeFeedbackTimer = setTimeout(
        () => this.organizeButton?.classList.remove('organized'),
        280,
      );
      this.options.toast('桌面已整理');
    }
    return true;
  }
  createRoom() {
    const w = this.halfWidth,
      d = this.halfDepth;
    this.desk = createDeskScene(this.scene, w, d);
    this.cardPad = createCardPad(this.scene, this.physics);
    this.sceneryBodies = [];
    for (const prop of this.desk.colliders) {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(...prop.size.map((n) => n / 2))),
      });
      body.position.set(...prop.position);
      body.quaternion.set(...prop.quaternion);
      body.aabbNeedsUpdate = true;
      body.portal =
        prop.name === 'zippered-collection-binders'
          ? 'album'
          : prop.name === 'warehouse-cardboard-carton'
            ? 'warehouse'
            : null;
      this.physics.addBody(body);
      this.sceneryBodies.push(body);
    }
    const ambient = new THREE.HemisphereLight('#eef6ff', '#7a8794', 1.85);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight('#edf8ff', 2.55);
    key.position.set(-6, 14, 5);
    key.castShadow = !FAST_WEB;
    key.shadow.mapSize.set(FAST_WEB ? 256 : 1024, FAST_WEB ? 256 : 1024);
    Object.assign(key.shadow.camera, {
      left: -w - 2,
      right: w + 2,
      top: d + 5,
      bottom: -d - 5,
      near: 0.5,
      far: 45,
    });
    key.shadow.normalBias = 0.014;
    key.shadow.bias = -0.00008;
    key.shadow.radius = 2;
    this.scene.add(key);
    this.keyLight = key;
    const fill = new THREE.DirectionalLight('#cee5ff', 1.35);
    fill.position.set(8, 7, -6);
    this.scene.add(fill);
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w, 0.15, d)) });
    floor.position.set(0, -0.106, 0);
    this.physics.addBody(floor);
    for (const [x, z, axis] of [
      [-w, 0, 'x'],
      [w, 0, 'x'],
      [0, -d, 'z'],
      [0, d, 'z'],
    ]) {
      const wall = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(axis === 'x' ? 0.08 : w, 6, axis === 'z' ? 0.08 : d)),
      });
      wall.position.set(x, 6, z);
      this.physics.addBody(wall);
    }
    this.halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.012, 6, 48),
      new THREE.MeshBasicMaterial({
        color: '#39d9fa',
        transparent: true,
        opacity: 0.76,
        depthWrite: false,
      }),
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.visible = false;
    this.scene.add(this.halo);
    this.resources.push(this.halo);
    this.createDeskPhone();
  }
  createDeskPhone() {
    const screen = document.createElement('canvas');
    screen.width = 384;
    screen.height = 720;
    const c = screen.getContext('2d');
    c.fillStyle = '#154cf5';
    c.fillRect(0, 0, 384, 720);
    c.fillStyle = '#06174e';
    c.beginPath();
    c.moveTo(0, 540);
    c.lineTo(384, 320);
    c.lineTo(384, 720);
    c.lineTo(0, 720);
    c.fill();
    c.strokeStyle = '#39d9fa';
    c.lineWidth = 12;
    c.beginPath();
    c.arc(340, 150, 135, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#39d9fa';
    c.font = 'bold 27px Microsoft YaHei';
    c.fillText('SHOP / LOCR', 25, 76);
    c.fillStyle = '#e9f8ff';
    c.font = 'bold 49px Microsoft YaHei';
    c.fillText('卡牌商店', 24, 165);
    for (const [i, text] of ['单卡', '卡盒', '整箱'].entries()) {
      const y = 232 + i * 100;
      c.fillStyle = i === 0 ? '#39d9fa' : '#e9f8ff';
      c.fillRect(25, y, 334, 77);
      c.fillStyle = '#06174e';
      c.font = 'bold 31px Microsoft YaHei';
      c.fillText(text, 47, y + 48);
      c.fillText('→', 304, y + 48);
    }
    c.fillStyle = '#39d9fa';
    c.font = 'bold 25px Microsoft YaHei';
    c.fillText('点击购买', 137, 643);
    const map = new THREE.CanvasTexture(screen);
    map.colorSpace = THREE.SRGBColorSpace;
    const root = this.desk.createPhone(map);
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(0.537, 0.082, 1.034)),
    });
    body.position.copy(root.position);
    body.quaternion.copy(root.quaternion);
    this.physics.addBody(body);
    body.aabbNeedsUpdate = true;
    this.phone = { root, body, size: [1.074, 0.164, 2.068] };
  }
  addRecord(item, { initial = false, index = 0, spawn = null, velocity = null } = {}) {
    if (this.records.some((r) => r.item.id === item.id)) return;
    const [w, h, d] = SIZES[item.kind],
      mass = { case: 7.6, box: 0.52, pack: 0.035, bonus: 0.015 }[item.kind];
    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
      linearDamping: 0.5,
      angularDamping: isPack(item.kind) ? 0.92 : 0.7,
      allowSleep: true,
      sleepSpeedLimit: isPack(item.kind) ? 0.3 : 0.15,
      sleepTimeLimit: 0.5,
    });
    let x = (item.x - 0.5) * (this.halfWidth * 2 - w - 1),
      z = (item.y - 0.5) * (this.halfDepth * 2 - d - 1);
    const container = this.containers.find((c) => c.data.id === item.containerId);
    const drop = initial && item.isNew && !container;
    if (!spawn && (!item.pose3d || drop)) {
      const pad = cardPadBounds(),
        depth = isPack(item.kind) ? h : d;
      if (
        x + w / 2 > pad.x0 &&
        x - w / 2 < pad.x1 &&
        z + depth / 2 > pad.z0 &&
        z - depth / 2 < pad.z1
      )
        x = x < 0 ? pad.x0 - w / 2 - 0.2 : pad.x1 + w / 2 + 0.2;
    }
    if (spawn) body.position.set(...spawn);
    else if (item.pose3d && !drop) body.position.set(...item.pose3d.position);
    else
      body.position.set(
        x,
        drop
          ? roomDropHeight(z, Math.hypot(w, h, d) / 2) + (index % 7) * 0.28
          : isPack(item.kind)
            ? d / 2 + 0.042
            : h / 2 + 0.042,
        z,
      );
    if (item.pose3d && !drop && !spawn) body.quaternion.set(...item.pose3d.quaternion);
    else
      body.quaternion.setFromEuler(
        isPack(item.kind) ? -Math.PI / 2 : 0,
        (item.angle * Math.PI) / 180,
        drop ? (Math.random() - 0.5) * 0.2 : 0,
      );
    if (velocity) body.velocity.set(...velocity);
    if (drop || spawn)
      body.angularVelocity.set(
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 1.1,
        (Math.random() - 0.5) * 0.6,
      );
    const record = {
      item,
      body,
      mass,
      hidden: drop,
      scheduled: drop ? this.elapsed + 0.001 + (index % 35) * 0.09 : 0,
      scaleBorn: spawn ? this.elapsed : 0,
      deliveryStart: drop ? [body.position.x, body.position.y, body.position.z] : null,
    };
    if (container) {
      container.model.updateMatrixWorld(true);
      const p = container.model.localToWorld(new THREE.Vector3(...caseSlots()[item.slotIndex]));
      body.position.set(p.x, p.y, p.z);
      body.quaternion.copy(container.body.quaternion);
      record.basePosition = body.position.clone();
      record.hoverLift = 0;
      body.type = CANNON.Body.STATIC;
      body.mass = 0;
      body.updateMassProperties();
      body.angularVelocity.set(0, 0, 0);
    } else if (drop) {
      body.type = CANNON.Body.KINEMATIC;
    } else if (initial) body.sleep();
    body.addEventListener('collide', (e) => {
      if (this.anim || this.elapsed - (this.lastImpact ?? 0) < 0.14) return;
      const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (impact > 3) {
        this.lastImpact = this.elapsed;
        this.dust(body.position, item.kind === 'case' ? 1 : 0.5);
      }
    });
    body.aabbNeedsUpdate = true;
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    this.physics.addBody(body);
    this.records.push(record);
    this.needsRender = true;
    return record;
  }
  addContainer(data, model = null) {
    model ??= this.library.create('case', true, PRODUCTS[data.productId ?? 'case'].set);
    model.position.set(...data.pose3d.position);
    model.quaternion.set(...data.pose3d.quaternion);
    this.library.poseOpening(model, 1);
    this.scene.add(model);
    model.updateMatrixWorld(true);
    const body = new CANNON.Body({ mass: 0 });
    body.position.copy(model.position);
    body.quaternion.copy(model.quaternion);
    const inverse = model.matrixWorld.clone().invert();
    model.traverseVisible((mesh) => {
      if (!mesh.isMesh || !mesh.visible || mesh.name.includes('tape')) return;
      const params = mesh.geometry.parameters;
      if (!params?.width) return;
      const local = inverse.clone().multiply(mesh.matrixWorld),
        p = new THREE.Vector3(),
        q = new THREE.Quaternion(),
        s = new THREE.Vector3();
      local.decompose(p, q, s);
      body.addShape(
        new CANNON.Box(
          new CANNON.Vec3(
            (params.width * s.x) / 2,
            (params.height * s.y) / 2,
            (params.depth * s.z) / 2,
          ),
        ),
        new CANNON.Vec3(p.x, p.y, p.z),
        new CANNON.Quaternion(q.x, q.y, q.z, q.w),
      );
    });
    this.physics.addBody(body);
    const c = { data, model, body };
    this.containers.push(c);
    return c;
  }
  flatRotation(record) {
    const pack = isPack(record.item.kind),
      axis = new THREE.Vector3(0, pack ? 1 : 0, pack ? 0 : 1).applyQuaternion(
        new THREE.Quaternion().copy(record.body.quaternion),
      );
    const yaw = Math.atan2(pack ? -axis.x : axis.x, pack ? -axis.z : axis.z);
    return new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  }
  reserveOpening(record) {
    record.hidden = true;
    record.scheduled = 0;
    // Keep support under objects above until the replacement is ready.
    const body = record.body;
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.updateMassProperties();
    body.aabbNeedsUpdate = true;
    this.needsRender = true;
  }
  clearEmptyContainers() {
    const empty = this.containers.filter(
      (c) => !this.options.state.items.some((i) => i.containerId === c.data.id),
    );
    for (const c of empty) {
      this.scene.remove(c.model);
      this.physics.removeBody(c.body);
      this.disposeUnique(c.model);
    }
    this.containers = this.containers.filter((c) => !empty.includes(c));
    this.options.state.containers = this.containers.map((c) => c.data);
  }
  rebuildBatches() {
    this.batches.forEach((b) => b.dispose());
    this.batches = [];
    for (const kind of Object.keys(PRODUCTS)) {
      const records = this.records.filter((r) => productIdOf(r.item) === kind);
      if (records.length)
        this.batches.push(new PackageBatch(this.scene, this.library.templates[kind], records));
    }
    this.batches.forEach((b) => b.update());
  }
  syncAccessibility() {
    this.accessibility.replaceChildren();
    const ids = new Set(this.options.state.items.map((i) => i.id));
    for (const r of [...this.records].sort(
      (a, b) =>
        Number(!!a.item.containerId) - Number(!!b.item.containerId) ||
        (isPack(a.item.kind) && isPack(b.item.kind) ? b.body.position.y - a.body.position.y : 0),
    )) {
      if (!ids.has(r.item.id)) continue;
      const button = document.createElement('button');
      button.className = `world-object object-${r.item.kind}`;
      button.dataset.item = r.item.id;
      button.textContent = r.item.containerId
        ? '请拖出卡盒'
        : `打开${itemProduct(r.item).set} ${names[r.item.kind]}`;
      button.setAttribute('aria-disabled', String(!!r.item.containerId));
      button.title = isPack(r.item.kind) ? 'Enter 打开单包；Shift+Enter 打开五包' : '';
      button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey && isPack(r.item.kind)) {
          e.preventDefault();
          const selected = this.nearestPacks(r);
          if (selected.length === 5) this.openPackRecords(selected);
          else this.options.toast('至少需要 5 包才能一起打开');
        }
      });
      button.setAttribute('aria-label', button.textContent);
      button.addEventListener('click', () => this.openRecord(r));
      this.accessibility.append(button);
    }
    this.tableStacks
      .filter((s) => s.ready)
      .forEach((stack) => {
        const button = document.createElement('button');
        button.className = 'world-card world-stack';
        button.dataset.stack = stack.data.id;
        button.textContent = `整理桌面卡堆 · ${stack.data.cards.length} 张`;
        button.addEventListener('click', () => this.inspectStack(stack));
        this.accessibility.append(button);
      });
    for (const [page, label] of [
      ['shop', '使用手机购买'],
      ['album', '打开收藏册'],
      ['warehouse', '打开仓库纸箱'],
    ]) {
      const button = document.createElement('button');
      button.className = `world-entrance world-${page === 'shop' ? 'phone' : page}`;
      button.textContent = label;
      button.addEventListener('click', () => {
        this.persist();
        this.options.navigate?.(page);
      });
      this.accessibility.append(button);
    }
    this.renderSelection();
    this.updateOrganizeState();
  }
  updateCamera() {
    const { theta, phi, distance } = this.orbit;
    this.camera.position
      .copy(this.target)
      .add(
        new THREE.Vector3(
          Math.sin(theta) * Math.sin(phi) * distance,
          Math.cos(phi) * distance,
          Math.cos(theta) * Math.sin(phi) * distance,
        ),
      );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.needsRender = true;
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h || this.disposed) return;
    this.quality.resize(w, h, FAST_WEB ? 1 : window.devicePixelRatio);
    // Resizing clears the drawing buffer. Apply it only immediately before a render.
    this.renderSize = { width: w, height: h };
    this.camera.aspect = w / h;
    // Preserve the desktop horizontal field of view in portrait windows so
    // the physical entrances at both desk edges remain reachable when zoomed out.
    this.camera.fov = THREE.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(38 / 2)) * Math.max(1, 1.6 / this.camera.aspect),
        ),
    );
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }
  ray(event) {
    const b = this.canvas.getBoundingClientRect();
    this.mouse.set(
      ((event.clientX - b.left) / b.width) * 2 - 1,
      (-(event.clientY - b.top) / b.height) * 2 + 1,
    );
    this.raycaster.layers.set(0);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster;
  }
  hit(event) {
    const ray = this.ray(event).ray;
    let nearest = Infinity,
      result = null;
    const test = (body, value) => {
      if (body.aabbNeedsUpdate) body.updateAABB();
      const bounds = new THREE.Box3(
        new THREE.Vector3().copy(body.aabb.lowerBound),
        new THREE.Vector3().copy(body.aabb.upperBound),
      );
      if (!ray.intersectsBox(bounds)) return;
      const q = new THREE.Quaternion().copy(body.quaternion),
        matrix = new THREE.Matrix4().compose(
          new THREE.Vector3().copy(body.position),
          q,
          new THREE.Vector3(1, 1, 1),
        );
      const local = ray.clone().applyMatrix4(matrix.clone().invert());
      for (let i = 0; i < body.shapes.length; i++) {
        const shape = body.shapes[i];
        if (!shape.halfExtents) continue;
        const shapeMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3().copy(body.shapeOffsets[i]),
          new THREE.Quaternion().copy(body.shapeOrientations[i]),
          new THREE.Vector3(1, 1, 1),
        );
        const shapeRay = local.clone().applyMatrix4(shapeMatrix.clone().invert()),
          h = shape.halfExtents;
        const point = shapeRay.intersectBox(
          new THREE.Box3(new THREE.Vector3(-h.x, -h.y, -h.z), new THREE.Vector3(h.x, h.y, h.z)),
          new THREE.Vector3(),
        );
        if (!point) continue;
        point.applyMatrix4(shapeMatrix).applyMatrix4(matrix);
        const distance = point.distanceToSquared(ray.origin);
        if (distance < nearest) {
          nearest = distance;
          result = value ? { ...value, point } : null;
        }
      }
    };
    this.records.forEach((record) => {
      if (!record.hidden) test(record.body, { record });
    });
    this.containers.forEach((c) => test(c.body, null));
    this.sceneryBodies.forEach((body) => test(body, body.portal ? { portal: body.portal } : null));
    this.tableStacks.forEach((stack) => {
      if (stack.ready && stack.root.visible && stack.body) test(stack.body, { stack });
    });
    if (this.phone) test(this.phone.body, { phone: true });
    return result;
  }
  hitAt(clientX, clientY) {
    const hit = this.hit({ clientX, clientY });
    return (
      hit?.record?.item.id ?? hit?.stack?.data.id ?? hit?.portal ?? (hit?.phone ? 'phone' : null)
    );
  }
  portalSource(page) {
    const source = this.desk.entrances[page];
    if (!source) return null;
    const corners =
      page === 'warehouse'
        ? [
            [-1.27, 1.84, 1.2],
            [1.27, 1.84, 1.2],
            [1.27, 0.13, 1.2],
            [-1.27, 0.13, 1.2],
          ]
        : page === 'album'
          ? [
              [-0.9, 0.805, -1.265],
              [0.9, 0.805, -1.265],
              [0.9, 0.805, 1.265],
              [-0.9, 0.805, 1.265],
            ]
          : [
              [-0.482, 0.084, -0.966],
              [0.482, 0.084, -0.966],
              [0.482, 0.084, 0.966],
              [-0.482, 0.084, 0.966],
            ];
    return {
      page,
      quad: corners.map((p) => {
        const point = new THREE.Vector3(...p)
            .applyQuaternion(source.quaternion)
            .add(source.position),
          screen = this.projectPoint(point.toArray());
        return [screen.x, screen.y];
      }),
      position: source.position.toArray(),
    };
  }
  obstacleVolumes(excluded = []) {
    const bodies = [
      ...this.records
        .filter((r) => !r.hidden && !r.item.containerId && !excluded.includes(r))
        .map((r) => r.body),
      ...this.tableStacks
        .filter((s) => s.ready && s.body && !excluded.includes(s))
        .map((s) => s.body),
      ...this.containers.map((c) => c.body),
      ...this.sceneryBodies,
      this.phone.body,
      this.cardPad.body,
    ];
    const result = [];
    for (const body of bodies)
      for (let i = 0; i < body.shapes.length; i++) {
        const shape = body.shapes[i];
        if (!shape.halfExtents) continue;
        const q = new THREE.Quaternion().copy(body.quaternion),
          p = new THREE.Vector3()
            .copy(body.shapeOffsets[i])
            .applyQuaternion(q)
            .add(new THREE.Vector3().copy(body.position));
        q.multiply(new THREE.Quaternion().copy(body.shapeOrientations[i]));
        result.push(
          volume(p, q, [shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2]),
        );
      }
    return result;
  }
  nearestPacks(record, count = 5) {
    const ids = new Set(this.options.state.items.map((i) => i.id)),
      packs = this.records.filter(
        (r) => productIdOf(r.item) === productIdOf(record.item) && !r.hidden && ids.has(r.item.id),
      );
    packs.sort(
      (a, b) =>
        Number(b === record) - Number(a === record) ||
        a.body.position.distanceSquared(record.body.position) -
          b.body.position.distanceSquared(record.body.position),
    );
    return packs.slice(0, count);
  }
  closeMenu() {
    this.actionMenu?.remove();
    this.actionMenu = null;
    if (this.selectionHints) {
      this.scene.remove(this.selectionHints);
      this.needsRender = true;
    }
    this.selectionHints = null;
  }
  showPackMenu(record, x, y) {
    this.closeMenu();
    const selected = isPack(record.item.kind) ? this.nearestPacks(record, 10) : [record],
      menu = document.createElement('div');
    menu.className = 'pack-actions';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.max(12, Math.min(x, this.host.clientWidth - 252))}px`;
    menu.style.top = `${Math.max(112, Math.min(y, this.host.clientHeight - 240))}px`;
    menu.innerHTML = `<small>${record.item.kind === 'bonus' ? 'vol.2' : itemProduct(record.item).set} · 拆封方式</small><button role="menuitem" data-count="1">打开 1 包 <span>ENTER</span></button><button role="menuitem" data-count="5">打开 5 包 <span>SHIFT + ENTER</span></button><button role="menuitem" data-count="10">打开 10 包</button>`;
    if (!isPack(record.item.kind))
      menu.innerHTML = `<small>${itemProduct(record.item).set} · 未拆封${names[record.item.kind]}</small><button role="menuitem" data-count="1">打开${names[record.item.kind]} <span>ENTER</span></button>${record.item.kind === 'box' ? '<button role="menuitem" data-open-all>全部打开</button>' : ''}`;
    menu.querySelector('[data-count="1"]').onclick = () => {
      this.closeMenu();
      this.openRecord(record);
    };
    for (const count of [5, 10]) {
      const button = menu.querySelector(`[data-count="${count}"]`);
      if (!button) continue;
      button.disabled = selected.length < count;
      button.onclick = () => {
        this.closeMenu();
        this.openPackRecords(selected.slice(0, count));
      };
    }
    const all = menu.querySelector('[data-open-all]');
    if (all)
      all.onclick = () => {
        this.closeMenu();
        this.openRecord(record, { all: true });
      };
    this.host.append(menu);
    this.actionMenu = menu;
    this.selectionHints = new THREE.Group();
    selected.forEach((r) => {
      const ring = this.halo.clone();
      ring.visible = true;
      ring.position.set(r.body.position.x, 0.048, r.body.position.z);
      ring.scale.setScalar(0.8);
      this.selectionHints.add(ring);
    });
    this.scene.add(this.selectionHints);
    this.needsRender = true;
  }
  showStackMenu(stack, x, y) {
    if (!stack.ready || !this.tableStacks.includes(stack)) return;
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'pack-actions';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '卡堆操作');
    menu.style.left = `${Math.max(12, Math.min(x, this.host.clientWidth - 252))}px`;
    menu.style.top = `${Math.max(112, Math.min(y, this.host.clientHeight - 200))}px`;
    const value = stackSaleValue(stack.data);
    menu.innerHTML = `<small>桌面卡堆 · ${stack.data.cards.length} 张</small><button role="menuitem" data-store-stack>全部入仓 <span>${stack.data.cards.length} 张</span></button><button role="menuitem" data-sell-stack ${value === null ? 'disabled' : ''}>全部出售 <span>${value === null ? '—' : value.toLocaleString('zh-CN')}</span></button>`;
    menu.querySelector('[data-store-stack]').onclick = () => {
      this.closeMenu();
      if (this.tableStacks.includes(stack)) this.storeTableStack(stack);
    };
    menu.querySelector('[data-sell-stack]').onclick = () => {
      this.closeMenu();
      if (!this.tableStacks.includes(stack)) return;
      try {
        const sale = sellStack(this.options.state, stack.data.id);
        this.removeTableStack(stack, sale.cards);
        this.options.sound('card');
        this.options.toast(`已出售 ${sale.quantity} 张 · ＋${sale.value}`);
        this.host.querySelector('#coins').textContent =
          this.options.state.coins.toLocaleString('zh-CN');
        this.persist();
      } catch (error) {
        this.options.toast(error.message);
      }
    };
    this.host.append(menu);
    this.actionMenu = menu;
  }
  pointerDown(e) {
    if (!this.library || this.inspector || ![0, 1, 2].includes(e.button)) return;
    this.pendingHover = null;
    this.pendingPointerMove = null;
    this.lastClick = null;
    this.closeMenu();
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    const hit = this.hit(e);
    this.pointer = {
      id: e.pointerId,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      hit,
      moved: false,
      modifier: e.ctrlKey || e.shiftKey,
    };
    this.updateOrganizeState();
    this.wake();
  }
  pointerMove(e) {
    const p = this.pointer;
    if (!p) {
      this.pendingHover = { clientX: e.clientX, clientY: e.clientY };
      this.wake();
      return;
    }
    if (p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.moved = true;
    if (p.moved && p.button === 0 && !this.drag && !p.extract) {
      if (p.hit?.record?.item.containerId) {
        p.extract = this.extractRecord(p.hit.record);
        if (!p.extract) return;
      } else if (p.hit?.record || p.hit?.stack) {
        const r = p.hit.record,
          stack = p.hit.stack;
        const entries = stack
          ? [stack]
          : this.selected.has(r.item.id)
            ? this.records.filter(
                (other) =>
                  this.selected.has(other.item.id) && !other.hidden && !other.item.containerId,
              )
            : [r];
        if (
          entries.some((other) => other.hidden || this.animations.some((a) => a.record === other))
        )
          return;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -p.hit.point.y);
        const origin = this.ray({ clientX: p.x, clientY: p.y }).ray.intersectPlane(
          plane,
          new THREE.Vector3(),
        );
        if (!origin) return;
        this.drag = {
          entries,
          plane,
          origin,
          starts: entries.map((other) => other.body.position.clone()),
          quaternions: entries.map((other) => other.body.quaternion.clone()),
          point: new THREE.Vector3(),
        };
        if (stack) this.options.sound('card');
        for (const other of entries) {
          this.wakeSupported(other.body, entries);
          other.body.type = CANNON.Body.KINEMATIC;
          other.body.mass = 0;
          other.body.updateMassProperties();
          other.body.collisionResponse = false;
          other.body.velocity.set(0, 0, 0);
          other.body.angularVelocity.set(0, 0, 0);
        }
        this.hover = null;
        this.canvas.style.cursor = 'grabbing';
        if (stack) this.updateStackDrop(e);
      }
    }
    if (p.extract) {
      const a = p.extract,
        plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -a.from.y),
        origin = this.ray({ clientX: p.x, clientY: p.y }).ray.intersectPlane(
          plane,
          new THREE.Vector3(),
        ),
        point = this.ray(e).ray.intersectPlane(plane, new THREE.Vector3());
      if (origin && point) {
        a.destination.copy(
          this.tablePosition(
            new THREE.Vector3(
              a.from.x + point.x - origin.x,
              a.from.y,
              a.from.z + point.z - origin.z,
            ),
            'box',
            [a.record],
            a,
          ),
        );
        a.over.set(a.destination.x, Math.max(a.above.y, a.destination.y + 0.35), a.destination.z);
      }
    } else if (this.drag && this.ray(e).ray.intersectPlane(this.drag.plane, this.drag.point)) {
      const delta = this.drag.point.clone().sub(this.drag.origin),
        obstacles = this.obstacleVolumes(this.drag.entries);
      this.drag.entries.forEach((entry, i) => {
        const start = this.drag.starts[i],
          size = entry.item ? SIZES[entry.item.kind] : entry.size;
        const dest = surfacePosition(
          new THREE.Vector3(start.x + delta.x, start.y, start.z + delta.z),
          size,
          entry.body.quaternion,
          obstacles,
          this.halfWidth,
          this.halfDepth,
        );
        entry.destination = dest;
        entry.body.position.set(dest.x, dest.y + 0.32, dest.z);
        entry.body.aabbNeedsUpdate = true;
        if (entry.root) {
          entry.root.position.copy(entry.body.position);
          entry.root.quaternion.copy(entry.body.quaternion);
        }
      });
    }
    this.needsRender = true;
    if (this.drag || p.extract) this.shadowDirty = true;
    if (this.drag?.entries.some((entry) => entry.data)) this.updateStackDrop(e);
  }
  warehouseDropAt(e) {
    const body = this.sceneryBodies.find((body) => body.portal === 'warehouse');
    if (!body) return false;
    const local = this.ray(e)
      .ray.clone()
      .applyMatrix4(
        new THREE.Matrix4()
          .compose(
            new THREE.Vector3().copy(body.position),
            new THREE.Quaternion().copy(body.quaternion),
            new THREE.Vector3(1, 1, 1),
          )
          .invert(),
      );
    const extent = body.shapes[0].halfExtents;
    return local.intersectsBox(
      new THREE.Box3(
        new THREE.Vector3(-extent.x, -extent.y, -extent.z),
        new THREE.Vector3(extent.x, extent.y, extent.z),
      ),
    );
  }
  updateStackDrop(e) {
    const stack = this.drag?.entries.find((entry) => entry.data);
    if (!stack) return;
    if (!this.stackDropHint) {
      const hint = document.createElement('div');
      hint.className = 'stack-storage-drop';
      const source = this.portalSource('warehouse');
      if (!source) return;
      const rect = this.host.getBoundingClientRect();
      hint.style.left = `${source.quad.reduce((sum, point) => sum + point[0], 0) / 4 - rect.left}px`;
      hint.style.top = `${source.quad.reduce((sum, point) => sum + point[1], 0) / 4 - rect.top}px`;
      this.host.append(hint);
      this.stackDropHint = hint;
    }
    const active = this.warehouseDropAt(e);
    this.stackDropHint.classList.toggle('is-active', active);
    this.stackDropHint.textContent = `${active ? '松手' : '拖到此处'} · 全部入仓 ${stack.data.cards.length} 张`;
  }
  storeTableStack(stack) {
    const cards = routeStackCards(
      this.options.state,
      stack.data.id,
      stack.data.cards.map((card) => card.id),
      'warehouse',
    );
    if (!cards.length) return false;
    this.removeTableStack(stack, cards);
    this.options.sound('card');
    this.options.toast(`${cards.length} 张卡牌已全部入仓`);
    this.persist();
    return true;
  }
  removeTableStack(stack, cards) {
    this.wakeSupported(stack.body, [stack]);
    const ids = new Set(cards.map((card) => card.id));
    this.cards = this.cards.filter((card) => {
      if (!ids.has(card.id)) return true;
      card.root.remove(card.mesh);
      this.disposeUnique(card.mesh);
      return false;
    });
    this.scene.remove(stack.root);
    this.disposeUnique(stack.visual);
    this.physics.removeBody(stack.body);
    this.tableStacks = this.tableStacks.filter((entry) => entry !== stack);
    this.canvas.dataset.cards = String(this.cards.length);
    this.syncAccessibility();
    this.needsRender = true;
    this.shadowDirty = true;
  }
  wakeSupported(body, excluded = []) {
    body.updateAABB();
    const box = body.aabb;
    for (const other of [...this.records, ...this.tableStacks]) {
      if (
        !other.body ||
        other.body === body ||
        excluded.includes(other) ||
        other.item?.containerId ||
        other.hidden
      )
        continue;
      other.body.updateAABB();
      const b = other.body.aabb;
      if (
        b.lowerBound.y >= box.upperBound.y - 0.08 &&
        b.lowerBound.x < box.upperBound.x &&
        b.upperBound.x > box.lowerBound.x &&
        b.lowerBound.z < box.upperBound.z &&
        b.upperBound.z > box.lowerBound.z
      )
        this.promoteBody(other);
    }
  }
  promoteBody(record) {
    const body = record.body;
    body.type = CANNON.Body.DYNAMIC;
    body.mass = record.mass;
    body.collisionResponse = true;
    body.updateMassProperties();
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.wakeUp();
    this.needsRender = true;
    this.saveDirty = true;
  }
  releaseDrag(cancel = false, storage = false) {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.stackDropHint?.remove();
    this.stackDropHint = null;
    for (let i = 0; i < drag.entries.length; i++) {
      const entry = drag.entries[i];
      if (!cancel && storage && entry.data && this.storeTableStack(entry)) continue;
      if (entry.data) this.options.sound('card');
      if (cancel) {
        entry.body.position.copy(drag.starts[i]);
        entry.body.quaternion.copy(drag.quaternions[i]);
        this.settleRecord(entry);
      } else {
        const size = entry.item ? SIZES[entry.item.kind] : entry.size,
          dest = surfacePosition(
            entry.body.position,
            size,
            entry.body.quaternion,
            this.obstacleVolumes([entry, ...drag.entries.slice(i + 1)]),
            this.halfWidth,
            this.halfDepth,
          );
        entry.body.position.copy(dest);
        this.promoteBody(entry);
        entry.body.velocity.set(0, -0.08, 0);
      }
      entry.body.aabbNeedsUpdate = true;
      if (entry.root) {
        entry.root.position.copy(entry.body.position);
        entry.root.quaternion.copy(entry.body.quaternion);
        this.saveStack(entry);
      }
    }
    this.needsRender = true;
    this.persist();
  }
  cancelExtraction(a) {
    this.scene.remove(a.model);
    this.disposeUnique(a.model);
    a.record.hidden = false;
    this.physics.addBody(a.record.body);
    a.record.body.position.copy(a.from);
    this.animations = this.animations.filter((other) => other !== a);
    this.hover = null;
    this.needsRender = true;
  }
  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    if (this.pendingPointerMove) {
      this.pointerMove(this.pendingPointerMove);
      this.pendingPointerMove = null;
    }
    this.releaseDrag(
      false,
      this.drag?.entries.some((entry) => entry.data) && this.warehouseDropAt(e),
    );
    if (p.extract) {
      const a = p.extract,
        container = this.containers.find((c) => c.data.id === a.record.item.containerId);
      const inside =
        container &&
        Math.abs(a.destination.x - container.body.position.x) < SIZES.case[0] / 2 &&
        Math.abs(a.destination.z - container.body.position.z) < SIZES.case[2] / 2;
      if (inside) this.cancelExtraction(a);
      else {
        a.releasedPointer = true;
        a.destination.copy(this.tablePosition(a.destination, 'box', [a.record], a));
        a.over.set(a.destination.x, Math.max(a.above.y, a.destination.y + 0.35), a.destination.z);
      }
    }
    this.pointer = null;
    this.canvas.style.cursor = 'default';
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.updateOrganizeState();
    if (p.moved) return;
    if (p.button === 2) {
      if (p.hit?.record) this.showPackMenu(p.hit.record, e.clientX, e.clientY);
      else if (p.hit?.stack) this.showStackMenu(p.hit.stack, e.clientX, e.clientY);
      return;
    }
    if (p.button !== 0) return;
    if (p.hit?.phone || p.hit?.portal) {
      this.options.sound('navigate');
      this.persist();
      this.options.navigate?.(p.hit.portal ?? 'shop');
      return;
    }
    if (p.hit?.record) {
      const r = p.hit.record;
      this.lastClick = r.item.id;
      if (r.item.containerId) {
        this.options.toast('拖出卡盒再拆封');
        return;
      }
      if (!p.modifier) this.selected.clear();
      this.selected.has(r.item.id) ? this.selected.delete(r.item.id) : this.selected.add(r.item.id);
      this.renderSelection();
    } else if (p.hit?.stack) this.inspectStack(p.hit.stack);
    else {
      this.selected.clear();
      this.renderSelection();
    }
    this.needsRender = true;
  }
  cancelPointer(e) {
    this.pendingPointerMove = null;
    this.releaseDrag(true);
    if (this.pointer?.extract) this.cancelExtraction(this.pointer.extract);
    this.pointer = null;
    this.canvas.style.cursor = 'default';
    this.updateOrganizeState();
    if (e && this.canvas.hasPointerCapture(e.pointerId))
      this.canvas.releasePointerCapture(e.pointerId);
  }
  tablePosition(position, kind, exclude = [], excludedAnimation = null) {
    const record = exclude.find((r) => r.item?.kind === kind),
      q =
        record?.body.quaternion ??
        (isPack(kind)
          ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
          : new THREE.Quaternion());
    return surfacePosition(
      position,
      SIZES[kind],
      q,
      this.obstacleVolumes(exclude),
      this.halfWidth,
      this.halfDepth,
    );
  }
  renderSelection() {
    this.needsRender = true;
    this.selected = new Set(
      [...this.selected].filter((id) =>
        this.records.some((r) => r.item.id === id && !r.hidden && !r.item.containerId),
      ),
    );
    if (this.selectedHalos) this.scene.remove(this.selectedHalos);
    this.selectedHalos = new THREE.Group();
    this.records
      .filter((r) => this.selected.has(r.item.id))
      .forEach((r) => {
        const ring = this.halo.clone();
        ring.visible = true;
        ring.userData.record = r;
        this.selectedHalos.add(ring);
      });
    this.scene.add(this.selectedHalos);
    this.selectionBar?.remove();
    this.selectionBar = null;
    if (!this.selected.size) return;
    const bar = document.createElement('div');
    bar.className = 'space-selection';
    bar.innerHTML = `<button>打开所选</button><button>取消选择</button>`;
    bar.querySelectorAll('button')[0].onclick = () => this.openSelected();
    bar.querySelectorAll('button')[1].onclick = () => {
      this.selected.clear();
      this.renderSelection();
    };
    this.host.append(bar);
    this.selectionBar = bar;
  }
  openSelected() {
    const selected = this.records.filter((r) => this.selected.has(r.item.id));
    this.selected.clear();
    this.renderSelection();
    selected.forEach((r) => this.openRecord(r));
  }
  extractRecord(record) {
    if (record.hidden || this.animations.some((a) => a.record === record)) return;
    const container = this.containers.find((c) => c.data.id === record.item.containerId);
    if (!container) return;
    const destination = this.tablePosition(record.body.position, 'box', [record]);
    if (!destination) {
      this.options.toast('桌面空位不足，请先整理桌面的物品');
      return;
    }
    const model = this.library.create('box', true, itemProduct(record.item).set);
    model.position.copy(record.body.position);
    model.quaternion.copy(record.body.quaternion);
    this.scene.add(model);
    record.hidden = true;
    this.physics.removeBody(record.body);
    const from = model.position.clone(),
      above = from.clone();
    above.y = new THREE.Box3().setFromObject(container.model).max.y + SIZES.box[1] / 2 + 0.12;
    const over = destination.clone();
    over.y = above.y;
    destination.y = SIZES.box[1] / 2 + 0.044;
    const animation = {
      kind: 'extract',
      record,
      model,
      from,
      above,
      over,
      destination,
      fallback: destination.clone(),
      time: 0,
      phase: 'withdraw',
      duration: 0.75,
      contents: [],
      releasedPointer: false,
    };
    this.animations.push(animation);
    this.hover = null;
    return animation;
  }
  openRecord(record, { all = false } = {}) {
    if (
      record.hidden ||
      this.animations.some((a) => a.record === record) ||
      this.disposed ||
      !this.library
    )
      return;
    if (!this.options.state.items.some((i) => i.id === record.item.id)) return;
    if (record.item.containerId) {
      this.options.toast('箱内卡盒需先拖到桌面，再双击打开');
      return;
    }
    if (isPack(record.item.kind)) {
      this.openPackRecords([record]);
      return;
    }
    const kind = record.item.kind,
      focus = new THREE.Vector3().copy(record.body.position),
      fromQ = new THREE.Quaternion().copy(record.body.quaternion);
    const flatQ = this.flatRotation(record),
      floor = volume(record.body.position, record.body.quaternion, SIZES[kind]).bounds.min.y;
    all = all && kind === 'box';
    const destinations = all
      ? this.cardDestinations([PRODUCTS.box.count * PRODUCTS.pack.count], [record])
      : null;
    if (all && !destinations) return;
    let result;
    try {
      result = all
        ? openBoxFully(this.options.state, record.item.id)
        : this.options.open(record.item.id);
    } catch (e) {
      this.options.toast(e.message);
      return;
    }
    this.reserveOpening(record);
    this.closeMenu();
    this.hover = null;
    const model = this.library.create(kind, true, itemProduct(record.item).set);
    model.position.copy(record.body.position);
    model.quaternion.copy(record.body.quaternion);
    this.scene.add(model);
    const contents = [],
      slots = kind === 'case' ? caseSlots() : boxSlots();
    if (result.container)
      result.container.pose3d = { position: focus.toArray(), quaternion: fromQ.toArray() };
    if (all)
      result.stack.pose3d = {
        position: destinations[0],
        quaternion: [...CARD_PAD_QUATERNION],
      };
    const output = new THREE.Vector3(
      focus.x,
      Math.max(0.044, floor) + SIZES.pack[2] / 2 + 7 * PACK_STEP,
      focus.z,
    );
    result.items.forEach((item, i) => {
      const child = this.library.create(item.kind, true, itemProduct(item).set);
      child.position.set(...slots[i]);
      model.add(child);
      contents.push(child);
      if (kind === 'box') {
        const position = new THREE.Vector3(...tabletopPacks()[i])
          .applyQuaternion(flatQ)
          .add(output);
        item.isNew = false;
        item.pose3d = { position: position.toArray(), quaternion: flatQ.toArray() };
      }
    });
    this.options.save();
    this.animations.push({
      record,
      model,
      kind,
      openAll: all,
      result,
      contents,
      focus,
      output,
      flatQ,
      from: model.position.clone(),
      fromQ,
      time: 0,
      phase: 'seal',
      released: 0,
      duration: kind === 'case' ? 1.55 : 2.4,
    });
    this.canvas.dataset.opening = kind;
    this.syncAccessibility();
  }
  cardDestinations(counts, excluded) {
    if (this.options.state.cardStacks.length + counts.length > 5000) {
      this.options.toast('请先整理桌上的卡堆');
      return null;
    }
    const occupied = this.options.state.cardStacks.map((s) => {
      const live = this.tableStacks.find((t) => t.data.id === s.id),
        position = live?.ready ? live.root.position : s.pose3d.position,
        quaternion = live?.ready
          ? live.root.quaternion
          : (s.pose3d.quaternion ?? CARD_PAD_QUATERNION);
      return volume(position, quaternion, [CARD_SIZE[0], CARD_SIZE[1], s.cards.length * CARD_STEP]);
    });
    const obstacles = this.obstacleVolumes([...excluded, ...this.tableStacks]),
      destinations = [];
    for (const count of counts) {
      const position = findCardPadPosition(count, occupied, obstacles);
      if (!position) {
        this.options.toast('白色卡垫空间不足，请先收纳或移走卡牌');
        return null;
      }
      destinations.push(position);
      occupied.push(
        volume(position, CARD_PAD_QUATERNION, [CARD_SIZE[0], CARD_SIZE[1], count * CARD_STEP]),
      );
    }
    return destinations;
  }
  openPackRecords(records) {
    if (
      records.some(
        (r) => r.hidden || this.animations.some((a) => a.record === r || a.records?.includes(r)),
      ) ||
      this.disposed ||
      !this.library
    )
      return;
    if (![1, 5, 10].includes(records.length)) {
      this.options.toast('请选择1包、5包或10包未拆封卡包');
      return;
    }
    const groups = [];
    for (const record of records) {
      const group = groups.find(
        (g) =>
          Math.hypot(
            g[0].body.position.x - record.body.position.x,
            g[0].body.position.z - record.body.position.z,
          ) < 0.035,
      );
      if (group) group.push(record);
      else groups.push([record]);
    }
    const destinations = this.cardDestinations(
      groups.map((group) => group.length * itemProduct(group[0].item).count),
      records,
    );
    if (!destinations) return;
    let result;
    try {
      result = openPacks(
        this.options.state,
        records.map((r) => r.item.id),
      );
    } catch (e) {
      this.options.toast(e.message);
      return;
    }
    this.options.state.cardStacks = this.options.state.cardStacks.filter((s) => s !== result.stack);
    for (const [groupIndex, group] of groups.entries()) {
      const cards = group.flatMap((record) =>
        result.stack.cards.slice(
          records.indexOf(record) * result.cardsPerPack,
          (records.indexOf(record) + 1) * result.cardsPerPack,
        ),
      );
      const flatQ = new THREE.Quaternion(...CARD_PAD_QUATERNION);
      const data = {
        id: groupIndex === 0 ? result.stack.id : crypto.randomUUID(),
        cards,
        pose3d: { position: destinations[groupIndex], quaternion: flatQ.toArray() },
      };
      this.options.state.cardStacks.push(data);
      this.createPackOpening(
        group,
        { kind: 'card', cards, stack: data, cardsPerPack: result.cardsPerPack },
        flatQ,
      );
    }
    this.options.save();
    this.closeMenu();
    this.hover = null;
    this.canvas.dataset.opening = 'pack';
    this.syncAccessibility();
  }
  createPackOpening(records, result, flatQ) {
    // Download the known stack during the opening; no decode/GPU work here.
    this.options.prefetchFinishes?.(result.cards);
    const focus = new THREE.Vector3().copy(records[0].body.position),
      fromQ = new THREE.Quaternion().copy(records[0].body.quaternion);
    const model = new THREE.Group();
    model.userData.flaps = [];
    const contents = [],
      creation = [],
      wrappers = [],
      stacks = [];
    model.position.copy(focus);
    model.quaternion.copy(fromQ);
    this.scene.add(model);
    model.updateMatrixWorld(true);
    const inverse = model.matrixWorld.clone().invert();
    records.forEach((record, p) => {
      this.reserveOpening(record);
      const wrapper = this.library.create(record.item.kind, true, itemProduct(record.item).set),
        matrix = new THREE.Matrix4().compose(
          new THREE.Vector3().copy(record.body.position),
          new THREE.Quaternion().copy(record.body.quaternion),
          new THREE.Vector3(1, 1, 1),
        );
      inverse
        .clone()
        .multiply(matrix)
        .decompose(wrapper.position, wrapper.quaternion, wrapper.scale);
      model.add(wrapper);
      wrappers.push(wrapper);
      const stack = new THREE.Group();
      stack.visible = false;
      stack.position.y = cardSlots()[0][1];
      wrapper.add(stack);
      stacks.push(stack);
      creation.push(
        scheduleResourceTask(
          () => {
            for (let i = 0; i < result.cardsPerPack; i++) {
              // Each pack remains a fully overlapping stack through withdrawal.
              // Covered faces are loaded by the sorting UI when they can be seen.
              const card = this.library.createCard(
                result.cards[p * result.cardsPerPack + i],
                i === result.cardsPerPack - 1,
              );
              card.position.z = cardSlots(result.cardsPerPack)[i][2];
              stack.add(card);
              contents.push(card);
            }
          },
          { priority: 3, valid: () => !this.disposed && this.animations.includes(animation) },
        ),
      );
    });
    const animation = {
      record: records[0],
      records,
      model,
      kind: 'pack',
      result,
      contents,
      wrappers,
      stacks,
      focus,
      flatQ,
      from: model.position.clone(),
      fromQ,
      time: 0,
      phase: 'seal',
      released: 0,
      duration: 1.52,
      finishesReady: false,
    };
    Promise.all(creation)
      .then(() => Promise.allSettled(contents.map((card) => card.userData.finishReady)))
      .then(async (ready) => {
        if (this.disposed) return;
        const failed = ready.some((result) => result.status === 'rejected');
        try {
          if (!failed)
            await prepareRenderer(
              this.renderer,
              model,
              this.camera,
              () => !this.disposed,
              this.scene,
            );
        } catch {
          if (!this.disposed) this.options.toast('卡面准备失败，卡牌已保存，请刷新后重试');
        } finally {
          if (!this.disposed) {
            if (failed) this.options.toast('卡面加载失败，卡牌已保存，请刷新后重试');
            animation.finishesReady = true;
            stacks.forEach((stack) => (stack.visible = true));
            this.needsRender = true;
            this.wake();
          }
        }
      })
      .catch(() => {
        if (this.disposed) return;
        this.finishOpening(animation);
        try {
          this.restoreCardStack(result.stack);
          this.syncAccessibility();
        } catch {
          // The saved identities remain recoverable even if this renderer fails.
        }
        this.options.toast('卡牌准备失败，卡牌已保存，请刷新后重试');
        this.needsRender = true;
      });
    this.animations.push(animation);
  }
  animateOpening(a, dt) {
    a.time += dt * (this.options.state.settings.motion ? 1 : 2.2) * (a.kind === 'box' ? 1.25 : 1);
    // Tear immediately; only the withdrawal needs finished card surfaces.
    if (a.kind === 'pack' && !a.finishesReady) a.time = Math.min(a.time, 0.28);
    const t = a.time;
    if (a.kind === 'place') {
      const p = a.from.clone().lerp(a.destination, smooth(t, 0, a.duration));
      a.record.body.position.copy(p);
      a.record.body.aabbNeedsUpdate = true;
      if (t >= a.duration) {
        this.settleRecord(a.record);
        this.animations = this.animations.filter((other) => other !== a);
        this.persist();
      }
      return;
    }
    if (a.kind === 'extract') {
      a.phase =
        t < 0.28 ? 'withdraw' : !a.releasedPointer ? 'held' : !a.placeStart ? 'transfer' : 'place';
      if (t < 0.28) a.model.position.lerpVectors(a.from, a.above, ease(t / 0.28));
      else if (!a.placeStart) {
        a.model.position.lerp(a.over, 1 - Math.exp(-dt * 18));
        if (a.releasedPointer && a.model.position.distanceTo(a.over) < 0.015) {
          a.placeStart = t;
          a.placeFrom = a.model.position.clone();
        }
      } else
        a.model.position.lerpVectors(
          a.placeFrom,
          a.destination,
          smooth(t, a.placeStart, a.placeStart + 0.22),
        );
      if (a.placeStart && t >= a.placeStart + 0.22) {
        extractItem(this.options.state, a.record.item.id);
        this.clearEmptyContainers();
        a.record.body.position.copy(a.model.position);
        a.record.body.quaternion.copy(a.model.quaternion);
        this.physics.addBody(a.record.body);
        a.record.hidden = false;
        delete a.record.basePosition;
        this.settleRecord(a.record);
        this.scene.remove(a.model);
        this.disposeUnique(a.model);
        this.animations = this.animations.filter((other) => other !== a);
        this.syncAccessibility();
        this.persist();
      }
      return;
    }
    const { kind, focus } = a;
    // Packaging stays at its original position and orientation for the entire opening.
    if (kind === 'case' || kind === 'box') {
      this.library.poseOpening(a.model, smooth(t, 0.15, 1.0));
      a.phase = t < 0.3 ? 'seal' : t < 1 ? 'opening' : 'withdraw';
      if (kind === 'case') {
        if (t >= a.duration) {
          a.contents.forEach((c) => {
            a.model.remove(c);
            this.disposeUnique(c);
          });
          a.contents = [];
          this.addContainer(a.result.container, a.model);
          a.keepModel = true;
          a.result.items.forEach((item) => this.addRecord(item));
          a.released = a.result.items.length;
          this.finishOpening(a);
        }
        return;
      }
      if (t < 1.45) {
        const slots = boxSlots();
        a.contents.forEach((c, i) => {
          c.position.y = slots[i][1] + smooth(t, 1, 1.45) * WITHDRAW_PACK;
        });
      }
      if (t >= 1.45 && !a.bundle) {
        a.model.updateMatrixWorld(true);
        a.bundle = new THREE.Group();
        a.bundle.position.copy(
          a.model.localToWorld(new THREE.Vector3(0, boxSlots()[0][1] + WITHDRAW_PACK, 0)),
        );
        a.bundle.quaternion.copy(a.fromQ);
        this.scene.add(a.bundle);
        a.bundle.updateMatrixWorld(true);
        a.contents.forEach((c) => a.bundle.attach(c));
        a.model.visible = false;
        a.bundleFrom = a.bundle.position.clone();
      }
      if (a.bundle) {
        a.phase = t < 1.9 ? 'arrange' : 'place';
        const lay = smooth(t, 1.45, 2.35);
        a.bundle.position.lerpVectors(a.bundleFrom, a.output, lay);
        a.bundle.quaternion.slerpQuaternions(a.fromQ, a.flatQ, lay);
        a.contents.forEach((c, i) => c.position.set(...tabletopPacks()[i]));
        if (t >= a.duration) {
          a.bundle.updateMatrixWorld(true);
          const records = [];
          a.contents.forEach((c, i) => {
            const p = c.getWorldPosition(new THREE.Vector3()),
              q = c.getWorldQuaternion(new THREE.Quaternion());
            const r = this.addRecord(a.result.items[i], { spawn: p.toArray() });
            records.push(r);
            r.body.quaternion.copy(q);
            this.settleRecord(r);
            a.bundle.remove(c);
            this.disposeUnique(c);
          });
          a.contents = [];
          this.scene.remove(a.bundle);
          a.released = a.result.items.length;
          if (a.openAll)
            this.createPackOpening(records, a.result, new THREE.Quaternion(...CARD_PAD_QUATERNION));
          this.finishOpening(a);
          if (a.openAll) this.canvas.dataset.opening = 'pack';
        }
      }
      return;
    }
    const cutEnd = 0.28,
      withdrawEnd = cutEnd + 0.43,
      layEnd = withdrawEnd + 0.35;
    a.phase = t < 0.035 ? 'seal' : t < cutEnd ? 'tear' : t < withdrawEnd ? 'withdraw' : 'align';
    a.wrappers.forEach((w) => this.library.poseOpening(w, smooth(t, 0.035, cutEnd)));
    if (!a.presenting)
      a.stacks.forEach((stack) => {
        stack.position.y = cardSlots()[0][1] + smooth(t, cutEnd, withdrawEnd) * WITHDRAW_CARD;
      });
    if (t >= withdrawEnd && !a.presenting) {
      a.model.updateMatrixWorld(true);
      const stack = new THREE.Group();
      stack.position.copy(
        a.model.localToWorld(new THREE.Vector3(0, cardSlots()[0][1] + WITHDRAW_CARD, 0)),
      );
      stack.quaternion.copy(a.fromQ);
      this.scene.add(stack);
      stack.updateMatrixWorld(true);
      a.contents.forEach((c) => stack.attach(c));
      // Selection order need not match the physical stack. Keep the exposed
      // face on top throughout alignment, rather than crossing cards mid-flight.
      const ordered = a.contents
        .map((mesh, index) => ({ mesh, card: a.result.cards[index] }))
        .sort((left, right) => left.mesh.position.z - right.mesh.position.z);
      a.contents = ordered.map((entry) => entry.mesh);
      a.result.cards = ordered.map((entry) => entry.card);
      a.result.stack.cards = a.result.cards;
      // Start the sorting renderer while the revealed stack is still settling.
      this.options.warmFinishes?.(a.result.cards);
      a.presenting = true;
      a.stack = stack;
      a.stackFrom = stack.position.clone();
      a.offsets = a.contents.map((c) => c.position.clone());
      a.rotations = a.contents.map((c) => c.quaternion.clone());
      a.model.visible = false;
      this.createCards(a.result.stack, stack, a.contents, false);
    }
    if (a.presenting) {
      const lay = smooth(t, withdrawEnd, layEnd);
      a.stack.quaternion.slerpQuaternions(a.fromQ, a.flatQ, lay);
      a.stack.position.lerpVectors(
        a.stackFrom,
        new THREE.Vector3(...a.result.stack.pose3d.position),
        lay,
      );
      a.contents.forEach((c, i) => {
        c.position.lerpVectors(
          a.offsets[i],
          new THREE.Vector3(...tableCards(i, a.contents.length)),
          lay,
        );
        c.quaternion.slerpQuaternions(a.rotations[i], new THREE.Quaternion(), lay);
      });
    }
    if (t >= a.duration) this.finishOpening(a);
  }
  finishOpening(a) {
    if (!a.keepModel) {
      this.scene.remove(a.model);
      this.disposeUnique(a.model);
    }
    const removed = new Set(a.records ?? [a.record]);
    for (const record of removed) {
      this.physics.removeBody(record.body);
      this.wakeSupported(record.body, [...removed]);
    }
    this.records = this.records.filter((r) => !removed.has(r));
    this.animations = this.animations.filter((other) => other !== a);
    if (!this.animations.length) delete this.canvas.dataset.opening;
    if (a.kind === 'pack') {
      const stack = this.tableStacks.find((s) => s.data.id === a.result.stack.id);
      if (stack) {
        stack.ready = true;
        this.compactStack(stack);
        this.options.warmFinishes?.(stack.data.cards);
      }
    }
    this.rebuildBatches();
    this.syncAccessibility();
    this.persist();
  }
  settleRecord(record) {
    const b = record.body;
    b.type = CANNON.Body.DYNAMIC;
    b.mass = record.mass;
    b.collisionResponse = true;
    b.updateMassProperties();
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.aabbNeedsUpdate = true;
    b.sleep();
    this.needsRender = true;
  }
  createCards(data, root, meshes, ready = true) {
    const stack = { data, root, ready };
    this.tableStacks.push(stack);
    data.cards.forEach((card, i) =>
      this.cards.push({
        id: card.id,
        stackId: data.id,
        root,
        mesh: meshes[i],
        rarity: card.rarity,
        index: i,
        revealed: true,
      }),
    );
    if (ready) this.compactStack(stack);
    this.canvas.dataset.cards = String(this.cards.length);
    this.syncAccessibility();
  }
  restoreCardStack(data) {
    const root = new THREE.Group();
    root.position.set(...data.pose3d.position);
    root.rotation.x = -Math.PI / 2;
    if (data.pose3d.quaternion) root.quaternion.fromArray(data.pose3d.quaternion);
    this.scene.add(root);
    const meshes = data.cards.map((card, i) => {
      const mesh = new THREE.Group();
      mesh.position.set(...tableCards(i, data.cards.length));
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      return mesh;
    });
    this.createCards(data, root, meshes);
  }
  compactStack(stack) {
    this.stats.stackCompactions++;
    const byId = new Map(
        this.cards.filter((c) => c.stackId === stack.data.id).map((c) => [c.id, c]),
      ),
      cards = stack.data.cards.map((c) => byId.get(c.id)),
      count = cards.length;
    const top = cards.at(-1)?.mesh;
    // Keep the exact opening face, geometry and material through the handoff.
    // Acquire the replacement before releasing old surfaces during reordering.
    const retainedTop =
      stack.topCardId === stack.data.cards.at(-1)?.id ? stack.visual?.children[0] : undefined;
    const visual = this.library.createTableStack(
      stack.data.cards,
      top?.getObjectByName('card-board') ? top : retainedTop,
    );
    if (stack.visual) {
      stack.root.remove(stack.visual);
      this.disposeUnique(stack.visual);
    }
    for (const [i, card] of cards.entries()) {
      if (card.mesh.children.length || card.mesh.isMesh) {
        stack.root.remove(card.mesh);
        if (card.mesh.parent !== visual) this.disposeUnique(card.mesh);
        card.mesh = new THREE.Group();
      }
      card.index = i;
      card.mesh.position.set(...tableCards(i, count));
      // Compacted cards are logical pick/sort positions, not rendered objects.
      // Keep their identity without traversing an empty scene node per card.
      card.mesh.matrixAutoUpdate = false;
      card.mesh.updateMatrix();
    }
    stack.visual = visual;
    if (this.renderPrepared && !top && !retainedTop) {
      // Reordering/routing can change the room's top card while the inspector
      // covers it. Prepare that renderer now, before the return exposes it.
      stack.topPreparation = Promise.resolve(visual.userData.finishReady)
        .then(() =>
          prepareRenderer(
            this.renderer,
            visual,
            this.camera,
            () => !this.disposed && stack.visual === visual,
            this.scene,
          ),
        )
        .catch(() => {
          if (!this.disposed) this.options.toast('桌面卡面准备失败，请刷新后重试。');
        });
    }
    stack.topCardId = stack.data.cards.at(-1)?.id;
    stack.root.add(stack.visual);
    stack.size = [CARD_SIZE[0], CARD_SIZE[1], Math.max(0.004 * MODEL_SCALE, count * CARD_STEP)];
    stack.mass = Math.max(0.02, count * 0.002);
    if (!stack.body) {
      this.stats.stackBodies++;
      stack.body = new CANNON.Body({
        mass: stack.mass,
        shape: new CANNON.Box(new CANNON.Vec3(...stack.size.map((n) => n / 2))),
        linearDamping: 0.7,
        angularDamping: 0.92,
        allowSleep: true,
        sleepSpeedLimit: 0.3,
        sleepTimeLimit: 0.5,
      });
      this.physics.addBody(stack.body);
    } else {
      const shape = stack.body.shapes[0];
      shape.halfExtents.set(...stack.size.map((n) => n / 2));
      shape.updateConvexPolyhedronRepresentation();
      shape.updateBoundingSphereRadius();
      stack.body.mass = stack.mass;
      stack.body.updateMassProperties();
      stack.body.updateBoundingRadius();
      this.physics.broadphase.dirty = true;
    }
    stack.body.position.copy(stack.root.position);
    stack.body.quaternion.copy(stack.root.quaternion);
    stack.body.aabbNeedsUpdate = true;
    stack.body.sleep();
    this.needsRender = true;
    this.shadowDirty = true;
  }
  saveStack(stack) {
    stack.data.pose3d = {
      position: stack.root.position.toArray(),
      quaternion: stack.root.quaternion.toArray(),
    };
  }
  animateCards() {
    for (const a of this.animations)
      if (a.kind === 'pack' && !a.presenting)
        a.contents.forEach((c) => {
          if (c.userData.foil) c.userData.foil.uniforms.time.value = this.elapsed;
        });
  }
  inspectorSource(stack) {
    stack.root.updateMatrixWorld(true);
    const [w, h, depth] = stack.size,
      b = this.canvas.getBoundingClientRect();
    const points = [
      [-w / 2, h / 2, depth / 2],
      [w / 2, h / 2, depth / 2],
      [w / 2, -h / 2, depth / 2],
      [-w / 2, -h / 2, depth / 2],
    ].map((p) => new THREE.Vector3(...p).applyMatrix4(stack.root.matrixWorld).project(this.camera));
    return {
      quad: points.every((p) => p.z > -1 && p.z < 1)
        ? points.map((p) => [
            b.left + ((p.x + 1) * b.width) / 2,
            b.top + ((1 - p.y) * b.height) / 2,
          ])
        : null,
      rarity: stack.data.cards.at(-1)?.rarity,
    };
  }
  inspectStack(stack) {
    if (!stack.ready || this.inspector || this.drag) return;
    this.closeMenu();
    stack.body.sleep();
    this.needsRender = true;
    this.shadowDirty = true;
    this.options.sound('card');
    this.inspector = createCardInspector(this.host, this.options.state, stack.data, {
      save: this.options.save,
      sound: this.options.sound,
      source: () => this.inspectorSource(stack),
      prepare: this.options.prepareFinishes,
      complete: this.options.completeFinishes,
      onEnter: () => {
        stack.root.visible = false;
        this.needsRender = true;
        this.shadowDirty = true;
      },
      onReorder: () => {
        this.compactStack(stack);
        this.persist();
      },
      onRoute: (cards) => {
        this.wakeSupported(stack.body, [stack]);
        const ids = new Set(cards.map((c) => c.id));
        this.cards = this.cards.filter((c) => {
          if (!ids.has(c.id)) return true;
          c.root.remove(c.mesh);
          this.disposeUnique(c.mesh);
          return false;
        });
        if (!stack.data.cards.length) {
          this.scene.remove(stack.root);
          this.disposeUnique(stack.visual);
          this.physics.removeBody(stack.body);
          this.tableStacks = this.tableStacks.filter((s) => s !== stack);
        } else {
          stack.root.position.y -=
            (stack.size[2] - Math.max(0.004 * MODEL_SCALE, stack.data.cards.length * CARD_STEP)) /
            2;
          this.compactStack(stack);
          this.saveStack(stack);
        }
        this.canvas.dataset.cards = String(this.cards.length);
        this.syncAccessibility();
        this.persist();
      },
      onClose: () => {
        if (['preparing', 'loading'].includes(this.inspector?.element.dataset.phase))
          this.inspectorEscapeUntil = performance.now() + 250;
        this.inspector = null;
        return Promise.resolve(stack.topPreparation).then(() => {
          if (this.disposed) return;
          stack.root.visible = true;
          this.shadowDirty = true;
          this.needsRender = true;
          // Keep the returning image until the restored WebGL card is actually presented.
          const renders = this.stats.renders,
            started = performance.now();
          return new Promise((resolve) => {
            const check = () => {
              if (
                this.disposed ||
                this.navigationPaused ||
                this.stats.renders > renders ||
                performance.now() - started > 180
              )
                resolve();
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          });
        });
      },
    });
  }
  escape() {
    if (this.pointer || this.drag) {
      this.cancelPointer(this.pointer ? { pointerId: this.pointer.id } : null);
      return true;
    }
    if (this.inspector) {
      this.inspector.escape();
      return true;
    }
    // Cancelling the hidden preparation has no exit animation to absorb a
    // repeated Escape. Keep the second keypress from also leaving the room.
    if (performance.now() < (this.inspectorEscapeUntil ?? 0)) return true;
    if (this.actionMenu) {
      this.options.sound('back');
      this.closeMenu();
      return true;
    }
    if (this.selected.size) {
      this.selected.clear();
      this.renderSelection();
      this.needsRender = true;
      return true;
    }
    return false;
  }
  dust(position, scale) {
    if (!this.options.state.settings.motion || this.effects.length > 20) return;
    const group = new THREE.Group();
    group.position.set(position.x, 0.04, position.z);
    const material = new THREE.MeshBasicMaterial({
      color: '#c3a66d',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const geometry = new THREE.RingGeometry(0.14, 0.2, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
    this.scene.add(group);
    this.effects.push({ group, mesh, scale, born: this.elapsed });
  }
  persist() {
    if (!this.library) return;
    const items = new Map(this.options.state.items.map((i) => [i.id, i]));
    for (const r of this.records) {
      const item = items.get(r.item.id);
      if (!item || r.hidden) continue;
      const p = item.containerId && r.basePosition ? r.basePosition : r.body.position,
        q = r.body.quaternion;
      const size = SIZES[item.kind];
      item.x = THREE.MathUtils.clamp(0.5 + p.x / (this.halfWidth * 2 - size[0] - 1), 0, 1);
      item.y = THREE.MathUtils.clamp(0.5 + p.z / (this.halfDepth * 2 - size[2] - 1), 0, 1);
      if (p.y < 2) item.isNew = false;
      item.pose3d = { position: [p.x, Math.max(0, p.y), p.z], quaternion: [q.x, q.y, q.z, q.w] };
    }
    for (const stack of this.tableStacks)
      if (stack.ready && stack.body) {
        stack.root.position.copy(stack.body.position);
        stack.root.quaternion.copy(stack.body.quaternion);
        this.saveStack(stack);
      }
    this.options.state.spaceView = { orbit: { ...this.orbit }, target: this.target.toArray() };
    this.saveDirty = false;
    this.lastSave = this.elapsed;
    this.options.save();
  }
  async preparePackageSamples(items) {
    this.warmPackages ??= [];
    this.warmedPackageTypes ??= new Set();
    const pending = [];
    for (const item of items) {
      const set = itemProduct(item).set;
      for (const kind of item.kind === 'case'
        ? ['case', 'box', 'pack']
        : item.kind === 'box'
          ? ['box', 'pack']
          : [item.kind]) {
        const key = `${set}:${kind}`;
        if (this.warmedPackageTypes.has(key)) continue;
        this.warmedPackageTypes.add(key);
        const model = this.library.create(kind, true, set);
        model.position.set(0, 1, 0);
        this.warmPackages.push(model);
        pending.push(model);
        await prepareRenderer(this.renderer, model, this.camera, () => !this.disposed, this.scene);
        if (this.disposed) return [];
      }
    }
    return pending;
  }
  async syncPurchasedItems() {
    if (this.disposed || !this.library) return;
    try {
      await this.library.prepareSets(this.options.state.items.map((item) => itemProduct(item).set));
      const pending = await this.preparePackageSamples(this.options.state.items);
      if (!this.disposed && pending.length) {
        await scheduleResourceTask(
          () => {
            const target = new THREE.WebGLRenderTarget(1, 1);
            target.texture.colorSpace = THREE.SRGBColorSpace;
            const previous = this.renderer.getRenderTarget();
            const scissor = this.renderer.getScissorTest();
            const shadowUpdate = this.renderer.shadowMap.needsUpdate;
            for (const model of pending) this.scene.add(model);
            try {
              this.renderer.setRenderTarget(target);
              this.renderer.setScissorTest(false);
              this.renderer.shadowMap.needsUpdate = false;
              this.renderer.render(this.scene, this.camera);
            } finally {
              for (const model of pending) this.scene.remove(model);
              this.renderer.setRenderTarget(previous);
              this.renderer.setScissorTest(scissor);
              this.renderer.shadowMap.needsUpdate = shadowUpdate;
              target.dispose();
            }
          },
          { valid: () => !this.disposed },
        );
      }
    } catch (error) {
      if (!this.disposed) this.options.toast('新包装素材加载失败，请重新进入开盒空间。');
      return;
    }
    if (this.disposed) return;
    const existing = new Set(this.records.map((r) => r.item.id));
    let index = 0;
    for (const item of this.options.state.items)
      if (!item.containerId && !existing.has(item.id))
        this.addRecord(item, { initial: true, index: index++ });
    this.rebuildBatches();
    this.syncAccessibility();
    this.needsRender = true;
    this.shadowDirty = true;
  }
  setNavigationPaused(paused) {
    if (this.disposed || this.navigationPaused === paused) return;
    this.navigationPaused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.wake();
  }
  applyRenderSize() {
    if (!this.renderSize) return;
    const { width, height } = this.renderSize;
    this.renderer.setDrawingBufferSize(width, height, roomPixelRatio(this.quality.ratio));
    this.stats.bufferResizes = (this.stats.bufferResizes ?? 0) + 1;
    this.renderSize = null;
  }
  tick(now) {
    if (this.disposed || this.navigationPaused) return;
    this.frame = 0;
    this.ticking = true;
    this.stats.ticks++;
    const obscured = this.inspector?.element.dataset.phase === 'open';
    if (obscured) this.stats.obscuredTicks++;
    this.updateOrganizeState();
    const begin = performance.now(),
      dt = Math.min(0.04, (now - this.previous) / 1000);
    this.previous = now;
    this.elapsed += dt;
    if (this.pendingPointerMove) {
      const event = this.pendingPointerMove;
      this.pendingPointerMove = null;
      this.pointerMove(event);
    }
    if (this.pendingHover) {
      const event = this.pendingHover;
      this.pendingHover = null;
      const hit = this.hit(event),
        record = hit?.record ?? null,
        stack = hit?.stack ?? null;
      if (this.hover !== record || this.hoverStack !== stack) {
        this.needsRender = true;
        if (stack?.ready) this.options.warmFinishes?.(stack.data.cards, { prefetchPriority: 1 });
      }
      this.hover = record;
      this.hoverStack = stack;
      this.canvas.style.cursor = hit?.phone || hit?.portal ? 'pointer' : hit ? 'grab' : 'default';
    }
    let changing = false;
    for (const r of this.records) {
      if (r.scheduled && this.elapsed >= r.scheduled) {
        r.scheduled = 0;
        r.hidden = false;
        this.promoteBody(r);
        changing = true;
      }
      if (!r.hidden && r.body.position.y < -3) {
        r.body.position.y = 4;
        r.body.velocity.set(0, 0, 0);
        this.promoteBody(r);
      }
      if (r.item.containerId && !r.hidden && r.basePosition) {
        const lift = THREE.MathUtils.damp(r.hoverLift, this.hover === r ? 0.26 : 0, 18, dt);
        if (Math.abs(lift - r.hoverLift) > 0.0001) {
          r.hoverLift = lift;
          r.body.position.y = r.basePosition.y + lift;
          r.body.aabbNeedsUpdate = true;
          changing = true;
        }
      }
    }
    const moving = this.physics.bodies.some(
      (b) => b.type === CANNON.Body.DYNAMIC && b.sleepState !== CANNON.Body.SLEEPING,
    );
    const finishWarmIdle = String(
      !moving && !this.animations.length && !this.drag && !this.pointer && !this.zoomActive,
    );
    if (this.canvas.dataset.finishWarmIdle !== finishWarmIdle)
      this.canvas.dataset.finishWarmIdle = finishWarmIdle;
    if (moving) {
      this.physics.step(1 / 60, dt, 2);
      this.stats.physicsSteps++;
      changing = true;
      this.saveDirty = true;
    }
    const activeAnimations = this.animations.filter(
      (a) => !(a.kind === 'pack' && !a.finishesReady && a.time >= 0.28),
    );
    if (activeAnimations.length) {
      for (const a of activeAnimations) this.animateOpening(a, dt);
      this.animateCards();
      changing = true;
    }
    for (const stack of this.tableStacks)
      if (stack.ready && stack.body) {
        const interpolating =
          stack.body.type === CANNON.Body.DYNAMIC && stack.body.sleepState !== CANNON.Body.SLEEPING;
        stack.root.position.copy(
          interpolating ? stack.body.interpolatedPosition : stack.body.position,
        );
        stack.root.quaternion.copy(
          interpolating ? stack.body.interpolatedQuaternion : stack.body.quaternion,
        );
      }
    let matricesChanged = false;
    if (changing || this.needsRender)
      for (const batch of this.batches) matricesChanged = batch.update() || matricesChanged;
    this.halo.visible = !!this.hover && !this.hover.hidden;
    if (this.halo.visible) {
      const r = this.hover;
      r.body.updateAABB();
      this.halo.position.set(
        r.body.position.x,
        r.body.aabb.upperBound.y + 0.014,
        r.body.position.z,
      );
      this.halo.scale.setScalar(r.item.kind === 'case' ? 2 : 1);
    }
    this.selectedHalos?.children.forEach((ring) => {
      const r = ring.userData.record;
      r.body.updateAABB();
      ring.position.set(r.body.position.x, r.body.aabb.upperBound.y + 0.014, r.body.position.z);
      ring.scale.setScalar(r.item.kind === 'case' ? 2 : 1);
    });
    if (this.effects.length) {
      changing = true;
      this.effects = this.effects.filter((effect) => {
        const age = this.elapsed - effect.born;
        if (age > 0.6) {
          this.scene.remove(effect.group);
          effect.mesh.geometry.dispose();
          effect.mesh.material.dispose();
          return false;
        }
        effect.group.scale.setScalar((1 + age * 4) * effect.scale);
        effect.mesh.material.opacity = (1 - age / 0.6) * 0.14;
        return true;
      });
    }
    if (
      this.saveDirty &&
      !this.drag &&
      !this.pointer?.extract &&
      (this.elapsed - this.lastSave > 1.5 || (!moving && !this.animations.length))
    )
      this.persist();
    if (changing || matricesChanged) this.shadowDirty = true;
    if (changing) this.needsRender = true;
    if (this.shadowDirty && !moving && !this.animations.length && !this.effects.length)
      this.needsRender = true;
    if (this.needsRender && !obscured && this.renderPrepared) {
      this.applyRenderSize();
      // A cached shadow from the previous pose can shade the moving object
      // itself on alternating frames. Keep manipulation and falling in sync.
      const updateShadow =
        this.shadowDirty &&
        (this.drag ||
          this.pointer?.extract ||
          moving ||
          now - this.lastShadowAt >= 1000 / 30 ||
          (!this.animations.length && !this.effects.length));
      this.renderer.shadowMap.needsUpdate = updateShadow;
      this.renderer.info.reset();
      this.camera.layers.set(0);
      this.library?.updateCardLight(this.keyLight.position);
      const rendered = this.damageRenderer.render({ allowSkip: true });
      if (rendered) this.stats.renders++;
      this.needsRender = false;
      if (updateShadow) {
        this.shadowDirty = false;
        this.lastShadowAt = now;
        if (rendered) this.stats.shadowUpdates++;
      }
      if (this.canvas.dataset.ready === 'true') {
        this.canvas.dataset.presented = 'true';
        this.canvas.style.removeProperty('visibility');
      }
      const cost = performance.now() - begin;
      this.stats.frameMs = this.stats.frameMs * 0.9 + cost * 0.1;
      const tracking =
        changing ||
        moving ||
        this.animations.length ||
        this.effects.length ||
        this.drag ||
        this.zoomActive;
      if (
        tracking &&
        // Resizing a full buffer costs more than repainting a small footprint.
        // Reserve adaptive supersampling changes for substantial GPU work.
        this.damageRenderer.stats().lastFraction >= 0.35 &&
        this.lastRenderAt &&
        now - this.lastRenderAt < 160 &&
        this.quality.observe(now - this.lastRenderAt)
      )
        this.resize();
      if (!tracking && this.quality.restore()) this.resize();
      this.lastRenderAt = tracking ? now : 0;
    }
    this.stats.quality = this.renderer.getPixelRatio();
    this.stats.displayFrameMs = this.quality.interval;
    this.ticking = false;
    if (
      (this.needsRender && !obscured && this.renderPrepared) ||
      changing ||
      moving ||
      activeAnimations.length ||
      this.effects.length ||
      this.records.some((r) => r.scheduled) ||
      this.pendingHover
    )
      this.frame = requestAnimationFrame(this.tick);
  }
  projectItem(id) {
    const r = this.records.find((r) => r.item.id === id);
    if (!r) return null;
    const b = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const p = new THREE.Vector3(0, r.item.containerId ? SIZES.box[1] / 2 : 0, 0)
      .applyQuaternion(
        new THREE.Quaternion(
          r.body.quaternion.x,
          r.body.quaternion.y,
          r.body.quaternion.z,
          r.body.quaternion.w,
        ),
      )
      .add(new THREE.Vector3(r.body.position.x, r.body.position.y, r.body.position.z))
      .project(this.camera);
    return {
      x: b.left + ((p.x + 1) / 2) * b.width,
      y: b.top + ((1 - p.y) / 2) * b.height,
      visible: !r.hidden && p.z >= -1 && p.z <= 1,
    };
  }
  projectCard(index) {
    const card = this.cards[index];
    if (!card) return null;
    const b = this.canvas.getBoundingClientRect();
    card.root.updateMatrixWorld(true);
    const p = this.cardWorldPoint(card, new THREE.Vector3(0, 0, 0.002)).project(this.camera);
    return { x: b.left + ((p.x + 1) / 2) * b.width, y: b.top + ((1 - p.y) / 2) * b.height };
  }
  cardWorldPoint(card, point) {
    return card.mesh.parent
      ? card.mesh.localToWorld(point)
      : point.applyMatrix4(card.mesh.matrix).applyMatrix4(card.root.matrixWorld);
  }
  projectPoint(position) {
    const b = this.canvas.getBoundingClientRect(),
      p = new THREE.Vector3(...position).project(this.camera);
    return { x: b.left + ((p.x + 1) / 2) * b.width, y: b.top + ((1 - p.y) / 2) * b.height };
  }
  snapshot() {
    const a = this.anim;
    for (const stack of this.tableStacks) stack.root.updateWorldMatrix(true, false);
    const obstacles = this.obstacleVolumes([...this.records, ...this.tableStacks]).map((v) => ({
      position: v.center.toArray(),
      quaternion: v.q.toArray(),
      size: v.half.map((n) => n * 2),
    }));
    return {
      ready: !!this.library,
      engine: 'WebGL',
      physics: 'cannon-es',
      sizes: SIZES,
      scenery: this.desk.snapshot(),
      objects: this.records
        .filter((r) => !r.hidden)
        .map((r) => ({
          id: r.item.id,
          kind: r.item.kind,
          deliveryStart: r.deliveryStart,
          renderPosition: [
            ...(r.body.type === CANNON.Body.DYNAMIC && r.body.sleepState !== CANNON.Body.SLEEPING
              ? r.body.interpolatedPosition
              : r.body.position
            ).toArray(),
          ],
          containerId: r.item.containerId,
          slotIndex: r.item.slotIndex,
          position: [r.body.position.x, r.body.position.y, r.body.position.z],
          quaternion: [
            r.body.quaternion.x,
            r.body.quaternion.y,
            r.body.quaternion.z,
            r.body.quaternion.w,
          ],
          velocity: r.body.velocity.length(),
          sleeping: r.body.sleepState === CANNON.Body.SLEEPING,
        })),
      tabletop: {
        halfWidth: this.halfWidth,
        halfDepth: this.halfDepth,
        obstacles,
        cardPad: { ...cardPadBounds(), ...CARD_PAD },
      },
      containers: this.containers.map((c) => ({
        id: c.data.id,
        position: c.model.position.toArray(),
        flaps: c.model.userData.flaps.map((f) => f.pivot.rotation[f.axis]),
        contents: this.records.filter((r) => r.item.containerId === c.data.id).length,
      })),
      animation: a ? this.animationSnapshot(a) : null,
      animations: this.animations.map((a) => this.animationSnapshot(a)),
      stacks: this.tableStacks.map((s) => ({
        id: s.data.id,
        count: s.data.cards.length,
        ready: s.ready,
        position: s.root.position.toArray(),
        quaternion: s.root.quaternion.toArray(),
        velocity: s.body?.velocity.length() ?? 0,
        sleeping: s.body?.sleepState === CANNON.Body.SLEEPING,
        visible: s.root.visible,
        finish: s.visual?.userData.finish
          ? {
              shader: s.visual.userData.finish.isShaderMaterial,
              kind: s.visual.userData.finish.uniforms.kind.value,
              serial: s.visual.userData.finish.userData.serial,
              ready: !!s.visual.userData.finish.userData.ready,
            }
          : null,
      })),
      inspecting: !!this.inspector,
      selected: [...this.selected],
      held: this.drag?.entries.map((e) => e.item?.id ?? e.data.id) ?? [],
      entrances: Object.fromEntries(
        ['shop', 'album', 'warehouse'].map((page) => [page, this.portalSource(page)]),
      ),
      exposure: this.renderer.toneMappingExposure,
      phone: {
        position: this.phone.root.position.toArray(),
        screen: this.projectPoint(this.phone.root.position.toArray()),
      },
      cards: this.cards.map((c) => ({
        id: c.id,
        stackId: c.stackId,
        rarity: c.rarity,
        revealed: c.revealed,
        position: c.mesh.position.toArray(),
        worldPosition: this.cardWorldPoint(c, new THREE.Vector3()).toArray(),
        angle: c.mesh.rotation.y,
      })),
      target: this.target.toArray(),
      orbit: { ...this.orbit },
      camera: this.camera.position.toArray(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      performance: {
        ...this.stats,
        damage: this.damageRenderer?.stats(),
        matrixUpdates: this.batches.reduce((n, b) => n + b.updates, 0),
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
      },
    };
  }
  animationSnapshot(a) {
    return {
      id: a.record.item.id,
      kind: a.kind,
      phase: a.phase,
      time: a.time,
      released: a.released,
      scale: a.model?.scale.toArray() ?? [1, 1, 1],
      position: a.model?.position.toArray() ?? [
        a.record.body.position.x,
        a.record.body.position.y,
        a.record.body.position.z,
      ],
      quaternion: a.model?.quaternion.toArray() ?? [
        a.record.body.quaternion.x,
        a.record.body.quaternion.y,
        a.record.body.quaternion.z,
        a.record.body.quaternion.w,
      ],
      flaps: a.model?.userData.flaps?.map((f) => f.pivot.rotation[f.axis]) ?? [],
      method: a.scissors ? 'scissors' : a.kind === 'pack' ? 'tear' : undefined,
      strip: a.wrappers?.[0].userData.strip.position.toArray(),
      scissors: a.scissors
        ? {
            visible: a.scissors.visible,
            position: a.scissors.position.toArray(),
            angles: a.scissors.userData.arms.map((arm) => arm.rotation.y),
          }
        : null,
      contents: a.contents.map((c) => (c ? c.position.toArray() : null)),
      stackPosition: a.stack?.position.toArray(),
      duration: a.duration,
      stackDetached: !!a.presenting,
    };
  }
  geometrySnapshot() {
    const a = this.anim;
    if (!a || a.kind === 'place') return null;
    a.model.updateMatrixWorld(true);
    a.stack?.updateMatrixWorld(true);
    a.bundle?.updateMatrixWorld(true);
    const shape = (name, size, matrix) => ({ name, size, matrix: matrix.toArray() });
    const roots = new Set(a.contents.filter(Boolean)),
      panels = [];
    a.model.traverse((mesh) => {
      if (a.kind === 'extract') return;
      if (!a.model.visible) return;
      if (!mesh.isMesh || !mesh.visible || /wrap|tape/.test(mesh.name)) return;
      let parent = mesh;
      while (parent && parent !== a.model) {
        if (roots.has(parent)) return;
        parent = parent.parent;
      }
      const p = mesh.geometry.parameters;
      if (p?.width && p?.depth)
        panels.push(shape(mesh.name, [p.width, p.height, p.depth], mesh.matrixWorld));
      else if (a.kind === 'pack' && mesh.name === 'foil-pack-body') {
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox,
          center = box.getCenter(new THREE.Vector3());
        panels.push(
          shape(
            mesh.name,
            box.getSize(new THREE.Vector3()).toArray(),
            mesh.matrixWorld
              .clone()
              .multiply(new THREE.Matrix4().makeTranslation(...center.toArray())),
          ),
        );
      }
    });
    if (a.kind === 'extract')
      this.containers.forEach((c) => {
        c.model.updateMatrixWorld(true);
        c.model.traverse((m) => {
          const p = m.geometry?.parameters;
          if (m.isMesh && m.visible && p?.width && !m.name.includes('tape'))
            panels.push(shape(m.name, [p.width, p.height, p.depth], m.matrixWorld));
        });
      });
    const contents =
      a.kind === 'extract'
        ? [shape('extract-box', SIZES.box, a.model.matrixWorld)]
        : a.contents
            .filter(Boolean)
            .map((c) =>
              shape(c.name, a.kind === 'pack' ? CARD_SIZE : SIZES[c.userData.kind], c.matrixWorld),
            );
    return {
      kind: a.kind,
      time: a.time,
      phase: a.phase,
      detached: !!a.presenting,
      panels,
      contents,
    };
  }
  disposeUnique(group) {
    const materials = new Set();
    group.traverse((o) => {
      if (o.userData.releaseFinish) {
        o.userData.releaseFinish();
        delete o.userData.releaseFinish;
      }
      // Shared maps/geometry belong to the library; opening coatings and card effects are owned here.
      if (o.material?.isShaderMaterial) {
        o.material.dispose();
        o.geometry?.dispose();
      }
      for (const mat of Array.isArray(o.material) ? o.material : [o.material])
        if (mat?.userData.uniquePackageSurface && !materials.has(mat)) {
          materials.add(mat);
          mat.dispose();
        }
      if (o.userData.uniqueGeometry) o.geometry?.dispose();
      if (o.name === 'card-board') {
        const mats = Array.isArray(o.material) ? o.material : [];
        mats[0]?.dispose();
      }
      if (o.name === 'rarity-label') o.geometry.dispose();
    });
  }
  dispose() {
    clearTimeout(this.viewSaveTimer);
    clearTimeout(this.organizeFeedbackTimer);
    if (this.disposed) return;
    this.inspector?.dispose();
    this.closeMenu();
    this.cancelPointer();
    for (const a of [...this.animations]) if (a.kind === 'extract') this.cancelExtraction(a);
    this.persist();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.selectionBar?.remove();
    this.help?.remove();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('dblclick', this.onDouble);
    this.canvas.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('lostpointercapture', this.onCaptureLost);
    this.batches.forEach((b) => b.dispose());
    this.cards.forEach((c) => this.disposeUnique(c.mesh));
    for (const a of this.animations) {
      if (a.model) this.disposeUnique(a.model);
      if (a.bundle) this.disposeUnique(a.bundle);
    }
    this.containers.forEach((c) => this.disposeUnique(c.model));
    this.warmPackages?.forEach((model) => this.disposeUnique(model));
    this.tableStacks.forEach((s) => {
      if (s.visual) this.disposeUnique(s.visual);
    });
    const geometries = new Set(),
      materials = new Set();
    this.resources.forEach((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    this.effects.forEach((e) => {
      geometries.add(e.mesh.geometry);
      materials.add(e.mesh.material);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.library?.dispose();
    this.desk?.dispose();
    this.cardPad.dispose();
    this.damageRenderer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    delete this.canvas.world3D;
  }
}
