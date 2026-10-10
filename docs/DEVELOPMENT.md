# 开发、验证与更新绿色版

## 两个启动入口

- **玩游戏**：双击根目录 `启动游戏.cmd`。它启动 `portable/游戏王开盒模拟器/` 中的打包副本。
- **修改界面**：双击 `预览源码.cmd`，或执行 `npm run dev`，在浏览器打开 `http://127.0.0.1:5173`。修改源码后刷新页面。

`npm run check` 和兼容保留的 `npm run build` 只做检查。**更新绿色版须执行 `npm run portable`**，然后退出旧游戏窗口再启动。代码位置先查 [PROJECT-LAYOUT.md](PROJECT-LAYOUT.md)。

## 独立游玩版输出

开发目录保持在`D:/Game-YGO`。供其他玩家使用的纯游玩版输出到`D:/游戏王实卡开盒模拟器`，直接双击`游戏王实卡开盒模拟器.exe`；程序窗口标题采用可执行文件名称，存档继续使用`%APPDATA%/YGO-Duel-Archive`。发行目录只包含游戏程序、运行库、语言资源、必要许可证及`resources/app.asar`；不放开发文档、验证记录、构建命令、测试存档或工艺审查页。运行内容封装为ASAR，内部应用元数据只保留运行入口及版本。

更新此游玩版：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1 -OutputDirectory "D:/游戏王实卡开盒模拟器" -ApplicationName "游戏王实卡开盒模拟器" -PlayerRelease`。打包仍逐文件验证当前源码；可复用默认绿色版或输出目录的Electron运行时，并使用固定版本`@electron/asar@4.3.1`封装资源。默认`npm run portable`及开发目录的启动脚本继续更新原`portable/游戏王开盒模拟器`。旧开发文档及未封装副本保存在开发目录的`test-results/package-history`，不会留在发行目录。本轮备份为`D:/Game-YGO-backups/20261010-play-version-export`，验证报告为`test-results/play-version-export-20261010/`。

实际ASAR游玩版已用独立存档断网验证：中文EXE与窗口名、三维场景/拆封、全部入口、整理拿取/换序/入仓、收藏册、全屏、刷新及程序重启后存档恢复、退出关闭均通过。`YGO_DESKTOP_ROOT="D:/游戏王实卡开盒模拟器" node tests/desktop-smoke.mjs`可复验；该测试先核对当前新开局资金与物品种类，再使用明确的库存夹具做拆封流程，等待准备阶段创建飞行层后检查转场。测试记录、截图、个人存档及开发说明均不写入发行目录。

## 2026-10-10 最新：缩短GMR编号梯形

编号黑框由上边160/下边176像素缩短为上边92/下边100像素，仅包住001/100文字和少量边距，右侧仍向下外倾。编号位置、22px字形、4倍字模及实际身份不变；真实材质、备用SVG和静态底图采用同一轮廓。GMR旧底图已烘焙长矩形，因此`generate-card-data.mjs`从同卡UR-OF素材恢复原编号区域的印刷底色，擦除普通卡密码并绘制短梯形，重新生成18张GMR空编号底图；缩短后不会残留黑色尾巴。恢复只在旧编号矩形内进行，其他工艺公式不变。

备份为`D:/Game-YGO-backups/20261010-gmr-short-plaque`，验证目录为`test-results/gmr-short-plaque-20261010/`。`gmr-numbering`覆盖001/023/037/088/100与空编号共36种灯光画面，确认字形可读、背景暗色及多余黑框消失；与前版shader对照的编号区域外差异为0。`gmr-detail-number`继续检查实际仓库详情入口和库存守恒。

源码/格式检查、全328规格`game-finishes`及上述两项针对性验证通过；已目视核对短编号框和真实详情。两个游玩版及ZIP均已更新，两个EXE隔离档案断网的36组编号/灯光检查和实际详情验证通过。审计确认运行文件与18张底图在源码/绿色版/ASAR一致，shader仅改变编号边界，字模库保持原哈希；所有底图在编辑矩形周围JPEG块之外逐像素一致。ZIP的22个运行文件逐文件SHA256校验通过，未加入开发资料，见`completion-audit.json`、`audit.log`和`zip.log`。

## 此前：GMR详情与仓库编号接入修复

用户截图中的LOCR-JP002详情右侧显示001/100，但卡面为空黑框：详情只给`finishAttributes`传规格ID，未传`numberedCards`里的实体编号；仓库缩略图和预览有同一遗漏。详情现在读取实际持有记录，仓库按规格选择最小可用编号，排除收藏册、收藏暂存及待整理卡堆中的身份；两个详情按钮传递当前仓库预览编号。备用SVG在真实工艺就绪前显示，之后由画布内的真实编号接替。未持有的预览不伪造编号，存档、库存、梯形、字体、膜纹和光位公式均不变。

备份为`D:/Game-YGO-backups/20261010-gmr-detail-number`，记录在`test-results/gmr-detail-number-20261010/`。新增`npm run test:ui -- gmr-detail-number`通过实际仓库两处详情入口验证截图同款001/100、001入册/002待整理时仓库037/100、真实画布数字像素、备用SVG隐藏、普通卡和库存守恒；无持有记录的详情模板另确认不伪造编号。用`YGO_DETAIL_DESKTOP_ROOT`指定任一打包目录可断网复验，测试始终使用隔离档案；`YGO_DETAIL_OUTPUT`可指定报告路径。

源码检查、格式检查及`game-finishes collection-workflow sales-workflow gmr-detail-number`回归通过；已目视核对源码和实际游玩版详情及编号局部。默认绿色版和纯游玩版均已更新，两个EXE隔离存档断网的针对性验证通过。审计确认四个运行文件在源码/绿色版/ASAR逐字节一致，两份工艺材质与本轮前版哈希相同；发行仍为22个文件，不包含开发目录。发送ZIP已更新且22个条目逐文件SHA256一致，完成记录见`completion-audit.json`及`zip.log`。

## 此前：收藏册清理与GMR梯形编号框

收藏册卡面删除右下角罕贵角标，册页上方删除“100页·每页6格”及“已用/600卡位”说明。页码、拖放区域、库存数量及100页600格容量保持原规则。

GMR左下角编号底板改为右侧向下外倾的黑色梯形，真实材质与备用SVG使用同一轮廓；保持原编号位置、四倍字模及001–100的实际身份。新轮廓覆盖原矩形底图，并仅在右侧新增斜边，避免边角残留矩形；编号范围从卡面像素(29,812)延伸至下边(205,840)。只修改编号局部裁切，镜碎膜、刻纹和光位公式没有变化。

备份为`D:/Game-YGO-backups/20261010-album-gmr-trapezoid`，记录在`test-results/album-gmr-trapezoid-20261010/`。`gmr-numbering`支持`YGO_SERIAL_OUTPUT`指定报告、`YGO_SERIAL_BASELINE`指定前版材质及`YGO_SERIAL_DESKTOP_ROOT`指定断网EXE；验证编号、暗色底板、斜边与编号区域外像素一致性。收藏册回归在跳页前等待当前转场结束、提交后等待目标册页及预渲染副本清理，避免读取隐藏准备页或在不可交互阶段提交。

源码全328规格工艺、收藏册100页/拖放/触摸/库存守恒、九条放卡连续性路径、桌面及窄屏入场动画、九类批绘像素检查和卡牌数据检查通过。两个实际EXE断网的36组编号/灯光检查通过，编号区域外对前版最大像素差均为0；已查看清理后的收藏册及实际游玩版037/100梯形框高清局部。源码/格式检查通过，绿色版、纯游玩版与发送ZIP已更新，压缩包逐文件校验通过。测试使用隔离档案，不访问真实玩家存档。

## 此前：集换店名称与Master Duel程序图标

购买手机桌面的单卡交易入口及应用标题由“急换社”改为“集换店”，原有`jhs`标识、筛选和交易保持不变。`public/assets/application-icon.ico`提取自用户指定的`D:/Netease/steam/steamapps/common/Yu-Gi-Oh!  Master Duel/masterduel.exe`，保留16、24、32、48、64、96、128、192、256像素九种尺寸；源游戏EXE不修改。桌面窗口使用此ICO，EXE内嵌图标由打包脚本调用`scripts/apply-executable-icon.mjs`自动更新。

图标工具通过固定开发依赖`resedit@3.1.0`编辑PE资源，逐项核对所有非图标资源及非资源段字节不变，验证新图标一致后原子替换EXE；再次打包时一致则跳过。旧EXE自动备份到开发目录`test-results/package-history`，依赖、脚本及验证资料不进入纯游玩版。默认绿色版、独立游玩版及发送用ZIP一并更新。本轮修改前备份为`D:/Game-YGO-backups/20261010-shop-name-masterduel-icon`，验证记录在`test-results/shop-name-masterduel-icon-20261010/`，使用隔离存档，不访问实际玩家存档。

源码/格式检查、购买浮层现有回归及两个EXE的断网名称/原生图标加载检查通过。九份内嵌图标资源与Master Duel原始数据逐字节一致，程序非资源段及卡膜/整理/打工逻辑保持原哈希；发送ZIP的22个文件全部校验通过。已查看程序图标并排图、购买手机桌面及集换店页；完成记录见本轮`completion-audit.json`。

## 此前：纯游玩版无损体积优化

`scripts/package.ps1 -PlayerRelease`在打包临时副本中执行`scripts/optimize-player-assets.mjs`，原始资源不变。仅当无损WebP更小，且解码后的RGBA每个像素、ICC配置、方向与尺寸完全一致时才转换；原生窗口图标保留PNG。当前转换231张，保留361张PNG；静态资源路径同步更新。ASAR自动共享重复文件的数据偏移，保留原资产名。发行副本去掉已内嵌的重复GLB文件和未使用的其他语言包，保留简体中文、繁体中文和英文运行语言。卡膜着色器、卡牌工艺、打工及整理逻辑不变。

解压后占用由441.42MiB降至392.26MiB，减少49.16MiB；同算法ZIP由258.99MiB降至243.43MiB，减少15.56MiB。发送用文件为`D:/游戏王实卡开盒模拟器.zip`，包含同名外层文件夹；解压后直接双击同名EXE。重建并逐文件核对ZIP：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-player-zip.ps1 -GameDirectory "D:/游戏王实卡开盒模拟器"`。加`-BeforeRoot "D:/Game-YGO-backups/20261010-player-size-lossless/player-before"`可复用并校验旧包基线，报告保存在开发目录。

