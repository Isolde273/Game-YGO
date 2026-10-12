import { finishAttributes, serialLabel, warehouseNumberedCards } from '../card-surfaces.js';
import { CARD_RARITIES, getCardView } from '../../game/card-data.js';
import {
  inventoryKeys,
  PRODUCTS,
  warehouseCount,
  binderCount,
  trayCount,
  countProduct,
} from '../../game/model.js';
import { num, esc } from './shared.js';
import { createWarehouseSalesPage, warehouseModes } from './warehouse-sales.js';

export function createWarehousePage({ icon, asset, screen, empty }) {
  const sales = createWarehouseSalesPage({ icon, asset, screen });
  return function warehouse(options) {
    const {
      state,
      inventoryFilter,
      search,
      order,
      inventoryRarity,
      warehouseMode = 'stock',
    } = options;
    if (warehouseMode === 'sales') return sales(options);
    const groups = inventoryKeys(state).map(getCardView);
    const stored = Object.fromEntries(groups.map((r) => [r.id, warehouseCount(state, r.id)]));
    const numbered = warehouseNumberedCards(state);
    const serialAttribute = (printId) =>
      numbered.has(printId) ? `data-serial="${numbered.get(printId).serial}"` : '';
    const matches = (text) => !search || text.toLowerCase().includes(search.trim().toLowerCase());
    const rows = groups.filter(
      (r) =>
        stored[r.id] > 0 &&
        (['all', 'cards'].includes(inventoryFilter) ||
          inventoryFilter === r.rarity ||
          (inventoryFilter === 'favorites' && state.favorites.includes(r.id))) &&
        matches(
          [r.name, r.nameJa, r.code, r.id, r.style, String(r.card?.password ?? '')].join(' '),
        ),
    );
    rows.sort((a, b) =>
      order === 'count'
        ? stored[b.id] - stored[a.id]
        : order === 'name'
          ? a.name.localeCompare(b.name, 'zh-CN')
          : CARD_RARITIES.findIndex((r) => r.id === b.rarity) -
            CARD_RARITIES.findIndex((r) => r.id === a.rarity),
    );
    const products = ['all', 'sealed'].includes(inventoryFilter)
      ? Object.entries(PRODUCTS).filter(
          ([kind, p]) => countProduct(state, kind) > 0 && matches(p.name),
        )
      : [];
    const tabs = [
      ['all', '全部库存'],
      ['cards', '单卡'],
      ['sealed', '未拆封'],
      ['favorites', '已标记'],
    ];
    const selected = rows.find((r) => r.id === inventoryRarity) ?? rows[0];
    const menu = `<aside class="inventory-menu"><span class="inventory-menu-caption">库存分类</span><nav aria-label="库存分类">${tabs.map(([key, label], i) => `<button data-action="inventory-filter" data-filter="${key}" class="${inventoryFilter === key ? 'active' : ''}" aria-pressed="${inventoryFilter === key}"><small>0${i + 1}</small><b>${label}</b>${icon('arrow')}</button>`).join('')}</nav><div class="inventory-rarities"><span>罕贵度</span>${CARD_RARITIES.map((r) => `<button data-action="inventory-filter" data-filter="${r.id}" class="${inventoryFilter === r.id ? 'active' : ''}" aria-pressed="${inventoryFilter === r.id}"><b>${r.name}</b><span>${num(groups.filter((g) => g.rarity === r.id).reduce((n, g) => n + stored[g.id], 0))}</span></button>`).join('')}</div><button class="stock-collection-link" data-action="album">${icon('album')}<span>收藏册<small>${num(binderCount(state))} 张入册 · ${num(trayCount(state))} 张暂存</small></span>${icon('arrow')}</button></aside>`;
    const toolbar = `<header class="inventory-toolbar"><label>${icon('search')}<input id="warehouse-search" placeholder="搜索名称 / 编号" aria-label="搜索仓库" value="${esc(search)}">${search ? `<button data-action="clear-search" aria-label="清空搜索">${icon('close')}</button>` : ''}</label><select id="inventory-order" aria-label="仓库排序">${[
      ['rarity', '罕贵度优先'],
      ['count', '持有数量'],
      ['name', '版本顺序'],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${order === value ? 'selected' : ''}>${label}</option>`,
      )
      .join('')}</select></header>`;
    const sealed = products.length
      ? `<section class="inventory-sealed"><header><h2>未拆封</h2><span>${num(state.items.length)} 件</span></header><div>${products.map(([kind, p]) => `<button class="warehouse-product" data-action="open"><span class="inventory-product-art"><img src="${asset(p.warehouseImage ?? p.image)}" alt="${p.name}"></span><span><b>${p.name}</b><small>${num(countProduct(state, kind))} ${p.short}</small></span>${icon('arrow')}</button>`).join('')}</div></section>`
      : '';
    const cards = rows
      .map(
        (r, i) =>
          `<article class="warehouse-card rarity-${r.rarity} ${selected?.id === r.id ? 'is-previewed' : ''}" style="--rarity:${r.color}"><span class="inventory-row-number">${String(i + 1).padStart(2, '0')}</span><button class="inventory-card-select" data-action="warehouse-preview" data-rarity="${r.id}" aria-label="预览 ${r.id}"><img ${finishAttributes(numbered.get(r.id) ?? r.id)} src="${r.image}" alt="${esc(r.name)}"><span><small>${r.code} · ${r.label}</small><b>${esc(r.name)}</b><em>${r.legacy ? '旧版占位卡' : r.label}</em></span></button><strong class="inventory-row-count">${num(stored[r.id])}<small>张</small></strong><div class="warehouse-transfer-controls"><label><span>转入暂存</span><input type="number" min="1" max="${stored[r.id]}" value="1" data-transfer-quantity="${r.id}" aria-label="${r.id} 转入暂存数量"></label><button data-action="warehouse-transfer" data-rarity="${r.id}" aria-label="转入 ${r.id} 暂存">${icon('arrow')}</button><button data-action="warehouse-transfer" data-rarity="${r.id}" data-all="true">全部</button></div><button class="inventory-row-detail" data-action="card-detail" data-rarity="${r.id}" ${serialAttribute(r.id)} aria-label="${r.id} 详情">${icon('card')}</button></article>`,
      )
      .join('');
    const preview = selected
      ? `<aside class="inventory-preview"><div class="inventory-preview-art rarity-${selected.rarity}"><img ${finishAttributes(numbered.get(selected.id) ?? selected.id)} src="${selected.image}" alt="${esc(selected.name)}">${numbered.has(selected.id) ? serialLabel(numbered.get(selected.id).serial) : ''}<span class="foil"></span><span>${selected.label}</span></div><div class="inventory-preview-caption"><small>${selected.code}</small><h2>${esc(selected.name)}</h2><span>${selected.label} · ${num(stored[selected.id])} 张</span></div><button data-action="card-detail" data-rarity="${selected.id}" ${serialAttribute(selected.id)}>查看详情 ${icon('arrow')}</button></aside>`
      : `<aside class="inventory-preview inventory-preview-empty">${icon('warehouse')}<b>仓库</b><span>${num(state.items.length)} 件未拆封</span></aside>`;
    return screen(
      'warehouse',
      '03',
      '仓库',
      `<div class="inventory-studio">${warehouseModes('stock')}<div class="inventory-status"><span>仓库单卡 <b>${num(warehouseCount(state))}</b> 张</span><span>未拆封 <b>${num(state.items.length)}</b> 件</span><button data-action="shop">${icon('shop')}补充库存</button></div><div class="inventory-layout">${menu}<section class="inventory-browser">${toolbar}<div class="shelves">${sealed}${cards ? `<section class="inventory-cards"><header><h2>单卡</h2><span>${rows.length} 种版本</span></header>${cards}</section>` : ''}${!rows.length && !products.length ? empty(search ? '没有找到匹配物品' : '暂无库存', search ? 'clear-search' : 'shop', search ? '清空搜索' : '前往购买') : ''}</div></section>${preview}</div></div>`,
    );
  };
}
