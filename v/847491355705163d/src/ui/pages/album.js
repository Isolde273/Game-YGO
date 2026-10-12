import { finishAttributes, serialLabel } from '../card-surfaces.js';
import { getCardView } from '../../game/card-data.js';
import {
  inventoryKeys,
  binderCount,
  trayCount,
  warehouseCount,
  ALBUM_PAGES,
} from '../../game/model.js';
import { num } from './shared.js';

export function createAlbumPage({ icon, asset, screen }) {
  return function album({ state, albumPage }) {
    const slots = state.binder.slots;
    const bound = binderCount(state),
      tray = trayCount(state);
    const pocket = (page, position) => {
      const slot = (page - 1) * 6 + position,
        card = slots[slot];
      const r = getCardView(card?.printId);
      return `<button class="album-slot ${card ? 'owned rarity-' + r.rarity : 'future-slot'}" data-slot="${slot}" ${card ? `data-album-source="slot" data-rarity="${r.id}"` : ''} aria-label="第 ${page} 页，第 ${position + 1} 格，${card ? r.name + ' ' + r.label : '空卡位'}，拖动卡牌放入或交换">
        <span class="pocket-window">${card ? `<img ${finishAttributes(card)} draggable="false" src="${r.image}" alt="${r.name}">${card.serial ? serialLabel(card.serial) : ''}<span class="foil"></span>` : `<span class="pocket-empty">${icon('plus')}<small>放入卡牌</small></span>`}</span><span class="pocket-number">${String(position + 1).padStart(2, '0')}</span></button>`;
    };
    const book = `<section class="binder-stage" aria-label="摊开的收藏册">
      <div class="binder-stage-heading"><h2>册页</h2></div>
      <div class="album-table"><div class="album-book">${['left', 'right']
        .map((side, index) => {
          const page = albumPage * 2 + index + 1;
          return `<section class="book-page ${side}-page" aria-label="第 ${page} 页"><header class="folio-heading"><span>第 ${page} 页</span><small>${Object.keys(slots).filter((key) => Math.floor(Number(key) / 6) === page - 1).length} / 6</small></header><div class="album-slots">${Array.from({ length: 6 }, (_, position) => pocket(page, position)).join('')}</div><footer class="folio-footer"><span>6 个卡位</span><b>${String(page).padStart(2, '0')}</b></footer></section>${index === 0 ? '<div class="book-spine" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}`;
        })
        .join('')}</div></div>
      <div class="binder-navigation"><button data-action="album-prev" data-album-turn="-1" ${albumPage === 0 ? 'disabled' : ''} aria-label="上一组册页">${icon('back')}<span>上一页</span></button><div><strong>${albumPage * 2 + 1} — ${albumPage * 2 + 2}</strong><small> / ${ALBUM_PAGES} 页</small></div><button data-action="album-next" data-album-turn="1" ${albumPage === 49 ? 'disabled' : ''} aria-label="下一组册页"><span>下一页</span>${icon('arrow')}</button></div>
    </section>`;
    const dock = `<aside class="collection-dock" aria-label="独立卡牌暂存区"><header><div><small>待放入册页</small><h2>暂存区</h2></div><b>${num(tray)}<small> 张</small></b></header><p>接收桌面、仓库转入及册中取出的卡牌。</p>
      <div class="collection-tray" data-album-drop="tray" aria-label="暂存区，拖入册中卡牌即可取出">${
        inventoryKeys(state)
          .filter((id) => trayCount(state, id) > 0)
          .map(getCardView)
          .map(
            (r) =>
              `<button class="tray-card rarity-${r.rarity}" data-album-source="tray" data-rarity="${r.id}" aria-label="拖动 ${r.name} ${r.label} 卡牌，暂存 ${num(trayCount(state, r.id))} 张"><span class="tray-thumbnail"><img ${finishAttributes(r.id)} draggable="false" src="${r.image}" alt="${r.name}"></span><span><b>${r.name}</b><small style="--rarity:${r.color}"><em>${r.label}</em></small></span><strong>×${num(trayCount(state, r.id))}</strong></button>`,
          )
          .join('') ||
        `<div class="tray-empty">${icon('card')}<b>暂无暂存卡牌</b><span>拖出册中卡牌放到这里</span><button data-action="warehouse">从仓库挑选 ${icon('arrow')}</button></div>`
      }</div>
      <div class="collection-warehouse" data-album-drop="warehouse" aria-label="仓库区，拖入卡牌即可入仓">${icon('warehouse')}<div><h3>仓库区 <small>${num(warehouseCount(state))} 张</small></h3><p>拖到这里即可入仓</p></div></div>
      <span class="collection-drag-status" id="album-drag-status" role="status" aria-live="polite">拖动卡牌到卡位、暂存区或仓库区</span>
    </aside>`;
    const index = `<details class="folio-index"><summary>册页索引 <span>按页跳转 · 1–100</span>${icon('arrow')}</summary><div class="folio-index-grid">${Array.from({ length: 100 }, (_, i) => `<button data-action="album-page" data-index="${Math.floor(i / 2)}" class="${Math.floor(i / 2) === albumPage ? 'active' : ''} ${Object.keys(slots).some((k) => Math.floor(Number(k) / 6) === i) ? 'has-cards' : ''}" aria-label="跳转到第 ${i + 1} 页" ${Math.floor(i / 2) === albumPage ? 'aria-current="page"' : ''}>${String(i + 1).padStart(2, '0')}</button>`).join('')}</div></details>`;
    return screen(
      'album',
      '02',
      '收藏册',
      `<div class="album-studio"><div class="collection-tools"><span><b>${num(bound)}</b> 张入册<i></i><b>${num(tray)}</b> 张暂存</span><details class="collection-help"><summary>操作说明</summary><p>拖动卡牌入册，占用卡位会交换；拖到翻页按钮可继续翻页。册中卡牌可拖回暂存区；卡牌拖到仓库区即可入仓。Esc 取消拖动。</p></details><form id="album-jump-form"><label for="album-jump">前往第</label><input id="album-jump" type="number" min="1" max="100" step="1" value="${albumPage * 2 + 1}" required aria-label="跳转页码"><span>页</span><button type="submit">跳转 ${icon('arrow')}</button></form></div><div class="collection-layout">${book}${dock}</div>${index}</div>`,
      `<button class="outline-button" data-action="warehouse">${icon('warehouse')}从仓库入册</button>`,
    );
  };
}