本轮备份为`D:/Game-YGO-backups/20261010-player-size-lossless`，资源、体积与最终验证记录在`test-results/player-size-lossless-20261010/`。发行目录只含22个运行文件，不包含开发文档、测试或个人存档；运行文件和转换后的引用由完成审计校验，断网EXE使用隔离存档覆盖拆封、整理拿取/换序/入仓、收藏册、全屏及重启恢复。进一步体积评估应区分Electron运行时与游戏资源，不以有损图片压缩换取容量。

## 此前：打工1秒冷却与摊开后拿取

打工收入保持500，冷却由2秒改为1秒；金额、倒计时及无障碍提示继续读取共同配置。已有存档记录的冷却截止时间保留，新时长从下一次打工开始生效。

整理卡牌恢复为进入及摊开期间不可操作，摊开结束后解除`inert`并聚焦界面，再允许拿取、换序和分配。440ms摊开、八分之一首绘、实时工艺刷新、可见更新与后台补绘分开调度均保留。`inspector-early-pickup`已按最新要求调整：在摊开0%、50%、100%但尚未完成交接时验证鼠标和直接事件不能拿取，交接后验证正常拖放、后排遮挡、分配及可见工艺连续性。

本轮备份为`D:/Game-YGO-backups/20261010-work1s-pickup-after-spread`，报告为`test-results/work1s-pickup-after-spread-20261010/`。`work.test.mjs`及`work-purchase`覆盖1秒冷却边界、重复领取拒绝、重载与切换应用保持冷却。

8项打工/钱包单元检查及源码打工、拿取限制、整理操作/分配/转场检查通过；更新绿色版后，隔离存档断网EXE的打工及拿取限制检查也通过。摊开交接可见工艺最大平均像素差：源码约0.000132、EXE约0.000099；两者后台补绘前后差均为0。已检查手机1s提示与整理页截图。格式、源码引用及绿色版一致性检查通过，实际玩家存档未访问。

## 此前：440ms摊开、提前拿取与光位交接连续

摊开时长由220ms改为440ms。完整首卡及后排八分之一准备好、进入阶段开始时即可交互，不再等全部摊开；加载阶段仍保持不可交互。提前拿取立即将飞行快照交给真实卡牌，隐藏旧快照并解除卡堆淡入，剩余卡继续摊开。按下时立即固定卡牌当前位置，不随卡堆滑走；移动中的覆盖卡实时参与抽离判定，临时分组内的卡牌查询、移出首卡后补全新首卡及显式换序也已适配。展开分组移除无效的transform提示，避免提前拿取的fixed坐标被错误解释成分组内坐标。

隐藏右侧补绘与可见卡面更新拆成独立作业。此前补绘占用同一卡牌的更新机会，保留准备时光位，导致可见窄条在补绘期间迟迟不响应新光位；现在可见部分持续使用当前光位，隐藏部分以相同当前光位按原131072像素预算补绘。不改变工艺shader、膜坐标、曝光或闪光强度。

新增`inspector-early-pickup`，使用60张真实PSER，覆盖完全重合时拿取、拿住后剩余卡继续摊开、提前入仓只补全新首卡、后排遮挡/抽离，以及固定光位下摊开终点和隐藏补绘前后的可见像素连续性。`YGO_EARLY_DESKTOP=1`验证隔离档案断网EXE；`YGO_EARLY_BASELINE_RENDER=1`只替换为本轮备份的旧渲染器，确认旧补绘调度无法同时更新可见部分；该对照预期失败，记录保留。源码检查的摊开交接最大平均像素差约0.000066、隐藏补绘前后差为0。正常速度工艺采样仍由`inspector-spread-finishes`覆盖九类工艺，固定光位测试与像素读取不作为玩家帧率数据。

本轮备份在`D:/Game-YGO-backups/20261010-spread440-early-pickup`，报告在`test-results/spread440-early-pickup-20261010/`。源码转场、操作、并行分配及就绪遮挡回归通过；预算检查仍保留每帧上限与退出隐藏卡堆零绘制。实际光位可在提前交互时就跟随指针，避免从不可交互切为可交互时集中变化。

提前按下时同时补全紧邻下层卡，避免拿走首卡后露出未完成工艺的右侧。普通摊开仍只刷新已准备的八分之一；提前拿取或分配实际露出更多区域时，立即绘制新露出的部分。

最终绿色版已重新打包，并使用隔离档案在断网EXE中通过提前拿取、九类正常速度工艺、实际爆闪光位响应、窗口缩放/取消进入/关闭动画及补绘预算检查。EXE摊开交接最大平均像素差约0.000199，隐藏补绘前后为0；60张卡分98块补全，每帧隐藏补绘最大130728像素，连续三次退出隐藏卡堆绘制均为0。已查看源码及EXE的提前拿取与摊开完成截图，下层工艺完整、后排遮挡正常。源码/格式检查通过，运行文件及文档与绿色版逐项校验，见本轮`completion-audit.json`。实际玩家存档未访问。

## 此前：摊开期间持续绘制工艺

整理页的实时工艺原本由`getAnimations()`返回的动画轨道决定是否持续更新；继承的CSS展开进度一旦没有被识别，卡面会保留准备阶段的位置/光位，直到其他事件或展开结束才更新。本轮以`data-phase="entering"`明确管理实时绘制周期，每帧使实际卡位/膜轴缓存失效并更新当前可见卡面。已准备卡牌在此阶段不等待IntersectionObserver重新确认可见性；进入/交接的phase变化立即触发刷新。原有八分之一准备、两端位置测量、被遮挡右侧延迟补绘及退出隐藏卡堆停绘仍保留。没有修改工艺shader、强度、纹理、刻纹坐标或灯光模型。

`inspector-spread-finishes`增加`YGO_SPREAD_UNREPORTED=1`，只从渲染器查询中隐藏继承属性轨道，实际摊开仍正常运行；旧版仅5次首卡刷新，修复后约99次连续刷新。`YGO_SPREAD_NORMAL=1`使用实际220ms动画，在进入期间采样卡面的缩略像素及位置，检查结束前已有变化；采样时间不作为性能证据。`YGO_SPREAD_STYLE`指定SR/UR/SER/UL/CR/PSER/UR-OF/PSER-OF/GMR，`YGO_SPREAD_OUTPUT`指定目录；九类源码正常速度检查均通过。备份为`D:/Game-YGO-backups/20261010-spread-flash-continuity`，当前记录在`test-results/spread-flash-continuity-20261010/`。

本机旧EXE在正常轨道检测下仍有更新，漏报模拟用于确认调度缺口及连续刷新，而不是宣称所有旧版环境都能直接复现。新版断网实际EXE九类正常速度检查、漏报时的前/后卡变化和爆闪幅值检查通过。源码的转场/取消/缩放、货币隐藏与首卡交接、拿取遮挡及预算检查通过；实际EXE预算检查仍只有1张全卡和59张八分之一首绘，补全右侧单帧最多130728像素，三次退出的隐藏卡堆绘制均为0。已核对源码及实际EXE摊开前段/后段画面。源码/格式检查通过，绿色版已更新；shader保持前版哈希，完成记录见`completion-audit.json`。

## 此前：打工500与2秒冷却

手机桌面打工每次增加500，冷却2秒。按钮金额、倒计时、无障碍提示和历史记录共用实际配置；连续触发、重载与切换手机应用仍遵守存档中的冷却截止时间。新规则从下一次打工开始生效，已经记录的截止时间保留。`work.test.mjs`及`wallet.test.mjs`验证冷却边界、收入与贷款峰值；`work-purchase`和`loan-wallet`检查实际金额、提示、持久化、贷款与手机布局。当前打工报告在`test-results/work500-2s-20261010/`，备份为`D:/Game-YGO-backups/20261010-work500-2s`。

8项相关单元测试、浏览器打工/贷款、断网实际EXE打工流程及源码/格式检查通过。已查看+500与2s倒计时的手机界面，绿色版已更新。贷款回归初次执行发现开盒资金提示仍用旧预期2250，更新为2850后通过；失败日志保留。运行文件与文档的绿色版一致性记录见`completion-audit.json`。

## 此前：完全重叠入场、左侧八分之一与逐步补绘

整理页先呈现完全重合的一叠卡，只能看见完整首卡，再使用一个共同进度向右摊开；最左侧锚点固定。取消原六组各自带小扇面的起点。后排卡首次只绘制左侧八分之一（按2像素采样网格对齐），窄屏步距同时收紧，整个摊开过程不露出未完成的右侧。首卡优先准备与实时飞行交接仍保留。共同进度的基础值保持终点，完成轨道取消时不会重新收拢。

