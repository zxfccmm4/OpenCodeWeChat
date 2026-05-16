# OpenCodeWeChat 部署文档

本文档面向“从源码包部署 OpenCodeWeChat”的场景，覆盖安装、微信登录、前台运行、`launchd` / `systemd` 托管、OMO 快速使用、验证与排障。

## 适用场景

推荐在以下场景使用本部署文档：

- 你拿到的是源码包或 git 仓库，而不是现成一键启动包
- 你希望在 macOS `launchd` 或 Linux `systemd` 下长期运行
- 你希望在部署后通过微信直接触发 OMO / Sisyphus

如果你只是想双击运行，优先使用 release 里的 macOS / Windows 一键启动包。

## 环境要求

部署机需要满足：

- macOS 或 Linux
- Bun >= 1.0
- OpenCode CLI 可用，且 `opencode` 在 `PATH` 中
- OpenCode 已完成本机登录
- 微信 iOS 或 Android 最新版，并支持 ClawBot

如果要使用 OMO，还需要：

- 已安装并配置 OMO / oh-my-openagent
- `opencode agent list` 能看到 `Sisyphus - Ultraworker`

建议先检查：

```bash
bun --version
opencode --version
opencode agent list
```

## 部署产物

推荐使用源码包部署：

```bash
opencode-wechat-0.2.0.tar.gz
```

源码包通常包含：

- TypeScript 源码
- `package.json`
- `bun.lock`
- `README.md`
- `DEPLOYMENT.md`

源码包通常不包含：

- `node_modules/`
- 微信登录凭据
- OpenCode 本地配置
- 运行日志

## 安装

示例部署目录：

```bash
sudo mkdir -p /opt/opencode-wechat
sudo chown "$USER" /opt/opencode-wechat
tar -xzf opencode-wechat-0.2.0.tar.gz -C /opt/opencode-wechat --strip-components=1
cd /opt/opencode-wechat
bun install --frozen-lockfile
bun run typecheck
```

如果部署机使用特殊 npm registry，可以提前配置 `bunfig.toml`，或者使用 Bun 全局 registry 配置。

## 微信登录

首次需要在部署机执行：

```bash
cd /opt/opencode-wechat
bun setup.ts
```

扫码确认后，微信凭据会保存到：

```text
~/.claude/channels/wechat/account.json
```

建议确认权限：

```bash
chmod 600 ~/.claude/channels/wechat/account.json
```

## 前台运行

使用 OpenCode 默认模型：

```bash
cd /opt/opencode-wechat
bun index.ts
```

使用 OMO 主 agent：

```bash
cd /opt/opencode-wechat
OPENCODE_AGENT=omo bun index.ts
```

如果需要固定 provider / model：

```bash
OPENCODE_PROVIDER_ID=github-copilot OPENCODE_MODEL_ID=claude-sonnet-4.6 bun index.ts
```

注意：

- `OPENCODE_PROVIDER_ID` 和 `OPENCODE_MODEL_ID` 必须同时设置或同时不设置
- 通常不要同时设置 `OPENCODE_AGENT` 和 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID`

启动成功时，日志应类似：

```text
[opencode] 使用 OpenCode 默认模型
[opencode] 使用 agent: Sisyphus - Ultraworker
[polling] 开始监听微信消息...
```

默认日志不会记录聊天正文。如果需要临时排障，可附加：

```bash
OPENCODE_WECHAT_VERBOSE_LOGS=1 bun index.ts
```

## OMO 微信协议快速使用

如果通过 `OPENCODE_AGENT=omo` 或 `OPENCODE_AGENT=sisyphus` 启动，可以在微信里直接发送以下前缀：

- `#ulw` / `#ultrawork`
- `#plan`
- `#start`
- `#delegate`
- `#deep`
- `#review`
- `#summary`

简版建议：

- 不确定怎么开始，先发 `#plan`
- 想沿着最近一次计划继续，发 `#start`
- 想让 OMO 尽量自主一路做完，发 `#ulw`
- 想做风险检查或结果压缩，分别用 `#review` 和 `#summary`

可直接发送的微信示例：

```text
#plan 帮我给这个故障排查拆一个计划
#start 按刚才的计划继续推进
#ulw 直接把这个问题从排查到修复都做完
```

更完整的场景说明和分类示例，见 [README.md](/Users/stevezhou/OpenCodeWeChat/README.md) 里的“OMO 微信协议使用指南”。

