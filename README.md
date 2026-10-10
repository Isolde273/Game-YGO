# 游戏王实卡开盒模拟器

一个离线的游戏王开盒与收藏模拟器，在三维桌面上体验拆箱、拆盒、开包和整理卡牌。

## 功能

- 三维桌面交互：拖动、叠放和拆封卡盒、卡包。
- LOCR 卡池与特别包，包含不同罕贵度和闪卡效果。
- 收藏册、仓库、单卡购买与出售。
- 本地自动存档，支持存档导入和导出。
- 附带卡牌图鉴和卡面工艺审查工具。

## 下载运行

前往 [Releases](https://github.com/Isolde273/Game-YGO/releases) 下载 Windows 便携版 ZIP，完整解压后运行 **游戏王实卡开盒模拟器.exe**。

便携版无需安装 Node.js，可以离线运行。请保留解压后的全部文件。

## 运行源码

安装 Node.js **22.18 或更新版本**，在项目目录执行：

```bash
npm ci
npm run dev
```

浏览器打开 <http://127.0.0.1:5173>。Windows 也可双击 `预览源码.cmd` 启动服务。

```bash
npm test       # 运行单元测试
npm run build # 检查源码与离线资源，不生成安装包
```

桌面打包需要 Electron 运行时，详细步骤见 [开发说明](docs/DEVELOPMENT.md)。

## 项目说明

本项目是非官方模拟器。游戏内规则和价格用于模拟体验；素材来源见 [ASSETS.md](ASSETS.md)，项目结构见 [项目布局](docs/PROJECT-LAYOUT.md)。
