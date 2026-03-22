# OpenCodeWeChat

通过微信官方 ClawBot ilink API，将微信消息桥接到 Claude Code 会话，让你直接在微信里与 Claude 对话。

## 效果预览

```
┌─────────────────────────────────────┐
│  微信 ClawBot                        │
│  ─────────────────                   │
│  你: 帮我写一个快速排序               │
│                                     │
│  Claude: 以下是快速排序实现...        │
│                                     │
│  你: 解释一下这个算法                 │
│                                     │
│  Claude: 快速排序是一种分治算法...    │
└─────────────────────────────────────┘
```

## 工作原理

```
┌──────────┐    ┌──────────────┐   ┌────────────┐   ┌─────────────────┐
│ 微信 iOS │───▶│ WeChat       │──▶│  ilink API │──▶│ OpenCodeWeChat  │
│          │    │ ClawBot      │   │            │   │                 │
└──────────┘    └──────────────┘   └────────────┘   └────────┬────────┘
                                                              │
                                                              ▼
                                                  ┌─────────────────────┐
                                                  │  Claude Code Session │
                                                  │                     │
                                                  │  <channel>          │
                                                  │  wechat_reply tool   │
                                                  └─────────────────────┘
```

1. **接收消息** — 通过 `ilink/bot/getupdates` 长轮询获取微信用户消息
2. **转发消息** — 通过 MCP Channel Protocol 将消息推送到 Claude Code 会话
3. **发送回复** — Claude 调用 `wechat_reply` 工具，插件通过 `ilink/bot/sendmessage` 发回微信

## 前置要求

- [Bun](https://bun.sh) >= 1.0
- [Claude Code](https://claude.com/claude-code) >= 2.1.80
- claude.ai 账号登录（不支持 API Key）
- 微信 iOS 最新版（需支持 ClawBot 插件）

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
# 获取二维码链接后手动在微信中扫码
bun -e "import {fetchQRCode} from './src/api/ilink.ts'; const q = await fetchQRCode('https://ilinkai.weixin.qq.com'); console.log(q.qrcode_img_content);"
```

### 3. 启动通道

```bash
bun src/index.ts
```

### 4. 开始对话

在微信中找到 ClawBot 对话，发送消息。Claude Code 终端会收到消息并自动回复。

## 项目结构

```
OpenCodeWeChat/
├── src/
│   ├── api/ilink.ts          # ilink API 客户端
│   ├── config.ts              # 配置常量
│   ├── core/
│   │   ├── message.ts         # 消息解析、文本提取、引用消息
│   │   └── context-token.ts    # Context token 缓存
│   ├── login/qr.ts            # QR 码登录流程
│   ├── mcp/
│   │   ├── server.ts           # MCP Server 创建
│   │   └── tools.ts            # wechat_reply 工具定义
│   ├── polling/loop.ts        # 长轮询消息循环
│   ├── storage/
│   │   ├── credentials.ts      # 凭据加载/保存
│   │   └── sync-buffer.ts      # Sync buffer 持久化
│   └── index.ts               # 入口
├── setup.ts                    # 独立扫码登录工具
├── tsconfig.json
├── package.json
├── .mcp.json                  # Claude Code MCP 配置
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

连续失败时会触发指数退避重试（最多等待 30 秒），避免对服务端造成压力。

### Sync Buffer

微信消息通过 `get_updates_buf` 实现幂等同步。每次 getupdates 返回的 buffer 会持久化到本地，重启后可从断点继续，不会漏消息也不会重复推送。

### MCP Channel Protocol

插件通过 MCP 的 experimental channel 协议扩展与 Claude Code 通信：

- **消息推送**：`notifications/claude/channel` — 将微信消息推入会话
- **回复工具**：`wechat_reply` — Claude 调用此工具发回微信

### Context Token

微信消息需要 `context_token` 才能回复。插件在收到消息时自动缓存对应用户的 token，调用 `wechat_reply` 时取出使用。

## 常用命令

```bash
bun setup.ts           # 扫码登录（或重新登录）
bun src/index.ts       # 启动通道
bun src/index.ts       # 已有凭据时直接启动
```

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `HOME` | 系统默认值 | 凭据保存目录前缀 |

凭据文件路径：`~/.claude/channels/wechat/account.json`

## 注意事项

- 当前为研究预览阶段，需要 Claude Code 使用 `--dangerously-load-development-channels` 标志
- 每次启动只能连接一个 ClawBot 实例
- 微信 ClawBot 目前仅支持 iOS 最新版
- Claude Code 会话关闭后通道也会断开

## License

MIT
