# 统一卡牌数据与存档版本 2

2026-10-09。本文记录全卡接入的第一阶段：统一查询入口、规格库存、编号卡账册、版本 1 迁移及页面适配。后续已完成版本4真实卡池发牌、盒内配额及完整工艺；最新状态见 [LOCR-COLLATION.md](LOCR-COLLATION.md)与[CARD-FINISHES.md](CARD-FINISHES.md)。以下保留第一阶段验证记录。

2026-10-09 后续调整：旧占位卡在加载和导入游戏进度时退役，清空其计数、册位、桌面实体与标记；真实规格、编号和封装不变。旧键仍仅用于校验历史格式，不再生成占位卡图或商品。覆盖含旧占位库存的存档前保留原文到 `ygo-duel-archive-placeholder-backup`，失败时不覆盖原档；既有版本备份继续保留。单卡交易入口暂时为空，模型层也拒绝单卡购买订单。

## 统一入口

`src/game/card-data.js` 是游戏与图鉴共用的卡种、规格和罕贵度入口。

- `CARD_CATALOG`：80 种卡的卡号、中日文名、密码、官方 ID、类型、数值与合法规格。
- `CARD_PRINTS`：318 个合法规格。`id` 为规格键，如 `LOCR-JP001-UR-OF`；`rarity` 是 UR，`overframe` 是 true，`style` 是 UR-OF。异画索引独立保存，不拿图像编号代替密码。
- `getCard`、`getCardPrint`、`getCardView`、`findCardPrints`：查卡种、查规格、页面展示数据及按名称／卡号／密码／罕贵度／版式搜索。未知身份返回 null；数据深度冻结。
- `CARD_RARITIES` 的显示名只有 N、SR、UR、SER、PSER、UL、CR、GMR。N 仅用于旧版占位卡。游戏、全卡图鉴及工艺审查页的规格按钮均使用字母代码。

来源仍是 `public/locr-catalog/cards.json` 与 `manifest.json`。`scripts/generate-card-data.mjs` 生成小型静态 ES 模块 `src/generated/locr-card-data.js`，不把贴图或模型嵌入数据入口，也不依赖联网或 JSON fetch；支持绿色版的 file:// 入口。

更新原清单后运行 `npm run cards:generate`。`npm run cards:check` 与 `npm run check` 比较完整生成结果及源摘要，拒绝过时的生成文件。不要手工编辑生成模块。

## 存档与分配

JSON 的 `version` 为 2，继续使用安装版原有 `ygo-duel-archive-v1` 存储键，避免切换键丢失旧进度。

- `cards` 和 `collection` 改为按规格 ID 保存计数。普通卡保持紧凑分组，不把十亿张旧卡展开为实体对象。
- 旧版 N／SR／UR／SER／PSER 的键继续保留，它们在查询入口中被明确标为 `legacy`，卡种为 `legacy-placeholder`。它们与 LOCR-JP001-UR 等真实规格独立，不猜测旧卡的真实身份。
- 桌面 `cardStacks[].cards` 与 `binder.slots` 中的卡记录保存 `{ id, printId, rarity }`；GMR 另有整数 `serial`，范围 1–100。
- `numberedCards` 为 GMR 持有实体账册，保存 `{ id, printId, rarity, serial, inCollection }`。与桌面／册页关联的同一实体保持相同 ID 和编号；不在桌面／册页的实体通过 `inCollection` 区分仓库与暂存区。不同卡种可使用相同编号，同一规格的编号不得重复。最多 18×100 个实体。
- 每个规格都校验：持有数量 ≥ 收藏数量＋桌面数量，收藏数量 ≥ 册中数量。GMR 计数必须与实体账册一致，禁止伪造数量、重复实体或编号、非法卡种／工艺组合。

`src/game/card-inventory.js` 提供 `addCards`、转移、入册和数量查询，`model.js` 保留统一导出，原调用可继续运行。示例：

```js
addCards(state, 'LOCR-JP001-UR-OF', 2);
transferWarehouseToTray(state, 'LOCR-JP001-UR-OF', 1);
moveBinderCard(state, { printId: 'LOCR-JP001-UR-OF' }, 0);
addCards(state, 'LOCR-JP001-GMR', 1, [7]);
```

数量查询的可选参数是具体规格键；`rarityCount` 用于跨规格汇总罕贵度。旧调用 `{ rarity: 'UR' }` 仍指旧版 UR 占位分组，新调用应使用 `printId`。

GMR 入库必须明确提供合法编号，重复／耗尽时整笔操作失败。不会从展示底图的 001/100 自动生成玩家实体，不设置未知爆率或编号保底。UL、CR、GMR 暂无游戏交易定价，不能直接购买。

## 旧档迁移与备份

版本 1 经校验后补充旧卡 `printId`、编号账册默认值，并升级到版本 2。卡牌数量、桌面顺序、实体 ID、册页位置、页码、三维姿态、标记、余额与其他进度保留。更早缺少收藏字段的存档保持原有“全部进入收藏暂存”的兼容行为。

`src/game/save-storage.js` 统一读取和写入。首次覆盖版本 1 前，将原始 JSON 原样保存到 `ygo-duel-archive-v1-backup`，后续保存不覆盖该备份。备份写入失败时不覆盖原档，并沿用游戏的保存失败提示。导入和导出继续通过版本校验及现有设置页面运行。

仓库、暂存区、册页、详情、整理卡面读取同一规格数据；标记和转移针对具体规格。桌面卡堆可恢复新的罕贵度及真实卡面底图。这里未接入全卡工艺着色器；GMR 底图仍是图鉴工艺预览图，实体编号以存档账册为准，后续渲染阶段需把编号绘入实际卡面。

## 验证入口

- `npm test`：原有行为及新增全卡数据／迁移测试；全 318 个规格逐个验证入库、入册、换位、出册、重载和数量守恒，覆盖 GMR 编号与备份失败。
- `npm run test:ui -- card-integration collection-workflow inspector-actions interfaces-layout navigation-transitions ui-smoke`：真实规格 UI、旧档备份、收藏、整理、布局与完整流程。
- `npm run test:ui -- locr-catalog material-review`：全卡图鉴与原工艺审查回归。
- `npm run check`、`npm run format:check`：源码、引用、生成数据与格式检查。
- `npm run test:cards:desktop`：实际 EXE 的离线异画卡面、版本1原文备份、真实规格及GMR编号重启恢复。

新浏览器报告与压缩截图保存在 `test-results/card-integration/`。验证使用隔离浏览器和桌面测试档案，不访问玩家实际存档。

本轮验证通过：55项单元测试；全318个规格的库存与存档往返；真实规格搜索／详情／转移／入册／重载；UL、CR、GMR桌面卡堆恢复与整理入仓；旧档原文备份；原收藏、整理、8种尺寸布局、导航及完整购买／开包／导入导出流程；80种／318规格图鉴渲染与原27张工艺审查；源码／引用／生成数据及格式检查。窄屏整理入仓列表可滚动，避免增加罕贵度选项后遮挡全选与确认按钮。

绿色版已更新，原桌面完整流程与新增全卡存档EXE验证通过。下一阶段从真实卡池发牌和盒内配额开始，随后接入完整工艺与实体编号绘制；不要把第一阶段沿用的开包数量、权重或展示序号当成最终封入规则。
# 后续阶段

2026-10-09已进入版本4与独立概率/真实配额发牌；最新规则、赠包、编号渲染及验证见 [LOCR-COLLATION.md](LOCR-COLLATION.md)。以下保留第一阶段记录。

