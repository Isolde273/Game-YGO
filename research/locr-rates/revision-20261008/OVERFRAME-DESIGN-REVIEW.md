# 出框卡设计检查 · 2026-10-08

用户已确认当前镜碎版本足够完善，工作转向出框卡设计。当前生产膜为 `jp-secret-microcells-v15`；源码与 `test-results/mirror-v16/before-v15/material-finishes.js` 字节一致。v16 的人物遮挡试验仅留在研究目录，没有进入生产卡面。本次为设计检查，未改生产源码或资产。

## 查看范围

- 实拍 `finish-references/clean-of.jpg` 与当前 `UR-OF-front.jpg` 的整卡、右上翼膜/内框、左爪/文字框、右爪/侧框局部。
- 当前 UR-OF、PSER-OF、GMR 各三个旋转姿态，现场重新渲染，共九种状态。
- 查看 `scripts/prepare-material-samples.py` 的构图配准、主体蒙版、内框和周边底图合成关系。

## 结论

主体构图基本准确：头冠向上越过图框，左右爪越过侧框，左下爪接近效果文字框。背景在图框外变暗，雷电延续，主体位于内框之上；卡名、属性、阶级和说明文字仍有独立阅读区域。

需要优先细查右上翼膜与内框交接：当前可见突兀的直角深色边，附近浅蓝底图与框外雷电的衔接偏硬。实拍相同区域受强反光影响，因此不凭这一张照片认定所有差异都属于蒙版错误。次要问题为重绘卡名/阶级星过于规整，和主体、底图印刷细节的质感不完全统一。镜碎主体与背景的反光区分可作为后续独立细节，已接受的基础膜无需继续迭代。

## 验证

`python tests/material-overframe.py` 通过：UR-OF / PSER-OF / GMR 的主体特征位移中位数分别 0.749 / 0.760 / 0.537px；越框特征点分别 7 / 9 / 9 个。此检查证明主要位置、比例和越框轮廓对应，不能证明所有接缝及字体完全一致。

图像及采集脚本：`test-results/overframe-design-review/` 下的 `reference-print.jpg`、`frame-details.jpg`、`card-rotation.jpg`、`capture.mjs`。
