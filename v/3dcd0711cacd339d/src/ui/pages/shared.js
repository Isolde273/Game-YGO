import { loanLimit } from '../../game/wallet.js';

const num = (value) => Number(value).toLocaleString('zh-CN');
export const loanLimitLabel = (state) => `可贷款：${num(loanLimit(state))}`;
export const loanBalanceAttributes = () => 'data-loan-balance';
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const navigation = [
  ['open', '开盒', 'box'],
  ['album', '收藏册', 'album'],
  ['warehouse', '仓库', 'warehouse'],
  ['shop', '购买', 'shop'],
  ['settings', '设置', 'settings'],
];
const channels = [
  ['jhs', '集换店', '单卡交易', '集'],
  ['tao', '淘盒', '卡盒与卡包', '淘'],
  ['q', 'OO', '整箱订购', 'OO'],
];
export { num, esc, channels };
export function createPageShell({ icon }) {
  const rail = (page) =>
    `<aside class="workspace-rail"><button class="rail-home" data-action="home">${icon('back')}<span>主界面</span></button><nav class="mini-nav" aria-label="页面导航">${navigation.map(([key, label, symbol], i) => `<button data-action="navigate" data-page="${key}" class="${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span><small>0${i + 1}</small></button>`).join('')}</nav></aside>`;
  const labels = {
    album: 'COLLECTION',
    warehouse: 'INVENTORY',
    shop: 'SHOP',
    settings: 'SETTINGS',
  };
  const heading = (page, code, title, actions = '') =>
    `<header class="page-heading"><div><span class="heading-number">${code}</span><div class="heading-title"><span>${labels[page]}</span><h1>${title}</h1></div></div><div class="heading-actions">${actions}</div></header>`;
  const screen = (page, code, title, content, actions = '', showHeading = true) =>
    page === 'settings'
      ? `<main class="page settings-page" aria-label="${title}">${content}</main>`
      : `<main class="page ${page}-page interface-workspace" aria-label="${title}">${rail(page)}<section class="workspace-content">${showHeading ? heading(page, code, title, actions) : ''}${content}</section></main>`;
  const stat = (label, value, unit = '') =>
    `<div class="archive-stat"><span>${label}</span><div><b>${num(value)}</b><small>${unit}</small></div></div>`;
  const empty = (title, action, label) =>
    `<div class="empty-shelf">${icon('card')}<h2>${title}</h2><button class="outline-button" data-action="${action}">${label}${icon('arrow')}</button></div>`;
  return { screen, stat, empty };
}