后排右侧在进入完成后逐步补绘，每帧最多处理两张、总计不超过131072像素，分块边界与原采样网格对齐。拿取、换序、分配和移走前卡仍即时补全即将露出的卡面。退出阶段停止绘制隐藏的卡堆，飞回桌面的首卡继续实时更新。摊开中只测量两端图片并插值得到后排位置，所有卡沿相同横向进度移动且共用膜轴；飞行和拖动继续独立测量。此轮未修改工艺着色器、膜坐标、纹理、曝光或光位公式。

源码回归覆盖完全重合起点、单向摊开、五个进度的实际DOM位置与灯光位置计算、交接/售价隐藏、窄屏、缩放/取消、即时拿取与遮挡、九类工艺拼接和并行分配。`inspector-entry-budget`使用60张不同规格，连续三次进入/退出，并单独等待全部右侧补绘完成；无像素读取，报告每帧/分块预算及边界连续性。`YGO_BUDGET_DESKTOP=1`验证隔离档案的断网EXE，`YGO_BUDGET_BASELINE=1`使用本轮备份/旧EXE作对照，`YGO_BUDGET_VARIANT`指定报告名称。

记录在`test-results/inspector-eighths-20261010/`，备份为`D:/Game-YGO-backups/20261010-inspector-eighths`。首次实际绘制2275722像素，占完整60张卡的14.0%；旧六分之一方案2943720像素，占18.1%，首次面积减少约22.7%。浏览器逐步补绘样本165个分块、约977ms完成，单帧最多130832像素，边界连续。正常速度实际点击样本约28ms反馈、102ms首卡出现、1458ms整堆可操作，记录到一次50ms长任务。性能采样有波动，不据此宣称消除全部卡顿；读取像素和放慢动画的工艺检查不作为帧率证据。

绿色版已更新，断网实际EXE的正常/关闭动画交接、八分之一就绪、抽离前遮挡、首卡和后排实时摊开、正常画面及爆闪幅值检查通过。实际EXE正常速度点击样本约34ms反馈、96ms首卡出现、1467ms整堆可操作，有一次67ms长任务；关闭动画约33ms反馈、1101ms可操作。右侧补绘样本99个分块、约582ms完成，单帧最多130728像素，60张全部完成，三次退出隐藏卡堆绘制均为0。已查看源码完全重合/摊开中段及实际EXE首卡等待/摊开中段画面。爆闪诊断最初沿用旧飞行距离的20%–70%采样，短距离入场的碎闪平均变化0.426低于原0.5断言；改为覆盖5%–90%的飞行路段后，浏览器及EXE均通过原阈值，未修改shader或降低阈值。失败记录保留。源码与格式检查通过，运行文件及文档和绿色版哈希在`completion-audit.json`。

## 此前：摊开时首卡残影与实时工艺

### 后续：按位移核对爆闪与飞行卡修复

用户指出移动没有体现灯光位置差异，本轮单独测量主亮纹、横纹及闪点的角度幅值，排除只变色/漫反射以及曝光饱和导致的误判。固定屏幕光位时，已有的摊开和拖动路径会改变主纹及闪点强度；复现漏更新的是首卡飞入/返回：`inspector-motion.js`只复制工艺画布，移除卡牌身份并标为静态快照，`card-finishes.js`因而完全跳过，卡牌虽移动，爆闪像素保持原样。

现在飞行卡首帧沿用已准备的完整画布，同时保留真实印刷规格/编号和`data-finish-surface="sorting"`，复用同一个整理灯光、工艺库和WebGL渲染器更新反光。`card-finishes.js`识别这个位于整理容器外的飞行表面。保留六分之一准备、首卡优先、快照淡出防残影及遮挡；未改动着色器、膜坐标、爆闪强度、曝光或光位公式。备份：`D:/Game-YGO-backups/20261010-flash-position`。

新增`tests/inspector-flash-position.mjs`：60张PSER实际界面，覆盖飞入、摊开、固定灯光拿取及返回；静止不随时间变化，返回相同位置的像素完全复现。诊断模式仅在测试编译时输出原shader的`blaze`、`secondary`、`sparkle`幅值，直接检查闪点变亮/变暗，不将RGB变色当成爆闪。`YGO_FLASH_DIAGNOSTIC=1`启用，`YGO_FLASH_DESKTOP=1`使用断网EXE隔离档，`YGO_FLASH_BASELINE=1`检查旧版，`YGO_FLASH_VARIANT`指定报告名。记录在`test-results/inspector-flash-position-20261010/`。`inspector-entry-handoff`改为检查完整飞行表面及真实身份；`inspector-transitions`明确把异步准备后创建的淡出轨道停在交接前，避免把不同起点的局部动画时间混为同一时钟，淡出完成后的残影断言仍保留。

浏览器的正常画面、爆闪幅值、进入交接、实时摊开、转场/窄屏/取消、并行路由、九种工艺拼接、就绪/遮挡、328规格工艺及纹理预热验证通过。转场脚本原来的局部时间混用先后导致两次首卡透明度断言失败，修正采样时钟后通过；产品动画时长与淡出规则未改变。断网实际EXE的旧版对照确认飞入/返回爆闪差值为0，新版两种模式及进入、关闭动画、实时摊开验证通过。已核对实际EXE正常速度的摊开中段、以及放慢诊断的飞行与拿取画面；飞行诊断为测量而暂停淡出，截图中的交叠不代表正常速度的重影。60张不同规格正常速度点击样本约49ms反馈、143ms完整首卡出现、1548ms整堆可操作，提前售价和主线程长任务均为0；关闭动画约63ms反馈、1066ms可操作。仅为本机样本，未宣称整堆加载时间大幅降低。源码/格式检查通过，绿色版已同步；哈希与完整报告快照见本轮`completion-audit.json`。

用户发现向右摊开时，首卡的旧外观留在收拢位置直到动画结束，移动中的工艺没有变化。复现确认两处原因：`motion-player.js`取消已经淡出的快照动画后，露出了`opacity: 1`的基础样式；`card-finishes.js`则跳过整个`entering`阶段。现在快照基础样式在交接后保持零透明度，淡出完成即持续隐藏，首卡只由真正移动的节点展示。

工艺渲染恢复进入阶段的实时更新，继续用卡牌当前位置计算相对光位。临时分组内的后排卡按整堆顺序查找后续遮挡，只绘制露出的左侧窄条；抽离/换序沿用完整绘制流程。窄窗口的采样余量不扩大已准备的六分之一边界；进入完成后仍按预算补绘右侧。本次只修复动画交接和绘制调度，没有改动工艺着色器、纹理、刻纹坐标或照明模型。

新增`inspector-spread-finishes`使用60张PSER，放慢摊开轨道而让首卡淡出正常结束，检查实际淡出清理、前/后卡像素随移动变化，以及后排绘制宽度不超过六分之一、只有1张完整卡。旧版两次采样的快照透明度均为1，前/后卡像素完全相同，进入阶段绘制为0；修复后快照为0，前卡与后卡像素均变化。另加390px/4张卡的窄窗口验证，`inspector-transitions`补充淡出完成后的真实清理断言。报告在`test-results/inspector-spread-live-20261010/`，设置`YGO_SPREAD_DESKTOP=1`检查隔离存档断网EXE，`YGO_SPREAD_NARROW=1`检查浏览器窄屏，`YGO_SPREAD_VARIANT`指定报告名；`YGO_SPREAD_BASELINE=1`记录旧版。备份为`D:/Game-YGO-backups/20261010-spread-live-finishes`。

浏览器的实时摊开、390px、交接、就绪/遮挡、转场、操作、并行路由、拖动性能、九种工艺拼接、预热与房间资源验证通过；断网EXE的实时摊开、交接、关闭动画、就绪/遮挡及并行路由通过。桌面拖动初次采样有一次超时，增加事件诊断后两次串行就绪/抽离验证通过，记录在就绪报告中。已核对旧版重影和新版实际EXE展开前后画面。正常速度的60张不同规格断网点击样本约55ms反馈、148ms完整首卡飞入、1387ms整堆可操作，售价提前显示和主线程长任务均为0；关闭动画也没有整理轨道。实时闪光功能测试放慢摊开并读取像素，其时长和绘制次数不作为玩家帧率。绿色版已更新，源码/格式及打包哈希检查通过；完整审计见本轮`completion-audit.json`。

## 此前：向右摊开与左侧六分之一首绘

整理页沿用点击后立即进入界面过渡、完整首卡先飞入的交接修复。后排卡的首次绘制改为左侧六分之一，仍按2像素对齐；进入动画结束后每帧最多补绘两张右侧。拿取、换序、分配及前卡移走时，继续优先完整绘制即将露出的卡面，后排拖卡在抽离前保持遮挡。

卡堆从左向右摊开：首卡飞到左侧收拢位置，交接后各组向右展开，最左侧位置固定。最多六组使用相同时间轴，后一组始终遮住前一组未绘制的右侧，间隙不超过原卡槽步距；窄窗口步距不超过卡面宽度六分之一。临时分组在进入完成、退出或销毁时解除，恢复原卡牌节点与顺序；加载中缩放会重新计算收拢位置。没有修改工艺着色器、纹理或膜坐标。

60张混合卡、1440×900/DPR1.5验证：进入时1张完整、59张六分之一，首绘2943720像素，完整绘制16303680像素，约18.1%（原三分之一为34.4%）。`inspector-transitions`在0/25/50/75/100%五个进度检查向右移动、固定左边缘和全部未绘制后缀遮挡，仍保持17条界面/飞行/展开总轨道及仅合成属性；九种工艺的首绘与补绘拼接、裁切和缩放像素对照通过。报告分别在`test-results/inspector-sixths-20261010/`、`test-results/inspector-transitions/`；本次展开前快照取自已核对的绿色版，保存在`D:/Game-YGO-backups/20261010-inspector-sixth-spread`。最终绿色版响应数据和完整验证审计见`test-results/inspector-entry-handoff-20261010/completion-audit.json`。

