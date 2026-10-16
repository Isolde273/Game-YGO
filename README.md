# 游戏王实卡开盒模拟器

离线拆箱、开包、卡牌收藏与三维桌面交互。

## 直接游玩

- 网页版：[打开游戏](https://Isolde273.github.io/YGO-Real-Card-Box-Simulator/)
- Windows版：[下载最新版本](https://github.com/Isolde273/YGO-Real-Card-Box-Simulator/releases/latest)，解压完整 ZIP 后运行exe。

Windows 版需要保留解压后的完整文件夹。游戏存档保存在本机，不随仓库同步；网页端存档由当前浏览器保存。

## 项目结构

- `src/game/`：卡池、开盒规则、库存、经济与存档。
- `src/scene/`：三维场景、材质与交互。
- `src/ui/`：页面、动画与样式。
- `src/generated/`：卡牌数据与模型数据。
- `src/vendor/`：随项目提供的第三方库及其许可文件。
- `public/`：卡图、音效、字体与场景素材。
- `desktop/`：Electron 入口与本地网页服务。

