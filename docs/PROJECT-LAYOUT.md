# 项目布局与 UI 修改索引

2026-10-08 整理。当前界面、素材、存档格式和交互沿用整理前版本。

## 目录职责

| 位置 | 内容 |
| --- | --- |
| `index.html` | 当前页面入口；样式加载顺序以此为准 |
| `src/app.js` | 应用状态、导航、主页、开盒 HUD、全局事件委托及存档入口 |
| `src/game/` | 库存、交易、独立概率与配额发牌、存档校验与统一卡牌查询；版本4及配额见 `LOCR-COLLATION.md`，第一阶段见 `CARD-DATA-SAVE.md` |
| `src/ui/pages/` | 收藏册、仓库、手机购买、设置及弹窗模板；`shared.js` 为公共页面框架 |
| `src/ui/screens.js` | 页面工厂的统一出口 |
| `src/ui/styles/` | 当前全部生效样式，按页面与用途拆分 |
| `src/ui/motion/` | 页面转场、局部动画、三维入口与整理页动画 |
| `src/ui/card-inspector.js` | 整理卡堆的 DOM、拖放、换序与分配 |
| `src/scene/` | Three.js 场景、包装、几何、碰撞、镜头及材质 |
| `src/vendor/`、`src/generated/` | 第三方运行库、生成的离线模型模块 |
| `public/assets/` | 运行素材；保留旧资源供研究和还原使用 |
| `public/material-review/` | 独立工艺审查页；游戏与图鉴共用已接受的完整材质，见 `CARD-FINISHES.md` |
| `public/locr-catalog/` | LOCR 全80种/318规格的卡面与图鉴；生成及接入状态见 `docs/LOCR-CATALOG.md` |
| `art/blender/` | 可编辑 Blender 源文件与碰撞清单 |
| `desktop/` | Electron 主进程与预加载脚本 |
| `scripts/`、`tests/` | 开发、打包、资产生成及当前验证脚本 |
| `research/` | 研究参考与历史版本；不是游戏运行入口 |
| `research/ui-legacy-20261008/` | 本轮归档的旧样式、转发模块和旧版哈希审计脚本 |
| `portable/` | 绿色版副本，执行打包命令后更新 |
| `test-results/` | 验证报告、截图及隔离测试存档 |

旧路径与新路径的详细对应关系见 [refactor-paths.json](refactor-paths.json)。历史验证记录中的旧路径按当时版本保留。

## 从界面找到修改位置

| 界面 | 模板或行为 | 样式 | 相关验证 |
| --- | --- | --- | --- |
| 主页、顶部栏、开盒 HUD | `src/app.js` | `home.css`、`base.css`、`space.css` | `interfaces-layout`、`ui-smoke` |
| 收藏册 | `src/ui/pages/album.js`、`src/ui/album-interactions.js`、`src/ui/motion/page-transitions.js` | `album.css` | `album-motion`、`persona-ui`、`compact-pages`、`collection-workflow`、`interfaces-layout`、`navigation-transitions` |
| 仓库与出售区 | `src/ui/pages/warehouse.js`、`warehouse-sales.js`；交易 `src/game/sales.js` | `warehouse.css` | `sales-workflow`、`collection-workflow`、`interfaces-layout`、`ui-smoke` |
| 购买与手机应用 | `src/ui/pages/shop.js`、`src/ui/motion/purchase-overlay.js` | `shop.css` | `persona-ui`、`compact-pages`、`purchase-overlay`、`ui-smoke` |
| 设置 | `src/ui/pages/settings.js`、`src/ui/settings-art.js`、`src/ui/motion/page-transitions.js` | `settings.css` | `interface-fixes`、`persona-ui`、`interfaces-layout`、`navigation-transitions`、`animation-controls` |
| 卡牌详情、订单确认 | `src/ui/pages/dialogs.js` | `base.css`、`settings.css` | `ui-smoke` |
| 公共导航与窄屏 | `src/ui/pages/shared.js` | `workspace.css`、`pages-responsive.css` | `interfaces-layout` |
| 卡堆整理 | `src/ui/card-inspector.js` | `world3d.css`、`space.css` | `inspector-actions`、`inspector-routing`、`inspector-transitions` |
| 真实卡面工艺 | `src/scene/material-finishes.js`、`game-card-finishes.js`、`src/ui/card-finishes.js` | `base.css`画布覆盖 | `game-finishes`、`material-review`、`collation-ui`、`collection-workflow` |
| 三维桌面与包装 | `src/scene/`；镜头与掉落起点为 `room-view.js`，插值为 `packages3d.js` | HUD 在 `space.css` | `room-motion`、`room-workflow`、`room-portals`、`blender-assets` |

表中 CSS 均位于 `src/ui/styles/`。验证名称对应 `tests/<名称>.mjs`。

## 必须一起考虑的连接

- 样式顺序：基础 → 三维基础 → 主页 → 公共页面 → 各页面 → 页面响应式 → 开盒覆盖 → 转场。不要只因文件名排序而重排 `index.html` 的样式链接。
- 全局按钮由 `src/app.js` 根据 `data-action` 等属性委托处理。改按钮结构时检查这些属性以及相关测试选择器。
- 手机购买通过 `purchase-overlay.js` 保留打开前的页面 DOM 与 3D canvas；从右侧拿取与收起手机。开盒空间的手机屏幕交接已取消，`room-portals.js` 仅由收藏册与仓库入口调用。改手机结构后运行 `purchase-overlay` 与 `persona-ui`；`phone-handoff`、`shop-docking` 为兼容测试入口。
- 收藏册翻页依赖 `.left-page`、`.right-page`；整理页拖放与飞行动画依赖卡牌和投放区的边界。
- 页面模板采用 HTML 字符串。格式化工具刻意不改模板内部空白，避免改变行内排版；调整模板时做视觉核对。
- 本轮 P3R / P5R 界面重做、视频逐帧记录与验证见 [PERSONA-UI.md](PERSONA-UI.md)。旧手机交接测试保留在 `research/ui-legacy-20261008/tests/`。
- 修改 Blender 摆件的大小或位置时，需同步碰撞清单及导出的模型。仅修改 HUD 或入口动画时，从 UI 文件定位。
- 游戏素材路径以页面或 `import.meta.url` 为基准；移动模块后须同时检查浏览器预览与绿色版的离线加载。

## 本轮备份

完整备份：`D:\Game-YGO-backups\20261008-080117`。包含原项目的 4759 个文件（约 970 MB），包括绿色版、研究资料、测试记录和隐藏文件。`BACKUP-MANIFEST.json` 保存逐文件 SHA-256；复制后已逐项核对。

备份是独立的整理前快照。需要还原时先退出游戏，将备份恢复到另一个空目录核对，避免把新旧源码混在一起。玩家实际存档位于 `%APPDATA%/YGO-Duel-Archive`，此次整理没有访问或迁移该目录。
