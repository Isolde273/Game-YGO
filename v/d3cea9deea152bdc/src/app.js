import { getCardView } from './game/card-data.js';
import { scheduleResourceTask } from './scene/resource-scheduler.js';
import { retireLegacyPlaceholders } from './game/card-inventory.js';
import { WORK_REWARD, performWork, workCooldown } from './game/work.js';
import { saleUnitPrice, sellWarehouse } from './game/sales.js';
import { multiplyMoney } from './game/money.js';
import { marketCardGroups, availableCardQuantity } from './game/card-market.js';
import { MARKET_PAGE_SIZE } from './ui/pages/shop.js';
import { loanBalanceAttributes } from './ui/pages/shared.js';
import { createLoanTooltip } from './ui/loan-tooltip.js';
import { filteredSaleEntries, saleSelectionSummary } from './ui/pages/warehouse-sales.js';
import { readStoredState, writeStoredState } from './game/save-storage.js';
import { icon } from './ui/icons.js';
import { createArchiveScreens } from './ui/screens.js';
import { createAlbumInteractions } from './ui/album-interactions.js';
import { createSounds } from './ui/sounds.js';
import { createCardFinishes } from './ui/card-finishes.js';
import { copyFinishCanvases } from './ui/card-surfaces.js';
import { createPageTransitions, createLocalTransitions } from './ui/motion/page-transitions.js';
import { createRoomPortals } from './ui/motion/room-portals.js';
import { createPurchaseOverlay } from './ui/motion/purchase-overlay.js';
import {
  PRODUCTS,
  bonusForOrder,
  freshState,
  validateState,
  cardCount,
  openItem,
  purchase,
  transferWarehouseToTray,
  warehouseCount,
} from './game/model.js';

const $ = (s) => document.querySelector(s);
const asset = (name) => `./public/assets/${name}`;
const num = (n) => Number(n).toLocaleString('zh-CN');
let state;
try {
  state = readStoredState(localStorage);
} catch {
  state = freshState();
  setTimeout(() => toast('原存档无法读取，已初始化新进度。可在设置中导入备份。'), 1000);
}
let page = 'home',
  phoneApp = '',
  albumPage = Math.floor((state.binder.page - 1) / 2),
  inventoryFilter = 'all',
  search = '',
  order = 'rarity';
let inventoryRarity = 'PSER';
let warehouseMode = 'stock';
const saleFilters = { kind: 'all', rarity: 'all', cardType: 'all', search: '' };
const marketFilters = {
  search: '',
  rarity: 'all',
  cardType: 'all',
  order: 'code',
  page: 0,
  selectedPrints: Object.create(null),
};
const saleSelection = new Set(),
  saleQuantities = new Map();
let settingsSection = '';
let albumTurning = false;
let space3D = null;
let worldModule;
let worldLoading = null;
const loadWorld = () =>
  (worldModule ??= import('./scene/world3d.js').catch((error) => {
    worldModule = null;
    throw error;
  }));
let shopReturnPage = null;
let pageReturnPage = 'home';
let albumControls;
let cleanup = () => {},
  modalCleanup = () => {},
  saveWarning = false,
  toastTimer,
  busy = false;
const archiveScreens = createArchiveScreens({ icon, asset });
const cardFinishes = createCardFinishes(document.body, () => state.settings);
const sounds = createSounds(() => state.settings);
const loanTooltip = createLoanTooltip({
  getState: () => state,
  enabled: () => page !== 'shop' && !$('#app').inert,
});

