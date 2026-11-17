# 启动窗证据

[English](README.md) | 中文

`lifecycle-*.png` 是启动窗所发布渲染器（`apps/desktop/renderer/lifecycle.html`、`lifecycle.css`、`lifecycle.js`）及其发布 preload 的截图，使用与 `DesktopLifecycleWindow` 相同的 web preferences，在 640×470 无边框透明 Electron 窗口中打开。harness 只提供主进程从 shell 语言组装出的展示对象；没有 mock 渲染器或 preload 代码。

- `lifecycle-found.png`：发现正在运行的 Host；连接它是主操作，停止并重新拉起它是次操作，并显示上次退出时的中断说明。
- `lifecycle-searching.png`：决策前的过渡界面。
- `lifecycle-stale.png`：来自其他应用构建（或无响应）的 Host 需要在启动前重新拉起。

启动窗在此变更之前不存在，因此该界面没有 before 截图：旧壳没有可重连的运行中 Host，总是拉起新的 Host。原生退出对话框新增的 “Also stop the Host” 复选框无法用 Electron 的 `capturePage` 捕获，而为桌面截图退出正在运行的生产应用也不可行，因此该基线缺失。

## 局域网远端 Host

`remote-*.png` 捕获同一套发布渲染器（`lifecycle.html`、`lifecycle.css`、`lifecycle.js`）和发布的 `preload-lifecycle.cjs`；由于渲染器的 `script-src 'self'` CSP 无法匹配 `file://` 文档，页面由同源的本地 HTTP 页面提供。窗口为 640×620、无边框、透明，截图为 125% 缩放，web preferences 与 `DesktopLifecycleWindow` 相同；harness 只提供主进程组装的展示对象。

- `remote-found-before.png`：本分支基线（`fork/master`）上的启动窗；本机 Host 在运行，只提供连接和重新拉起。
- `remote-found-after.png`：同一场景，加上发现的远端卡片和手动地址卡片。
- `remote-only-after.png`：没有本机 Host；发现了一个网关，因此提供启动本地、该远端和手动输入。
- `remote-manual-after.png` 与 `remote-credentials-after.png`：远端地址表单与网关登录表单。

没有嵌入 GIF：新增状态是静态卡片和表单，面板与卡片的入场动画未变；捕获 harness 在离屏运行，桌面会话不可交互。
