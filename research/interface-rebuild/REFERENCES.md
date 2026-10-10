# 界面重构参考

访问与检查日期：2026-10-07（北京时间）。仅参考信息组织和交互；网站截图保存在本研究目录，不作为游戏素材分发。

| 来源 | 已检查内容 | 对应实现 |
| --- | --- | --- |
| [集换社](https://www.jihuanshe.com/) | 官网展示的手机、卡牌内容和底部应用导航；截图 `market.jpg` | 购买页保留手机，急换社使用卡图、版本、编号、单价和购买入口组成商品列表；三个应用都有订单与钱包 |
| [Carbon Data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) | 搜索、全局筛选、工具栏、信息层级和结果数量；可读页面内容保存在 `sources-verified.json`，工具栏截图 `carbon-toolbar.jpg` | 仓库把类型筛选、名称搜索、排序和稀有度筛选分开，库存数量置于卡图外；保留卡牌陈列和未拆封货架 |
| [Apple Settings](https://developer.apple.com/design/human-interface-guidelines/settings) | 设置分组、任务相关选项、清楚的控件标签和一致的访问路径；截图 `settings-live.jpg`、`settings-groups.jpg` | 声音／画面分组控制、存档与补给动作、独立重置区域、可跳转的分组导航 |
| [Pokémon TCG Pocket](https://tcgpocket.pokemon.com/en-us/) | 官方卡牌展示、收藏定位及沉浸式卡牌介绍；截图 `pocket.jpg`、`pocket-cards.jpg` | 收藏页以卡牌为中心，保留实体双页收藏册，增加版本进度、册页索引和独立卡牌详情 |

收藏册的布面封皮、金属装订环、透明卡套与双页布局延续项目既有设计。新增索引与导航是本项目的界面设计，没有复用第三方界面素材。

Dribbble 搜索、TCG Collector 及部分旧 Material 页面未返回可用设计内容，未作为设计依据。访问结果保留在 `sources.json` 和 `sources-verified.json`，便于区分已检查来源与失败尝试。

当前四个页面的结构和专用样式分别位于 `src/archive-screens.js` 与 `src/archive-ui.css`；所有新样式限定在收藏、仓库、购买、设置页面，主界面和开卡空间保持原样。

## 转场实施前的 UI 追加研究（2026-10-07）

已完成用户提供的 ignoredone 资源筛选，复核八组缓存案例，记录见 UI 参考筛选（历史记录保留在本地）。主要选择银心湖列车的纸质资料卡、视相博物馆的收藏状态、未许之地的商品层级和矢量突破的几何图形；各自适配收藏册、收藏索引、手机商店和转场遮罩。

本轮是研究阶段，尚未将这些追加建议写入游戏。继续保留现有红蓝笔刷、手机、双页收藏册与货架，文案只说明功能。动态接口未完整加载的内容没有作为结论依据。

下一步依据上述筛选与 视频转场研究（历史记录保留在本地） 实施导航转场；接入时区分页面导航和同页刷新，并验证动态效果开关、快速返回、窄屏及 3D 初始化／释放。

后续实施已完成：用户追加深度重构要求后，页面模板与样式已重写，导航与局部转场已接入。以上研究阶段记录保留；当前实现及回归结果以 [交付验证](../../VERIFICATION.md) 中“参考研究后的结构重构与导航转场”为准。
