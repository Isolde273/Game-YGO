# 卡牌价格、单卡市场与打工进度 · 2026-10-10

## 最新：购买支持历史最高资金三倍贷款

新存档字段`maxCoins`保留最高正资金，购买后可贷到`-3 × maxCoins`，包装与单卡共用规则；超出则显示“实在贷不动了”。打工、仓库出售、桌面整堆出售都支持负资金与最高记录更新；花钱不会缩减最高记录。新开局峰值500，下限-1500。旧档无峰值时以当前资金和500中的较高值初始化，无法追溯未保存的历史峰值。现有328项价格、LOSP包72及音效规则保持。

新增`src/game/wallet.js`，接入模型、单卡交易、出售和打工；负资金保存/重载/导出/导入保留峰值。贷款验证报告在 `test-results/loan-wallet-20261010/`，市场与出售回归沿用既有报告目录。具体命令见 `DEVELOPMENT.md`。

98单测、源码/格式检查、浏览器 `loan-wallet user-card-prices sales-workflow`及断网EXE贷款验证通过。绿色版已更新，实际导出和导入保留-1500/最高500；偿债后最高750、下限-2250也通过。五个运行模块哈希一致，完成核对为 `test-results/loan-wallet-20261010/completion-audit.json`。

## 此前：LOSP特别包售价导入

用户已填写 `outputs/card-prices-20261010/LOSP特别包售价填写表.xlsx`。十项LOSP超框PSER分别为：JP011=156、JP012=25、JP013=60、JP014=49、JP015=27、JP016=50、JP017=100、JP018=82、JP019=38、JP020=312。已核对规格ID、卡名、工艺、版本和金额，以“用户定价”导入；318项LOCR及18项UR-OF价格保持不变，当前328项全部有报价，排除列表为空。以下十项LOSP排除说明保留为本次导入前历史。

`outputs/card-prices-20261010/inspect-losp-filled.mjs`只读特别包Excel，并与前次LOCR审计及当前生产价格核对，输出 `losp-merged-user-prices.csv`、`losp-filled-prices-audit.json`。用 `node scripts/import-card-prices.mjs outputs/card-prices-20261010/losp-merged-user-prices.csv --source=user [--check]`核对/导入，不使用零价排除。两个用户工作簿均不改写。

特别包 `PRODUCTS.bonus.price` 为72，淘盒新增特别包商品，订单识别LOSP；购买、仓库单售和批售都读取同一配置。LOSP单卡进入急换社目录，并用于仓库出售、整理售价及桌面整堆出售。

本轮验证记录位于 `test-results/losp-card2-20261010/`，备份位于 `D:/Game-YGO-backups/20261010-losp-card2`。`user-card-prices`读取新的合并审计，逐项核对并实际买卖328规格，覆盖LOSP搜索与购买、72/包与两包144结账/批售、特别包开卡堆整理售价/整堆出售及重载。

93项单元测试、源码/格式检查、浏览器价格/音效/紧凑页面/购买转场通过，已查看特别包上架及390px LOSP目录。绿色版已更新，实际EXE断网价格与音效验证通过，两个报告均`passed=true`且错误为空。五个运行模块及card2资源与绿色版哈希一致，用户特别包工作簿与备份一致。桌面价格测试显式显示并聚焦隔离窗口，避免隐藏窗口造成截图等待超时。完整核对见 `test-results/losp-card2-20261010/completion-audit.json`。

## 此前：LOCR用户售价表已导入并更新绿色版

用户已填完 `outputs/card-prices-20261010/卡牌售价填写表.xlsx`。读取两张工作表共328行，318项LOCR规格价格均有效，没有缺项、重复项或卡名错配。来源为用户填写的售价，不应标为已核实的集换社集换价。

用户说明0元表示该卡盒没有对应规格。本表的10项0元全部为 `LOSP-JP011-PSER-OF` 至 `LOSP-JP020-PSER-OF`，现已从单卡市场及报价范围排除，不提供免费交易；赠包卡数据和已有库存保留。之前将这10项加入本次填写范围有误。UR-OF的18项价格由用户逐项重新填写，现已按精确规格采用这些价格，不继承普通UR默认价。例如LOCR-JP001普通UR为1，UR-OF为180。用户的工作簿和价格数值保持原样；原表“UR价格同时适用于普通版和超框版”的说明及UR-OF默认价依据已失效。