最终断网EXE、1440×900、60张不同规格首次点击样本：约55ms出现界面反馈，153ms首卡开始飞入，1462ms整堆可操作；旧版对应909ms和1485ms。新版货币提前显示为0、主线程长任务为0。关闭动画样本约54ms反馈、1254ms可操作，整理动画为0。整堆准备仍有耗时，界面和完整首卡先回应点击；这些为本机样本，像素读取验证的`maxFrame`包含测试开销。浏览器九项回归通过，缩短摊开时长及平滑时间曲线后重跑`inspector-transitions inspector-entry-handoff`通过；最终绿色版的交接、关闭动画、就绪/遮挡和并行路由均通过。新增实际EXE展开中段截图与中途Esc退出检查，临时分组无残留；桌面测试统一原生窗口内容尺寸与测试视口，使用隔离存档。

## 此前：桌面卡堆点击响应与提前显示的货币图标

沿`启动游戏.cmd`指向的实际绿色版EXE复现：点击未预热的60张不同卡面卡堆后，整个整理转场原先等待准备完成；售价节点的内联`visibility: visible`又覆盖了隐藏父容器的状态，导致桌面先露出售价和货币图标。售价现在继承卡牌说明区域的可见性，空卡堆继续保留占位；隐藏准备容器同时使用零透明度，避免子节点越过隐藏状态。

整理页新增`loading`阶段：点击后立即播放背景、标题与两侧面板的过渡，卡堆、说明和售价保持隐藏且不可操作。`card-finishes.js`优先解码、上传并完整绘制最前卡，通过`onFirstReady`释放首卡飞入；其他卡按批次继续准备左侧约三分之一，上传沿用每帧4个/约8ms的预算。首卡的完整工艺快照一直保留到所有露出片段准备好，再展开卡堆、显示说明及售价，进入后按原流程补绘右侧。准备与飞入并行，膜坐标、着色器和工艺外观保持原样。

涉及`src/ui/card-inspector.js`、`src/ui/motion/inspector-motion.js`、`src/ui/card-finishes.js`、`src/ui/styles/world3d.css`及`src/app.js`的准备回调连接；`src/scene/world3d.js`同时处理`loading`阶段的取消及连续Esc。关闭准备中的整理页会立即移除过渡和恢复桌面卡堆，异步准备完成后不再重新打开。

本机1440×900、断网EXE、两个桌面卡堆（启动预热另一堆）的实际画布点击：首个可见过渡909→55ms，修复后完整首卡约149ms开始飞入，整堆可操作1485→1377ms。旧版记录91帧提前显示售价，新版为0；两版均没有主线程长任务。这次响应统计覆盖可见画面，资源准备时间另以整堆就绪统计，单机样本不代表所有设备耗时。

新增`tests/inspector-entry-handoff.mjs`验证真实画布命中、60张不同规格、首次点击响应与售价不提前显示；人为暂停首卡或后排卡解码，验证完整首卡保持、隐藏卡堆/售价以及连续Esc取消。使用`YGO_HANDOFF_DESKTOP=1`检查断网EXE，`YGO_HANDOFF_VARIANT`指定报告名；`YGO_HANDOFF_BASELINE=1`只记录旧版问题。性能脚本补充`loading`阶段统计。

浏览器回归命令：`npm run test:ui -- inspector-entry-handoff card-finish-prewarming opening-inspector-readiness inspector-actions inspector-routing inspector-transitions inspector-drag-performance card-finish-batch room-sorting-resources`。上述回归、源码/格式检查及断网EXE的交接、就绪、整理路由均通过，绿色版已更新；已核对旧版桌面孤立售价、新版等待/完整卡堆与首卡工艺画面。报告和审计在`test-results/inspector-entry-handoff-20261010/`，备份为`D:/Game-YGO-backups/20261010-inspector-entry-handoff`。测试使用隔离存档。

关闭动画或使用系统减少动态效果时，界面和准备好的完整首卡直接显示，后排就绪后再展开，等待期间同样不显示售价。设置`YGO_HANDOFF_REDUCED=1`验证关闭动画的交接；此模式没有整理动画，并沿用相同的取消和资源检查。

## 此前：整理页首次进入的纹理上传卡顿

首次进入60张不同卡面的卡堆时，原先在六张一批的绘制中同步上传纹理，造成多次57–72ms主线程长任务。`src/ui/card-finishes.js`现在每帧开始加载4种印刷规格，并通过共享队列预上传纹理：每帧最多4个纹理，累计约8ms后让出下一帧；单个上传超过预算时不继续本帧的下一项。按纹理及版本去重，进入前等待上传队列，再执行原来的局部绘制。原有最前卡完整、后卡左侧约三分之一及后台右侧补绘流程保留，着色器与工艺外观未修改。

`src/ui/card-finish-batch.js`预编译使用独立材质保留程序，完成后清空纹理引用；异步编译等待由本模块管理，释放渲染器时可结束等待，避免替换预热卡堆或立即退出时留下未完成的准备任务。取消的纹理请求不再上传，释放时结束队列中的等待并清空资源。

本机断网EXE、1440×900、60张不同规格的首次进入对照：准备阶段最长帧93.5→33.4ms，超过50ms的帧8→0，主线程长任务7→0；从点击到开始进场780→703ms，到可操作1415→1348ms。新版三次进入都没有主线程长任务。进场动画仍有一帧约51ms，此测量用于验证上传阻塞，不能代表所有设备的恒定帧率。`opening-inspector-readiness`会读取60张画布像素，它的`maxFrame`包含测试自身开销，不作为本轮性能数据。

新增`tests/inspector-entry-performance.mjs`，不读取画布像素；设置`YGO_ENTRY_DESKTOP=1`验证隔离存档、断网EXE，`YGO_ENTRY_UNIQUE=1`使用60张不同规格，`YGO_ENTRY_VARIANT`指定报告名。`tests/card-finish-prewarming.mjs`验证实际纹理上传每帧不超过4次、重复预热不重传、替换卡堆及编译/上传过程中释放资源均结束等待。验证命令：`npm run test:ui -- card-finish-prewarming opening-inspector-readiness inspector-actions inspector-routing inspector-transitions inspector-drag-performance card-finish-batch room-sorting-resources`。

报告、审计及最终截图在`test-results/inspector-entry-stutter-20261010/`，本轮备份为`D:/Game-YGO-backups/20261010-inspector-entry-stutter`。源码、格式、浏览器回归及断网EXE就绪/路由验证通过，绿色版已更新。

## 此前：整理卡牌先绘制左侧三分之一

整理页首次准备改为完整绘制最前卡，其余卡只绘制左侧约三分之一；边界按2像素对齐，保留原片段导数网格。进场结束后每帧补绘最多2张卡的右侧，已有左侧像素保留。补绘让位于拖动和动画；提前拿取、置前、分配动画或移走前卡时，通过同步完整绘制优先准备将要露出的卡面，避免空白右侧进入画面。缩放、退出和移除卡牌沿用资源失效与释放流程。

涉及`src/ui/card-finishes.js`的分段准备和补绘队列、`card-finish-batch.js`的横向裁切与原位置拷贝，以及`src/app.js`、`src/scene/world3d.js`和`src/ui/card-inspector.js`的交互优先补齐连接。工艺着色器、纹理和膜坐标保持原样。

60张混合卡、1440×900/DPR1.5验证：进场时1张完整、59张左侧三分之一，首次绘制5615712像素，整堆完整绘制为16303680像素，首次约34.4%；后续右侧全部补齐。九种工艺的左右拼接与完整绘制对照：编号区外差异0，补绘右侧时左侧差异0，奇数尺寸单张右侧差异0；GMR字模沿用原重复渲染噪声的平均误差检验。

验证命令：`npm run test:ui -- opening-inspector-readiness card-finish-batch inspector-actions inspector-routing inspector-transitions inspector-drag-performance room-sorting-resources`。就绪测试新增初始覆盖宽度、透明后缀、提前拿取补齐及后台最终完成检查，默认报告目录改为`test-results/inspector-thirds-20261010/`，可用`YGO_READINESS_OUTPUT`指定；`YGO_READINESS_DESKTOP=1`验证断网EXE。备份为`D:/Game-YGO-backups/20261010-inspector-thirds`。

上述浏览器回归、源码与格式检查通过；绿色版已更新，断网EXE的就绪和整理路由验证通过。EXE同样记录1张完整、59张局部，提前拿取的卡面已补齐。后台补绘完成后另排一帧刷新露出区域，接收补绘期间发生的灯光变化。已核对浏览器和EXE卡堆及抽离画面；审计与报告在本轮目录。

## 此前：拆包响应、整理预渲染与后排遮挡

本轮确认运行入口的差异：绿色版仍使用等待全部卡面纹理后才开始撕包、整理进场时才绘制工艺，以及拖动立即置顶的旧逻辑。已接续并验证源码中的修正：撕包先开始，仅抽出卡牌等待工艺资源；整理页保持隐藏和不可交互，完整卡面准备好后才开始进场；后排卡拖动保持原层级，完全离开前方卡牌的覆盖区域后才抬到最前。

进一步调整 `src/ui/card-finishes.js`：按印刷规格和实体编号去重预热，完整卡面每批准备6张，保留原着色器、纹理、膜坐标及光位；单张工艺资源失败时保留原卡面回退，其余卡继续准备，退出后的异步准备不再创建资源。`src/scene/world3d.js` 在卡堆落下的动画阶段开始预热整理工艺，并拦截取消准备后的短时间重复Esc，避免同时退回主界面。

