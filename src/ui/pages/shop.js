import { PRODUCTS } from '../../game/model.js';
import { WORK_REWARD, workCooldown } from '../../game/work.js';
import { marketCards, availableCardQuantity } from '../../game/card-market.js';
import { CARD_RARITIES } from '../../game/card-data.js';
import { num, esc, channels } from './shared.js';
export const MARKET_PAGE_SIZE = 20;
export function createShopPages({ icon, asset, screen }) {
  const appHeader = (name, app, desc) =>
    `<div class="app-header ${app}-header"><button data-action="phone-home" aria-label="返回手机桌面">${icon('back')}</button><div><b>${name}</b><small>${desc}</small></div><span class="app-header-mark">${icon(app === 'jhs' ? 'card' : app === 'tao' ? 'box' : 'chat')}</span></div>`;
  function phoneContent({ state, phoneApp, marketFilters = {} }) {
    const cooldown = Math.ceil(workCooldown(state) / 1000);
    if (!phoneApp)
      return `<div class="phone-desktop"><div class="phone-wallpaper"><span>购买</span>${icon('shop')}</div><div class="phone-apps">${channels.map(([key, name, desc], i) => `<button data-action="phone-app" data-app="${key}"><span class="app-icon app-${key}">${icon(key === 'jhs' ? 'card' : key === 'tao' ? 'box' : 'chat')}</span><span class="phone-conversation"><b>${name}</b><small>${desc}</small></span><i>${icon('arrow')}</i><em>0${i + 1}</em></button>`).join('')}</div><div class="phone-dock"><span>${icon('coin')}<b data-phone-coins>${num(state.coins)}</b></span><button class="phone-work-button" data-action="work" ${cooldown ? 'disabled' : ''}><b>打工</b><span>+${WORK_REWARD}</span><small data-work-countdown>${cooldown ? cooldown + 's' : ''}</small></button></div><button class="phone-dismiss" data-action="phone-close">${icon('back')}收起手机</button></div>`;
    if (phoneApp === 'jhs') {
      const cards = marketCards(marketFilters);
      const pageCount = Math.max(1, Math.ceil(cards.length / MARKET_PAGE_SIZE));
      const page = Math.max(0, Math.min(pageCount - 1, marketFilters.page ?? 0));
      const select = (id, values, current, label) =>
        `<select id="${id}" aria-label="${label}">${values.map(([value, text]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${text}</option>`).join('')}</select>`;
      const filters = `<div class="jhs-market-filters"><input id="market-search" value="${esc(marketFilters.search ?? '')}" placeholder="搜索名称 / 卡号" aria-label="搜索单卡">${select('market-rarity', [['all', '罕贵度'], ...CARD_RARITIES.map((r) => [r.id, r.name])], marketFilters.rarity ?? 'all', '罕贵度')}${select(
        'market-card-type',
        [
          ['all', '卡牌类别'],
          ['monster', '怪兽卡'],
          ['spell', '魔法卡'],
          ['trap', '陷阱卡'],
        ],
        marketFilters.cardType ?? 'all',
        '卡牌类别',
      )}${select(
        'market-order',
        [
          ['code', '卡号排序'],
          ['price-asc', '价格从低到高'],
          ['price-desc', '价格从高到低'],
        ],
        marketFilters.order ?? 'code',
        '排序',
      )}</div>`;
      const products = cards
        .slice(page * MARKET_PAGE_SIZE, (page + 1) * MARKET_PAGE_SIZE)
        .map((card) => {
          const available = availableCardQuantity(state, card.id);
          return `<button class="jhs-product" data-action="checkout" data-kind="card" data-rarity="${card.id}" ${card.price === null || !available ? 'disabled' : ''}><span class="market-card-thumb"><img src="${card.image}" alt="${esc(card.name)}" decoding="async"></span><span class="market-product-copy"><span class="market-rarity">${card.label}<small>${card.code}</small></span><b>${esc(card.name)}</b><strong>${card.price === null ? '—' : num(card.price)}</strong>${!available ? '<small>售罄</small>' : ''}</span><span class="buy-round">${icon('arrow')}</span></button>`;
        })
        .join('');
      return `<div class="market-app jhs-app">${appHeader('集换店', 'jhs', '单卡交易')}<div class="market-section-title"><b>单卡交易</b><span data-market-count>${cards.length}</span></div>${filters}<div class="jhs-products">${products || '<div class="phone-empty">无匹配单卡</div>'}</div><nav class="market-pagination" aria-label="单卡分页"><button data-action="market-prev" ${page === 0 ? 'disabled' : ''}>${icon('back')}</button><span>${page + 1} / ${pageCount}</span><button data-action="market-next" ${page === pageCount - 1 ? 'disabled' : ''}>${icon('arrow')}</button></nav></div>`;
    }
    if (phoneApp === 'tao')
      return `<div class="market-app tao-app">${appHeader('淘盒', 'tao', '卡盒与卡包')}<div class="tao-banner"><div><small>LOCR</small><b>卡盒 · 卡包</b></div><img src="${asset('locr-box.png')}" alt=""></div><div class="tao-products">${[
        'box',
        'pack',
        'bonus',
      ]
        .map((kind) => {
          const p = PRODUCTS[kind];
          return `<button class="tao-product" data-action="checkout" data-kind="${kind}"><b>${p.name}</b><div class="tao-product-img"><img src="${asset(p.image)}" alt="${p.name}"><span>${p.short}</span></div><p>${p.count} ${kind === 'box' ? '包 / 盒' : '张 / 包'}</p><div class="product-price"><strong>${num(p.price)}</strong>${icon('arrow')}</div></button>`;
        })
        .join(
          '',
        )}</div><div class="tao-delivery">${icon('box')}单笔每 3 盒赠 vol.2 1 包，不跨订单累计</div></div>`;
    return `<div class="market-app q-app">${appHeader('OO', 'q', '整箱订购')}<div class="q-contact"><span class="q-avatar">${icon('box')}</span><div><b>卡牌商店</b><small>整箱批发</small></div></div><div class="q-chat"><div class="chat-message"><span class="chat-avatar">卡</span><div>LOCR 原封整箱<br>24 盒 / 箱 · 15 包 / 盒</div></div><div class="q-product-card"><div class="chat-product"><img src="${asset('case.png')}" alt="游戏王原封整箱"><div><small>LOCR</small><b>原封整箱</b><span>24 盒 / 箱</span><strong>${num(PRODUCTS.case.price)}</strong></div></div><button data-action="checkout" data-kind="case">订购整箱${icon('arrow')}</button></div><div class="chat-system-note">每箱赠 vol.2 8 包，下单后送达开盒桌面</div></div></div>`;
  }
  function shop({ state, phoneApp, marketFilters }) {
    const phone = `<div class="phone-wrap"><div class="phone-shadow"></div><div class="phone ${phoneApp ? 'app-open' : ''}"><div class="phone-hardware"><span></span><i></i></div><div class="phone-screen"><div class="phone-status"><b>${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</b><span class="phone-signal" aria-label="电量充足"><i></i><i></i><i></i><b></b></span></div><div id="phone-content">${phoneContent({ state, phoneApp, marketFilters })}</div><button class="phone-home-button" data-action="phone-home" aria-label="返回手机桌面"><span></span></button></div><span class="phone-side-button"></span></div></div>`;
    return `<section class="purchase-overlay" role="dialog" aria-modal="true" aria-label="购买"><main class="shop-page" aria-label="手机购买"><div class="shop-stage">${phone}</div></main></section>`;
  }
  return { shop, phoneContent };
}
