# OpenCodeWeChat v0.4.0

OpenCodeWeChat `v0.4.0` 现已发布。

这个版本把"微信 × 本地 OpenCode"从单向文字工具升级成完整的双向工作台：媒体收发闭环、完整回复保护、图形控制台，以及一整套故障自愈机制——通道挂了能自己爬起来，坏消息不再堵死队列。

## 更新摘要

### 媒体与消息

- 新增接收能力：在微信里直接发图片、视频、文件（或未转写的语音）给 ClawBot，桥接层自动从微信 CDN 下载解密并保存到本地收件箱（`~/.claude/channels/wechat/inbox/`），OpenCode 可直接按路径读取继续处理。
- 修复发送媒体在手机端无法下载的问题：`aes_key` 编码与官方客户端对齐（hex 字符串 base64），图片、视频、文件现可正常点开。
- 媒体指令解析增强容错：`~` 家目录路径、全角冒号、反引号/引号包裹均可识别；每条发往 OpenCode 的消息自动附带媒体指令用法提醒，避免模型只回文件名。
- 普通微信消息默认路由到 OMO 主 agent（`omo` / `sisyphus`），不再落到 OpenCode 默认 agent；当用户明确要求 PDF/报告/文件交付时，会向 OMO 追加硬性文件交付协议，要求实际创建本地文件并用 `[[wechat-file:/绝对路径|说明]]` 发回微信。
- 新增完整回复保护：订阅 OpenCode SSE 增量作为本地完整性兜底；微信侧只在 OpenCode 完成后发送普通 `FINISH` 文本分片，不再显示多条半截气泡。处理期间可选显示"对方正在输入..."。可用 `OPENCODE_WECHAT_STREAM_CAPTURE=0` / `OPENCODE_WECHAT_TYPING=0` 关闭。

### 启动与管理

- 新增浏览器图形控制台（`OpenCodeWeChatGUI.command` / `.cmd` / `.sh` 或 `bun run gui`）：状态面板、启动/停止、页面内扫码登录、登出、实时日志，仅绑定 127.0.0.1。
- 新增三平台菜单启动器（macOS / Windows / Linux），覆盖登录、登出、启动、停止、打开 GUI。
- macOS 一键包的可执行文件现在会在打包时做 ad-hoc codesign，启动脚本会自动清理下载隔离属性，降低双击时被系统误报"已损坏"的概率。
- 新增登出能力：`bun scripts/logout.ts` 停止通道并清除本机凭据与会话状态（收件箱文件保留）。
- 通道日志统一写入 `channel.log`（终端启动自动分流，超 5MB 轮转），GUI 实时滚动展示。
- 一键打包升级：每个平台分发包新增 GUI 控制台二进制与对应启动器，打包后的 GUI 可直接拉起同目录主程序。

### 稳定性

- OpenCode 服务进程死亡后自动重建会话并重试当前消息；进程退出原因与崩溃输出完整记录到日志。
- 会话创建遇瞬时 5xx 自动重试 3 次；模型调用失败不再表现为无声的"空响应"，错误原因直接可见。
- 默认不再注入 `Steveai/gpt-5.4-mini` 等固定模型；未显式配置 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID` 时，由 OpenCode / OMO 按自身配置选择模型，避免新版 OpenCode 报 `ProviderModelNotFoundError`。
- PDF/报告/文件交付等长任务会自动使用更长的 OpenCode 等待窗口（默认 300 秒，可用 `OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS` 调整），避免 60 秒短问答超时误杀正在生成的文件。
- 修复 ClawBot 长回答尾部不完整的问题：最终回复按保守长度拆成多条微信文本发送，避免单条 text payload 被客户端截断。
- 同一消息连续 3 次处理失败自动跳过并通知用户，杜绝毒消息永久阻塞队列；批次失败增加退避，不再热循环刷日志。
- 媒体发送失败降级为失败原因文本，消息流程不中断。

### 测试

- 自动化测试从 23 个扩展到 142 个，覆盖媒体收发与加解密、ClawBot 普通 `FINISH` 发送、长回复分片、SSE 聚合、OMO 默认模型选择、普通消息路由到 OMO 主 agent、PDF/文件交付协议、长任务超时窗口、自愈重试、登出清理、GUI 接口等核心路径。

## 下载

本次发布提供 macOS Apple Silicon、macOS Intel 和 Windows x64 三个一键启动包。下载后解压即可使用，推荐双击 `OpenCodeWeChat GUI` 启动图形控制台完成扫码与管理。

- macOS Apple Silicon: [OpenCodeWeChat-0.4.0-macos-arm64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-macos-arm64.zip)
- macOS Intel: [OpenCodeWeChat-0.4.0-macos-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-macos-x64.zip)
- Windows x64: [OpenCodeWeChat-0.4.0-windows-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-windows-x64.zip)

## SHA256 校验

- `OpenCodeWeChat-0.4.0-macos-arm64.zip`
  `7532cd384a9365fc8b9b3de7ef257eab751a020ea420bb0824caf169b67214cb`

- `OpenCodeWeChat-0.4.0-macos-x64.zip`
  `8a92a39e0c27f279c933ba39b2199c2a738df6bb1a15c2b67e4e0be489c8e3c9`

- `OpenCodeWeChat-0.4.0-windows-x64.zip`
  `732203671b4dd794344f6bf8d318519388389c06c6d2cccd08b0e08a9daa3076`

## 快速上手

- 想要图形化体验：双击 `OpenCodeWeChat GUI`，在浏览器里扫码、启动、看日志
- 在微信里发文件/图片给 ClawBot，让 OpenCode 直接处理；让它"把结果文件发给我"，文件会回到微信且可正常下载
- 长任务可开启"对方正在输入..."；最终回复会按普通文本完整分片到达
- OMO 工作流照旧：`#plan`、`#start`、`#ulw`、`#delegate`、`#deep`、`#review`、`#summary`
