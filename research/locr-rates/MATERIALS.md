# 日版 LOCR 工艺样卡 · 2026-10-07

本轮先核对日版工艺说明、查看选定的实物近照，再制作独立审查页。范围为日本国内版，未混用亚洲日文版 `/100A` 或 TCG 工艺。SR、UR、SER、UL、CR、PSER、GMR 各一张；UR/PSER 超框各补一张，共九张。超框是布局变体，不是第八种罕贵度。

**2026-10-07 第二轮已修改样卡。** 恢复 590×860／59:86 卡面比例，分别校准三张普通卡的内图框，保留下沿、卡号带和扫描外缘纹理；SR/SER 属性和永续图标使用对应圆形遮罩。下表已改为最新实现。之前关于固定彩虹印刷边缘、连续格线和独立 GMR 卡膜的实现判断已撤回；只读审查记录见 第二轮审查（历史记录保留在本地），修改与验证记录见 样卡修正（历史记录保留在本地）。

**第三轮：爆闪与超框构图修正。** 镜碎微颗粒增加窄角度 HDR 亮峰、虹彩侧翼与白亮中心，转动卡/光源时出现成组亮灭；不再仅用低强度宽反光。超框使用无 SAMPLE 插图对实物扫描的特征配准，恢复主体位置/比例/裁切，替换拉长方形插图的做法。上部扩展图保留实物底图，清除原拍摄文字后重建标题/标记；图像连续到文本框上缘，消除卡号处拼接暗带。详见 本轮修正与验证（历史记录保留在本地）。

## 观察依据与实现

| 工艺 | 观察与核对 | 本次样卡实现 |
| --- | --- | --- |
| SR | 卡图、属性/种别及对应标记有闪箔；卡名保持印刷。现行版本不局限于卡图。 | 局部平滑箔光，随入射/观察角度变化；纸面及卡名不使用稀有字箔。 |
| UR | SR 区域加金字名称；UR 不等于浮雕。 | 局部闪箔及独立金色金属文字。 |
| SER / SE | 日本国内版可见纵向细长的断续颗粒、错位点列与较宽反光带，文字为碎银箔。 | 固定表面微单元、错位断续颗粒、角度驱动的反光包络与窄角高亮爆闪；仅覆盖卡图/标记，独立钻石切面银字。 |
| UL / UTR | 现行第 13 期日本国内版沿用第 11 期体系，文本区、外缘/图框不刻浮雕，边框为光泽箔；原石实物近照有细密晶体刻纹。 | 以晶体图像轮廓生成法线、框面细粒、金字；排除文本区及光滑边缘。 |
| CR | LOCR 日本国内版改用玻璃碎片式平行箔/背景浮雕，区别于旧版集中线、也区别于亚洲向版本。观察的应战 G 实物图有较大的多边形碎片反光。 | 固定角形碎片模板、不同方向反射、轮廓压纹；文本区平整，名称为银箔。 |
| PSER / PSE | 全卡镜碎覆盖文字区，反光受印刷墨层影响。外缘随角度显出虹彩；单张照片及 Wiki 的“虹色の印刷”措辞不足以确定材料层结构。 | 全卡共用微颗粒卡膜，保留暗墨吸收；外缘为中性金属底色和源纹理，随光变色，没有固定 HSV 彩虹。卡名使用虹彩字箔。 |
| GMR | 用户明确其全卡膜与 PSER 一样；日版实物另有黑色象形纹样外缘、名称/标记/框线厚箔和金字编号。 | 与 PSE 共用基础卡膜；从本产品实物外缘提取中性纹样遮罩，增加厚箔法线、细银框、标记边线与 `001/100` 金字区。 |

可制作以上效果的实时数字近似。光谱使用角度驱动的有界近似，并不模拟微米级真实光栅/光波；浮雕使用法线，不是能制造实体卡的模具文件。CR 碎片与浮雕线路为参考近似，GMR 外缘为实物照片提取的形状遮罩；粒距、膜型号与浮雕模具均没有原厂数据，不宣称精确复刻。

## 样卡和卡面来源

| 样卡 | 实际日文卡名 / 卡号 | 选择依据 |
| --- | --- | --- |
| SR / SER / UL / PSER | 原石の皇脈 · LOCR-JP076 | LOCR 中确有这四种规格；同卡比较减少图案差异。 |
| UR / GMR / UR-OF / PSER-OF | 四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン · LOCR-JP015 | LOCR 适用的普通 UR、超框 UR/PSER/GMR。 |
| CR | 応戦するＧ · LOCR-JP048 | LOCR CR 对应卡；当前底框/文本来自同产品同卡 SR，已替换先前 SD45 底框。 |

用户要求不加入官方 SAMPLE 字样。本次没有使用项目现有 `public/assets/card.jpg` 或官方 SAMPLE 图作为运行时样卡。也没有直接把带有固定彩虹反光的整张高罕照片贴到模型上。