function save() {
  loanTooltip.refresh();
  try {
    writeStoredState(localStorage, state);
    saveWarning = false;
  } catch {
    if (!saveWarning) toast('自动保存失败，请在设置中导出进度备份');
    saveWarning = true;
  }
}
function toast(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3300);
}
function applySettings() {
  sounds.sync();
  cardFinishes.refresh();
  document.body.classList.toggle('reduced-motion', !state.settings.motion);
  document.documentElement.style.setProperty('--scene-brightness', state.settings.brightness / 100);
}
function sound(type = 'click') {
  sounds.play(type);
}
function header() {
  return `<header class="topbar"><button class="brand" data-action="home" aria-label="返回主界面"><span class="brand-emblem">${icon('card')}</span><span><b>游戏王</b><small>开盒模拟器</small></span></button><div class="resources"><div class="currency" aria-label="资金" ${loanBalanceAttributes(state)}>${icon('coin')}<span><b id="coins">${num(state.coins)}</b></span></div></div></header>`;
}
const pageNames = {
  home: '主界面',
  open: '开盒',
  album: '收藏',
  warehouse: '仓库',
  shop: '购买',
  settings: '设置',
};
function footer() {
  return `<footer class="footer"><span><span class="online-dot"></span> ${saveWarning ? '保存失败，请导出存档' : '已自动保存'}</span></footer>`;
}
const localTransitions = createLocalTransitions({ motion: () => state.settings.motion });
const purchaseOverlay = createPurchaseOverlay({
  app: $('#app'),
  motion: () => state.settings.motion,
  onDismiss: () => {
    sound('back');
    void render(shopReturnPage ?? 'home');
  },
  onStart: () => space3D?.setNavigationPaused(true),
  onFinish: () => {
    space3D?.syncPurchasedItems();
    space3D?.setNavigationPaused(false);
    if ($('#coins')) $('#coins').textContent = num(state.coins);
  },
});
const roomPortals = createRoomPortals({
  app: $('#app'),
  motion: () => state.settings.motion,
  onStart: () => space3D?.setNavigationPaused(true),
  onFinish: () => space3D?.setNavigationPaused(false),
});
const pageTransitions = createPageTransitions({
  app: $('#app'),
  layer: $('#page-transition'),
  getPage: () => page,
  motion: () => state.settings.motion,
  commit: (next, prepared) => renderPage(next, prepared),
  prepareSettings: () => settings(),
  prepareHome: () => header() + home(),
  ready: waitForPage,
  onStart: () => {
    localTransitions.finish();
    space3D?.setNavigationPaused(true);
  },
  onFinish: () => space3D?.setNavigationPaused(false),
  onError: () => toast('界面未能准备完成，请重试。'),
});
async function waitForPage(next) {
  const started = performance.now();
  const timeout = document.documentElement.dataset.webRelease ? 120000 : 8000;
  while (next === 'open') {
    const canvas = $('#world canvas');
    if ((!canvas && !worldLoading) || canvas?.dataset.error)
      throw new Error('3D initialization failed');
    if (!canvas) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (performance.now() - started > timeout) throw new Error('3D initialization timed out');
      continue;
    }
    if (canvas.dataset.ready === 'true' && canvas.dataset.presented === 'true') break;
    if (performance.now() - started > timeout) throw new Error('3D initialization timed out');
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (next === 'open') {
    space3D?.setNavigationPaused(true);
  }
  if (next === 'album') await cardFinishes.prepare($('#app'));
}
async function render(next = page, source = null) {
  loanTooltip.hide();
  if (purchaseOverlay.busy) return false;
  if (next === 'shop') {
    if (page !== 'shop') {
      shopReturnPage = page;
      page = 'shop';
      phoneApp = '';
    }
    return purchaseOverlay.open(shop()).then((result) => {
      syncWorkUI();
      return result;
    });
  }
  if (page === 'shop') {
    await purchaseOverlay.close();
    page = shopReturnPage ?? 'home';
    shopReturnPage = null;
    if (next === page) {
      if (page !== 'open') renderPage(page);
      return true;
    }
  }
  if (roomPortals.busy) return Promise.resolve(false);
  if (next === 'home') pageReturnPage = 'home';
  else if (page === 'open' && next !== 'open') pageReturnPage = 'open';
  if (next === 'settings' && page !== 'settings') settingsSection = '';
  if (page === 'open' && ['album', 'warehouse'].includes(next) && space3D) {
    const origin = space3D.portalSource(next);
    return roomPortals.go(next, origin, (bridge) =>
      pageTransitions.go(next, bridge ?? { source: source ?? $('#world canvas') }),
    );
  }
  if (next !== page) return pageTransitions.go(next, { source });
  renderPage(next);
}
function renderPage(next = page, prepared = null) {
  loanTooltip.hide();
  const routeChanged = next !== page;
  cleanup();
  cleanup = () => {};
  page = next;
  document.body.dataset.page = page;
  document.body.classList.toggle(
    'archive-view',
    ['album', 'warehouse', 'shop', 'settings'].includes(page),
  );
  document.documentElement.classList.toggle(
    'archive-document',
    document.body.classList.contains('archive-view'),
  );
  if (prepared) $('#app').replaceChildren(prepared);
  else if (page === 'settings') $('#app').innerHTML = settings();
  else
    $('#app').innerHTML =
      page === 'open'
        ? opening()
        : header() +
          (page === 'home'
            ? home()
            : page === 'album'
              ? album()
              : page === 'warehouse'
                ? warehouse()
                : page === 'shop'
                  ? shop()
                  : settings()) +
          (page === 'home' ? '' : footer());
  applySettings();
  if (routeChanged) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  albumControls?.sync();
  if (page === 'open') initWorld();
}
function home() {
  const routes = [
    ['open', '01', '开盒', 'OPEN', 'box'],
    ['album', '02', '收藏册', 'COLLECTION', 'album'],
    ['warehouse', '03', '仓库', 'INVENTORY', 'warehouse'],
    ['shop', '04', '购买', 'SHOP', 'shop'],
    ['settings', '05', '设置', 'SETTINGS', 'settings'],
  ];
  const tile = ([key, no, label, en, symbol]) =>
    `<button class="menu-tile tile-${key}" data-action="${key}"><span class="tile-number">${no}</span><span class="tile-symbol">${icon(symbol)}</span><span class="tile-text"><strong>${label}</strong><small>${en}</small></span><span class="tile-arrow">${icon('arrow')}</span></button>`;
  return `<main class="home"><section class="home-navigation"><div class="home-title"><span>主菜单 / MENU</span><h1>游戏王<b>开盒模拟器</b></h1></div><nav class="home-menu" aria-label="主菜单">${routes.slice(0, -1).map(tile).join('')}<div class="home-menu-actions">${tile(routes.at(-1))}<button class="menu-tile tile-exit" data-action="quit" aria-label="退出游戏"><span class="tile-symbol">${icon('exit')}</span><span class="tile-text"><strong>退出</strong></span></button></div></nav><div class="home-save"><span class="online-dot"></span>${saveWarning ? '保存失败，请导出存档' : '进度已自动保存'}</div></section><section class="home-art" aria-hidden="true"><div class="hero-disc"></div><img class="hero-dragon" src="${asset('reload-dragon.svg')}" alt=""><div class="hero-ticks"></div></section></main>`;
}
function opening() {
  return `<main id="world" class="unboxing-space"><div class="unboxing-hud"><button class="space-return" data-action="home" aria-label="返回主界面">${icon('back')}<span>主界面<small>HOME</small></span></button><div class="space-tools"><button class="space-organize" data-action="organize-space" title="按类型整理桌面上的箱、盒、包和卡堆" disabled>${icon('organize')}<span>整理</span></button><div class="space-coins" aria-label="资金" ${loanBalanceAttributes(state)}>${icon('coin')}<span><b id="coins">${num(state.coins)}</b></span></div></div></div></main>`;
}
function initWorld() {
  const host = $('#world');
  let cancelled = false;
  cleanup = () => {
    cancelled = true;
  };
  const pending = loadWorld()
    .then(({ createWorld3D }) => {
      if (cancelled || !host.isConnected || page !== 'open') return;
      try {
        space3D = createWorld3D(host, {
          state,
          save,
          sound,
          toast,
          prepareFinishes: (host, options) =>
            cardFinishes.prepare(host, { ...options, incremental: true, sortingEntry: true }),
          completeFinishes: (host) => cardFinishes.complete(host),
          warmFinishes: (cards) => cardFinishes.warm(cards),
          navigate: (next) => {
            if (next === 'shop') phoneApp = '';
            render(next);
          },
          open: (id) => {
            const result = openItem(state, id);
            save();
            return result;
          },
        });
        const instance = space3D;
        cleanup = () => {
          instance.dispose();
          cardFinishes.warm([]);
          if (space3D === instance) space3D = null;
        };
      } catch (error) {
        console.error(error);
        toast('无法初始化 3D 空间，请检查显卡驱动后重新进入。');
      }
    })
    .catch((error) => {
      if (!cancelled && host.isConnected) {
        console.error(error);
        toast('开盒空间素材加载失败，请重新进入。');
      }
    })
    .finally(() => {
      if (worldLoading === pending) worldLoading = null;
    });
  worldLoading = pending;
}

