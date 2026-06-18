# OpenCodeWeChat v0.4.0

OpenCodeWeChat `v0.4.0` 现已发布。

这个版本把"微信 × 本地 OpenCode"从单向文字工具升级成完整的双向工作台：媒体收发闭环、流式回复、图形控制台，以及一整套故障自愈机制——通道挂了能自己爬起来，坏消息不再堵死队列。

## 更新摘要

### 媒体与消息

- 新增接收能力：在微信里直接发图片、视频、文件（或未转写的语音）给 ClawBot，桥接层自动从微信 CDN 下载解密并保存到本地收件箱（`~/.claude/channels/wechat/inbox/`），OpenCode 可直接按路径读取继续处理。
- 修复发送媒体在手机端无法下载的问题：`aes_key` 编码与官方客户端对齐（hex 字符串 base64），图片、视频、文件现可正常点开。
- 媒体指令解析增强容错：`~` 家目录路径、全角冒号、反引号/引号包裹均可识别；每条发往 OpenCode 的消息自动附带媒体指令用法提醒，避免模型只回文件名。
- 新增流式回复：订阅 OpenCode SSE 增量（`message.part.delta`），以同一 `client_id` 配合 `GENERATING→FINISH` 状态在微信里原地更新一条气泡——回复像元宝一样逐步增长；处理期间显示"对方正在输入..."。媒体指令不会闪现在气泡里，推理内容不泄露。可用 `OPENCODE_WECHAT_STREAM_REPLIES=0` / `OPENCODE_WECHAT_TYPING=0` 关闭。

### 启动与管理

- 新增浏览器图形控制台（`OpenCodeWeChatGUI.command` / `.cmd` / `.sh` 或 `bun run gui`）：状态面板、启动/停止、页面内扫码登录、登出、实时日志，仅绑定 127.0.0.1。
- 新增三平台菜单启动器（macOS / Windows / Linux），覆盖登录、登出、启动、停止、打开 GUI。
- 新增登出能力：`bun scripts/logout.ts` 停止通道并清除本机凭据与会话状态（收件箱文件保留）。
- 通道日志统一写入 `channel.log`（终端启动自动分流，超 5MB 轮转），GUI 实时滚动展示。
- 一键打包升级：每个平台分发包新增 GUI 控制台二进制与对应启动器，打包后的 GUI 可直接拉起同目录主程序。

### 稳定性

- OpenCode 服务进程死亡后自动重建会话并重试当前消息；进程退出原因与崩溃输出完整记录到日志。
- 会话创建遇瞬时 5xx 自动重试 3 次；模型调用失败不再表现为无声的"空响应"，错误原因直接可见。
- 同一消息连续 3 次处理失败自动跳过并通知用户，杜绝毒消息永久阻塞队列；批次失败增加退避，不再热循环刷日志。
- 媒体发送失败降级为失败原因文本，消息流程不中断。

### 测试

- 自动化测试从 23 个扩展到 116 个，覆盖媒体收发与加解密、流式分段、SSE 聚合、自愈重试、登出清理、GUI 接口等核心路径。

## 下载

本次发布提供 macOS Apple Silicon、macOS Intel 和 Windows x64 三个一键启动包。下载后解压即可使用，推荐双击 `OpenCodeWeChat GUI` 启动图形控制台完成扫码与管理。

- macOS Apple Silicon: [OpenCodeWeChat-0.4.0-macos-arm64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-macos-arm64.zip)
- macOS Intel: [OpenCodeWeChat-0.4.0-macos-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-macos-x64.zip)
- Windows x64: [OpenCodeWeChat-0.4.0-windows-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-windows-x64.zip)

## SHA256 校验

- `OpenCodeWeChat-0.4.0-macos-arm64.zip`
  `28717a4419d193e7844cbffc5b2638afa6ee67209ad8bed5034bc258493fea77`

- `OpenCodeWeChat-0.4.0-macos-x64.zip`
  `cb15382c9883653edc7c10425c81644210d5317c332936a97faa11ebdfc938fe`

- `OpenCodeWeChat-0.4.0-windows-x64.zip`
  `f3e6e6a84d3d4a3d7b579538a4fbe45a7d5a6e6d5fec4e8bf35c240de2bdaf85`

## 快速上手

- 想要图形化体验：双击 `OpenCodeWeChat GUI`，在浏览器里扫码、启动、看日志
- 在微信里发文件/图片给 ClawBot，让 OpenCode 直接处理；让它"把结果文件发给我"，文件会回到微信且可正常下载
- 长任务会看到"对方正在输入..."和分段到达的流式回复
- OMO 工作流照旧：`#plan`、`#start`、`#ulw`、`#delegate`、`#deep`、`#review`、`#summary`