卡图来自 YGOPRODeck 的无水印独立插图：

- <https://images.ygoprodeck.com/images/cards_cropped/56506740.jpg>
- <https://images.ygoprodeck.com/images/cards_cropped/90091224.jpg>
- <https://images.ygoprodeck.com/images/cards_cropped/46502744.jpg>

日文文本与通常卡框参考 CARD RUSH 的无水印实物扫描。普通卡按各自内图框替换插图，保留印刷框和卡号带；JP015 暗金标题重新绘制，CR 名称从同卡 SR 印字提取遮罩。超框主体由独立插图与实物扫描配准重建，上方延伸保留实物底图，文本/外缘布局分开校准；主体位置已经实物验证，扫描光照和字形重建仍是近似。超框标题采用 Noto Serif JP 的所需字符子集，来源及 SIL OFL 位于 `finish-references/`。

GMR 的 `001/100` 只表示数字审查样卡，不宣称持有对应实体编号，也不写入存档编号池。所有标题/日文文本为原卡内容，没有添加美术宣传用语。

## 可复查资料

- [KONAMI LOCR 官网](https://www.yugioh-card.com/japan/products/locr/)：七种罕贵度及超框范围；官方图仅作布局核查。
- [日本 Wiki：Super](https://yugioh-wiki.net/?Super)、[Ultra](https://yugioh-wiki.net/?Ultra)、[Secret](https://yugioh-wiki.net/?Secret)、[Ultimate](https://yugioh-wiki.net/?Ultimate)、[Collectors](https://yugioh-wiki.net/?Collectors)、[Grandmaster](https://yugioh-wiki.net/?Grandmaster)：现行工艺及版本差异。PSE 的说明位于 Secret 页。
- [JP076 SR 实物](https://www.cardrush.jp/product/112954)、[SE 实物](https://www.cardrush.jp/product/112832)、[UL 实物](https://www.cardrush.jp/product/112854)、[PSE 实物](https://www.cardrush.jp/product/112752)。
- [JP015 UR 实物](https://www.cardrush.jp/product/112893)、[超框 UR](https://www.cardrush.jp/product/112691)、[GMR 全卡及细节](https://www.cardrush.jp/product/112655)。GMR 侧光细节文件为该页 `Y0419_3.jpg`，已查看缩至 720×960 的版本。
- [JP048 CR 实物](https://www.cardrush.jp/product/112863)、[当前 LOCR SR 底框](https://www.cardrush.jp/product/112926)。早期 SD45 参考保留在研究目录，已退出运行时生成。

资料快照 `finish-*.html/txt/json` 保留于本目录。查看的照片缩图及来源 URL 位于 `finish-references/`；没有批量把原图或编码送入会话。游游亭有店铺水印的图只用作初期对照，没有进入运行时素材。

## 审查入口、文件与验证

- 双击项目根目录 `审查卡面.cmd`；或打开 <http://127.0.0.1:5173/public/material-review/index.html>。
- 拖动转卡、滚轮缩放、拖动光源面板/使用角度滑条；支持背面、自动转动、闪箔/浮雕开关、九卡对比、带标签的 PNG 导出。
- `src/material-finishes.js`：独立不透明印刷/材质着色器，卡背复用已有本地卡背；表面一次合成，避免叠片深度闪烁。
- `scripts/prepare-material-samples.py`：重建无水印日版卡面、材质区域遮罩和浮雕法线。
- `public/material-review/`：独立页面与 9 份样卡素材，全部本地加载；与游戏存档/卡池无依赖。
- `tests/material-review.mjs`：逐卡光照变化、闪箔开关、UL 法线反射、拖动/缩放、卡背、静止停止绘制、自动转动、对比及选卡、纹理复用、PNG 导出、390px 布局、键盘调光、网络来源与 WebGL 错误检查。
- `tests/material-calibration.py`：贴图尺寸、各源内图框下沿/卡号带、外缘纹理、两个圆标遮罩及全卡膜覆盖。
- `tests/material-optics.mjs`：模型比例、相同印刷条件下 PSE/GMR 卡膜输出一致、静止纹理和连续角度响应、中性外缘/随光虹彩，以及四种卡面三光位、远中近三档缩放截图。
- `scripts/calibrate-overframe.py`、`tests/material-overframe.py`：开发阶段的实物特征配准、原拍摄文字/图标底图清理与独立主体位置回归；需要本机已有 OpenCV，页面运行时不依赖它。日常样卡生成器仍只使用 Pillow/numpy。

验证记录在 `test-results/material-review/report.json`，九卡同光位概览及桌面/窄屏截图在同目录。单张 3 次绘制，九卡 27 次；纹理共享、静止停止渲染。没有重打包主游戏或替换主游戏的占位卡，等待本次工艺审查后再决定接入方式。
