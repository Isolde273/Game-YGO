import { CARD_RARITIES, getCardView } from '../../game/card-data.js';
import { PRODUCTS } from '../../game/model.js';
import { saleUnitPrice, warehouseSaleEntries } from '../../game/sales.js';
import { multiplyMoney, sumMoney } from '../../game/money.js';
import { num, esc } from './shared.js';

export const warehouseModes = (mode) =>
  `<nav class="warehouse-modes" aria-label="仓库区域">${[
    ['stock', '库存'],
    ['sales', '出售区'],
  ]
    .map(
      ([key, label]) =>
        `<button data-action="warehouse-mode" data-mode="${key}" aria-pressed="${mode === key}">${label}</button>`,
    )
    .join('')}</nav>`;

export function filteredSaleEntries(state, filters) {
  const query = filters.search.trim().toLowerCase();
  return warehouseSaleEntries(state).filter((entry) => {
    const card = entry.printId ? getCardView(entry.printId) : null;
    return (
      (filters.kind === 'all' || entry.kind === filters.kind) &&
      (filters.rarity === 'all' || card?.rarity === filters.rarity) &&
      (!filters.cardType ||
        filters.cardType === 'all' ||
        card?.card?.cardType === filters.cardType) &&
      (!query ||
        [
          card?.name,
          card?.nameJa,
          card?.code,
          card?.id,
          card?.card?.password,
          entry.serial ? String(entry.serial).padStart(3, '0') + '/100' : '',
          PRODUCTS[entry.productId ?? entry.kind]?.name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query))
    );
  });
}

export function saleSelectionSummary(entries, selection, quantities) {
  const selected = entries.filter((entry) => selection.has(entry.key));
  const amounts = selected.map((entry) => quantities.get(entry.key) ?? entry.quantity);
  const quantity = amounts.reduce((sum, amount) => sum + amount, 0);
  try {
    if (
      selected.some(
        (entry, i) =>
          !Number.isSafeInteger(amounts[i]) ||
          amounts[i] < 1 ||
          amounts[i] > entry.quantity ||
          saleUnitPrice(entry) === null,
      )
    )
      throw new Error('出售数量无效');
    return {
      valid: true,
      quantity,
      total: sumMoney(selected.map((entry, i) => multiplyMoney(saleUnitPrice(entry), amounts[i]))),
    };
  } catch {
    return { valid: false, quantity: 0, total: 0 };
  }
}

export function createWarehouseSalesPage({ icon, asset, screen }) {
  return ({ state, saleFilters, saleSelection, saleQuantities }) => {
    const entries = filteredSaleEntries(state, saleFilters);
    const quantityFor = (entry) => saleQuantities.get(entry.key) ?? entry.quantity;
    const { valid, quantity, total } = saleSelectionSummary(entries, saleSelection, saleQuantities);
    const rows = entries
      .map((entry) => {
        const card = entry.printId ? getCardView(entry.printId) : null;
        const product = PRODUCTS[entry.productId ?? entry.kind];
        const name = card?.name ?? product.name;
        const image = card?.image ?? asset(product.warehouseImage ?? product.image);
        const detail = card
          ? `${card.code} · ${card.label}${entry.serial ? ` · ${String(entry.serial).padStart(3, '0')}/100` : ''}`
          : product.short;
        const amount = quantityFor(entry);
        const unitPrice = saleUnitPrice(entry);
        let value = '—';
        try {
          if (!Number.isSafeInteger(amount) || amount < 1 || amount > entry.quantity)
            value = '数量无效';
          else if (unitPrice !== null) value = num(multiplyMoney(unitPrice, amount));
        } catch {
          value = '金额超出上限';
        }
        return `<article class="sale-row" data-sale-row="${esc(entry.key)}"><input type="checkbox" data-sale-select="${esc(entry.key)}" aria-label="选择 ${esc(name)} ${esc(detail)}" ${unitPrice === null ? 'disabled' : ''} ${saleSelection.has(entry.key) ? 'checked' : ''}><img src="${image}" alt="${esc(name)}" loading="lazy"><div class="sale-name"><b>${esc(name)}</b><small>${esc(detail)}</small><span>可售 ${num(entry.quantity)} · 单价 ${unitPrice === null ? '—' : num(unitPrice)}</span></div><label class="sale-quantity">数量<input type="number" min="1" max="${entry.quantity}" value="${amount}" data-sale-quantity="${esc(entry.key)}" aria-label="${esc(name)} 出售数量"></label><button data-action="sale-max" data-key="${esc(entry.key)}">全部数量</button><button class="sale-submit" data-action="sale-one" data-key="${esc(entry.key)}" ${unitPrice === null ? 'disabled' : ''}>出售 <strong data-sale-value>${value}</strong></button></article>`;
      })
      .join('');
    return screen(
      'warehouse',
      '03',
      '仓库',
      `<div class="warehouse-sales">${warehouseModes('sales')}<div class="sale-filters"><label>类型<select id="sale-kind">${[
        ['all', '全部'],
        ['case', '整箱'],
        ['box', '卡盒'],
        ['pack', '卡包'],
        ['bonus', '特别包'],
        ['cards', '单卡'],
      ]
        .map(
          ([key, label]) =>
            `<option value="${key}" ${saleFilters.kind === key ? 'selected' : ''}>${label}</option>`,
        )
        .join(
          '',
        )}</select></label><label>罕贵度<select id="sale-rarity">${[['all', '全部'], ...CARD_RARITIES.map((r) => [r.id, r.name])].map(([key, label]) => `<option value="${key}" ${saleFilters.rarity === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>卡牌类别<select id="sale-card-type">${[
        ['all', '全部'],
        ['monster', '怪兽卡'],
        ['spell', '魔法卡'],
        ['trap', '陷阱卡'],
      ]
        .map(
          ([key, label]) =>
            `<option value="${key}" ${saleFilters.cardType === key ? 'selected' : ''}>${label}</option>`,
        )
        .join(
          '',
        )}</select></label><label class="sale-search">${icon('search')}<input id="sale-search" value="${esc(saleFilters.search)}" placeholder="搜索名称 / 编号" aria-label="搜索出售物品"></label></div><div class="sale-batch"><button data-action="sale-select-all" ${entries.some((entry) => saleUnitPrice(entry) !== null) ? '' : 'disabled'}>全选筛选结果</button><button data-action="sale-clear">清空选择</button><span data-sale-summary>${valid ? `已选 ${num(quantity)} 件 · ${num(total)}` : '出售数量无效'}</span><button class="sale-submit" data-action="sale-batch" ${valid && quantity ? '' : 'disabled'}>批量出售</button></div><section class="sale-list" aria-label="可出售物品">${rows || '<p class="sale-empty">无可出售物品</p>'}</section></div>`,
    );
  };
}
