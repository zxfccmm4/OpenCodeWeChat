# OpenCodeWeChat

把微信变成 OpenCode / OMO 的移动入口。

OpenCodeWeChat 通过微信官方 ClawBot ilink API，把微信消息桥接到本地 OpenCode 会话，让你直接在微信里发起对话、规划任务、续跑计划、收发文件，并触发 OMO 工作流。

适合这样的场景：

- 想把 OpenCode / OMO 从终端带到微信里随时可用
- 想在微信里直接发 `#plan`、`#start`、`#ulw` 这类 OMO 指令
- 想把文件、图片发给 AI 处理，也让 AI 把产物文件直接发回微信
- 想要长回答尽量完整：OpenCode SSE 辅助补齐 + 微信普通文本分片发送
- 不想碰终端：浏览器图形控制台覆盖扫码登录、启停和实时日志
- 想要比纯 demo 更可靠的消息桥接：故障自愈、游标保护、消息去重和 `context_token` 回退

## 效果预览

![微信对话效果](docs/images/wechat_1.jpg)

![微信对话效果](docs/images/wechat_2.jpg)

## 当前能力

| 能力 | 说明 |
|------|------|
| 微信扫码登录 | 支持独立登录流程，凭据保存在本地 `~/.claude/channels/wechat/`；支持登出并清除本机凭据 |
| 自动拉起 OpenCode | 启动时自动执行 `opencode serve`，兼容旧版 `opencode server listening...` 和新版 `server listening...` 启动日志 |
| 长轮询收发微信消息 | 基于 `ilink/bot/getupdates` + `ilink/bot/sendmessage` 实现近实时消息桥接 |
| 完整回复保护 | 订阅 OpenCode SSE 增量作为本地完整性补充，最终按 ClawBot 兼容的普通 `FINISH` 文本分片发送 |
| 双向媒体收发 | 微信发来的图片/视频/文件自动下载解密到本地收件箱；OpenCode 产物通过媒体指令上传发回微信，手机端可正常下载 |
| 浏览器图形控制台 | 状态面板、启动/停止、页面内扫码登录、登出、实时日志，仅绑定 127.0.0.1 |
| 三平台一键启动器 | macOS / Windows / Linux 菜单式启动器，覆盖登录、登出、启动、停止、打开 GUI |
| 故障自愈 | OpenCode 服务死亡自动重建会话并重试；会话创建瞬时失败自动重试；同一消息连续失败自动跳过并通知，杜绝毒消息阻塞队列 |
| 可靠同步 | 只有整批消息成功处理后才推进同步游标，避免处理中断时丢消息；批次失败带退避 |
| 已处理消息去重 | 本地持久化最近处理过的入站消息 ID，减少重试时重复回复 |
| `context_token` 回退 | 缓存并持久化最近可用的 `context_token`，消息缺少 token 时尝试回退 |
| Oh My OpenAgent 上下文 | 每次调用 OpenCode 都通过 `system` 加载 OMO、MCP、Skill 和会话规则 |
| OMO 微信协议 | 支持 `#plan`、`#start`、`#ulw`、`#team`、`#hyperplan`、`#ulw-loop`、`#delegate`、`#deep`、`#review`、`#summary` 等 |
| OMO agent 路由 | 自动读取新版 `/api/agent` 或旧版 `/agent`，按指令优先路由到 Prometheus、Atlas、Sisyphus 等可用 agent |
| OMO 计划续跑 | `#plan` 的最近结果会按微信用户缓存，后续 `#start` 可自动续跑 |
| 一键启动包 | 生成 macOS Apple Silicon、macOS Intel、Windows x64 启动包，内含主程序、扫码工具和图形控制台 |
| 自动化测试 | 覆盖媒体加解密、SSE 聚合、完整回复分片、自愈重试、登出清理、GUI 接口等关键回归 |

## 工作方式

```text
微信客户端
  -> WeChat ClawBot
  -> ilink API
  -> OpenCodeWeChat
  -> opencode serve
  -> OpenCode session/message API
```

处理链路大致分为 4 步：

1. 通过 `ilink/bot/getupdates` 长轮询拉取微信用户消息；媒体消息自动从微信 CDN 下载解密到本地收件箱。
2. 本地启动 `opencode serve`，创建 OpenCode 会话。
3. 把微信文本（和收到的媒体文件路径）转成 OpenCode prompt，并通过 `system` 加载 Oh My OpenAgent、MCP、Skill 等会话上下文。
4. 订阅 OpenCode SSE 增量作为本地完整性兜底；OpenCode 完成后再按普通 `FINISH` 文本安全分片发送，媒体指令随后上传 CDN 作为独立消息发出。