新增 `tests/opening-inspector-readiness.mjs` 验证60张混合卡堆进场前全部工艺就绪、后排重叠区域的实际命中遮挡、完全抽离后的置顶和回移，以及人为延迟700ms纹理请求时仍先撕包。设置 `YGO_READINESS_DESKTOP=1` 检查断网绿色版，`YGO_READINESS_VARIANT`指定报告前缀；仅测量历史版本时可设`YGO_READINESS_BASELINE=1`。原转场测试改为等待准备完成后的进场阶段再截取动画；开封连续性按实际动画时长逐帧检查，仍覆盖撕开、抽出、归拢和原顶卡交接。

同尺寸1440×900的断网EXE单次对照：旧版进场工艺就绪0/60、最长帧约512ms；新版进场前60/60就绪、最长帧约62ms，隐藏准备约381ms。浏览器DPR1.5的60张卡准备等待由本轮开始时约1234ms降至约720–785ms。以上为本机测试样本，包含资源准备，不代表恒定帧率或所有设备的耗时。

报告和缩放截图位于 `test-results/opening-inspector-20261010/`，源码接续前备份为 `D:/Game-YGO-backups/20261010-opening-inspector`；打包前的旧应用保留在 `test-results/package-history/`。相关回归：`opening-inspector-readiness inspector-actions inspector-routing inspector-transitions inspector-drag-performance card-finish-batch opening-continuity bulk-opening room-sorting-resources`；绿色版使用隔离存档验证，不修改玩家存档。

上述浏览器回归、101项单元测试、源码与格式检查均通过。绿色版已更新，断网EXE的`opening-inspector-readiness`、`inspector-routing`、`opening-continuity`和`bulk-opening`通过；已查看EXE重叠遮挡和完整抽离画面。最终浏览器延迟纹理测试实际延迟12次请求700ms，约74ms开始撕包；此次人为延迟不计入正常开封耗时对照。

## 此前：开卡空间与整理页性能

`src/ui/card-finish-batch.js`每个图集只提交一次场景；各卡仍独立绘制和裁切，保留原膜坐标、片段着色器、纹理、光位和曝光。提交后清空复用材质的uniform引用，避免离屏或释放卡牌后仍占有纹理。单卡直接拷贝路径和约419万像素图集上限保持。`card-finishes.js`在拖动光位锁定时跳过重复的卡牌边界读取，卡牌相对灯光的反光仍实时更新。

`src/scene/world3d.js`将合拢卡堆的逻辑空节点移出渲染树，保留实体、投影位置、碰撞体和顶卡身份；动画卡牌沿用真实场景节点。`packages3d.js`仅裁减普通封包不可见的两层内膜索引，外表面顶点/UV、镂空孔壁和开封完整四层膜保持；特别包保留完整封装几何及阴影。

同条件前后交替三次采样的中位数：6堆×60张、64包、1920×1080/DPR1.5固定分辨率，场景节点471→111、三角面363688→288424、绘制调用85→81，平均帧间隔62.29→59.66ms；50张PSER、1440×900/DPR1.5鼠标光位更新36.48→33.68ms。24帧的场景提交1200→24，但卡牌GPU绘制仍为1200次。90次拖动边界读取90→0，拖动平均8.67→8.61ms、p95约18.8→18.7ms，未宣称拖动帧率大幅增长。

实际应用动态分辨率的三次交替采样：缩放平均38.87→37.18ms、p95 76.4→69.5ms；开封期间平均10.05→9.60ms、p95 34.7→27.8ms。两版缩放和开封质量均为1，静止时均停止绘制和物理tick；开封采样包含静止间隙。上述浏览器数据用于同条件比较，不是玩家恒定FPS。

验证：`npm run test:ui -- card-finish-batch inspector-drag-performance room-sorting-resources inspector-actions inspector-routing inspector-transitions inspector-performance opening-continuity room-workflow bulk-opening collection-workflow`。九种工艺的稳定/裁切/resize像素差异均为0，GMR原有重复渲染噪声另按平均误差验证；复用材质完成提交后保留uniform数为0。普通/特别封包16组姿态对照的包装表面无超过2级变化，平放视图和特别包完全一致；普通包立放仅有少量阴影边缘差异，整图通道平均误差低于0.001。

报告汇总在`test-results/room-sorting-performance-20261010/`，备份为`D:/Game-YGO-backups/20261010-room-sorting-performance`。固定分辨率脚本为`tests/room-render-profile.mjs`；设`YGO_PROFILE_BASELINE=1`对照本轮备份，`YGO_PERF_VARIANT`指定报告名。动态流程使用`tests/room-performance.mjs`，同样支持基线与报告名，另用`YGO_PERF_OUTPUT`指定目录。整理脚本设`YGO_PERF_BASELINE=1`、`YGO_PERF_BASELINE_ROOT`对照备份。各GPU测量必须串行运行。绿色版及最终证据见本轮`completion-audit.json`。

绿色版已更新；断网EXE的`YGO_INSPECTOR_DESKTOP=1 node tests/inspector-routing.mjs`与`YGO_BULK_DESKTOP=1 node tests/bulk-opening.mjs`通过，使用隔离存档，覆盖并行拖放/换序/退出、整盒60张和10包开封、全部入仓、贷款提示及重载。已查看本轮EXE整理并行飞行和开封恢复画面。完成审计记录运行文件哈希、报告副本与测量限制。

## 此前：可见贷款浮层与批量开盒/开包

资金悬浮改用游戏内浮层，文字为“可贷款：数字”，保持历史最高资金三倍的总额度。主页及各页面顶部、开盒HUD生效，购买手机和订单没有提示；购买打开、页面切换、移开鼠标时浮层隐藏，资金记录变化后读取最新额度。`src/ui/loan-tooltip.js`负责事件及固定定位，避免原生提示无法实际显示和窄屏裁切。

卡盒右键新增“全部打开”：先检查卡垫位置，再一次提交拆盒及全15包的60张既定卡牌，然后自动播放拆盒与整叠拆包动画。中途离开/重载保留完整结果，不留下需要再点击的封包。普通“打开卡盒”仍保留15包。`openBoxFully()`与普通批量开包共用发牌事务，失败不部分消耗；存档每堆上限由50改为60，支持整盒卡堆。卡包右键新增“打开10包”，选择当前包及同类最近九包，少于十包禁用；原“撕开1包”改为“打开1包”，5包操作与快捷键保留。

`npm run test:ui -- bulk-opening loan-wallet opening-continuity room-workflow purchase-overlay`检查实际悬浮及390px布局、购买排除、整盒/10包/5包/1包、60张全部入仓、中途离开重载，以及原拆封动画和购买背景保持。设置 `YGO_BULK_DESKTOP=1`运行 `node tests/bulk-opening.mjs`，设置 `YGO_LOAN_DESKTOP=1`运行 `node tests/loan-wallet.mjs`，均使用断网EXE与隔离存档。当前报告在 `test-results/tooltip-bulk-open-20261010/`（贷款报告在`loan/`）；备份在 `D:/Game-YGO-backups/20261010-tooltip-bulk-open`。

101项单元测试、上述浏览器回归及源码/格式检查通过；绿色版已更新，断网EXE的批量开封与贷款浮层验证均通过，报告错误为空。已查看实际浮层和右键菜单，九个改动运行文件与绿色版哈希一致，完成审计在当前报告目录的`completion-audit.json`。

## 此前：原生资金悬浮提示（已由游戏内浮层替代）

主页/各页顶部、开盒空间、购买手机桌面和订单中的当前资金均使用原生悬浮提示“最多可贷款：数字”。数值是历史最高资金的三倍（贷款下限的绝对值），借款后仍显示总额度；打工和出售更新峰值时，已有页面的提示同步更新。商品价格不附带贷款提示。开盒资金区域恢复接收鼠标悬浮，布局不变。

`npm run test:ui -- loan-wallet`在原贷款回归中检查各资金位置的提示、负资金显示总额度、出售增长额度及手机打开时打工同步刷新背景页。当前报告目录为 `test-results/loan-hover-20261010/`，设置 `YGO_LOAN_DESKTOP=1`运行 `node tests/loan-wallet.mjs`验证断网绿色版。备份在 `D:/Game-YGO-backups/20261010-loan-hover`。

浏览器及断网EXE回归、5项资金单元测试、源码/离线引用和格式检查通过；绿色版已更新。

## 2026-10-10 历史最高资金的三倍贷款

`src/game/wallet.js`统一处理有符号资金，存档字段`maxCoins`记录历史最高正资金。购买后的资金可等于`-3 × maxCoins`，低于下限则显示“实在贷不动了”，不扣款、不发货，也不改最高记录；包装和单卡采用同一规则。打工、仓库出售与桌面整堆出售支持偿还负资金，超过最高记录才扩大额度。价格/订单金额仍沿用原非负整数分校验，资金单独支持负数，正资金上限仍为1e12。

新开局/重置为资金500、最高500，下限-1500。旧档没有历史最高记录，以当前资金和500中较高值初始化；无法恢复此前未记录的峰值。负资金导出、导入及重载保留峰值，缺少峰值的负数存档、非法峰值或低于下限的资金拒绝。存档版本保持4，字段向旧正资金档兼容。

`npm test`覆盖贷款边界和越界一分、原子拒绝、偿债/新最高、负资金存档、旧档兼容及金额上限。`npm run test:ui -- loan-wallet user-card-prices sales-workflow`检查实际购买、精确错误提示、资金负数显示、导出/导入/重载、偿债与额度增长，以及原328规格报价和出售功能。设置 `YGO_LOAN_DESKTOP=1`运行 `node tests/loan-wallet.mjs`验证断网EXE。报告在 `test-results/loan-wallet-20261010/`，备份为 `D:/Game-YGO-backups/20261010-loan-wallet`。桌面导出由隔离测试会话指定到报告目录，不写玩家下载目录。