function showOverlay(html, cls = '') {
  closeOverlay();
  const focused = document.activeElement;
  $('#overlay').innerHTML =
    `<div class="modal-backdrop"><section class="modal ${cls}" role="dialog" aria-modal="true" tabindex="-1">${html}</section></div>`;
  const dialog = $('.modal');
  dialog.focus();
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const els = [...dialog.querySelectorAll('button:not([disabled]),input,a,select')];
    if (!els.length) {
      e.preventDefault();
      return;
    }
    const first = els[0],
      last = els.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last || document.activeElement === dialog)
    ) {
      e.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', trap);
  modalCleanup = () => {
    dialog.removeEventListener('keydown', trap);
    if (focused?.isConnected) focused.focus();
  };
}
function closeOverlay() {
  modalCleanup();
  modalCleanup = () => {};
  $('#overlay').innerHTML = '';
  busy = false;
}
function closeBtn() {
  return `<button class="modal-close icon-button" data-action="close" aria-label="关闭">${icon('close')}</button>`;
}
function album() {
  return archiveScreens.album({ state, albumPage });
}
function warehouse() {
  return archiveScreens.warehouse({
    state,
    inventoryFilter,
    search,
    order,
    inventoryRarity,
    warehouseMode,
    saleFilters,
    saleSelection,
    saleQuantities,
  });
}
function saleQuantity(entry) {
  return saleQuantities.get(entry.key) ?? entry.quantity;
}
function updateSaleSummary() {
  const entries = filteredSaleEntries(state, saleFilters);
  const { valid, quantity, total } = saleSelectionSummary(entries, saleSelection, saleQuantities);
  $('[data-sale-summary]').textContent = valid
    ? `已选 ${num(quantity)} 件 · ${num(total)}`
    : '出售数量无效';
  $('[data-action="sale-batch"]').disabled = !valid || !quantity;
}
function executeSale(key) {
  const entries = filteredSaleEntries(state, saleFilters).filter((entry) =>
    key ? entry.key === key : saleSelection.has(entry.key),
  );
  try {
    const result = sellWarehouse(
      state,
      entries.map((entry) => ({ key: entry.key, quantity: saleQuantity(entry) })),
    );
    saleSelection.clear();
    saleQuantities.clear();
    save();
    render();
    toast(`已出售 ${num(result.quantity)} 件 · ＋${num(result.value)}`);
  } catch (error) {
    toast(error.message);
  }
}
function cardDetail(rarity, serial) {
  const r = getCardView(rarity);
  if (!r) return;
  showOverlay(closeBtn() + archiveScreens.cardDetail({ state, r, serial }), 'card-detail-modal');
}
function shop() {
  return archiveScreens.shop({ state, phoneApp, marketFilters });
}
function refreshMarket() {
  const host = $('#phone-content');
  if (!host || phoneApp !== 'jhs' || host.dataset.localTransition) return;
  host.innerHTML = archiveScreens.phoneContent({ state, phoneApp, marketFilters });
}