核对记录：`outputs/card-prices-20261010/filled-prices-audit.json`；转换后的CSV及完整导入审计也在同目录。重新读取最新Excel后，以 `--source=user --exclude-zero`导入，`src/generated/jihuanshe-prices.js`包含318项价格和10项 `excludedPrintIds`，来源为“用户定价”。购买、仓库出售、整理页和桌面右键整堆出售共用同一报价。顺带修复购买后背景资金数字未立即更新的问题。

本轮验证：93项单元测试通过；`user-card-prices`对生产报价逐项核对，并实际买卖全部318项，浏览器检查全部分页价格、普通UR/UR-OF独立结账、高价GMR编号入仓、混合批量出售、整理售价、右键整堆出售及重载恢复；市场、出售、购买手机和打工回归通过。桌面和390px价格显示已查看，源码与格式检查通过。已执行 `npm run portable`，实际EXE在断网和隔离存档下通过同一生产报价验证，`desktop.json`的 `passed=true`，错误为空；5个运行关键模块与绿色版哈希一致，用户工作簿与备份哈希一致。测试记录在 `test-results/user-card-prices-20261010/`，备份为 `D:/Game-YGO-backups/20261010-user-card-prices`。

当前单卡价格采用用户售价表。LOCR盒325、箱7999、包22；购买页打工每次300、冷却5秒。以下0/328、接口受阻及未完成集换价目标段落保留为导入前历史记录。

## 市场管线开发记录（导入前）

- `src/game/model.js`：购买价格改为箱7999、盒325、包22；旧档兼容新增 `workReadyAt`。
- `src/game/work.js`：打工300，5秒冷却，重复触发与金额上限拒绝，冷却存档持久化。
- `src/app.js`、`src/ui/pages/shop.js`、`src/ui/styles/shop.css`：购买手机桌面的打工按钮与倒计时，同步手机及背景金额；切换应用后继续倒计时，到截止时间恢复按钮。OO整箱价格改为读取统一产品配置。
- 已建立328规格清单（LOCR 318、LOSP vol.2 10）：`research/jihuanshe-prices-20261010/card-price-template.csv`，保留卡号、罕贵度、工艺和超框版本；价格为空，未填估价。
- `scripts/import-card-prices.mjs`：检查精确规格、重复项、卡号/罕贵度/工艺/超框一致性、价格及核对时间。仅全部328规格有价格才生成 `src/generated/jihuanshe-prices.js`；不完整输入只写审计报告并失败退出。
- `src/game/card-prices.js`、`money.js`：统一读取精确规格报价，金额以整数分运算（最多两位小数）；缺价返回null，不使用估价或旧100单卡价格。
- `src/game/card-market.js`、`src/ui/pages/shop.js`：急换社目录展示全部328规格，每页20项；支持名称/卡号、罕贵度、卡牌类别与价格排序。普通卡入仓；GMR购买避开持有和封装预留编号，编号或资金不足整单拒绝。
- `src/game/sales.js`、出售区、整理页、桌面右键：卡牌使用同一报价，混合订单和卡堆总价逐规格累加；箱7999、盒325、包22，特别包维持100。缺价卡牌显示“—”并禁用买卖。无效数量和金额溢出不在渲染中抛错，也不改变库存。
- 出售区的怪兽/魔法/陷阱筛选与物品类型、罕贵度、搜索共同生效，切换时清空选择；全选跳过缺价项。仓库“罕贵度优先”使用罕贵度排序，避免新价格改变这个功能。
- 新增界面没有装饰性说明；去掉手机重复的SHOP字样、整箱聊天“今天”和侧栏“本机存档”。功能性规格、数量、价格、操作与倒计时保留。

## 此前集换价来源状态（历史）

