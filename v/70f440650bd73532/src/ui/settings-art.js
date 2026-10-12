export const SETTINGS_OPTIONS = [
  ['settings-audio', '声音与画面', 'CONFIG'],
  ['settings-save', '存档', 'DATA SAVE'],
  ['home', '主界面', 'RETURN TO TITLE'],
];

export function settingsArc() {
  return `<span>SYSTEM</span><svg class="settings-system-word" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><path id="settings-system-arc" d="M 0 500 A 500 500 0 0 0 1000 500"/></defs><g class="settings-system-orbit"><text dominant-baseline="hanging" dy="-10"><textPath href="#settings-system-arc" startOffset="7.5%" textLength="860" lengthAdjust="spacingAndGlyphs">SYSTEM</textPath></text></g></svg>`;
}

export function settingsConfigArc() {
  return `<svg class="settings-config-word" viewBox="0 0 1000 1000" aria-hidden="true"><defs><path id="settings-config-arc" d="M 500 1000 A 500 500 0 0 0 500 0"/></defs><g class="settings-config-orbit"><text dominant-baseline="hanging" dy="10"><textPath href="#settings-config-arc" startOffset="35%" textLength="470" lengthAdjust="spacingAndGlyphs">SYSTEM</textPath></text></g></svg>`;
}

export function settingsCard(asset) {
  return `<div class="settings-feature-card" lang="ja"><div class="settings-card-name"><span>白き幻獣－青眼の白龍</span><b>光</b></div><div class="settings-card-stars">${'<i></i>'.repeat(8)}</div><div class="settings-card-monster"><img src="${asset('reload-dragon.svg')}" alt=""></div><div class="settings-card-text"><b class="settings-card-type">【ドラゴン族／効果】</b><p>このカード名の①②の効果はそれぞれ１ターンに１度しか使用できない。①：このカードがデッキから手札に加わった時、または自分のモンスターが戦闘で破壊された時、手札のこのカードを相手に見せて発動できる。このカードを特殊召喚する。②：このカードが手札・デッキから特殊召喚した場合に発動できる。相手フィールドのモンスターを全て破壊する。このターン、自分は「ブルーアイズ」モンスターでしか直接攻撃できない。③：フィールドのこのカードを対象とする効果が発動した時、手札を１枚捨てて発動できる。その効果を無効にする。</p><div class="settings-card-stats"><b>ATK/3000</b><b>DEF/2500</b></div></div><div class="settings-card-footer"><span>30397786</span><small>©スタジオ・ダイス／集英社・テレビ東京・KONAMI</small><i></i></div></div>`;
}

export function settingsMenu(section = '') {
  return `<nav class="settings-menu" aria-label="设置分组">${SETTINGS_OPTIONS.map(([id, label, en]) => `<button ${id === 'home' ? 'data-action="home"' : `data-action="settings-section" data-section="${id}"`} class="${section === id ? 'active' : ''}" aria-label="${label}" aria-current="${section === id ? 'page' : 'false'}"><span class="settings-menu-label">${id === 'home' ? 'RETURN<small>to</small>TITLE' : en}</span></button>`).join('')}</nav>`;
}