98项单元测试、源码/格式检查、上述三个浏览器回归和实际EXE断网贷款流程全部通过；已查看超限提示和负资金显示。绿色版已更新，五个改动运行模块与源码哈希一致，完成记录在同目录 `completion-audit.json`。

## 此前：音效统一减半，默认50%

`src/ui/sounds.js`所有事件的播放系数统一乘0.5，点击/页签、主入口悬浮、进入页面、购买成功和card2都生效；音量滑块及实时调整沿用该系数。相同设置下，播放增益为上一版的50%。`src/game/model.js`新开局和存档缺省值的`settings.volume`改为50，重置采用同一配置，二级设置页据此显示50%。已有存档的有效自定义音量不改写。

`npm test`覆盖新开局/缺省50、自定义音量保留，以及异步首播、减半增益、实时调节和静音。`npm run test:ui -- sound-interactions`实际验证全部音效的增益、二级页50%默认显示与25%调整、卡牌路径及静音；设 `YGO_AUDIO_DESKTOP=1`后执行同名脚本验证断网EXE。默认报告目录为 `test-results/half-sound-default50-20261010`，备份为 `D:/Game-YGO-backups/20261010-half-sound-default50`。以下增益0.7、卡牌2/3为减半前历史数值。

93项单元测试、源码/格式检查、浏览器和实际EXE断网音效回归均通过。默认50%二级页已查看，绿色版已更新，模型与音效模块哈希一致。包装拖动测试在选取后等待当前位置可命中且动画结束，再重新定位，避免物品变化造成拖动漏选；未改变游戏包装行为。完成记录见同目录 `completion-audit.json`。

## 此前：点击统一使用09音效

`src/ui/sounds.js`将所有`click`事件映射到现有`tab`样本（用户源 `09_item_tab_switch.wav`），按钮、商品选择、设置点击及默认调用都统一替换。原14资源不加载、不播放，保留归档；点击增益仍为0.7，没有播放间隔，页签和点击共享解码缓存。卡牌仍使用card2，背景音乐/返回/退出及包装操作保持静音。

验证使用 `node --test tests/sound-playback.test.mjs`、`npm run check`、`npm run test:ui -- sound-interactions`。实际播放记录应只有五个活动音频样本，点击和页签记录均为tab。打包后设置 `YGO_AUDIO_DESKTOP=1`、`YGO_AUDIO_OUTPUT=test-results/click-tab-sound-20261010`运行 `node tests/sound-interactions.mjs`验证断网EXE。报告在同目录，备份为 `D:/Game-YGO-backups/20261010-click-tab-sound`。以下旧点击14映射及五个P3R样本说明均为历史。

以上单元、源码/格式、浏览器和断网EXE音效检查均通过。已更新绿色版，音效模块与源码哈希一致，09源文件、项目资源和绿色版资源哈希一致；完成记录为 `test-results/click-tab-sound-20261010/completion-audit.json`。

## 此前：LOSP价格与卡片互动2

LOSP特别包Excel的十项报价已经并入用户价格数据，当前328规格有价，LOCR原318项及UR-OF独立价格不变。特别包72，淘盒可购买，仓库单售/批售共用该价。详情与导入命令见 `MARKET-PRICES-PROGRESS.md`。卡片互动1停止预加载和播放，所有卡牌操作及收藏册翻页统一使用 `card-2.wav`；增益仍为设置音量的2/3，无播放间隔。其他五个P3R样本继续使用，背景音乐、返回和退出音保持关闭。

`npm run test:ui -- user-card-prices sound-interactions compact-pages purchase-overlay`验证生产328项报价、特别包购买/出售72、LOSP整理/整堆出售和重载、六个活动音频样本以及页面布局。桌面分别设置 `YGO_USER_PRICES_DESKTOP=1` / `YGO_AUDIO_DESKTOP=1`运行对应脚本；音效报告设 `YGO_AUDIO_OUTPUT=test-results/losp-card2-20261010/audio`。价格报告在 `test-results/losp-card2-20261010/prices`。以下随机card1/2与LOSP排除说明均为历史。

上述浏览器与断网EXE回归、93项单元测试和源码/格式检查全部通过；绿色版已更新，五个运行模块及card2音频哈希一致，填写的LOSP工作簿未被改写。完成审计见 `test-results/losp-card2-20261010/completion-audit.json`。

## 此前：取消背景音乐、返回音与新开局

游戏不再创建背景音乐播放器，主页音乐按钮和设置中的背景音乐/音量项已移除。旧存档的`music`和`musicVolume`只保留兼容，即使为开启也不会播放。统一音效映射取消`back`，返回、Esc、收起手机、关闭整理页/筛选、退出等路径均静音，且不预加载返回样本；其余五个P3R样本与随机卡片互动1/2保持现有音量和播放规则。

`freshState()`现为500、三盒LOCR与一包特别包，含真实封装数据；设置“重置进度”采用同一配置，不额外提供整箱或散包。已有存档正常读取。旧开封/交易回归使用`tests/helpers/starter-state.mjs`明确提供其所需物品和资金，实际新开局由模型单测及`background-disabled`检查，避免回归夹具依赖玩家赠品。

`npm run test:ui -- background-music sound-interactions compact-pages interfaces-layout`检查旧档音乐关闭、音乐控件消失、各返回与退出静音、新开局/重置/重载、原有音效及响应式布局。`background-music`入口现在执行`background-disabled`；设置`YGO_AUDIO_DESKTOP=1`后分别运行两个音效脚本可验证断网EXE。报告在`test-results/no-music-return-sound-20261010/`，本轮备份为`D:/Game-YGO-backups/20261010-no-music-return-sound`。以下背景音乐和返回音段落保留为历史说明，以本段为准。

本轮93项单元测试、浏览器上述四项回归、源码与格式检查通过；已更新绿色版，断网EXE的音乐取消/返回静音/新开局重置和完整音效回归通过。两个桌面报告均`passed=true`，错误为空。音效拖动验证在选取后重新读取包装投影点，再检查实际持有状态，避免物理位置更新导致测试使用过期坐标。

## 2026-10-10 SR与UTR工艺

SR的反光只保留在卡图窗口；卡名、属性/星级/类别图标和其他印刷区域没有箔膜闪光。UL显示为UTR，仍使用原存档规格ID；UTR外缘和卡图框采用PSER的银底彩框，保留原浮雕，框内不加入镜碎/钻面反光。图鉴、审查和游戏共用 `src/scene/material-finishes.js`。

`npm run test:ui -- sr-utr-finishes material-review game-finishes card-integration`检查42个SR、21个UTR、前版像素对照、名称、库存/存档与全328规格渲染。断网EXE验证分别设置 `YGO_FINISH_TWEAK_DESKTOP=1` / `YGO_FINISH_DESKTOP=1` 后运行对应脚本。备份、光学数据和对照图见 `docs/CARD-FINISHES.md`；测试始终使用隔离档案。

## 2026-10-10 最新：用户售价表导入、产品价格与打工

用户填写的售价表已导入：318项LOCR规格逐项对应，18项UR-OF独立定价，不继承普通UR默认价；10项零元LOSP规格按用户说明排除出单卡目录和报价。`src/generated/jihuanshe-prices.js`记录来源“用户定价”、有效价格及 `excludedPrintIds`，`card-prices.js`统一读取，`money.js`以整数分处理交易。购买、仓库出售、整理页和右键整堆出售使用同一价格。缺价或排除规格没有免费交易，已有卡牌和赠包数据保留。完整进度见 `MARKET-PRICES-PROGRESS.md`。

`npm run test:ui -- user-card-prices card-market sales-workflow purchase-overlay work-purchase` 检查当前用户报价、交易、资金同步、布局和恢复。`user-card-prices`直接加载生产报价，与已填表核对全部318项，并逐规格买卖；设 `YGO_USER_PRICES_DESKTOP=1` 后运行 `node tests/user-card-prices.mjs` 验证断网EXE。报告在 `test-results/user-card-prices-20261010/`，所有验证使用隔离存档。`card-market`及`sales-workflow`另用合成价格夹具验证通用交易，不写入生产数据。

用户表通过依赖运行时的 `outputs/card-prices-20261010/inspect-filled.mjs --export-csv`重新读取并转换为精确规格CSV。运行 `node scripts/import-card-prices.mjs outputs/card-prices-20261010/user-card-prices.csv --source=user --exclude-zero --check`核对，去掉`--check`导入。`--exclude-zero`只允许与`--source=user`同时使用，零元明确记录为排除项；其他缺项、重复、未知规格、版本错配、非法金额仍拒绝。默认导入流程继续要求328项正数价格，不把用户售价标为已核实集换价。

LOCR购买价格为整箱7999、卡盒325、单包22；OO商品与订单读取同一配置。手机购买桌面“打工”每次300、冷却5秒，存档字段 `workReadyAt` 持久化冷却；`src/game/work.js` 拒绝冷却中的重复领取，`src/app.js` 更新按钮倒计时及金额，退出手机后不运行倒计时轮询。

`npm run test:ui -- work-purchase purchase-overlay compact-pages` 检查购买标价与扣款、打工、重载、切换应用和布局；设 `YGO_WORK_DESKTOP=1` 后运行 `node tests/work-purchase.mjs` 验证断网EXE。打工历史报告在 `test-results/market-prices-work-20261010/`；当前单卡按用户填写的价格上架。

## 2026-10-10 出售区卡牌类别

