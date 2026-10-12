import { finishAttributes, serialLabel } from '../card-surfaces.js';
import {
  RARITIES,
  PRODUCTS,
  bonusForOrder,
  cardCount,
  collectionCount,
  warehouseCount,
  countKind,
} from '../../game/model.js';
import { num, esc, channels } from './shared.js';
export function createDialogs({ icon, asset, screen, stat, empty }) {
  function cardDetail({ state, r, serial }) {
    const collection = collectionCount(state, r.id),
      warehouse = warehouseCount(state, r.id),
      pending = (state.cards[r.id] ?? 0) - collection - warehouse;
    const numbered = state.numberedCards
      .filter((c) => c.printId === r.id)
      .sort((a, b) => a.serial - b.serial);
    const displayed = numbered.find((card) => card.serial === serial) ?? numbered[0];
    const serials = numbered.map((c) => `${String(c.serial).padStart(3, '0')}/100`).join(' · ');
    return `<div class="modal-kicker">卡牌档案 <span>${r.code}</span></div><div class="card-detail"><div class="detail-card rarity-${r.rarity}"><img ${finishAttributes(displayed ?? r.id)} src="${r.image}" alt="${esc(r.name)}">${displayed ? serialLabel(displayed.serial) : ''}<span class="foil"></span></div><div class="detail-copy"><span class="rarity-tag" style="--rarity:${r.color}">${r.label}</span><h2>${esc(r.name)}</h2><div class="card-stats"><span>ATK<b>${r.attack}</b></span><span>DEF<b>${r.defense}</b></span></div><div class="detail-quantity">持有数量<b>${num(state.cards[r.id] ?? 0)}</b></div>${serials ? `<p class="owned-gmr-numbers">GMR · ${serials}</p>` : ''}<div class="card-location-counts">${stat('收藏', collection)}${stat('仓库', warehouse)}${stat('待整理', pending)}</div><button class="primary-button" data-action="favorite" data-rarity="${r.id}" ${(state.cards[r.id] ?? 0) === 0 ? 'disabled' : ''}>${icon('star')}${state.favorites.includes(r.id) ? '移除标记' : '添加标记'}</button></div></div>`;
  }
  function checkout({ state, kind, p }) {
    return `<div class="modal-kicker">购买凭据 <span>${esc(p.code ?? 'LOCR')}</span></div><h2>确认订单</h2><div class="receipt-sheet"><div class="checkout-product"><img src="${kind === 'card' ? p.image : asset(p.image)}" alt="${esc(p.name)}"><div><small>${kind === 'card' ? p.label : '未拆封物品'}</small><b>${esc(p.name)}</b><strong>${num(p.price)}<small> / ${kind === 'card' ? '张' : p.short}</small></strong></div></div><div class="quantity-row"><span>购买数量</span><div><button data-action="qty-minus" aria-label="减少数量">−</button><input type="number" id="checkout-quantity" value="1" min="1" max="${p.maxQuantity ?? 99}" aria-label="购买数量"><button data-action="qty-plus" aria-label="增加数量">＋</button></div></div><div class="order-total"><span>合计<small>${icon('coin')} ${num(state.coins)}</small></span><strong id="checkout-total">${num(p.price)}</strong></div></div><p class="order-note">${icon('check')}${kind === 'card' ? '购买后收入仓库' : '购买后送达开盒桌面'}</p>${['box', 'case'].includes(kind) ? `<p id="checkout-bonus" class="order-note">本单赠 vol.2 ${bonusForOrder(kind, 1)} 包（不跨订单累计）</p>` : ''}<p id="checkout-error" class="inline-error" role="alert"></p><button class="primary-button" data-action="buy">确认购买${icon('arrow')}</button>`;
  }
  return { cardDetail, checkout };
}