let workTimer;
function syncWorkUI() {
  clearTimeout(workTimer);
  const buttons = document.querySelectorAll('.phone [data-action="work"]');
  const remaining = workCooldown(state);
  const seconds = Math.ceil(remaining / 1000);
  for (const button of buttons) {
    button.disabled = seconds > 0;
    button.querySelector('[data-work-countdown]').textContent = seconds ? `${seconds}s` : '';
    button.setAttribute(
      'aria-label',
      seconds ? `打工，冷却${seconds}秒` : `打工，获得${WORK_REWARD}`,
    );
  }
  if (buttons.length && remaining) workTimer = setTimeout(syncWorkUI, Math.min(100, remaining));
}

let checkoutData;
function checkout(kind, rarity = 'N') {
  const p = kind === 'card' ? getCardView(rarity) : PRODUCTS[kind];
  if (!p) return;
  if (kind === 'card') {
    if (p.price === null) return toast('该卡暂无集换价');
    p.maxQuantity = availableCardQuantity(state, rarity);
    if (!p.maxQuantity) return toast('单卡库存不足');
    p.short = '张';
  }
  checkoutData = { kind, rarity, quantity: 1, p };
  showOverlay(closeBtn() + archiveScreens.checkout({ state, kind, p }), 'checkout-modal');
}
function changeQuantity(n) {
  if (!checkoutData) return;
  checkoutData.quantity = Math.max(
    1,
    Math.min(checkoutData.p.maxQuantity ?? 99, Math.trunc(Number(n) || 1)),
  );
  $('#checkout-quantity').value = checkoutData.quantity;
  try {
    $('#checkout-total').textContent = num(
      multiplyMoney(checkoutData.p.price, checkoutData.quantity),
    );
    $('[data-action="buy"]').disabled = false;
  } catch (error) {
    $('#checkout-total').textContent = '—';
    $('[data-action="buy"]').disabled = true;
  }
  $('#checkout-error').textContent = '';
  const bonus = $('#checkout-bonus');
  if (bonus)
    bonus.textContent = `本单赠 vol.2 ${bonusForOrder(checkoutData.kind, checkoutData.quantity)} 包（不跨订单累计）`;
}
function buy() {
  if (busy || !checkoutData) return;
  busy = true;
  try {
    const { kind, rarity, quantity, p } = checkoutData;
    const { bonusCount } = purchase(state, kind, quantity, rarity);
    save();
    document.querySelectorAll('#coins,[data-phone-coins]').forEach((el) => {
      el.textContent = num(state.coins);
    });
    sound('confirm');
    closeOverlay();
    render();
    showOverlay(
      `<div class="order-success">${icon('check')}<h2>订单已送达</h2><p>${quantity} ${kind === 'card' ? '张' : p.short} ${p.name}${bonusCount ? `<br>赠 vol.2 ${bonusCount} 包` : ''}<br>${kind === 'card' ? '已入仓库' : '已送达开盒桌面'}</p><button class="primary-button" data-action="${kind === 'card' ? 'success-warehouse' : 'success-open'}">${kind === 'card' ? '查看仓库' : '前往开盒'} ${icon('arrow')}</button><button class="text-button" data-action="close">继续购买</button></div>`,
      'success-modal',
    );
  } catch (e) {
    busy = false;
    $('#checkout-error').textContent = e.message;
  }
}
function setPhoneApp(next, source) {
  const host = $('#phone-content');
  if (!host || host.dataset.localTransition || next === phoneApp) return;
  const back = !next;
  phoneApp = next;
  $('.phone').classList.toggle('app-open', !!next);
  void localTransitions
    .swap(host, archiveScreens.phoneContent({ state, phoneApp, marketFilters }), {
      source,
      back,
    })
    .then(syncWorkUI);
}
async function turnAlbum(next, source) {
  if (albumTurning || document.querySelector('.book-turn-layer')) return;
  const target = Math.max(0, Math.min(49, next));
  if (target === albumPage) return;
  albumTurning = true;
  sound('card');
  const prepared = document.createElement('div');
  try {
    const rect = $('#app').getBoundingClientRect();
    Object.assign(prepared.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      minHeight: `${rect.height}px`,
      visibility: 'hidden',
      pointerEvents: 'none',
    });
    prepared.inert = true;
    prepared.setAttribute('aria-hidden', 'true');
    prepared.innerHTML = header() + archiveScreens.album({ state, albumPage: target }) + footer();
    document.body.append(prepared);
    await cardFinishes.prepare(prepared);
    if (page !== 'album') return;
    const book = $('#app .album-book');
    const outgoing = book && copyFinishCanvases(book, book.cloneNode(true));
    outgoing?.querySelectorAll('.book-outgoing').forEach((element) => element.remove());
    const back = target < albumPage;
    albumPage = target;
    state.binder.page = target * 2 + 1;
    save();
    const fragment = document.createDocumentFragment();
    fragment.append(...prepared.childNodes);
    renderPage(page, fragment);
    const turning = !albumControls?.dragging
      ? localTransitions.book($('.album-book'), back, { outgoing })
      : Promise.resolve();
    const replacement =
      source?.dataset.action === 'album-page'
        ? document.querySelector(`[data-action="album-page"][data-index="${target}"]`)
        : document.querySelector(
            `[data-action="${back ? 'album-prev' : 'album-next'}"]:not([disabled])`,
          ) || document.querySelector(`[data-action="${back ? 'album-next' : 'album-prev'}"]`);
    replacement?.focus({ preventScroll: true });
    await turning;
  } finally {
    prepared.remove();
    albumTurning = false;
  }
}
function settings(section = settingsSection) {
  return archiveScreens.settings({ state, saveWarning, settingsSection: section });
}
function exportSave() {
  cleanup();
  cleanup = () => {};
  if (page === 'open') initWorld();
  save();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = `游戏王开盒存档-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('存档已导出');
}
function resetDialog() {
  showOverlay(
    `${closeBtn()}<div class="modal-kicker">RESET ARCHIVE</div><h2>重置进度？</h2><p class="reset-copy">当前卡牌、物品与资金会被替换为初始状态。<br>建议先导出存档，方便日后恢复。</p><div class="reset-actions"><button class="outline-button" data-action="export">先导出存档</button><button class="primary-button" data-action="confirm-reset">确认重置</button></div>`,
    'reset-modal',
  );
}

document.addEventListener('click', (e) => {
  if (
    pageTransitions.busy ||
    roomPortals.busy ||
    purchaseOverlay.busy ||
    localTransitions.settingsBusy
  )
    return;
  const button = e.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const a = button.dataset.action;
  if (!['buy', 'album-prev', 'album-next', 'album-page'].includes(a)) {
    const cardAction = [
      'warehouse-preview',
      'card-detail',
      'favorite',
      'warehouse-transfer',
      'sale-one',
      'sale-batch',
    ].includes(a);
    const backAction =
      ['home', 'close', 'phone-close', 'phone-home', 'quit'].includes(a) ||
      (a === 'navigate' && button.dataset.page === pageReturnPage);
    const tabAction = [
      'warehouse-mode',
      'inventory-filter',
      'phone-app',
      'settings-section',
    ].includes(a);
    const navigationAction =
      a in pageNames || a === 'navigate' || a === 'success-open' || a === 'success-warehouse';
    sound(
      cardAction
        ? 'card'
        : backAction
          ? 'back'
          : tabAction
            ? 'tab'
            : navigationAction
              ? 'navigate'
              : 'click',
    );
  }
  if (pageNames[a]) {
    closeOverlay();
    if (a === 'shop') phoneApp = '';
    render(a, button);
    return;
  }
  switch (a) {
    case 'market-prev':
    case 'market-next': {
      const last = Math.max(
        0,
        Math.ceil(marketCardGroups(marketFilters).length / MARKET_PAGE_SIZE) - 1,
      );
      marketFilters.page = Math.max(
        0,
        Math.min(last, marketFilters.page + (a === 'market-next' ? 1 : -1)),
      );
      refreshMarket();
      break;
    }
    case 'work':
      try {
        performWork(state);
        save();
        document.querySelectorAll('#coins,[data-phone-coins]').forEach((el) => {
          el.textContent = num(state.coins);
        });
        syncWorkUI();
      } catch (error) {
        toast(error.message);
      }
      break;
    case 'warehouse-mode':
      warehouseMode = button.dataset.mode;
      saleSelection.clear();
      saleQuantities.clear();
      render();
      break;
    case 'sale-select-all':
      filteredSaleEntries(state, saleFilters).forEach((entry) => {
        if (saleUnitPrice(entry) === null) return;
        saleSelection.add(entry.key);
        saleQuantities.set(entry.key, entry.quantity);
      });
      render();
      break;
    case 'sale-clear':
      saleSelection.clear();
      render();
      break;
    case 'sale-max': {
      const entry = filteredSaleEntries(state, saleFilters).find(
        (entry) => entry.key === button.dataset.key,
      );
      if (entry) saleQuantities.set(entry.key, entry.quantity);
      render();
      break;
    }
    case 'sale-one':
      executeSale(button.dataset.key);
      break;
    case 'sale-batch':
      executeSale();
      break;
    case 'quit':
      save();
      if (window.desktop?.quit) void window.desktop.quit();
      else {
        window.close();
        toast('请关闭浏览器页面以退出游戏');
      }
      break;
    case 'warehouse-preview':
      inventoryRarity = button.dataset.rarity;
      render();
      break;
    case 'phone-close':
      void render(shopReturnPage ?? 'home', button);
      break;
    case 'organize-space':
      space3D?.organize();
      break;
    case 'navigate':
      closeOverlay();
      render(button.dataset.page, button);
      break;
    case 'close':
      closeOverlay();
      break;
    case 'card-detail':
      cardDetail(button.dataset.rarity, Number(button.dataset.serial) || undefined);
      break;
    case 'favorite': {
      const r = button.dataset.rarity;
      state.favorites = state.favorites.includes(r)
        ? state.favorites.filter((k) => k !== r)
        : [...state.favorites, r];
      save();
      closeOverlay();
      render();
      cardDetail(r);
      break;
    }
    case 'inventory-filter':
      inventoryFilter = button.dataset.filter;
      render();
      void localTransitions.list($('.shelves'));
      break;
    case 'album-page':
      turnAlbum(Number(button.dataset.index) || 0, button);
      break;
    case 'warehouse-transfer': {
      const rarity = button.dataset.rarity;
      const input = document.querySelector(`[data-transfer-quantity="${rarity}"]`);
      try {
        const quantity = button.dataset.all ? warehouseCount(state, rarity) : Number(input.value);
        transferWarehouseToTray(state, rarity, quantity);
        save();
        render();
        toast(`${num(quantity)} 张 ${rarity} 已送到收藏暂存区`);
        document.querySelector('.stock-collection-link')?.focus({ preventScroll: true });
      } catch (error) {
        toast(error.message);
        input?.focus();
      }
      break;
    }
    case 'clear-search':
      search = '';
      render();
      break;
    case 'settings-section': {
      const next = button.dataset.section;
      if (next === settingsSection || localTransitions.settingsBusy) break;
      void localTransitions.settingsSection(
        $('.settings-persona'),
        button,
        settings(next),
        (prepared) => {
          settingsSection = next;
          renderPage('settings', prepared);
        },
      );
      break;
    }
    case 'album-prev':
      turnAlbum(albumPage - 1, button);
      break;
    case 'album-next':
      turnAlbum(albumPage + 1, button);
      break;
    case 'future-slot':
      toast('预留卡位，后续可收录更多卡牌。');
      break;
    case 'phone-app':
      setPhoneApp(button.dataset.app, button);
      break;
    case 'phone-home':
      setPhoneApp('', button);
      break;
    case 'checkout':
      checkout(button.dataset.kind, button.dataset.rarity);
      break;
    case 'qty-minus':
      changeQuantity(checkoutData.quantity - 1);
      break;
    case 'qty-plus':
      changeQuantity(checkoutData.quantity + 1);
      break;
    case 'buy':
      buy();
      break;
    case 'success-open':
      closeOverlay();
      render('open', button);
      break;
    case 'success-warehouse':
      closeOverlay();
      render('warehouse', button);
      break;
    case 'setting-toggle':
      state.settings[button.dataset.setting] = !state.settings[button.dataset.setting];
      save();
      render();
      break;
    case 'fullscreen': {
      if (window.desktop) window.desktop.toggleFullscreen();
      else if (document.fullscreenElement)
        document.exitFullscreen?.().catch(() => toast('全屏切换失败'));
      else document.documentElement.requestFullscreen?.().catch(() => toast('请使用 F11 切换全屏'));
      break;
    }
    case 'export':
      exportSave();
      break;
    case 'import':
      $('#import-file').click();
      break;
    case 'reset':
      resetDialog();
      break;
    case 'confirm-reset':
      cleanup();
      cleanup = () => {};
      state = freshState();
      albumPage = 0;
      save();
      closeOverlay();
      render('home');
      toast('已恢复初始进度');
      break;
  }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'market-search') {
    marketFilters.search = el.value;
    marketFilters.page = 0;
    const cursor = el.selectionStart;
    refreshMarket();
    $('#market-search').focus();
    $('#market-search').setSelectionRange(cursor, cursor);
  }
  if (el.id === 'sale-search') {
    saleFilters.search = el.value;
    saleSelection.clear();
    saleQuantities.clear();
    const cursor = el.selectionStart;
    render();
    $('#sale-search').focus();
    $('#sale-search').setSelectionRange(cursor, cursor);
  }
  if (el.dataset.saleQuantity) {
    const entry = filteredSaleEntries(state, saleFilters).find(
      (entry) => entry.key === el.dataset.saleQuantity,
    );
    if (!entry) return;
    const amount = Number(el.value);
    const valid = Number.isSafeInteger(amount) && amount >= 1 && amount <= entry.quantity;
    el.setCustomValidity(valid ? '' : `数量应为 1 至 ${entry.quantity} 的整数`);
    // Keep invalid input visible; transaction validation rejects it without deducting inventory.
    saleQuantities.set(entry.key, amount);
    const value = el.closest('.sale-row').querySelector('[data-sale-value]');
    try {
      value.textContent = !valid
        ? '数量无效'
        : saleUnitPrice(entry) === null
          ? '—'
          : num(multiplyMoney(saleUnitPrice(entry), amount));
    } catch {
      value.textContent = '金额超出上限';
    }
    updateSaleSummary();
  }
  if (el.matches('input[type="range"][data-setting]')) {
    state.settings[el.dataset.setting] = Number(el.value);
    el.nextElementSibling.textContent = el.value + '%';
    applySettings();
    save();
  }
  if (el.id === 'checkout-quantity') changeQuantity(el.value);
  if (el.id === 'warehouse-search') {
    search = el.value;
    const cursor = el.selectionStart;
    render();
    $('#warehouse-search').focus();
    $('#warehouse-search').setSelectionRange(cursor, cursor);
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('.market-print-select')) {
    const name = el.dataset.marketName;
    const group = marketCardGroups(marketFilters).find((card) => card.name === name);
    if (!group?.prints.some((print) => print.id === el.value)) return;
    marketFilters.selectedPrints[name] = el.value;
    const index = marketCardGroups(marketFilters).findIndex((card) => card.name === name);
    marketFilters.page = Math.floor(index / MARKET_PAGE_SIZE);
    refreshMarket();
    document.querySelector(`.market-print-select[data-market-name="${CSS.escape(name)}"]`)?.focus();
  }
  const marketField = {
    'market-rarity': 'rarity',
    'market-card-type': 'cardType',
    'market-order': 'order',
  }[el.id];
  if (marketField) {
    marketFilters[marketField] = el.value;
    marketFilters.page = 0;
    refreshMarket();
  }
  const saleFilterField = {
    'sale-kind': 'kind',
    'sale-rarity': 'rarity',
    'sale-card-type': 'cardType',
  }[el.id];
  if (saleFilterField) {
    saleFilters[saleFilterField] = el.value;
    saleSelection.clear();
    saleQuantities.clear();
    render();
  }
  if (el.dataset.saleSelect) {
    if (el.checked) saleSelection.add(el.dataset.saleSelect);
    else saleSelection.delete(el.dataset.saleSelect);
    updateSaleSummary();
  }
  if (el.id === 'inventory-order') {
    order = el.value;
    render();
    void localTransitions.list($('.shelves'));
  }
  if (el.id === 'import-file' && el.files[0]) {
    try {
      if (el.files[0].size > 5e6) throw new Error('存档文件过大');
      const imported = retireLegacyPlaceholders(
        validateState(JSON.parse(await el.files[0].text())),
      );
      showOverlay(
        `${closeBtn()}<div class="modal-kicker">RESTORE ARCHIVE</div><h2>恢复这份存档？</h2><p class="reset-copy">${num(cardCount(imported))} 张卡牌 · ${imported.items.length} 件物品<br>${num(imported.coins)}<br><br>会替换当前进度。建议先导出当前存档。</p><div class="reset-actions"><button class="outline-button" data-action="export">先导出当前存档</button><button class="primary-button" id="confirm-import">确认恢复</button></div>`,
        'reset-modal',
      );
      $('#confirm-import').addEventListener(
        'click',
        () => {
          cleanup();
          cleanup = () => {};
          state = imported;
          albumPage = Math.floor((state.binder.page - 1) / 2);
          save();
          closeOverlay();
          render('home');
          toast('存档恢复成功');
        },
        { once: true },
      );
    } catch (error) {
      toast(`导入失败：${error.message}`);
    }
    el.value = '';
  }
});
document.addEventListener('keydown', (e) => {
  if (purchaseOverlay.busy) {
    if (e.key === 'Escape') {
      e.preventDefault();
      purchaseOverlay.finish();
    }
    return;
  }
  if (roomPortals.busy) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (roomPortals.phase === 'entering') roomPortals.finish();
    }
    return;
  }
  if (localTransitions.settingsBusy) {
    if (e.key === 'Escape') {
      e.preventDefault();
      localTransitions.finish();
    }
    return;
  }
  if (pageTransitions.busy) {
    if (e.key === 'Escape') e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (page === 'open' && space3D?.escape()) return;
    sound('back');
    if ($('#overlay').children.length) {
      closeOverlay();
    } else if (page === 'shop' && phoneApp) {
      setPhoneApp('', document.querySelector('.phone-home-button'));
    } else if (page === 'shop') {
      void render(shopReturnPage ?? 'home');
    } else if (page === 'settings' && settingsSection) {
      void localTransitions.settingsSection(
        $('.settings-persona'),
        $('.settings-card-display'),
        settings(''),
        (prepared) => {
          settingsSection = '';
          renderPage('settings', prepared);
        },
      );
    } else if (page !== 'home') render(page === 'open' ? 'home' : pageReturnPage);
  }
  if (e.key === 'F11' && window.desktop) {
    e.preventDefault();
    window.desktop.toggleFullscreen();
  }
});
window.addEventListener('beforeunload', () => {
  sounds.dispose();
  cardFinishes.dispose();
  albumControls?.dispose();
  roomPortals.dispose();
  cleanup();
  save();
});
$('.embers').innerHTML = Array.from(
  { length: 18 },
  (_, i) =>
    `<i style="--x:${(i * 37) % 100}%;--duration:${8 + (i % 7)}s;--delay:${-i * 0.9}s;--size:${2 + (i % 3)}px"></i>`,
).join('');
save();
albumControls = createAlbumInteractions({
  host: $('#app'),
  getState: () => state,
  getPage: () => page,
  refresh: () => render(),
  turn: (delta) => turnAlbum(albumPage + delta),
  jump: (number) => turnAlbum(Math.floor((number - 1) / 2)),
  save,
  toast,
  sound,
});
render('home');
void pageTransitions.intro();
// Prepare the CPU scene template during a quiet menu visit. No room or card
// GPU resources are created until the player actually enters the space.
setTimeout(() => {
  void scheduleResourceTask(() => loadWorld(), {
    priority: 0,
    valid: () => page === 'home' && !worldModule,
  }).catch(() => {});
}, 800);
