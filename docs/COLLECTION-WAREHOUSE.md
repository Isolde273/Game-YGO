# 收藏册与仓库

2026-10-09：存档已升级到版本2，库存／暂存分组键与册中卡牌增加真实规格身份，旧档保留为独立占位卡。最新数据、迁移和备份规则见 [CARD-DATA-SAVE.md](CARD-DATA-SAVE.md)；下文为此前界面与版本1记录。

2026-10-08。此阶段重做主游戏的收藏与仓库界面，LOCR 全卡素材仍由独立图鉴提供。

## 功能

- 收藏册有 100 个实体页，每页 6 格；一组摊开显示两页，共 600 个卡位。
- 翻页按钮、页码输入和 100 页索引均可跳转。卡牌选择随翻页保留；拖卡悬停翻页按钮约 650 毫秒后翻页。
- 暂存区与册页使用不同布局单元。宽屏在右侧，较窄屏幕在下方；触摸卡牌之外可正常滚动。
- 支持鼠标／触摸拖放，以及键盘／点击选卡后放置。册中卡牌可换位、跨页移动、取出或转回仓库。
- 移动到已占用卡位时，册中两张卡交换；从暂存区放入时，原卡退回暂存区。
- 入册、出册和移动使用卡牌飞行及卡袋动画。系统或游戏关闭动画时立即完成数据更新。
- 仓库提供分类、罕贵度筛选、名称／编号搜索、排序、详情与标记；可按数量或全部转入暂存区。
- 桌面卡堆的收藏投放区现在明确标为暂存区，转入不会自动占据册页。
- 新界面只保留功能标签、状态、数量和操作提示。

## 存档

保持版本 1，增加 `binder: { slots: {}, page: 1 }`。卡位键为 0–599，值保存唯一 `id` 和 `rarity`。`page` 为上次打开的左页。

`collection` 包含册中和暂存卡牌；暂存数量由收藏总数减去册中数量得到。仓库继续从持有数量扣除收藏和桌面卡堆。各位置之间移动不会增加持有数量。

旧存档缺少 `binder` 时，原有收藏全部保留在暂存区，以罕贵度分组显示，不把大数量展开为对象。校验拒绝重复 ID、非法卡位、超出收藏数量的册中记录和无效页码。

主游戏本阶段仍按罕贵度汇总占位卡。接入全卡时须扩展单卡身份和分组键，保留同名异画、版式与罕贵度；不得把现有五种分组视作 LOCR 的完整卡池。

## 文件与验证

- 模型：`src/game/model.js`。
- 页面与交互：`src/ui/pages/album.js`、`src/ui/pages/warehouse.js`、`src/ui/album-interactions.js`、`src/app.js`。
- 样式：`src/ui/styles/album.css`、`src/ui/styles/warehouse.css`。
- 桌面路由说明：`src/ui/card-inspector.js`；页面进入动画：`src/ui/motion/motion-player.js`。
- 模型测试：`tests/binder.test.mjs`；端到端验证：`tests/collection-workflow.mjs`。
- 旧界面测试同步新的暂存／手动入册行为：`interfaces-layout`、`navigation-transitions`、`ui-smoke`、`desktop-smoke`。

命令：`npm test`、`npm run test:ui -- collection-workflow interfaces-layout navigation-transitions ui-smoke inspector-actions room-portals`、`npm run check`、`npm run format:check`。

截图和流程报告保存在 `test-results/collection-redesign/`。所有测试使用隔离存档。

2026-10-08 验证通过：43 项单元测试、100 页逐页检查、600 个位置的满册模型检查、8 种尺寸的布局、鼠标／触摸／键盘入册、跨页拖放、入册／出册动画、旧存档迁移和库存守恒。`interfaces-layout`、`navigation-transitions`、`ui-smoke`、`inspector-actions`、`inspector-transitions`、`room-portals` 均通过，无页面错误。

执行 `npm run portable` 后，实际 EXE 的离线素材、五个入口、开包整理、手动入册、刷新及重启存档恢复通过 `npm run test:desktop`。旧绿色版应用目录保留在 `test-results/package-history/`。源码与引用检查、格式检查均通过。

## 收藏册细节与购买页布局（2026-10-08）

- 收藏册增加册页层次、透明卡袋接缝、封边缝线与金属装订环，按可用高度调整册页尺寸，保留每页 6 格、共 100 页与原有拖放行为。
- 暂存操作区使用紧凑按钮；窄屏暂存区横向排列五个罕贵度卡组。操作说明按需展开，册页索引向上弹出。
- 收藏册与购买页压缩顶部栏、导航与间距。购买页删除左右面板和页内标题，居中保留手机；公共顶部栏与导航仍用于返回和切页。
- 手机尺寸保持桌面 334×606、宽度不超过 700px 时 318×606，保留手机内部购买、订单、钱包和返回操作。
- `compact-pages` 已加入默认 UI 验证。1440×900、1366×768、1095×615、1000×700、768×1024、390×844、360×800 的收藏册均无需页面滚动；购买页在 1095×615、1000×700 分别需 145px、60px，其余尺寸无需页面滚动。无横向溢出或册页与暂存区重叠。
- `collection-workflow`、`compact-pages`、`interfaces-layout`、`navigation-transitions`、`phone-handoff`、`shop-docking`、`ui-smoke` 通过。截图与布局报告保存在 `test-results/compact-pages/`。

涉及源码：`src/ui/pages/album.js`、`src/ui/pages/shop.js`、`src/ui/pages/shared.js`、`src/app.js`，样式为 `album.css`、`shop.css`、`workspace.css`。测试从手机桌面启动应用，移除对已删除侧栏按钮的依赖。

本轮完成 `npm run format`、`npm run check`、`npm run format:check`，源码与离线引用 96 个文件、187 个引用检查通过。桌面与窄屏收藏册、手机居中布局截图已核对。`npm run portable` 已更新绿色版，`npm run test:desktop` 验证实际 EXE 的离线素材、购买转场、收藏、刷新及重启存档恢复通过。

## P3R / P5R 界面完成记录（2026-10-08）

收藏册翻页、仓库重做、原背景手机购买浮层、SYSTEM / CONFIG 设置与整理卡牌飞行动画已完成。购买页没有左右操作面板，桌面手机仍为 334×606，窄屏为 318×606；手机内保留购买、订单、钱包与收起操作。

`persona-ui`、`persona-motion`、`purchase-overlay`、`navigation-transitions`、`collection-workflow`、`interfaces-layout`、`compact-pages`、`inspector-actions`、`inspector-transitions`、`room-portals`、`ui-smoke` 均通过；43 项单元测试、源码与格式检查通过。绿色版已更新，实际 EXE 验证通过。完整实现、参考视频采样与验证记录见 `docs/PERSONA-UI.md`。

最新修正：下一组左右册页在翻页前准备并解码，动画不再把双面页压平；双向翻页已验证旧卡面不会镜像至背面。手机移除手部并支持机身外点击退出；设置采用绘制的龙形卡牌和三种悬浮轮廓，主界面取代抽卡规则，转场加入左侧三个选项条。从开卡空间进入的页面支持 Esc 返回。整理卡牌去掉卡面罕贵度标签，分配后增加 240ms 补位。`interface-fixes` 已接入默认套件，源码、布局、完整流程和实际 EXE 验证通过，绿色版已更新。
