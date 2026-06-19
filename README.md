# OpenCodeWeChat

把微信变成 OpenCode / OMO 的移动入口。

OpenCodeWeChat 通过微信 ClawBot ilink API，把微信消息桥接到本机 `opencode serve`。你可以在微信里直接和本地 OpenCode / OMO 对话、执行 `#plan` / `#start` / `#ulw` 等工作流、发送图片和文件给 AI，也可以让 AI 把生成的 PDF、图片、视频或其他文件发回微信。

## 适合谁

- 想在微信里随时调用本机 OpenCode / OMO。
- 想用浏览器控制台完成扫码、启动、停止和看日志，不想一直守着终端。
- 想把微信图片、文件交给本地 AI 处理。
- 想让 AI 生成报告、PDF、图片等产物，并直接发回微信。
- 想要更稳的桥接层：回复分片、消息去重、游标保护、自动重试和本地日志。

## 效果预览

![微信对话效果](docs/images/wechat_1.jpg)

![微信对话效果](docs/images/wechat_2.jpg)

## 下载使用

推荐普通用户直接下载一键包，不需要克隆源码。

发布页：[OpenCodeWeChat v0.4.0](https://github.com/zxfccmm4/OpenCodeWeChat/releases/tag/v0.4.0)

| 平台 | 下载 |
|------|------|
| macOS Apple Silicon | [OpenCodeWeChat-0.4.0-macos-arm64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-macos-arm64.zip) |
| macOS Intel | [OpenCodeWeChat-0.4.0-macos-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-macos-x64.zip) |
| Windows x64 | [OpenCodeWeChat-0.4.0-windows-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.4.0/OpenCodeWeChat-0.4.0-windows-x64.zip) |

SHA256 校验：

```text
OpenCodeWeChat-0.4.0-macos-arm64.zip
7532cd384a9365fc8b9b3de7ef257eab751a020ea420bb0824caf169b67214cb

OpenCodeWeChat-0.4.0-macos-x64.zip
8a92a39e0c27f279c933ba39b2199c2a738df6bb1a15c2b67e4e0be489c8e3c9

OpenCodeWeChat-0.4.0-windows-x64.zip
732203671b4dd794344f6bf8d318519388389c06c6d2cccd08b0e08a9daa3076
```

macOS 下载后如果提示“OpenCodeWeChat-GUI 已损坏，无法打开”，通常是系统下载隔离属性导致的。进入解压后的目录运行：

```bash
xattr -dr com.apple.quarantine .
```

## 快速开始

前置条件：

- 本机已经安装并登录 OpenCode CLI，终端里能运行 `opencode`。
- 微信账号可以使用 ClawBot。
- 如果要使用 OMO，需要本机 OpenCode / OMO 已经配置好对应 agent。

一键包使用流程：

1. 下载并解压当前平台的 zip。
2. macOS 双击 `OpenCodeWeChat GUI.command`，Windows 双击 `OpenCodeWeChat GUI.bat`。
3. 浏览器控制台打开后，在页面里扫码登录微信。
4. 点击启动通道。
5. 在微信里向 ClawBot 发送消息。

GUI 默认只监听本机地址 `127.0.0.1:5179`。如果端口被占用，可以设置：

```bash
OPENCODE_WECHAT_GUI_PORT=5180
```

## 源码运行

开发者可以从源码运行：

```bash
git clone https://github.com/zxfccmm4/OpenCodeWeChat.git
cd OpenCodeWeChat
bun install
```

扫码登录：

```bash
bun setup.ts
```

启动通道：

```bash
bun index.ts
```

启动 GUI：

```bash
bun run gui
```

登出并清理本机登录态：

```bash
bun scripts/logout.ts
```

## 启动脚本

源码仓库内置了几个常用启动脚本：

| 用途 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 菜单启动器 | `launchers/OpenCodeWeChatLauncher.command` | `launchers/OpenCodeWeChatLauncher.cmd` | `launchers/OpenCodeWeChatLauncher.sh` |
| 直接启动通道 | `launchers/OpenCodeWeChat.command` | `launchers/OpenCodeWeChat.cmd` | - |
| 启动 GUI | `launchers/OpenCodeWeChatGUI.command` | `launchers/OpenCodeWeChatGUI.cmd` | `launchers/OpenCodeWeChatGUI.sh` |
| 停止通道 | `launchers/StopOpenCodeWeChat.command` | `launchers/StopOpenCodeWeChat.cmd` | - |

打包后的 zip 里也会包含对应平台的启动器和二进制文件。

## 工作方式

```text
微信客户端
  -> ClawBot
  -> ilink API
  -> OpenCodeWeChat
  -> opencode serve
  -> OpenCode / OMO agent
```

核心流程：

1. 通过 `ilink/bot/getupdates` 长轮询拉取微信消息。
2. 自动启动本机 `opencode serve`，创建 OpenCode 会话。
3. 把微信文本、媒体文件路径和 OMO 指令转换成 OpenCode prompt。
4. 等 OpenCode 完成后，把最终回复按微信安全长度拆分成普通文本消息发回。
5. 如果回复里包含媒体指令，自动上传本地文件并发送给微信。

桥接层不会把生成中的半截内容连续刷到微信；它只发送最终文本分片和最终媒体消息。

## OMO 指令

普通消息默认会尽量路由到 OMO 主 agent（优先 `omo` / `sisyphus`，按本机 OpenCode agent 列表决定）。你也可以在微信消息开头加指令：

| 指令 | 用途 |
|------|------|
| `#plan` | 先规划任务，适合复杂需求开头 |
| `#start` | 沿着最近一次 `#plan` 继续执行 |
| `#ulw` / `#ultrawork` | 让 OMO 尽量自主推进到可验证结果 |
| `#team` | 多成员协作、并行调查和汇总 |
| `#hyperplan` | 更结构化的复杂任务规划 |
| `#ulw-loop` / `#loop` | 循环推进、验证和更新状态 |
| `#search` / `#explore` | 检索、探索、查资料 |
| `#analyze` / `#metis` | 根因分析、证据核查 |
| `#delegate` | 分工委派、并行处理 |
| `#deep` | 深度分析 |
| `#review` | 代码评审、风险检查 |
| `#summary` | 压缩总结 |

示例：

```text
#plan 帮我把这个发布流程拆成可执行步骤
#start 按刚才的计划继续做第一步
#review 帮我检查这次改动有没有回归风险
#ulw 修复这个 bug，验证通过后告诉我结果
```

`#plan` 的最近结果会按微信用户缓存在本机，后续 `#start` 会自动带上这份上下文。

## 文件和媒体

### 微信发给 AI

你可以在微信里直接发送图片、视频、文件，桥接层会下载并解密到本机收件箱：

```text
~/.claude/channels/wechat/inbox/
```

OpenCode / OMO 会收到本地文件路径，可以继续读取和处理。

### AI 发回微信

如果 OpenCode / OMO 生成了本地文件，让它在最终回复里输出媒体指令：

```text
[[wechat-image:/absolute/path/result.png|可选说明]]
[[wechat-video:/absolute/path/demo.mp4|可选说明]]
[[wechat-file:/absolute/path/report.pdf|可选说明]]
```

要求：

- 路径必须是运行 OpenCodeWeChat 这台机器上的真实绝对路径。
- `~`、全角冒号、反引号和引号包裹会做兼容处理。
- 上传失败时会发一条失败原因文本，不会卡住消息队列。

PDF、报告、文件交付类请求会自动使用更长的等待窗口，默认 300 秒。

## 配置项

常用环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOME` / `USERPROFILE` | 系统用户目录 | 决定本地状态文件保存位置 |
| `OPENCODE_BIN` | `opencode` | OpenCode CLI 路径 |
| `OPENCODE_AGENT` | 自动选择 | 指定默认 agent；`omo` / `sisyphus` 会进入 OMO 路由 |
| `OPENCODE_PROVIDER_ID` | 空 | 显式指定 OpenCode provider，通常不需要设置 |
| `OPENCODE_MODEL_ID` | 空 | 显式指定 OpenCode model，通常不需要设置 |
| `OPENCODE_SERVER_USERNAME` | `opencode` | 本地 OpenCode server 用户名 |
| `OPENCODE_SERVER_PASSWORD` | 自动生成 | 本地 OpenCode server 密码 |
| `OPENCODE_WECHAT_GUI_PORT` | `5179` | GUI 本地端口 |
| `OPENCODE_WECHAT_CDN_BASE_URL` | 微信默认 CDN | 微信媒体 CDN 地址 |
| `OPENCODE_WECHAT_INBOX_DIR` | `~/.claude/channels/wechat/inbox` | 收件箱目录 |
| `OPENCODE_WECHAT_STREAM_CAPTURE` | `1` | 是否订阅 OpenCode SSE 作为完整回复兜底 |
| `OPENCODE_WECHAT_TYPING` | `0` | 是否开启微信“正在输入”状态 |
| `OPENCODE_WECHAT_TYPING_MAX_MS` | `45000` | 正在输入状态最长保持时间 |
| `OPENCODE_WECHAT_PROMPT_TIMEOUT_MS` | `60000` | 普通任务等待 OpenCode 的最长时间 |
| `OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS` | `300000` | 文件、PDF、报告类任务的最长等待时间 |
| `OPENCODE_WECHAT_TEXT_CHUNK_CHARS` | `500` | 微信文本分片长度 |
| `OPENCODE_WECHAT_VERBOSE_LOGS` | `0` | 是否输出更详细的消息日志 |

模型选择建议：

- 默认不要设置 `OPENCODE_PROVIDER_ID` 和 `OPENCODE_MODEL_ID`。
- 让 OpenCode / OMO 使用自己已经配置好的默认模型。
- 如果日志里出现 `ProviderModelNotFoundError`，优先删除这两个环境变量，而不是在 OpenCodeWeChat 里硬编码模型。

## 本地状态和日志

状态目录：

```text
~/.claude/channels/wechat/
```

常见文件：

| 文件 | 说明 |
|------|------|
| `account.json` | 微信登录凭据 |
| `sync_buf.txt` | 微信同步游标 |
| `context_tokens.json` | 最近可用的 `context_token` 缓存 |
| `processed_messages.json` | 已处理消息去重记录 |
| `omo_plan_context.json` | 每个微信用户最近一次 `#plan` 结果 |
| `opencode-wechat.pid` | 通道进程 PID |
| `channel.log` | 通道日志，超过 5MB 会轮转 |
| `inbox/` | 微信发来的媒体和文件 |

GUI 的日志窗口读取的就是 `channel.log`。

## 常见问题

### macOS 提示应用已损坏

这是下载隔离属性导致的概率最高。进入解压后的目录运行：

```bash
xattr -dr com.apple.quarantine .
```

然后重新双击 `OpenCodeWeChat GUI.command` 或 `OpenCodeWeChat-GUI`。

### 启动后提示找不到 OpenCode

确认终端里可以运行：

```bash
opencode --version
```

如果你的 OpenCode 不在 `PATH` 里，设置：

```bash
OPENCODE_BIN=/absolute/path/to/opencode
```

### 回复只有一部分或被截断

当前版本会等待 OpenCode 完成后再按普通文本分片发送。可以检查：

- `OPENCODE_WECHAT_STREAM_CAPTURE` 没有被设成 `0`。
- `OPENCODE_WECHAT_TEXT_CHUNK_CHARS` 不要设置得过大，默认 `500` 更稳。
- GUI 日志里是否出现 OpenCode 超时、会话断开或 Provider 报错。

### 一直显示正在输入

默认不会开启正在输入状态。如果你设置了：

```bash
OPENCODE_WECHAT_TYPING=1
```

可以先关掉它，或缩短：

```bash
OPENCODE_WECHAT_TYPING_MAX_MS=15000
```

### PDF 或长报告任务超时

文件交付类任务默认等待 300 秒。如果仍然不够，可以调大：

```bash
OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS=600000
```

同时要求模型必须实际生成文件，并在最终回复里输出：

```text
[[wechat-file:/absolute/path/report.pdf|报告]]
```

### 出现 ProviderModelNotFoundError

例如：

```text
ProviderModelNotFoundError
providerID: "Steveai"
modelID: "gpt-5.4-mini"
```

这说明环境里显式指定了 OpenCodeWeChat 要使用的 provider/model，但本机 OpenCode 没有这个模型。删除或清空：

```bash
OPENCODE_PROVIDER_ID
OPENCODE_MODEL_ID
```

让 OpenCode / OMO 使用自己配置好的默认模型。

### 某条消息连续失败后被跳过

同一条消息连续失败 3 次会被跳过，并在微信里通知原因。这是为了防止一条坏消息永久堵住整个队列。修复环境问题后，重新发送那条消息即可。

## 开发

常用命令：

```bash
bun test
bun run typecheck
bun run package:current
bun run package:all
```

打包脚本：

```bash
bun scripts/package-app.ts --target macos-arm64 --target macos-x64 --target windows-x64
```

输出目录：

```text
dist/one-click/
```

## 项目结构

```text
api/          微信 ilink、媒体上传和媒体下载
core/         OMO 指令、文本分片、媒体指令、上下文和输入状态
gui/          浏览器图形控制台
login/        微信扫码登录
opencode/     OpenCode server、session、SSE、agent 和错误处理
polling/      微信轮询、消息处理、回复发送和重试逻辑
scripts/      打包、启动、停止、登出脚本
storage/      本地状态读写
tests/        Bun 自动化测试
launchers/    macOS / Windows / Linux 启动器
docs/         发布说明、部署文档和图片资源
```

更多文档：

- [部署文档](docs/DEPLOYMENT.md)
- [v0.4.0 发布说明](docs/RELEASE-v0.4.0.md)

## 许可证

MIT
