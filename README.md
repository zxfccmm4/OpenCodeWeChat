# OpenCodeWeChat

把微信变成 OpenCode / OMO 的移动入口。

OpenCodeWeChat 通过微信官方 ClawBot ilink API，把微信消息桥接到本地 OpenCode 会话，让你直接在微信里发起对话、规划任务、续跑计划，并触发 OMO 工作流。

适合这样的场景：

- 想把 OpenCode / OMO 从终端带到微信里随时可用
- 想在微信里直接发 `#plan`、`#start`、`#ulw` 这类 OMO 指令
- 想要比纯 demo 更可靠的消息桥接：支持游标保护、消息去重和 `context_token` 回退

## 效果预览

![微信对话效果](wechat_1.jpg)

![微信对话效果](wechat_2.jpg)

## 当前能力

| 能力 | 说明 |
|------|------|
| 微信扫码登录 | 支持独立登录流程，凭据保存在本地 `~/.claude/channels/wechat/` |
| 自动拉起 OpenCode | 启动时自动执行 `opencode serve`，通过本地 HTTP 会话与 OpenCode 通信 |
| 长轮询收发微信消息 | 基于 `ilink/bot/getupdates` + `ilink/bot/sendmessage` 实现近实时消息桥接 |
| 可靠同步 | 只有整批消息成功处理后才推进同步游标，避免处理中断时丢消息 |
| 已处理消息去重 | 本地持久化最近处理过的入站消息 ID，减少重试时重复回复 |
| `context_token` 回退 | 缓存并持久化最近可用的 `context_token`，消息缺少 token 时尝试回退 |
| OMO 微信协议 | 支持 `#plan`、`#start`、`#ulw`、`#delegate`、`#deep`、`#review`、`#summary` |
| OMO 计划续跑 | `#plan` 的最近结果会按微信用户缓存，后续 `#start` 可自动续跑 |
| 一键启动包 | 支持生成 macOS Apple Silicon、macOS Intel、Windows x64 启动包 |
| 最小化自动化测试 | 覆盖轮询游标、消息去重、`context_token` 回退、OMO 指令协议等关键回归 |

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

1. 通过 `ilink/bot/getupdates` 长轮询拉取微信用户消息。
2. 本地启动 `opencode serve`，创建 OpenCode 会话。
3. 把微信文本转成 OpenCode prompt，必要时附加 OMO 指令增强。
4. 把 OpenCode 返回的文本通过 `ilink/bot/sendmessage` 发回微信。

## 环境要求

