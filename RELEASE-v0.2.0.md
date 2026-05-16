# OpenCodeWeChat v0.2.0

OpenCodeWeChat `v0.2.0` 现已发布。

这个版本让“微信作为本地 OpenCode / OMO 入口”真正变得更适合日常使用：除了补齐跨平台分发与启动体验，也加入了更可靠的消息同步能力，以及面向 OMO 的微信侧指令协议。

## 更新摘要

- 新增一键打包能力，现可直接生成 macOS Apple Silicon、macOS Intel 和 Windows x64 三个平台的分发包。
- 每个启动包都包含独立主程序、单独扫码登录工具，以及可双击启动的 `command` / `bat` 启动器，部署和交付都更直接。
- 新增 `package:current`、`package:mac`、`package:win` 和 `package:all` 构建脚本，方便本地出包、测试和后续发布流程复用。
- 优化 OpenCode CLI 启动逻辑，支持自动补全常见安装路径，也支持通过 `OPENCODE_BIN` 手动指定可执行文件位置。
- 完善跨平台兼容处理，凭据目录和同步状态路径已适配 Windows 与 macOS，降低不同系统下的运行差异。
- 增强退出清理和错误提示体验，双击启动时如果遇到 OpenCode 未安装、路径缺失或服务异常，会更容易定位问题。
- 调整消息同步逻辑：整批消息成功处理后才推进同步游标，并增加已处理消息去重，降低重试时丢消息或重复回复的风险。
- 增加 `context_token` 缓存与回退机制，提升微信回消息的稳定性。
- 新增微信侧 OMO 指令协议，支持 `#plan`、`#start`、`#ulw`、`#delegate`、`#deep`、`#review`、`#summary`。
- 支持按微信用户缓存最近一次 `#plan` 结果，后续 `#start` 可自动续跑最近计划。
- 补充最小化自动化测试，覆盖轮询游标、消息去重、`context_token` 回退和 OMO 协议行为。

## 下载

本次发布提供 macOS Apple Silicon、macOS Intel 和 Windows x64 三个一键启动包。下载后解压即可使用，首次运行时可直接通过内置登录工具完成扫码配置。

- macOS Apple Silicon: [OpenCodeWeChat-0.2.0-macos-arm64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.2.0/OpenCodeWeChat-0.2.0-macos-arm64.zip) （43 MB）
- macOS Intel: [OpenCodeWeChat-0.2.0-macos-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.2.0/OpenCodeWeChat-0.2.0-macos-x64.zip) （47 MB）
- Windows x64: [OpenCodeWeChat-0.2.0-windows-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.2.0/OpenCodeWeChat-0.2.0-windows-x64.zip) （79 MB）

## SHA256 校验

- `OpenCodeWeChat-0.2.0-macos-arm64.zip`
  `ad2889096d5c9ca54b0b94d6829adbdaebf9fcdc75c15fe369823e8036ed3d1d`

- `OpenCodeWeChat-0.2.0-macos-x64.zip`
  `23ff9547a800d4000251a602238609e2c84b4654fc774349398d3a534acc5f85`

- `OpenCodeWeChat-0.2.0-windows-x64.zip`
  `d3aa5f0fc854c4d7beab312c6e7b1b460721f206ce01a1609b2d75194f91c756`

## 快速上手

- 如果你只想快速体验，直接下载对应平台的一键启动包
- 如果你想使用 OMO，启动时设置 `OPENCODE_AGENT=omo`
- 如果你想在微信里触发 OMO 工作流，可以直接发送 `#plan`、`#start`、`#ulw`、`#delegate`、`#deep`、`#review`、`#summary`
