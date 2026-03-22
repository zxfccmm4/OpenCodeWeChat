# OpenCodeWeChat

将微信消息桥接到 Claude Code 会话的 Channel 插件。

基于微信官方 ClawBot ilink API，将微信消息接入 Claude Code，让你在微信中直接与 Claude 对话。

## 工作原理

```
微信 (iOS) → WeChat ClawBot → ilink API → [本插件] → Claude Code Session
                                                  ↕
Claude Code ← MCP Channel Protocol ← wechat_reply tool
```

## 项目结构

```
src/
├── api/           # ilink API 客户端
├── core/          # 消息解析、Context token 缓存
├── login/         # QR 码登录流程
├── mcp/           # MCP Server + tools
├── polling/       # 长轮询消息循环
├── storage/       # 凭据、Sync buffer 持久化
├── config.ts      # 配置常量
└── index.ts       # 入口
```

## 前置要求

- [Bun](https://bun.sh) >= 1.0
- [Claude Code](https://claude.com/claude-code) >= 2.1.80
- 微信 iOS 最新版（需支持 ClawBot 插件）

## 快速开始

### 1. 安装依赖

```bash
cd OpenCodeWeChat
bun install
```

### 2. 微信扫码登录

```bash
bun setup.ts
```

### 3. 启动通道

```bash
bun src/index.ts
```

## License

MIT