- [Bun](https://bun.sh) >= 1.0
- 本机已安装并登录 [OpenCode](https://opencode.ai) CLI，且 `opencode` 命令可用
- 微信 iOS 或 Android 最新版，且支持 ClawBot

如果你打算用 OMO，还需要：

- 已安装并配置 OMO / oh-my-openagent
- `opencode agent list` 能看到 `Sisyphus - Ultraworker`

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

### 4. 开始对话

在微信中找到 ClawBot 对话，发送普通文本或 OMO 指令协议消息即可。OpenCodeWeChat 会自动收消息并回微信。

## OMO 微信协议使用指南

当你通过 `OPENCODE_AGENT=omo` 或 `OPENCODE_AGENT=sisyphus` 启动时，可以在微信消息前加轻量前缀。桥接层会把这些前缀翻译成更贴近官方 OMO 工作流的 prompt。

### 使用前提

- 启动通道时设置 `OPENCODE_AGENT=omo` 或 `OPENCODE_AGENT=sisyphus`
- 本机 OpenCode / OMO 已正确注册 `Sisyphus - Ultraworker`
- 微信入口仍然是纯文本消息；桥接层只做 prompt 增强，不会在微信里直接暴露终端命令面板

### 指令表

| 前缀 | 映射语义 | 适合场景 | 示例 |
|------|----------|----------|------|
| `#ulw` / `#ultrawork` | 官方 `ultrawork` | 想让 OMO 尽量自主一路做完 | `#ulw 直接把这个问题从排查到修复都做完` |
| `#plan` | Prometheus / `@plan` | 先拆任务、先出计划 | `#plan 帮我给这个需求拆一个实现计划` |
| `#start` | Atlas / `/start-work` | 沿着最近一次计划继续执行 | `#start 按刚才的计划继续做，先完成第一步` |
| `#delegate` | 多智能体委派 | 并行调查、分工处理 | `#delegate 帮我并行排查这个故障，最后汇总结论` |
| `#deep` | 深度分析 | 根因诊断、复杂实现分析 | `#deep 帮我彻底分析这段实现为什么会出问题` |
| `#review` | 评审模式 | 找 bug、回归风险、缺失测试 | `#review 帮我审一下这次提交的风险和缺失测试` |
| `#summary` | 摘要模式 | 压缩结果、汇报同步 | `#summary 把刚才的结果整理成三句话` |

### 推荐使用流程

1. 用 `#plan` 让 OMO 把任务拆开。
2. 用 `#start` 沿着最近那份计划继续推进。
3. 如果任务天然适合并行调查，直接用 `#delegate`。
4. 如果你想尽量自动完成，直接用 `#ulw`。
5. 做完后用 `#summary` 收口，或者用 `#review` 从评审视角再过一遍。

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
| 沿着最近计划继续做 | `#start` | `#start 按刚才的计划继续做，先完成第一步` |
| 直接全自动推进 | `#ulw` | `#ulw 直接把这个问题从排查到修复都做完` |
| 并行调查 / 多智能体拆分 | `#delegate` | `#delegate 帮我并行排查这个故障，最后汇总结论` |
| 深度分析 / 根因诊断 | `#deep` | `#deep 帮我彻底分析这段实现为什么会出问题` |
| 代码评审 / 风险检查 | `#review` | `#review 帮我审一下这次提交的风险和缺失测试` |
| 压缩总结 / 汇报同步 | `#summary` | `#summary 把刚才的结果整理成三句话` |

## 常用命令

```bash
bun setup.ts          # 扫码登录（或重新登录）
bun index.ts          # 启动通道
bun test              # 运行最小化自动化测试
bun run typecheck     # 静态类型检查
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
- 可选配置模板 `opencode-wechat.env.example`

如果需要固定 agent、模型，或者手动指定 `opencode` 路径，可以把 `opencode-wechat.env.example` 复制为 `opencode-wechat.env`，再填写：

```bash
OPENCODE_AGENT=omo
# 或：
OPENCODE_BIN=/opt/homebrew/bin/opencode
```

注意：`package:current` 只面向 macOS / Windows。Linux 主要走源码部署方式。

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

## 配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `HOME` | 系统默认值 | 本地状态目录前缀 |
| `OPENCODE_AGENT` | 未设置 | 可选，指定 OpenCode agent；`omo` / `sisyphus` 会映射到 OMO 主 agent |
| `OPENCODE_PROVIDER_ID` | 未设置 | 可选，固定 OpenCode provider |
| `OPENCODE_MODEL_ID` | 未设置 | 可选，固定 OpenCode model；必须和 `OPENCODE_PROVIDER_ID` 同时设置 |
| `OPENCODE_BIN` | `opencode` | 可选，手动指定 OpenCode CLI 路径 |
| `OPENCODE_SERVER_PASSWORD` | 未设置 | OpenCode 本地 HTTP 服务认证密码 |
| `OPENCODE_SERVER_USERNAME` | `opencode` | OpenCode 本地 HTTP 服务认证用户名 |
| `OPENCODE_WECHAT_VERBOSE_LOGS` | `0` | 设为 `1` 时输出消息摘要；默认只记录消息长度，避免正文落盘 |

示例：

```bash
OPENCODE_AGENT=omo bun index.ts
```

```bash
OPENCODE_PROVIDER_ID=github-copilot OPENCODE_MODEL_ID=claude-sonnet-4.6 bun index.ts
```

通常不要同时设置 `OPENCODE_AGENT` 和 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID`，让 OMO 按自己的 agent 配置选择模型会更自然。

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
- 当前 release 说明见 [RELEASE-v0.2.0.md](RELEASE-v0.2.0.md)

## License

MIT
