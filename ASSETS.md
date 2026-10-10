# 素材来源

2026-10-10 最新：全部音效在原有相对音量基础上统一减半，设置默认音效音量为50%。点击和页签切换均使用 `09_item_tab_switch.wav`，共享同一个解码缓存。当前共四个P3R样本及卡片互动2；所有卡牌操作和收藏册翻页统一使用卡片互动2，不再随机。背景音乐、返回和退出音效已取消。`p3r-click.wav`（原14）、`background.m4a`、`p3r-back.wav`和`card-1.wav`保留作历史资源，当前不加载或播放。

2026-10-10 最新交互音效从用户提供的 `C:/Users/Isolde/Documents/Codex/2026-10-10/https-www-bilibili-com-video-bv1la4m1l7mj/outputs/P3R_UI_SFX/01_clean_WAV` 原样复制至 `public/assets/audio/`，未使用之前制作的合成试听版。源目录README说明这些是从视频混合音轨提取并降噪的片段，非游戏原始独立素材，可能保留背景残留或处理痕迹。选择依据为素材操作标签、长度与信号检查；本环境未做人工听音验收。

| 用途 | 用户源文件 | 项目资源 |
| --- | --- | --- |
| 点击 | `09_item_tab_switch.wav` | `p3r-tab.wav` |
| 返回（已停用） | `15_config_return.wav` | `p3r-back.wav` |
| 五个主入口悬浮 | `12_list_move_B.wav` | `p3r-hover.wav` |
| 进入页面 | `01_menu_open.wav` | `p3r-navigate.wav` |
| 页签切换 | `09_item_tab_switch.wav` | `p3r-tab.wav` |
| 购买成功 | `16_save_confirmation.wav` | `p3r-confirm.wav` |

卡牌互动和收藏册翻页只使用 `D:/md音效/卡片互动2.wav`，对应 `card-2.wav`，文件保持原样。原有2/3相对系数保留，另与所有音效一样乘0.5，最终增益为设置值的1/3。源与项目SHA-256对应表位于 `test-results/p3r-ui-sound-20261010/source-mapping.json`，最终核对在同目录的 `asset-hashes.json`。

历史背景音乐来自用户文件 `C:/Users/Isolde/Downloads/双子.m4a`，原样复制至 `public/assets/audio/background.m4a`（3,999,604字节）；当前已停用。

2026-10-10 旧交互音效由用户提供的 `D:/md音效` 五个WAV原样复制至 `public/assets/audio/`：点击→`click.wav`、返回→`back.wav`、鼠标悬浮→`hover.wav`、卡片互动1/2→`card-1.wav` / `card-2.wav`。旧点击、返回、悬浮和卡片互动1资源保留归档，当前使用上表的四个P3R片段及卡片互动2。

2026-10-07 日版 LOCR 工艺审查样卡：7 种罕贵度各 1 张，另有 UR/PSER 超框各 1 张。独立卡图使用 YGOPRODeck 的 56506740、90091224、46502744 无水印插图，日文卡框/文本参考 CARD RUSH 实物扫描，字箔、碎玻璃、浮雕法线及编号为项目制作。第二轮恢复 590×860 比例和逐源内框套准，CR 改用 LOCR-JP048 SR 底框；GMR 外缘改为从该产品实物提取中性形状遮罩。PSER 外缘不含静态彩虹底色，PSE/GMR 使用共同角度响应卡膜。没有使用官方 SAMPLE 卡面或游游亭店铺水印图。现行日版工艺区别、逐项来源、数字近似范围及构图取舍见 [日版工艺资料](research/locr-rates/MATERIALS.md)。

游戏包装和环境素材存入 `public/assets/`，独立审查页的样卡在 `public/material-review/assets/`。真实LOCR和vol.2卡面分别位于`public/locr-catalog/`、`public/vol2-catalog/`；2026-10-09已将全部328规格的印刷、箔膜、浮雕、厚箔及框线接入游戏，复用既有工艺着色器。vol.2遮罩从已核实的本地卡面生成，GMR编号字模来自存档实际实体编号；全部离线加载。来源与验证见 [完整卡面工艺](docs/CARD-FINISHES.md)。

