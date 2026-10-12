import {
  SETTINGS_OPTIONS,
  settingsCard,
  settingsMenu,
  settingsArc,
  settingsConfigArc,
} from '../settings-art.js';
export function createSettingsPage({ icon, asset, screen, stat, empty }) {
  function settings({ state, saveWarning, settingsSection = '' }) {
    const s = state.settings;
    const toggle = (key, label, desc = '') =>
      `<div class="setting-row"><div><b>${label}</b>${desc ? `<small>${desc}</small>` : ''}</div><button class="switch ${s[key] ? 'on' : ''}" data-action="setting-toggle" data-setting="${key}" role="switch" aria-checked="${s[key]}" aria-label="${label}"><i></i></button></div>`;
    const range = (key, label, min = 0) =>
      `<div class="setting-row range-row"><div><b>${label}</b></div><label class="range-control"><input type="range" min="${min}" max="100" value="${s[key]}" data-setting="${key}" aria-label="${label}"><span>${s[key]}%</span></label></div>`;
    const groups = SETTINGS_OPTIONS;
    const index = settingsMenu(settingsSection);
    const audio = `<div class="settings-section" id="settings-audio"><h2><small>01</small>声音与画面</h2><div class="preferences-grid"><section class="preference-group"><h3>${icon('sound')}声音</h3>${toggle('sound', '交互音效')}${range('volume', '音效音量')}</section><section class="preference-group"><h3>${icon('expand')}画面</h3>${toggle('motion', '动态效果', '转场、拆封与粒子动画')}${range('brightness', '背景亮度', 20)}<div class="setting-row"><div><b>全屏显示</b><small>F11 切换</small></div><button class="outline-button" data-action="fullscreen">${icon('expand')}切换全屏</button></div></section></div></div>`;
    const save = `<div class="settings-section" id="settings-save"><h2><small>02</small>存档</h2><div class="save-overview">${stat('已开卡包', state.opened.pack, '包')}</div><div class="settings-actions"><button class="outline-button save-action" data-action="export">${icon('download')}<span><b>导出存档</b><small>备份本机进度</small></span>${icon('arrow')}</button><button class="outline-button save-action" data-action="import">${icon('album')}<span><b>导入存档</b><small>从 JSON 恢复进度</small></span>${icon('arrow')}</button><div class="settings-danger"><span><b>重置进度</b><small>清空收藏与购买记录</small></span><button class="outline-button reset-button" data-action="reset">重置进度</button></div></div><input type="file" id="import-file" accept=".json,application/json" hidden></div>`;
    const content = `${audio}${save}`;
    const visible = settingsSection || 'settings-audio';
    const art = `<div class="settings-card-sweep" aria-hidden="true"></div><div class="settings-card-display" aria-hidden="true">${settingsCard(asset)}</div>`;
    return screen(
      'settings',
      '05',
      '设置',
      `<div class="settings-persona ${settingsSection ? 'is-config' : 'is-system'}"><div class="settings-circle" aria-hidden="true">${settingsArc()}</div>${settingsSection ? settingsConfigArc() : ''}<div class="settings-scene" aria-hidden="true"></div><header class="settings-persona-title"><small>05 / 设置</small><h1>${settingsSection ? groups.find((g) => g[0] === visible)?.[2] : 'SYSTEM'}</h1></header>${index}${art}<section class="settings-content" ${settingsSection ? '' : 'hidden'}>${content}</section><footer class="settings-persona-footer"><span>${icon(saveWarning ? 'close' : 'check')}${saveWarning ? '保存失败，请导出存档' : '本机自动保存'}</span><span>Esc 返回</span></footer></div>`,
      '',
      false,
    ).replaceAll(
      /(<div class="settings-section(?: credits)?" id="([^"]+)")/g,
      (all, tag, id) => tag + (id === visible ? '' : ' hidden'),
    );
  }
  return settings;
}
