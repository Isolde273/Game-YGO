# LOCR 模板与闪膜微调 · 2026-10-08

本轮以已接受的 v15 为基础。参考视频前十秒每 5 帧的 61 张画面已在本轮前段复核，见 `test-results/mirror-v12/reference-stabilized/`；本记录承接同一轮，不另以文字结论代替看图。

## 实际卡池

只使用日版 LOCR。卡表来源：<https://yugioh-starlight.com/archives/59735218.html>，官方商品页：<https://www.yugioh-card.com/japan/products/locr/>。

| 展示工艺 | 怪兽 | 魔法 | 陷阱 |
| --- | --- | --- | --- |
| SR | JP048 应战的 G | JP076 原石的皇脉 | JP078 欢迎拉比林斯 |
| UR | JP015 四天之龙 暗叛逆超量龙 | JP003 龙·引导的呼笛 | JP009 真红恶魔链 |
| SER | JP045 白银之城的召使 阿里安娜 | JP076 原石的皇脉 | JP078 欢迎拉比林斯 |
| UL | JP045 白银之城的召使 阿里安娜 | JP076 原石的皇脉 | JP078 欢迎拉比林斯 |
| CR | JP048 应战的 G | JP069 守墓的刻印 | JP077 异次元栅栏 |
| PSER 通常卡框 | JP045 白银之城的召使 阿里安娜 | JP076 原石的皇脉 | JP078 欢迎拉比林斯 |
| GMR | JP015 | JP003 | JP009 |
| UR 出框 | JP015 | JP003 | JP009 |
| PSER 出框 | JP015 | JP003 | JP009 |

以上九种展示组合恰好都有三类实卡，因此输出 27 个模板。OF 是版式，不是额外罕贵度。清单保存 `style`、`cardType`、`set` 与来源字段；生成器逐个检查选卡的可用工艺，测试另从存档卡表解析校验，不生成所有卡和罕贵度的笛卡尔积。

`finish-references/clean-trap.jpg` 是之前下载的盒外 SR13 资料，本轮未使用，也未输出到模板。

## 实现

- `src/scene/material-finishes.js`：横纹按物理卡面比例匹配竖纹宽度，保留平滑宽窄变化；亮纹包络随光源缓慢位移，细刻纹保持卡膜坐标；新增独立的标题区域图标闪膜，保留文字明暗细节。
- `scripts/prepare-material-samples.py`：按真实 LOCR 卡种生成标题、属性、等级／阶级、魔陷种类图标遮罩；三张 UR-OF 均全卡覆盖闪膜。新增 6 张常规卡底和两套独立 OF 构图。
- `public/material-review/`：新增怪兽／魔法／陷阱筛选；工艺概览保持原九张样卡；列表、对比、点击与导出按筛选结果计算。
- 卡图来源为独立插图，与对应 Cardrush 日版实卡照片配准；各图片旁的 `.url.txt` 记录来源。JP003／009 的变换存于本目录 `of003-registration.json`、`of009-registration.json`。
- JP009 出框没有完整内卡图框，不生成该内框；JP003 只保留主体未遮挡的可见内框。原 JP015 的主体遮挡与注册布局保持不变。

这些是工艺展示用的重建底图，非工厂分色文件。新出框标题及部分外侧底纹仍使用实卡扫描信息；GMR 魔法／陷阱的主体沿用同卡 OF 构图，外沿参考各自 GMR 照片。它们适合检查卡种、构图和动态闪膜，但细字与背景去反光仍存在扫描素材的精度限制。序号 `001/100` 为展示值。

## 验证

- `python tests/material-templates.py`：27 个真实卡池组合、标题及图标遮罩、UR-OF 全卡膜。
- `python tests/material-calibration.py`：27 张卡底边框／编号注册、PSER 中性边缘与内框遮挡。
- `python tests/material-overframe.py`：9 张 OF/GMR 主体与实卡匹配，中位位移约 0.49–0.83 像素。
- `material-optics`：横竖中位可见宽度 12 / 14 像素；光源 120° 扫描时可测竖纹移动约 19–22 像素，横纹约 12 像素；静止画面不漂移；361 个细步光照帧及多角度色谱验证通过。
- `material-details`：27 张卡名与圆形图标的实际渲染光照响应，以及三张 UR-OF 的边缘和效果栏闪膜响应。
- `material-flash`、`material-review`：闪光响应、三类筛选、27 张样卡、对比／旋转／缩放、离线加载、导出、390px 布局。
- `npm run check`、`npm run format:check` 通过。

主要输出：`test-results/foil-template-update/`，常规光学报告：`test-results/material-review/`。
本轮修改源码与工艺预览，未更新绿色版。