2026-10-10 出售区新增“卡牌类别”：全部、怪兽卡、魔法卡、陷阱卡。依据统一卡牌数据的 `cardType` 筛选，可与物品类型、罕贵度和名称/编号搜索共同使用；具体卡牌类别会排除包装物品。切换类别和其他筛选一样清空已选项与数量，全选和批量出售仅作用于筛选结果。`npm run test:ui -- sales-workflow` 覆盖三类真实卡牌、组合筛选、空结果、批量出售及五档布局；设 `YGO_SALES_DESKTOP=1` 后运行 `node tests/sales-workflow.mjs` 验证断网EXE。默认报告为 `test-results/sale-card-type-20261010/`，本轮备份为 `D:/Game-YGO-backups/20261010-sale-card-type`。

## 2026-10-10 P3R交互音效接入

从用户提供的 `01_clean_WAV` 选取六个原文件用于点击、返回、五个主入口悬浮、页面进入、页签切换与购买确认，映射见根目录 `ASSETS.md`。卡牌互动及收藏册翻页每次独立随机使用原 `card-1.wav` / `card-2.wav`，增益保持设置值的三分之二。2026-10-10 最新补充：取消全部音效的300ms触发间隔，连续操作与异步首播均逐次播放；退出后仍禁止迟到播放。开卡空间的整箱、卡盒、卡包选取、拖放与开封继续静音。

设置恢复“交互音效”和“音效音量”；原 `sound` / `volume` 偏好生效。顶部开关仍控制背景音乐，《双子》播放器独立管理。关闭音效时不加载WAV、不创建Web Audio；启用后的首手势解码并缓存八个采样。点击、返回、悬浮、进入、页签、确认的播放增益依次为设置值的0.7、0.7、0.55、0.45、0.7、0.6，降低密集操作的音量。

`npm run test:ui -- sound-interactions background-music compact-pages interfaces-layout purchase-overlay` 验证真实WAV解码与播放、两个随机卡片样本、音量/静音/快速连续触发、包装静音、背景音乐独立循环/跨页/重载和布局。设置 `YGO_AUDIO_DESKTOP=1`，分别运行 `node tests/sound-interactions.mjs` 与 `node tests/background-music.mjs` 验证断网EXE；测试均使用隔离存档。音效报告默认在 `test-results/audio-no-cooldown-20261010/`，背景音乐报告在 `test-results/p3r-ui-sound-20261010/background/`。取消间隔改动的备份为 `D:/Game-YGO-backups/20261010-audio-no-cooldown`。备份为 `D:/Game-YGO-backups/20261010-p3r-original-sounds`。

## 2026-10-10 背景音乐、手机与拆包更新（历史记录）

交互音效全部取消，旧存档的 `sound` / `volume` 字段仅保留兼容，不再触发声音或读取WAV。设置与顶部开关改为“背景音乐”，使用用户提供的 `双子.m4a`，本地资源为 `public/assets/audio/background.m4a`，循环播放并实时调整音量；保留原音乐开关与音量偏好。`src/ui/background-music.js` 管理独立播放器、首手势重试及清理，跨页面不会重启。

手机三个应用删除订单与钱包界面、底栏和路由；保留单卡交易空市场、卡盒/卡包购买与整箱订购。卡包撕线位于圆孔最下沿下方0.027模型单位，真孔属于撕下的顶部膜片；封装与开封共用孔位、分界、UV和法线。卡盒整条开封取包时间轴以1.25倍推进，正常动画总时长由2.4秒降为1.92秒，整箱和单包速度保持原值。俯视角的存档校验同步到当前角度，避免保存缩放后重载被旧角度下限清除。

该轮报告在 `test-results/background-phone-tear-20261010/`。当时的背景音乐与全静音验证现已拆分到 `background-music`；最新交互音效规则见上节。`opening-continuity` 仍验证1.25倍实时时长与15包交接。以下其他音效段落属于历史验证记录。

## 开发环境

安装 Node.js 22.18 或更高版本，在根目录执行 `npm ci`。`package-lock.json` 固定开发工具版本；游戏运行本身仍使用本地静态文件与内置 Three.js / cannon-es。

浏览器测试默认使用已安装的 Microsoft Edge。其他机器可设置 `YGO_BROWSER_CHANNEL`（如 `chrome`），或用 `YGO_BROWSER_PATH` 指定浏览器可执行文件。测试依赖从当前项目的 `node_modules` 读取，不再依赖某个用户的 Codex 缓存路径。

货币金额只显示图标和数字，顶部不再显示持有卡牌计数。全部补给入口已移除，DATA SAVE仅保留已开卡包、导出存档、导入存档和重置进度。旧订单记录的金额单位仅在显示时移除，不改原存档记录。

仓库出售、整堆出售与货币UI：`npm run test:ui -- sales-workflow`。设置 `YGO_SALES_DESKTOP=1` 后执行 `node tests/sales-workflow.mjs` 验证断网绿色版。包含筛选、编号搜索、数量/总价、超量拒绝、批量交易、收藏保护、整堆场景清理、重载、1440/820/640/390/360px布局，以及货币图标和整理页“图标 100”。单位售价由 `src/game/sales.js` 的 `SALE_PRICE` 统一管理，暂为100；编号卡按具体实体出售。交易先整批校验，再修改库存及余额。`npm test` 覆盖交易原子性、编号归属、箱壳清理与连续音效播放。

最新音效已取消触发间隔；原300ms验证报告仅作历史记录。收藏册翻页及卡牌互动使用随机卡片互动1/2，音量为设置值的三分之二；实时调整音量也保持此比例。开卡空间的整箱/卡盒/卡包选取、拖放、碰撞及开封保持静音。`npm run test:ui -- sound-interactions` 检查真实音频解码、播放记录、包装选取/拖放/开封静音、翻页、悬浮范围、音量和静音；设置 `YGO_AUDIO_DESKTOP=1` 验证断网绿色版，设置 `YGO_AUDIO_OUTPUT=test-results/currency-labels-audio-300-20261010` 保存本轮报告。

开封顶卡与包装连续性：`npm run test:ui -- opening-continuity`，设置 `YGO_OPENING_DESKTOP=1` 后执行 `node tests/opening-continuity.mjs` 验证断网绿色版。覆盖选择顺序与物理高度不一致的五包逐帧合拢、单包/五包原卡面交接、15包开盒动画、盒顶标志、OO 与接近垂直的房间视角；输出在 `test-results/opening-fixes-20261009/`。

清晰度与占位卡退役：`npm run test:ui -- room-clarity-market`；设置 `YGO_CLARITY_DESKTOP=1` 后执行 `node tests/room-clarity-market.mjs` 验证断网绿色版。覆盖动态分辨率下限、静止恢复、原存档备份、真实卡牌保留、整理两侧抽象图形、空单卡市场及购买页取消焦点描边；输出在 `test-results/clarity-placeholder-20261009/`。整理大堆测试的 `helpers/sorting-stacks.mjs` 使用真实规格，N 测试档位由 CR 代替。

整理页固定位置与并行操作：`npm run test:ui -- inspector-routing inspector-actions inspector-transitions`；设置 `YGO_INSPECTOR_DESKTOP=1` 后执行 `node tests/inspector-routing.mjs` 验证断网绿色版。覆盖移出前卡后剩余卡坐标不变、动画期间继续拖放/选择/换序、同一目标的重叠飞行、多个动画中退出、批量入仓与重进存档守恒；报告与截图在 `test-results/inspector-routing/`。

整堆直接入仓：`npm run test:ui -- room-direct-storage`；设置 `YGO_STORAGE_DESKTOP=1` 后执行 `node tests/room-direct-storage.mjs` 验证断网绿色版。覆盖拖到桌面仓库纸箱时的投放提示、取消拖动、整堆入仓、其他卡堆/未拆封物品/余额守恒与重进恢复。支持右键点击桌面卡堆选择“全部入仓”，直接收纳该堆；测试同时覆盖菜单取消、卡包右键菜单保留及390/360px下“批量操作卡包和卡堆”提示完整显示。本轮菜单截图/日志在 `test-results/stack-context-storage-20261009/`。五包已改为同步撕开，opening-continuity 同时检查没有剪刀及剪切阶段。

整理拖动性能：`npm run test:ui -- inspector-drag-performance` 使用50张真实PSER卡、1440×900、DPR1.5，测量鼠标经过卡堆与连续拖动；同时比较后排露出区域的裁切渲染和完整渲染像素。报告在 `test-results/direct-opening-storage-20261009/`。渲染只优化更新范围与调度，卡面工艺着色器和纹理保持原样；窗口尺寸变化后先恢复完整卡面再裁切更新。

2026-10-09 开卡与整理性能：`npm run test:ui -- card-finish-batch room-sorting-resources inspector-drag-performance inspector-performance`。批量卡面共用中间画布，单张更新直接拷贝；每张卡保留独立光位，采样网格按2像素对齐，临时图集不超过约419万像素。整理静止卡堆复用布局测量；拖动/动画实时测量，尺寸、滚动和DOM变更后失效。整理页完全打开时暂停房间绘制，物理/开封仍推进，返回后呈现最新状态。卡堆复用碰撞体、逻辑卡节点及未换掉的顶卡；包装实例只上传变动矩阵。

本轮验证日志、像素对照、对象身份与实例上传检查位于 `test-results/room-sorting-performance-20261009/`。批量对照覆盖9类工艺、共享材质的不同光位、分批/裁切/奇数尺寸及单张更新；原GMR字模着色器的少量像素在独立重复渲染中也有差异，另记录字模平均误差，未改着色器。`inspector-performance`使用测试夹具构造300张真实规格卡，避免把真实每包4张规则与旧50张卡堆断言混用。