官方站点和Pro站点可读取，但卡价接口 `https://api.jihuanshe.com/api/market/card-versions?keyword=LOCR` 返回 `MARKET_PERMISSION_DENY` / “抱歉，无权限操作”；另一卡牌接口返回 `encrypted request required`。证据在 `research/jihuanshe-prices-20261010/access-check.json` 与 `endpoint-2.json`。没有取得可核对的集换价；当前覆盖为0/328，审计见 `price-import-report.json`。

已向用户请求可访问的卡价链接或已有价格表的本地路径，问题待答。不得将其他网站售价、估价、旧100售价、视频价格或无版本价格冒充集换价。

正常浏览器访问官方主页及公开H5入口仅看到下载APP/打开APP，没有公开价格列表。没有绕过接口权限限制。生产数据 `src/generated/jihuanshe-prices.js` 仍是空entries；测试夹具只存在于隔离测试进程/页面，不写入源码、玩家档案或绿色版。

2026-10-10 05:35再次复查：官方同一接口仍返回 `MARKET_PERMISSION_DENY` / “抱歉，无权限操作”，新证据为 `access-recheck.json`。公开搜索精确组合“LOCR”“集换价”只显示一般卡价讨论，无具体版本价格表，见 `public-search-check.json`。空模板再次核对仍为0/328，导入被正确拒绝。完成审计见 `completion-audit.json`：产品价格和打工已验证；真实报价与可购买全部单卡不完整，源码和绿色版仍匹配已有验证哈希。

相同的价格来源阻碍持续多个目标轮次。交易管线、导入和绿色版已经完成，当前没有能独立推进的剩余开发工作；下一步须取得可访问的卡价来源或用户价格表（卡号、罕贵度/具体版本、集换价），目标受阻，不得标记完成。

## 此前集换价目标未完成部分（历史）

1. 获取并逐规格核对集换价，保留来源和核对时间，再用导入脚本验证完整覆盖。
2. 取得可核对的价格表后运行导入脚本；保留来源与核对时间，确认全部328项覆盖。
3. 使用真实报价复查显示、购买、单卡/整堆出售以及存档恢复，重新打包并验证绿色版。当前测试仅验证逻辑，不能作为真实报价证据。

当前全部单卡规格已经展示，报价与交易管线已经接通，但所有单卡报价仍缺失，生产环境单卡买卖暂不可用。真实集换价目标尚未完成，不能标记complete。

## 市场管线原验证与备份（历史）

92项单元测试通过，包括金额精度、混合订单原子性、GMR预留与耗尽、缺价保护及导入数据错配。浏览器 `card-market`、`sales-workflow`、`work-purchase`、`purchase-overlay`、`compact-pages`、`interfaces-layout`、`persona-ui`、`room-clarity-market` 全部通过。检查328项分页覆盖、筛选/空结果/光标、不同单价购买与出售、整理选卡同步及卡堆报价；查看390px市场截图，筛选分页可见且无横向溢出。源码153文件/368引用、全卡来源与格式检查通过。

打工报告在 `test-results/market-prices-work-20261010/`；新市场报告在 `test-results/card-market-pipeline-20261010/`；出售报告在 `test-results/sale-card-type-20261010/`。市场与出售测试均明确使用合成报价，仅用于验证交易行为。备份为 `D:/Game-YGO-backups/20261010-card-market-pipeline`；更新绿色版后运行 `YGO_MARKET_DESKTOP=1 node tests/card-market.mjs`、`YGO_SALES_DESKTOP=1 node tests/sales-workflow.mjs`、`YGO_WORK_DESKTOP=1 node tests/work-purchase.mjs`。仅对应desktop报告passed=true可确认断网EXE验证通过。

本轮绿色版已更新，三个实际EXE断网测试全部通过，报告分别为 `card-market-pipeline-20261010/desktop.json`、`sale-card-type-20261010/desktop-sales.json`、`market-prices-work-20261010/desktop-work.json`。14个关键模块与绿色版逐文件哈希一致；更新打包时也已校验完整文件副本。未覆盖或修改实际玩家存档。