样卡第三轮：超框主体改为对 CARD RUSH 的 UR-OF/GMR 实物扫描进行特征配准，保留正确构图，上部延伸用同一无水印扫描的清理底图补齐；不再把方形卡图拉伸铺满。超框标题使用 [Noto Serif JP](https://github.com/google/fonts/tree/main/ofl/notoserifjp) 的 24.7 KB 字符子集，只用于生成栅格卡名；字体、来源 URL 和 `NOTO-SERIF-JP-OFL.txt` 保存在 `research/locr-rates/finish-references/`，不产生运行时在线字体请求。镜碎爆闪由共同 WebGL 卡膜生成，没有新增叠层/光效贴图。

模型入口的前置转场由项目自制 DOM／CSS／Web Animations 绘制。仓库过渡箱使用四壁、底面及沿左右箱口铰接的双盖片，手机使用前端绘制的机身与屏幕；只读取场景模型的投影坐标，不使用 Blender 动画或新增下载素材。

收藏工作台与卡店环境由本项目在 Blender 5.2.2 LTS 中建模，源文件为 `art/blender/card-shop.blend`，生成脚本为 `scripts/build-card-shop.py`。包含桌架与桌腿、桌垫实体缝线、卡册拉链齿与分层内页、右上瓦楞仓库纸箱、细小的桌面入口箭头、卡组盒与卡套托、骰子凹点、陶瓷杯内壁、文具槽纹、手机接口和扬声器，以及精细的无字货架卡盒、空玻璃展柜、分类纸盒和相邻对战桌椅；已移除台灯和展柜内的展示卡牌。模型、木纹和织物纹理为项目自制，模型上的中文「仓库／收藏册／购买」用本机 Microsoft YaHei 制成实体字形，源文件包含打包字体，游戏只使用导出的字形网格；手机画面及局部反射纹理在游戏内生成，不使用下载模型。

运行时模型为 `public/assets/models/card-shop.glb`，同时嵌入 `src/generated/card-shop-glb.js`，确保桌面版在 file URL 下离线加载。加载器与几何合并工具来自项目相同版本的 Three.js，沿用 `src/vendor/THREE-LICENSE.txt`。玩家无需安装 Blender。

实体卡店照片仅作结构、尺度与陈列参考，未作为游戏贴图分发：晴れる屋东京店的对战区、BCW 的单卡柜与分类纸盒、Mox Boarding House 的木桌和暖色照明。具体来源链接、参考照片与建模取舍保存在 `research/card-shop/REFERENCES.md`。背景与既有包装、卡面素材来源保持下述记录。

3D 开盒空间更新：整箱外观参考 [Dimension Force 12 盒实物外箱](https://www.gate-to-the-games.de/Yugioh-Karten-SEALED-CASE-Dimension-Force-12x-Displays-deutsch)（参考图保存在 `research/yugioh-shipping-case.jpg`），以及下表已有的 Brothers of Legend 开箱照片。运行时整箱使用独立建模的纸板底、四面箱壁、四片带铰链并分层折叠的箱盖和分离胶带；棕色纸板、蓝色印刷及标签用 Canvas 绘制，标签复用官方 OCG 标志。整箱照片不用于 3D 模型贴图。LOCR 名称与 12 盒数量是本游戏的模拟配置。

`locr-box-front.png`、`locr-box-side.png` 最初由官方盒图缩略来源校正，现改用用户提供的800像素产品图，分别输出1024×1536与896×1536的透视校正贴图。2026-10-09 盒顶按用户提供的正面标志与 KONAMI 截图重新制作：`locr-lid-title-source.png`、`locr-konami-source.png` 保留输入，`scripts/prepare-lid-art.py` 提取透明标志，输出 `locr-lid-title.png`、`locr-konami.png` 与白底 `locr-box-top.png`，KONAMI 位于左上角。英文照片反光及裁切遮挡的部分按原文字重绘，日文标志从原图提取。内部纸白，背面／底面用项目绘制的示意印刷补全（并非官方背面贴图）。`locr-pack-front.png` 同样从800像素产品图裁切，输出1024×2048贴图，用于实际盒子和薄膜卡包几何体的包装表面。处理脚本为 `scripts/prepare-3d-assets.py`，其 `--box-only` 路径也重新生成上述包装贴图及盒顶。纸盒盒盖、侧耳、平直撕包条、压纹封口、红柄金属剪刀、收藏卡实体及闪卡着色均为本项目建模或绘制。剪刀由双臂、金属刀片、红色环形握柄与铆钉组成，五包拆封时横移并合剪。

三维渲染使用 [Three.js 0.180.0](https://github.com/mrdoob/three.js/tree/r180)，物理碰撞使用 [cannon-es 0.20.0](https://github.com/pmndrs/cannon-es/tree/v0.20.0)。两者从 jsDelivr 下载后保存至 `src/vendor/`，随绿色版离线分发，MIT 许可证分别见 `THREE-LICENSE.txt` 和 `CANNON-LICENSE.txt`。

| 文件 | 来源与用途 |
| --- | --- |
| `background.png` | 用户提供的 image-1.png，主场景背景，原图保留 |
| `character.png` | 用户提供的 image-2.png，主界面透明立绘，原图保留 |
| `locr-box.png` | [KONAMI LOCR 官方盒图](https://www.yugioh-card.com/japan/products/package/cg2070-box.png)，按包装轮廓抠出透明素材，保留包装白色印刷。原图为 `locr-box-source.png` |
| `locr-pack.png` | [KONAMI LOCR 官方包图](https://www.yugioh-card.com/japan/products/package/cg2070-pack.png)，按包装轮廓抠出透明素材。原图为 `locr-pack-source.png` |
| `locr-product.png` | [KONAMI LOCR 产品图](https://www.yugioh-card.com/japan/products/package/cg2070.png)，原图留存 |
| `card.jpg` | [KONAMI LOCR-001 青眼白龙官方预览图](https://www.yugioh-card.com/japan/products/locr/images/locr001ur-of.jpg)，保留原 SAMPLE 水印；仅保留历史素材，2026-10-09 已取消运行引用 |
| `card-empty.svg` | 自制无卡名、卡图及数值的中性表面，仅作为兼容查询的空白回退 |
| `locr-package-reference.webp` | 用户提供的800×800产品图；正面、侧面透视校正与卡包裁切的高细节来源，生成脚本为 `scripts/prepare-3d-assets.py` |
| `card-back.jpg` | [YGOPRODeck 卡背纹样](https://images.ygoprodeck.com/images/cards/back.jpg)，黑橙旋涡，按 512×744 卡面比例重采样后离线加载；所有稀有度与桌面卡堆共享 |
| `case-source.jpg`, `case.png` | [游戏王整箱实物照片](https://i.ebayimg.com/images/g/V-QAAOSwuW9hlUjU/s-l400.jpg)，从 Bing 图片检索「yugioh sealed booster case」获得；游戏王 Brothers of Legend 整箱照片作为外箱外观素材，游戏内内容设为 LOCR。`case.png` 去除边界背景，保留纸箱与实物 |
| `theme-icon.png` | [PRTS 主题入口图标](https://media.prts.wiki/7/7a/%E7%95%8C%E9%9D%A2%E4%B8%BB%E9%A2%98_%E8%AF%8D%E7%A5%AD_%E5%85%A5%E5%8F%A3.png)，用于主题标识 |
| `yugioh-logo.png` | [KONAMI 游戏王 OCG 标志](https://www.yugioh-card.com/japan/assets/images/logo-ocg.png)，用于整箱模拟标签 |
| `display.otf` | Bebas Neue，来自参考游戏字体目录；[Bebas Neue 上游](https://github.com/dharmatype/Bebas-Neue)，SIL Open Font License |

视觉参考：[PRTS 界面主题一览](https://prts.wiki/w/%E7%95%8C%E9%9D%A2%E4%B8%BB%E9%A2%98%E4%B8%80%E8%A7%88)中的样张保存在 `research/theme.png`，供设计参考，不作为整个游戏页面的背景。

游戏王产品介绍：[LIMIT OVER COLLECTION — THE RIVALS](https://www.yugioh-card.com/japan/products/locr/)。购买应用的结构参考：[集换社](https://www.jihuanshe.com/)、淘宝商品界面、微信聊天界面。手机、应用与其他页面的外观统一采用主菜单纸张与笔刷样式。

菜单图标、几何纹样、UI 和闪卡效果为项目自制 SVG/CSS。3D 卡背使用上表的离线黑橙旋涡贴图。整理界面由 HTML/CSS 绘制，中央卡牌使用真实规格工艺；两侧接收区仅显示抽象格线，不显示任何具体卡牌。卡面、规格与发牌使用完整卡库，旧占位卡已退出游戏，手机单卡交易已按用户售价表上架328个规格（LOCR318、LOSP10）。当前交互音效使用上述四个P3R样本和卡片互动2，背景音乐及返回/退出音效取消。

主界面按用户提供的 `eb68157d511ce8441b0b244e08581ffb.png` 设计图调整构图。`home-*-paper.png` 是 `scripts/prepare-home-art.py` 用固定随机种子绘制的破损纸边、炭黑笔刷、红蓝色块与印刷磨损；`home-*-stamp.svg` 为自制的开盒、收藏和仓库印章图标。设计图作为视觉参考，主界面文字、数量和按钮仍由实时界面绘制。

其他界面复用主菜单纸张与印章。`interface-ink.svg`、`interface-red.svg`、`interface-blue.svg`、`interface-shop.svg` 由 `scripts/prepare-interface-art.mjs` 使用固定种子生成，延续相同的炭黑、红蓝笔刷和米色纸面，支持离线缩放。

2026-10-07 的深度界面重构使用项目原有卡图、包装图、印章与纹理。集换社、Carbon、Apple 和 Pokémon TCG Pocket 的网页只用于参考信息组织、设置分组、手机购物和卡牌展示，未将网页图片、字体或界面截图复制进游戏。可核对的来源与访问记录位于 `research/interface-rebuild/`。

最新 P3 Reload 重构：`reload-dragon.svg` 为本项目绘制的几何龙头插画，按用户确认保留在主页，仅作装饰，不附青眼白龙名称、卡号与攻防；`reload-cards.svg` 为留存的通用卡牌扇形插画；`src/ui/icons.js` 为本项目绘制的统一实心图标；`theme-icon.png` 更新为蓝青卡牌标志。当前页面不再加载旧纸张、印章、人物和界面纹理。继续使用青眼白龙 SAMPLE 卡图、官方产品包装图与实体卡店模型。Bilibili、ignoredone 和 ATLUS 的网页、视频与缩略参考只用于研究，没有被打包为运行时美术、音乐或字体；详细记录见 `research/p3r/REFERENCES.md`。

素材权利分别归原权利人所有，本项目为本地学习与个人体验原型。替换外观素材只需修改 `public/assets` 与 `src/game/model.js` 中的映射。

本轮五类转场中的册页、货架箱格、手机／收据、滑轨、唱片圆环与盒片均为项目绘制的 CSS 几何和现有原创 SVG 图标；功能大字使用现有本地字体。没有新增远程图像、视频、音频或运行时网络请求。

开卡空间三个入口的追加转场同样由 CSS 几何、原创图标与 Web Animations 构成：手机画面、翻开的收藏册和展开盖片的纸箱均在前端绘制，从场景入口的投影位置飞入，并交接原有页面遮罩。没有使用 Blender 动画、渲染视频、屏幕截图贴图或新下载素材。

2026-10-10：`currency.webp` 来自用户提供的 `C:/Users/Isolde/Desktop/task-mv195bpv4k0ea.png`，仅裁去透明边并缩小为160px无损WebP。所有货币图标统一引用此本地素材；`locr-box-warehouse.webp` 由现有 `locr-box-front.png` 缩小为180×270的正面仓库缩略图，没有新增下载素材。
