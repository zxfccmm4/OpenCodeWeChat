# OpenCodeWeChat

通过微信官方 ClawBot ilink API，将微信消息桥接到本地 OpenCode 会话，让你直接在微信里与 OpenCode 对话。

## 效果预览

![微信对话效果](wechat_1.jpg)

![微信对话效果](wechat_2.jpg)

## 工作原理

```
┌──────────┐    ┌──────────────┐   ┌────────────┐   ┌─────────────────┐
│ 微信客户端 │──▶│ WeChat       │──▶│  ilink API │──▶│ OpenCodeWeChat  │
│          │    │ ClawBot      │   │            │   │                 │
└──────────┘    └──────────────┘   └────────────┘   └────────┬────────┘
                                                              │
                                                              ▼
                                                  ┌─────────────────────┐
                                                  │  opencode serve     │
                                                  │  本地 HTTP 服务      │
                                                  │                     │
                                                  │  POST /session      │
                                                  │  POST /message      │
                                                  └─────────────────────┘
```

1. **接收消息** — 通过 `ilink/bot/getupdates` 长轮询获取微信用户消息
2. **启动 OpenCode** — 本地拉起 `opencode serve`，创建短生命周期 HTTP 服务
3. **转发消息** — 通过 `/session` 创建会话，再通过 `/session/:id/message` 发送用户消息
4. **发送回复** — AI 响应通过 `ilink/bot/sendmessage` 发回微信

## 前置要求