## 环境要求

- [Bun](https://bun.sh) >= 1.0
- 本机已安装并登录 [OpenCode](https://opencode.ai) CLI，且 `opencode` 命令可用
- 微信 iOS 或 Android 最新版，且支持 ClawBot

如果你打算用 OMO，还需要：

- 已安装并配置 OMO / oh-my-openagent
- OpenCode agent 列表里能看到 `sisyphus` 或旧版 `Sisyphus - Ultraworker`

## 快速开始

### 1. 安装

```bash
git clone <repo-url>
cd OpenCodeWeChat
bun install
```

### 2. 微信扫码登录

```bash
bun setup.ts
```

扫码成功后，账号凭据会保存到：

```text
~/.claude/channels/wechat/account.json
```

如果终端二维码显示不完整，可以直接拿二维码内容：

```bash
bun -e "import {fetchQRCode} from './api/ilink.ts'; const q = await fetchQRCode('https://ilinkai.weixin.qq.com'); console.log(q.qrcode_img_content);"
```

### 3. 启动通道

```bash
bun index.ts
```

如果要直接使用 OMO：

```bash
OPENCODE_AGENT=omo bun index.ts
```

也可以直接使用源码仓库内置的一键脚本：

```bash
./launchers/OpenCodeWeChat.command
```

Windows 上双击或在终端运行：

```cmd
launchers/OpenCodeWeChat.cmd
```

这两个脚本会自动检查 Bun/OpenCode、安装依赖、在缺少微信凭据时先启动扫码登录，然后启动通道。实际逻辑位于 `scripts/run-macos.command` 和 `scripts/run-windows.cmd`，可选配置文件为项目根目录的 `opencode-wechat.env`。

### 一键启动器（推荐）

如果不想记多个脚本，可以用带菜单的一键启动器，覆盖 macOS / Windows / Linux 三个平台：

| 平台 | 双击或运行 |
|------|-----------|
| macOS | `launchers/OpenCodeWeChatLauncher.command` |
| Windows | `launchers/launchers/OpenCodeWeChatLauncher.cmd` |
| Linux | `launchers/OpenCodeWeChatLauncher.sh` |

启动器会显示当前运行状态和登录账号，并提供四个操作：

```text
1) 登录微信（扫码）       # 已在运行时会先停止通道再重新扫码
2) 登出并清除本机凭据     # 停止通道并删除凭据/同步游标/会话缓存，inbox 下载文件保留
3) 启动 OpenCodeWeChat   # 缺少凭据时自动进入扫码登录，Ctrl+C 停止后返回菜单
4) 停止 OpenCodeWeChat   # 按 pid 文件优雅停止，超时强制结束
```

macOS / Linux 菜单逻辑位于 `scripts/launcher.sh`，Windows 位于 `scripts/launcher-windows.cmd`；登出逻辑也可以单独执行：`bun scripts/logout.ts`。

### 图形控制台（GUI）

不想用终端的话，可以打开浏览器图形控制台，功能与启动器一致并附带实时日志：

| 平台 | 双击或运行 |
|------|-----------|
| macOS | `launchers/OpenCodeWeChatGUI.command` |
| Windows | `launchers/launchers/OpenCodeWeChatGUI.cmd` |
| Linux | `launchers/OpenCodeWeChatGUI.sh` |

也可以用 `bun run gui` 启动。控制台是一个只绑定本机回环地址的本地网页（`127.0.0.1:5179`，可用 `OPENCODE_WECHAT_GUI_PORT` 改端口），启动后会自动打开浏览器：

- **状态面板**：实时显示通道运行状态、PID 和登录账号
- **启动 / 停止通道**：通道进程独立于控制台运行，关掉浏览器或控制台都不影响通道
- **扫码登录**：二维码直接显示在页面里，扫码确认后自动保存凭据；重新登录会先自动停止通道
- **登出**：停止通道并清除本机凭据（收件箱文件保留）
- **通道日志**：通道日志统一写入 `~/.claude/channels/wechat/channel.log`（终端启动的通道会自动分流一份，GUI 启动的直接重定向），页面实时滚动显示

### 4. 开始对话

在微信中找到 ClawBot 对话，发送普通文本或 OMO 指令协议消息即可。OpenCodeWeChat 会自动收消息并回微信。

普通消息也会默认进入 Oh My OpenAgent 流程：桥接层会在 OpenCode 请求的 `system` 字段里注入当前会话规则，要求模型按需使用已加载的 MCP 工具、内置 Skill 和 OMO 工作流。带 `#plan`、`#team` 等前缀时，会在这个基础上额外追加对应工作流语义。

### 完整回复与输入中状态

长任务不再需要干等一整段回复：

- **输入中指示器**：可选开启。OpenCode 处理期间，微信会显示"对方正在输入..."（官方 `sendtyping` 协议，自动续期，结束自动取消）；为避免 OpenCode / Provider 卡住时微信端残留输入状态，默认关闭，开启后也会在最大时长到达时自动取消
- **OpenCode SSE 完整性兜底**：桥接层会订阅 OpenCode 的 SSE 事件流，只在本地合并最终文本；不会把生成中的半成品发给微信，也不会发送 `GENERATING` 气泡
- **长回复保底分片**：最终回复超过安全长度或还有未发送尾部时，会拆成多条普通 `FINISH` 文本继续发送，避免 ClawBot / 微信客户端截断尾部
- SSE 订阅不可用（如旧版 OpenCode）时回退为同步整段发送；微信侧始终只接收完整普通文本消息和媒体消息

`OPENCODE_WECHAT_STREAM_CAPTURE` 默认开启；设为 `0` 可关闭 SSE 完整性补充。`OPENCODE_WECHAT_TYPING=1` 可开启输入中指示器。

### 发送图片、视频和文件到微信

OpenCode / OMO 如果生成了本地文件，可以在最终回复里输出媒体指令，桥接层会自动上传到微信 CDN 并发送给当前微信用户：

```text
[[wechat-image:/absolute/path/result.png|可选说明]]
[[wechat-video:/absolute/path/demo.mp4|可选说明]]
[[wechat-file:/absolute/path/report.pdf|可选说明]]
```

说明文字会作为单独文本消息先发出，随后发送对应图片、视频或文件。路径必须是运行 OpenCodeWeChat 这台机器上的真实绝对路径；普通文本回复不受影响。

桥接层会在每条发往 OpenCode 的消息末尾自动附加媒体指令用法提醒，确保模型在用户要文件时输出指令而不是只回文件名。指令解析对常见写法偏差有容错：`~` 开头的家目录路径、全角冒号、路径外层的反引号/引号都能正确识别；媒体上传失败时会降级为一条失败原因文本，不会卡住消息队列。

### 接收微信发来的图片、视频和文件

反方向也支持：在微信里直接发图片、视频、文件（或不带转写的语音）给 ClawBot，桥接层会从微信 CDN 下载并解密，保存到本地收件箱目录（默认 `~/.claude/channels/wechat/inbox/`），然后把保存路径告诉 OpenCode：

```text
[用户通过微信发送了图片，已保存到本地路径: ~/.claude/channels/wechat/inbox/2026-06-11T08-30-00-000Z-wechat-image.jpg]
```

OpenCode / OMO 可以直接按路径读取这些文件继续处理。媒体可以单独发送，也可以附带文字说明一起发送；下载失败时消息不会丢，OpenCode 会收到失败原因并提示你重新发送。收件箱文件名会带时间戳前缀并做安全清洗，目录权限为 `0700`。

## OMO 微信协议使用指南

当你通过 `OPENCODE_AGENT=omo` 或 `OPENCODE_AGENT=sisyphus` 启动时，可以在微信消息前加轻量前缀。桥接层会把这些前缀翻译成更贴近官方 OMO 工作流的 prompt；如果 OpenCode 暴露了 agent 列表，还会按指令优先选择更合适的 agent。

### 使用前提

- 启动通道时设置 `OPENCODE_AGENT=omo` 或 `OPENCODE_AGENT=sisyphus`
- 本机 OpenCode / OMO 已正确注册 `sisyphus` 或旧版 `Sisyphus - Ultraworker`
- 微信入口仍然是纯文本消息；桥接层只做 prompt 增强，不会在微信里直接暴露终端命令面板

### 指令表

| 前缀 | 映射语义 | 适合场景 | 示例 |
|------|----------|----------|------|
| `#ulw` / `#ultrawork` | 官方 `ultrawork` | 想让 OMO 尽量自主一路做完 | `#ulw 直接把这个问题从排查到修复都做完` |
| `#plan` | Prometheus / `@plan` | 先拆任务、先出计划 | `#plan 帮我给这个需求拆一个实现计划` |
| `#start` | Atlas / `/start-work` | 沿着最近一次计划继续执行 | `#start 按刚才的计划继续做，先完成第一步` |
| `#team` | OMO team mode | 需要多成员协作、并行调查和汇总 | `#team 分头查这个回归，最后合并结论` |
| `#hyperplan` | hyperplan / hyperplan-ultrawork | 复杂任务的结构化规划和验证点设计 | `#hyperplan 给这个跨模块改造做一份执行图` |
| `#ulw-loop` / `#loop` | `/ulw-loop` / Ralph loop | 需要循环推进、验证和状态更新 | `#ulw-loop 持续推进这个修复，直到可验证` |
| `#search` / `#explore` | Librarian / Explore | 资料检索、代码库探索、来源核验 | `#search 查一下这个 API 现在的正确用法` |
| `#analyze` / `#metis` | Metis / Oracle 分析 | 证据核查、根因诊断、反例检查 | `#analyze 看看这个性能下降的根因` |
| `#delegate` | 多智能体委派 | 并行调查、分工处理 | `#delegate 帮我并行排查这个故障，最后汇总结论` |
| `#deep` | 深度分析 | 根因诊断、复杂实现分析 | `#deep 帮我彻底分析这段实现为什么会出问题` |
| `#review` | 评审模式 | 找 bug、回归风险、缺失测试 | `#review 帮我审一下这次提交的风险和缺失测试` |
| `#summary` | 摘要模式 | 压缩结果、汇报同步 | `#summary 把刚才的结果整理成三句话` |

### 推荐使用流程

1. 用 `#plan` 让 OMO 把任务拆开。
2. 用 `#start` 沿着最近那份计划继续推进。
3. 对复杂方案用 `#hyperplan`，对循环推进用 `#ulw-loop`。
4. 如果任务天然适合并行调查，直接用 `#team` 或 `#delegate`。
5. 如果你想尽量自动完成，直接用 `#ulw`。
6. 做完后用 `#summary` 收口，或者用 `#review` 从评审视角再过一遍。

### agent 自动路由

桥接层启动时会优先读取新版 OpenCode `/api/agent`，失败后回退到旧版 `/agent`。如果发现对应 agent，会按指令临时覆盖本次 prompt 的 agent：

| 指令 | 优先 agent |
|------|------------|
| `#plan` | `prometheus`、`plan`、`sisyphus` |
| `#start` / `#delegate` | `atlas`、`sisyphus` |
| `#team` / `#ulw` / `#ulw-loop` | `sisyphus` |
| `#deep` | `hephaestus`、`sisyphus` |
| `#review` | `momus`、`oracle`、`sisyphus` |
| `#search` | `librarian`、`explore`、`sisyphus` |
| `#analyze` | `metis`、`oracle`、`sisyphus` |

如果当前 OpenCode 没有暴露 agent 列表，桥接层会继续使用会话默认 agent。

### `#plan` 和 `#start` 的关系

- `#plan` 的最近一次结果会按微信用户单独缓存。
- 缓存文件路径是 `~/.claude/channels/wechat/omo_plan_context.json`。
- 同一微信用户后续发送 `#start` 时，桥接层会自动附带最近一次 `#plan` 的请求和回复。
- 如果当前没有可用的最近计划，`#start` 仍然可用，但桥接层会明确提示 OMO 现在没有缓存计划。

### 能力边界

- 这些前缀只会增强发给 OMO 的 prompt，不会改变普通消息、同步游标或微信回复机制。
- 桥接层不会直接控制 OMO 的内部多智能体执行细节，只是尽量把微信文本映射到更合适的工作流语义。
- 最终是否真的触发多智能体、并行调查或 ultrawork，仍取决于当前 OMO agent 的能力和配置。

### 按场景分类的微信示例

| 场景 | 建议指令 | 示例 |
|------|----------|------|
| 先规划再执行 | `#plan` | `#plan 帮我给这个需求拆一个实现计划` |
| 复杂结构化规划 | `#hyperplan` | `#hyperplan 帮我设计这个跨仓库迁移方案` |
| 沿着最近计划继续做 | `#start` | `#start 按刚才的计划继续做，先完成第一步` |
| 循环推进到可验证 | `#ulw-loop` | `#ulw-loop 持续做这个修复并验证` |
| 直接全自动推进 | `#ulw` | `#ulw 直接把这个问题从排查到修复都做完` |
| 并行调查 / 多智能体拆分 | `#team` / `#delegate` | `#team 帮我并行排查这个故障，最后汇总结论` |
| 资料检索 / 代码探索 | `#search` | `#search 查一下这个库现在推荐怎么配置` |
| 诊断分析 / 证据核查 | `#analyze` | `#analyze 帮我判断这次错误最可能的根因` |
| 深度分析 / 根因诊断 | `#deep` | `#deep 帮我彻底分析这段实现为什么会出问题` |
| 代码评审 / 风险检查 | `#review` | `#review 帮我审一下这次提交的风险和缺失测试` |
| 压缩总结 / 汇报同步 | `#summary` | `#summary 把刚才的结果整理成三句话` |

## 常用命令

```bash
bun setup.ts          # 扫码登录（或重新登录）
bun scripts/logout.ts # 登出：停止通道并清除本机凭据
bun index.ts          # 启动通道
bun run gui           # 启动浏览器图形控制台
./launchers/OpenCodeWeChatLauncher.command  # macOS 一键启动器（登录/登出/启动/停止菜单）
./launchers/OpenCodeWeChatGUI.command  # macOS 图形控制台
./launchers/OpenCodeWeChat.command  # macOS 一键运行
./launchers/StopOpenCodeWeChat.command  # macOS 一键停止
bun test              # 运行最小化自动化测试
bun run typecheck     # 静态类型检查
```

Linux 一键启动器：

```bash
./launchers/OpenCodeWeChatLauncher.sh
./launchers/OpenCodeWeChatGUI.sh
```

Windows 一键运行：

```cmd
launchers/OpenCodeWeChatLauncher.cmd
launchers/OpenCodeWeChatGUI.cmd
launchers/OpenCodeWeChat.cmd
Stoplaunchers/OpenCodeWeChat.cmd
```

## 一键启动打包

项目支持直接生成双击启动包，产物输出到 `dist/one-click/`：

```bash
bun run package:current   # 当前 macOS / Windows 系统打包
bun run package:mac       # macOS Apple Silicon + Intel
bun run package:win       # Windows x64
bun run package:all       # 全部一起打包
```

每个启动包包含：

- 主程序二进制
- 独立扫码登录工具
- 双击启动器
- 重新扫码启动器
- 停止运行中的通道脚本
- 可选配置模板 `opencode-wechat.env.example`

如果需要固定 agent、模型，或者手动指定 `opencode` 路径，可以把 `opencode-wechat.env.example` 复制为 `opencode-wechat.env`，再填写：

```bash
OPENCODE_AGENT=omo
# 或：
OPENCODE_BIN=/opt/homebrew/bin/opencode
```

Windows 如果提示找不到 OpenCode CLI，常见写法是：

```cmd
OPENCODE_BIN=C:\Users\你的用户名\AppData\Roaming\npm\opencode.cmd
```

注意：`package:current` 只面向 macOS / Windows。Linux 主要走源码部署方式。

macOS 如果双击后提示 `OpenCodeWeChat-GUI 已损坏，无法打开`，通常是 GitHub 下载隔离属性导致。请下载最新版启动包重新解压；仍有问题时，在解压后的包目录执行：

```bash
xattr -dr com.apple.quarantine .
```

## 本地状态文件

默认目录：

```text
~/.claude/channels/wechat/
```

主要文件：

- `account.json`：微信账号凭据
- `sync_buf.txt`：长轮询同步游标
- `context_tokens.json`：最近缓存的 `context_token`
- `processed_messages.json`：最近已处理消息去重记录
- `omo_plan_context.json`：最近一次 `#plan` 结果缓存
- `inbox/`：从微信下载的图片、视频、文件收件箱
- `channel.log`：通道运行日志（GUI 与终端启动均写入，超过 5MB 自动轮转为 `.old`）

## 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `HOME` | 系统默认值 | 本地状态目录前缀 |
| `OPENCODE_AGENT` | 未设置 | 可选，指定 OpenCode agent；`omo` / `sisyphus` 会映射到 OMO 主 agent，兼容新版 agent id 和旧版 agent name |
| `OPENCODE_PROVIDER_ID` | 未设置 | 可选，显式覆盖 OpenCode / OMO provider；通常建议留空 |
| `OPENCODE_MODEL_ID` | 未设置 | 可选，显式覆盖 OpenCode / OMO model；必须和 `OPENCODE_PROVIDER_ID` 同时设置。未设置时不传 `model` 字段，由 OpenCode / OMO 使用自己的模型配置 |
| `OPENCODE_BIN` | `opencode` | 可选，手动指定 OpenCode CLI 路径 |
| `OPENCODE_SERVER_PASSWORD` | 未设置 | OpenCode 本地 HTTP 服务认证密码 |
| `OPENCODE_SERVER_USERNAME` | `opencode` | OpenCode 本地 HTTP 服务认证用户名 |
| `OPENCODE_WECHAT_CDN_BASE_URL` | `https://novac2c.cdn.weixin.qq.com/c2c` | 可选，覆盖图片/视频/文件上传与下载使用的微信 CDN 地址 |
| `OPENCODE_WECHAT_INBOX_DIR` | `~/.claude/channels/wechat/inbox` | 可选，覆盖从微信下载媒体文件的保存目录 |
| `OPENCODE_WECHAT_GUI_PORT` | `5179` | 可选，GUI 控制台监听端口（仅绑定 127.0.0.1） |
| `OPENCODE_WECHAT_STREAM_CAPTURE` | `1` | 订阅 OpenCode SSE 作为最终回复完整性补充；不会把增量直接发成微信气泡。设为 `0` 可关闭 |
| `OPENCODE_WECHAT_TYPING` | `0` | 设为 `1` 开启微信"对方正在输入"指示器 |
| `OPENCODE_WECHAT_TYPING_MAX_MS` | `45000` | 输入中指示器开启后，单条消息最多保持的毫秒数，超时会自动取消 |
| `OPENCODE_WECHAT_PROMPT_TIMEOUT_MS` | `60000` | 单次 OpenCode 请求最大等待毫秒数，超时会中断并进入重试/跳过逻辑 |
| `OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS` | `300000` | PDF/报告/文件交付等长任务的 OpenCode 请求最大等待毫秒数 |
| `OPENCODE_WECHAT_TEXT_CHUNK_CHARS` | `500` | 可选，长回复最终发送时每条微信文本的最大字符数 |
| `OPENCODE_WECHAT_VERBOSE_LOGS` | `0` | 设为 `1` 时输出消息摘要；默认只记录消息长度，避免正文落盘 |

示例：

```bash
OPENCODE_AGENT=omo bun index.ts
```

```bash
OPENCODE_PROVIDER_ID=github-copilot OPENCODE_MODEL_ID=claude-sonnet-4.6 bun index.ts
```

通常不要同时设置 `OPENCODE_AGENT` 和 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID`，让 OMO 按自己的 agent 配置选择模型会更自然。遇到 `ProviderModelNotFoundError` 时，先删除 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID` 后重启。

## 测试与验证

项目目前自带一组最小化自动化测试，主要覆盖：

- 同步游标只在整批成功后推进
- 失败重试时保留旧游标
- 已处理消息去重
- `context_token` 回退
- OMO 指令解析与 prompt 编译
- `#plan -> #start` 续跑行为

运行方式：

```bash
bun test
```

## 项目结构

```text
OpenCodeWeChat/
├── api/
│   └── ilink.ts
├── core/
│   ├── context-token.ts
│   ├── message.ts
│   └── omo-command.ts
├── login/
│   └── qr.ts
├── opencode/
│   └── client.ts
├── polling/
│   └── loop.ts
├── storage/
│   ├── credentials.ts
│   ├── omo-plan-context.ts
│   ├── processed-messages.ts
│   └── sync-buffer.ts
├── tests/
│   ├── omo-command.test.ts
│   └── polling.test.ts
├── types/
│   └── wechat.ts
├── config.ts
├── index.ts
├── setup.ts
├── package.json
└── README.md
```

## 技术说明

- 微信接入基于官方 ilink REST API
- OpenCode 通信基于本地 `opencode serve` 的 HTTP 会话接口
- 默认日志不记录聊天正文；如需排障，可临时设置 `OPENCODE_WECHAT_VERBOSE_LOGS=1`
- 回复依赖 `context_token`；桥接层会自动缓存并尝试回退

## 部署与发布

- 源码部署、`launchd`、`systemd` 方案见 [DEPLOYMENT.md](DEPLOYMENT.md)
- 当前 release 说明见 [RELEASE-v0.4.0.md](RELEASE-v0.4.0.md)

## License

MIT
