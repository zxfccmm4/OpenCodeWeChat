# OpenCodeWeChat v0.2.0 Release Draft

以下内容可直接用于 GitHub Release。当前下载链接按仓库 `fendouai/OpenCodeWeChat` 和 tag `v0.2.0` 生成。

## 更新摘要

- 新增跨平台一键打包能力，可直接生成 macOS Apple Silicon、macOS Intel 和 Windows x64 启动包。
- 启动包内置独立可执行主程序、单独扫码登录工具，以及可双击启动的 `command` / `bat` 启动器，降低部署门槛。
- 增加 `package:current`、`package:mac`、`package:win` 和 `package:all` 脚本，方便本地构建和后续发版。
- 改进 OpenCode CLI 启动逻辑，支持自动补全常见安装路径，也支持通过 `OPENCODE_BIN` 手动指定可执行文件位置。
- 补齐 Windows 兼容细节，凭据目录和同步缓存路径改为跨平台处理，便于在不同系统上直接运行。
- 增加退出清理逻辑和更清晰的错误提示，双击启动时遇到 OpenCode 未安装、路径缺失或服务异常会更容易定位问题。

## 下载

本次发布提供 macOS Apple Silicon、macOS Intel 和 Windows x64 三个一键启动包，解压后可直接双击启动。

- macOS Apple Silicon: [OpenCodeWeChat-0.2.0-macos-arm64.zip](https://github.com/fendouai/OpenCodeWeChat/releases/download/v0.2.0/OpenCodeWeChat-0.2.0-macos-arm64.zip) （43 MB）
- macOS Intel: [OpenCodeWeChat-0.2.0-macos-x64.zip](https://github.com/fendouai/OpenCodeWeChat/releases/download/v0.2.0/OpenCodeWeChat-0.2.0-macos-x64.zip) （47 MB）
- Windows x64: [OpenCodeWeChat-0.2.0-windows-x64.zip](https://github.com/fendouai/OpenCodeWeChat/releases/download/v0.2.0/OpenCodeWeChat-0.2.0-windows-x64.zip) （79 MB）

## SHA256 校验

- `OpenCodeWeChat-0.2.0-macos-arm64.zip`
  `ad2889096d5c9ca54b0b94d6829adbdaebf9fcdc75c15fe369823e8036ed3d1d`

- `OpenCodeWeChat-0.2.0-macos-x64.zip`
  `23ff9547a800d4000251a602238609e2c84b4654fc774349398d3a534acc5f85`

- `OpenCodeWeChat-0.2.0-windows-x64.zip`
  `d3aa5f0fc854c4d7beab312c6e7b1b460721f206ce01a1609b2d75194f91c756`