- [Bun](https://bun.sh) >= 1.0
- 本机已安装并登录 [OpenCode](https://opencode.ai) CLI，且 `opencode` 命令可用
- 微信 iOS 或 Android 最新版（需支持 ClawBot 插件）

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

终端会显示二维码，用微信扫描并在 ClawBot 中确认。凭据保存到 `~/.claude/channels/wechat/account.json`。

如果终端二维码显示不完整，可以用以下方式获取链接：

```bash
bun -e "import {fetchQRCode} from './api/ilink.ts'; const q = await fetchQRCode('https://ilinkai.weixin.qq.com'); console.log(q.qrcode_img_content);"
```

### 3. 启动通道

```bash
bun index.ts
```

### 4. 开始对话

在微信中找到 ClawBot 对话，发送消息。OpenCodeWeChat 进程会收到消息并自动回复。

## 项目结构

```
OpenCodeWeChat/
├── api/
│   └── ilink.ts               # ilink API 客户端
├── core/
│   ├── message.ts             # 消息解析、文本提取、引用消息
│   └── context-token.ts       # Context token 缓存
├── login/
│   └── qr.ts                  # QR 码登录流程
├── opencode/
│   └── client.ts              # OpenCode 本地服务启动与会话请求
├── polling/
│   └── loop.ts                # 长轮询消息循环
├── storage/
│   ├── credentials.ts         # 凭据加载/保存
│   ├── processed-messages.ts  # 已处理消息去重状态
│   └── sync-buffer.ts         # Sync buffer 持久化
├── tests/
│   └── polling.test.ts        # 轮询处理回归测试
├── types/
│   └── wechat.ts              # TypeScript 类型定义
├── config.ts                  # 配置常量
├── index.ts                   # 入口
├── setup.ts                   # 独立扫码登录工具
├── tsconfig.json
├── package.json
└── README.md
```

## 技术实现

### ilink API

ilink 是微信官方的 ClawBot 通信协议，基于 HTTPS REST API。主要端点：

| 端点 | 用途 |
|------|------|
| `GET ilink/bot/get_bot_qrcode` | 获取登录二维码 |
| `GET ilink/bot/get_qrcode_status` | 轮询扫码状态 |
| `POST ilink/bot/getupdates` | 长轮询获取新消息 |
| `POST ilink/bot/sendmessage` | 发送消息 |

### 长轮询机制

`getupdates` 采用 35 秒长轮询，服务端 hold 住请求直到有新消息或超时。超时后立即发起下一次轮询，实现近乎实时的消息推送。

连续失败时会触发分级退避重试：前两次短暂重试，达到阈值后等待 30 秒，避免对服务端造成压力。

### Sync Buffer

微信消息通过 `get_updates_buf` 实现断点续传。插件会在整批消息成功处理后再推进本地游标；如果处理中断，会保留旧游标并在重启后重试。为避免重试时重复回复，最近处理过的入站消息 ID 会额外持久化去重。

### OpenCode 本地服务

插件不会直接在当前进程里嵌入模型调用，而是先拉起本地 `opencode serve`：

- **启动本地服务**：自动执行 `opencode serve --hostname=127.0.0.1 --port=0`
- **创建会话**：通过 `POST /session` 创建 OpenCode 会话
- **发送消息**：通过 `POST /session/:id/message` 转发微信文本
- **认证方式**：使用 `OPENCODE_SERVER_PASSWORD` 生成 HTTP Basic Auth
- **可选路由**：可通过 `OPENCODE_AGENT` 或 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID` 指定 agent / 模型

### Context Token

微信消息需要 `context_token` 才能回复。插件会在收到消息时自动缓存对应用户的 token，并持久化到本地；如果后续消息未带 token，会优先回退到最近缓存值。

## 常用命令

```bash
bun setup.ts    # 扫码登录（或重新登录）
bun index.ts    # 启动通道（已有凭据时直接启动）
```

## 运行测试

项目包含一组最小化自动化测试，用来验证轮询消息处理的关键回归场景，例如同步游标推进、已处理消息去重，以及 `context_token` 缓存回退。

```bash
bun test
```

如果只想先做静态类型检查，可以运行：

```bash
bun run typecheck
```

## 一键启动打包

项目现在支持直接生成双击启动包，产物会输出到 `dist/one-click/`：

```bash
bun run package:current   # 为当前 macOS / Windows 系统打包
bun run package:mac       # 生成 macOS Apple Silicon + Intel 包
bun run package:win       # 生成 Windows x64 包
bun run package:all       # 全部一起打包
```

每个启动包都会包含：

- 主程序二进制：`bin/OpenCodeWeChat` / `bin/OpenCodeWeChat.exe`
- 独立登录工具：`bin/OpenCodeWeChat-Setup` / `bin/OpenCodeWeChat-Setup.exe`
- 双击启动器：`OpenCodeWeChat.command` 或 `OpenCodeWeChat.bat`
- 重新扫码启动器：`Login WeChat.command` 或 `Login WeChat.bat`
- 可选配置模板：`opencode-wechat.env.example`

首次跨平台打包时，Bun 可能需要联网下载对应平台的运行时。

如果需要固定 agent、模型，或者手动指定 `opencode` 路径，可以把启动包目录里的 `opencode-wechat.env.example` 复制为 `opencode-wechat.env`，再填写：

```bash
OPENCODE_AGENT=omo
# 或：
OPENCODE_BIN=/opt/homebrew/bin/opencode
```

## 部署

部署到 macOS launchd、Linux systemd 或从源码包安装时，参考 [DEPLOYMENT.md](DEPLOYMENT.md)。

GitHub Release 中的 `opencode-wechat-0.2.0.tar.gz` 是完整源码包，包含 README、部署文档、TypeScript 源码、`bun.lock` 和效果预览截图资源。下载后可用以下方式校验：

```bash
shasum -a 256 opencode-wechat-0.2.0.tar.gz
```

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `HOME` | 系统默认值 | 凭据保存目录前缀 |
| `OPENCODE_PROVIDER_ID` | 未设置 | 可选，指定 OpenCode provider；不设置时使用 OpenCode 默认模型 |
| `OPENCODE_MODEL_ID` | 未设置 | 可选，指定 OpenCode model；必须和 `OPENCODE_PROVIDER_ID` 同时设置 |
| `OPENCODE_AGENT` | 未设置 | 可选，指定 OpenCode agent；例如 `omo` 或 `sisyphus` 使用 OMO 主 agent |
| `OPENCODE_WECHAT_VERBOSE_LOGS` | `0` | 可选，设为 `1` 时在日志中输出消息摘要；默认只记录消息长度，避免正文落盘 |

凭据文件路径：`~/.claude/channels/wechat/account.json`

其他本地状态文件：

- `~/.claude/channels/wechat/sync_buf.txt`：长轮询同步游标
- `~/.claude/channels/wechat/context_tokens.json`：最近缓存的 `context_token`
- `~/.claude/channels/wechat/processed_messages.json`：最近已处理消息去重记录

例如固定使用 GitHub Copilot 的默认 Claude Sonnet：

```bash
OPENCODE_PROVIDER_ID=github-copilot OPENCODE_MODEL_ID=claude-sonnet-4.6 bun index.ts
```

使用 OMO / oh-my-openagent：

```bash
OPENCODE_AGENT=omo bun index.ts
```

`omo` / `sisyphus` 会自动映射为 OpenCode 注册的 `Sisyphus - Ultraworker` agent。通常不要同时设置 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID`，让 OMO 按自己的 agent 配置选择模型。

## 注意事项

- 使用 `OPENCODE_SERVER_PASSWORD` 环境变量进行认证（OpenCode 桌面应用已设置）
- 每次启动只能连接一个 ClawBot 实例
- 微信 ClawBot 支持 iOS 和 Android 最新版
- OpenCode 会话关闭后通道也会断开
- 默认日志不会记录聊天正文；如需排障，可临时设置 `OPENCODE_WECHAT_VERBOSE_LOGS=1`

## License

MIT