整理基线可设 `YGO_PERF_BASELINE=1` 和 `YGO_PERF_BASELINE_ROOT`，替换测试加载的整理/工艺模块；本轮备份为 `D:/Game-YGO-backups/20261009-room-sorting-performance`。`YGO_PERF_VARIANT`指定报告名。性能采样应单独运行，使用相同窗口/DPR/卡数；无头浏览器帧间隔不能当成玩家实际FPS。

## 常用命令

2026-10-10 悬浮音与编号UI：悬浮音只由主菜单/页面导航中“开盒、收藏册、仓库、购买、设置”五个入口触发。普通按钮、卡牌/空卡位、桌面物品、右键菜单、手机应用、设置控件、货币、返回与退出全部静音。点击/返回和随机卡片互动音仍保留。`npm run test:ui -- sound-interactions gmr-numbering game-finishes` 验证，音效输出可用 `YGO_AUDIO_OUTPUT` 指定；默认本轮输出 `test-results/hover-serial-20261010/`。`YGO_AUDIO_DESKTOP=1 node tests/sound-interactions.mjs` 检查绿色版。

GMR编号保留原左下角160×28区域，字模改为4倍采样的22px常规Arial，左边距6px、基线22px，使用深色底和柔和灰金刻字响应；编号区域屏蔽原镜碎/厚箔/强清漆反光。收藏册/整理页加载回退用同比例SVG显示相同字形位置。`gmr-numbering` 渲染001/023/037/088/100及无实体编号的分组预览，覆盖36种照明/曝光组合和编号字形/对比度/闪白上限。设置 `YGO_SERIAL_BASELINE=D:/Game-YGO-backups/20261010-hover-serial/src/scene/material-finishes.js` 比较前版shader，要求编号区域之外全部像素一致。本次按用户要求不查看视频或截图。

2026-10-10 最新规则：全部镜碎辅条纹已删除，以下四条/半贯穿辅纹段落仅为历史记录。当前验证使用 `npm run test:ui -- mirror-ridges material-flash material-optics game-finishes`，检查无辅纹专属shader、主纹原有明暗和位移、75%–100%光位粗度、边缘75%粗度及碎闪峰值。默认主纹输出在 `test-results/no-aux-audio-20261010/ridges/`；比较本轮备份时设 `YGO_MIRROR_BASELINE=D:/Game-YGO-backups/20261010-no-aux-audio/src/scene/material-finishes.js`，移动和宽度倍率均为1。

用户提供的五个WAV存于 `public/assets/audio/`，由 `src/ui/sounds.js` 预加载、手势解锁后缓存解码。卡片操作统一传 `card`，每次独立随机选择 `card-1` 或 `card-2`；按钮、返回、悬浮分别为 `click`、`back`、`hover`。环境音乐仍使用原有独立开关。`npm run test:ui -- sound-interactions` 实际解码并记录播放的样本，覆盖册页拖放、入册/取出/入仓、仓库转暂存、整理选择/分配、桌面右键整堆入仓、音量、静音及悬浮子元素去重；设 `YGO_AUDIO_DESKTOP=1` 后运行 `node tests/sound-interactions.mjs` 检查绿色版断网file URL加载。

卡包圆孔采用真正贯穿四层膜的几何孔洞，位置与LOCR包装原图对齐，封装实例和开封模型共用孔位。`npm test` 包含正反向穿孔射线、孔边膜保留及开封/空包姿态检查；`packing-geometry` 和 `opening-continuity` 检查原袋口、层间隙及开封交接。

镜碎辅纹与横主纹持续可见：`npm run test:ui -- mirror-ridges material-flash material-optics`。`mirror-ridges`实际渲染4条辅纹遮罩，检查横竖各1条贯穿/半贯穿、贯穿线位于主纹之间、宽度与端点；1089个光位检查每条只在少数光位激活、同时最多2条、未激活时为0，另检查65光位横主纹持续可见。设`YGO_MIRROR_BASELINE`为前版`material-finishes.js`可额外实际比较主纹2倍位移；本轮使用`D:/Game-YGO-backups/20261009-mirror-four-selective/material-finishes.js`。报告在`test-results/mirror-four-selective-20261009/`，可用`YGO_MIRROR_RIDGES_OUTPUT`/`YGO_MATERIAL_OUTPUT`/`YGO_MATERIAL_OPTICS_OUTPUT`指定输出目录。

最新主纹加粗与右侧竖辅纹验证仍使用上述命令，另加`game-finishes`覆盖全部卡牌规格及游戏界面。测试同时检查贯穿竖辅纹位于最右两道主纹之间。设置`YGO_MIRROR_SPEED_FACTOR`指定相对基线的移动倍率（默认2）；设置`YGO_MIRROR_WIDTH_FACTOR`额外读取实际shader的横竖主纹宽度并比较倍率，同时验证辅纹宽度未变。本轮基线为`D:/Game-YGO-backups/20261009-mirror-main-third/material-finishes.js`，移动倍率1、宽度倍率1.3333333333333333，报告在`test-results/mirror-main-third-20261009/`。

辅纹淡入淡出同样使用`mirror-ridges material-flash material-optics game-finishes`验证。`mirror-ridges`对四条辅纹分别进行281点光位扫掠，检查渐亮/渐暗单调性、明暗端点、峰值及相邻步长；另渲染隔离辅纹经过ACES/sRGB后的亮度，检查峰值两侧都有中间亮度。设置`YGO_MIRROR_FADE_COMPARE=1`及`YGO_MIRROR_BASELINE`可比较前后实际显示的渐变范围。本轮基线为`D:/Game-YGO-backups/20261009-mirror-aux-fade/material-finishes.js`，移动/宽度倍率均为1；默认报告目录更新为`test-results/mirror-aux-fade-20261009/`。

主纹最低闪度为峰值一半：继续使用上述四项验证。`mirror-ridges`额外读取横竖主纹的合成反光系数，覆盖1089光位×5档漫反射照明（5445组合），确认50%下限与100%峰值，包含峰值增益及实际主纹光照乘数，防止下限之后再次衰减。本轮基线`D:/Game-YGO-backups/20261009-mirror-main-half/material-finishes.js`，移动/宽度倍率均为1；默认报告目录为`test-results/mirror-main-half-20261009/`。

最新碎闪、主纹粗度及半贯穿辅纹：`npm run test:ui -- mirror-ridges material-flash material-optics game-finishes`。50%最低闪度规则已由恢复旧下限取代。设`YGO_MIRROR_BASELINE`为`D:/Game-YGO-backups/20261010-mirror-spark-edge-width/material-finishes.js`比较主纹位移与最大粗度；`YGO_MIRROR_SPEED_FACTOR=1`、`YGO_MIRROR_WIDTH_FACTOR=1`（宽度允许最大值的75%–100%）。另设`YGO_MIRROR_RESPONSE_BASELINE=D:/Game-YGO-backups/20261009-mirror-main-half/material-finishes.js`，与50%规则之前的真实shader比较最低响应和最暗光位次数。默认输出`test-results/mirror-spark-edge-width-20261010/`。

`mirror-ridges`额外检查边缘75%粗度、主纹随光位75%–100%粗度、四条辅纹的75%宽度比例及两道原贯穿线变为半贯穿。每个光位扫描9个膜位置，检查任意位置最多激活两条；每条辅纹另扫描71光位×17个沿线位置，确认出现/消失有逐段推进过程。碎闪峰值在完整刻纹/碎闪微面夹具中，以实际反光幅度对比主纹峰值；测试表达式使用`sqrt(dot(v,v))`，避免现有局部`length`变量遮盖GLSL内建函数。不得仅按系数断言取代实际编译/渲染。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 预览当前源码 |
| `npm test` | 游戏模型、排布、碰撞与镜头单元测试 |
| `npm run check` | 语法、模块引用、CSS/HTML 素材引用及启动脚本检查 |
| `npm run cards:generate` / `npm run cards:check` | 从全卡JSON生成离线统一卡牌数据 / 验证生成结果与来源一致 |
| `npm run test:ui` | 自动准备源码服务，运行布局、导航、手机交接、整理、模型入口及完整 UI 流程 |
| `npm run test:ui -- shop-docking` | 单独执行指定浏览器验证；也可跟多个测试名 |
| `npm run test:assets` | 检查 Blender 模型与离线嵌入资源一致性 |
| `npm run format` / `npm run format:check` | 格式化 / 检查自有源码；跳过生成资源、第三方库和历史资料 |
| `npm run portable` | 从当前源码重新生成绿色版应用目录 |
| `npm run test:desktop` | 使用隔离档案验证实际绿色版 EXE |
| `npm run test:cards:desktop` | 验证绿色版全卡规格、旧档备份、GMR编号与重启恢复 |

更新绿色版默认复用当前绿色版里的 Electron 运行时；若是没有绿色版的新目录，执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1 -Runtime "Electron运行时目录"`。打包先准备完整的新应用目录，再替换旧目录，避免留下搬迁前的旧源码。

现有 Python / Blender 资产工具继续使用原命令；仅修改界面时无需重新生成模型或素材。

替换前的绿色版应用目录以及失败时的暂存文件保留在 `test-results/package-history/`，可用于回退或排查。

## 保持外观的整理验证

启动当前源码服务与整理前备份服务（备份端口设为 5174）后执行 `npm run test:preservation`。可用 `YGO_BASELINE_URL` 指定其他备份服务地址。脚本对比相同存档、相同窗口下的页面截图与浏览器解析后的样式，报告保存在 `test-results/project-layout/`。

浏览器测试使用隔离上下文；桌面测试设置 `YGO_SMOKE_USERDATA` 指向 `test-results/`。不要为验证覆盖玩家的实际存档。已有研究截图和阶段性验证记录保留在原目录；归档的旧版哈希审计脚本仅作为历史资料。
