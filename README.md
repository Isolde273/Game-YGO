# 游戏王实卡开盒模拟器

离线拆箱、开包、卡牌收藏与三维桌面交互。本仓库已更新为 2026 年 10 月 16 日提供的「原版」项目，包含完整 JavaScript 源码、卡牌数据与游戏素材。

## 直接游玩

- 网页版：[打开游戏](https://Isolde273.github.io/YGO-Real-Card-Box-Simulator/)
- Windows 绿色版：[下载最新版本](https://github.com/Isolde273/YGO-Real-Card-Box-Simulator/releases/latest)，解压完整 ZIP 后运行 `游戏王实卡开盒模拟器-原版.exe`。

Windows 版需要保留解压后的完整文件夹。游戏存档保存在本机，不随仓库同步；网页端存档由当前浏览器保存。

## 本地运行源码

安装 Node.js，在仓库根目录执行：

```sh
node --input-type=module -e "import { startLocalBrowser } from './desktop/local-browser.mjs'; await startLocalBrowser(process.cwd(), url => console.log(url));"
```

用浏览器打开终端输出的 `http://127.0.0.1:28101/`，按 `Ctrl+C` 停止服务。请通过 HTTP 服务访问，避免直接打开 HTML 文件。

如需使用 Electron 桌面窗口运行源码：

```sh
npx electron@35.2.1 .
```

## 项目结构

- `src/game/`：卡池、开盒规则、库存、经济与存档。
- `src/scene/`：三维场景、材质与交互。
- `src/ui/`：页面、动画与样式。
- `src/generated/`：卡牌数据与模型数据。
- `src/vendor/`：随项目提供的第三方库及其许可文件。
- `public/`：卡图、音效、字体与场景素材。
- `desktop/`：Electron 入口与本地网页服务。

源码由提供的 Windows 应用 `resources/app.asar` 提取；网页入口使用项目自带的 `src/web-entry.js`。大型 Electron 运行文件通过 Release 分发。

GitHub Pages 使用 `main` 分支的根目录；`.nojekyll` 确保静态资源原样发布。