## 本地状态目录

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

一般不要手动删除这些文件。只有在明确需要重新同步或清空某类缓存状态时，才有选择地处理。

## macOS launchd 托管

创建目录：

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/OpenCodeWeChat
```

创建 `~/Library/LaunchAgents/com.local.opencode-wechat.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.opencode-wechat</string>

  <key>WorkingDirectory</key>
  <string>/opt/opencode-wechat</string>

  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/bun</string>
    <string>index.ts</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/Users/yourname</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>OPENCODE_AGENT</key>
    <string>omo</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/yourname/Library/Logs/OpenCodeWeChat/stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/yourname/Library/Logs/OpenCodeWeChat/stderr.log</string>
</dict>
</plist>
```

根据实际环境替换：

- `/opt/homebrew/bin/bun`
- `/opt/opencode-wechat`
- `/Users/yourname`

加载服务：

```bash
launchctl unload ~/Library/LaunchAgents/com.local.opencode-wechat.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.local.opencode-wechat.plist
launchctl start com.local.opencode-wechat
```

查看日志：

```bash
tail -f ~/Library/Logs/OpenCodeWeChat/stderr.log
```

停止服务：

```bash
launchctl stop com.local.opencode-wechat
launchctl unload ~/Library/LaunchAgents/com.local.opencode-wechat.plist
```

## Linux systemd 托管

创建 `/etc/systemd/system/opencode-wechat.service`：

```ini
[Unit]
Description=OpenCodeWeChat bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opencode
WorkingDirectory=/opt/opencode-wechat
Environment=HOME=/home/opencode
Environment=PATH=/home/opencode/.bun/bin:/usr/local/bin:/usr/bin:/bin
Environment=OPENCODE_AGENT=omo
ExecStart=/home/opencode/.bun/bin/bun index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable opencode-wechat
sudo systemctl start opencode-wechat
```

查看日志：

```bash
journalctl -u opencode-wechat -f
```

## 验证部署

启动后，在微信 ClawBot 对话里发一条测试消息，例如：

```text
hello
```

日志中应出现：

```text
[polling] 收到消息
[polling] 发送至 OpenCode...
[opencode] 收到响应
[polling] 已发送回复
```

如果只想验证 OMO agent 是否可用：

```bash
opencode agent list | grep "Sisyphus - Ultraworker"
```

## 升级流程

停止服务：

```bash
launchctl stop com.local.opencode-wechat
```

Linux：

```bash
sudo systemctl stop opencode-wechat
```

备份本地状态：

```bash
cp -a ~/.claude/channels/wechat ~/.claude/channels/wechat.backup.$(date +%Y%m%d%H%M%S)
```

替换代码并安装依赖：

```bash
cd /opt/opencode-wechat
tar -xzf /path/to/opencode-wechat-0.2.0.tar.gz -C /opt/opencode-wechat --strip-components=1
bun install --frozen-lockfile
bun run typecheck
```

然后重新启动服务。

## 常见问题

### `未找到 OpenCode agent`

检查：

```bash
opencode agent list
```

如果你打算使用 OMO，确认列表里有：

```text
Sisyphus - Ultraworker
```

### `Prompt 失败: 500`

先确认启动日志里是否真的用了 OMO agent：

```text
[opencode] 使用 agent: Sisyphus - Ultraworker
```

如果没有，确认启动时设置了：

```bash
OPENCODE_AGENT=omo
```

### 微信收不到回复

检查日志中是否出现：

```text
[polling] 已发送回复
```

如果出现了：

```text
[opencode] 收到响应
```

但没有 `已发送回复`，常见原因包括：

- 入站消息缺少可用的 `context_token`，且本地缓存里也没有该用户最近的 token
- ilink `sendmessage` 请求失败
- 当前批次后续消息处理失败，游标被故意保留等待重试

### 重启后重复或漏消息

优先检查：

```text
~/.claude/channels/wechat/sync_buf.txt
~/.claude/channels/wechat/processed_messages.json
```

一般不要手动删除。只有在明确需要重新同步或清空去重状态时，才有选择地处理。

### 避免多个实例同时运行

同一个微信 ClawBot 账号只应运行一个 OpenCodeWeChat 实例。检查命令：

```bash
pgrep -fl "bun index.ts|opencode serve"
```

如果看到多个 `bun index.ts`，只保留一个实例。
