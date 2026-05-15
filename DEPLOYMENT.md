# OpenCodeWeChat 部署文档

本文档说明如何从源码包部署 OpenCodeWeChat，并使用 OpenCode 的 OMO agent 处理微信消息。

## 1. 部署产物

推荐使用源码包部署：

```bash
opencode-wechat-0.2.0.tar.gz
```

源码包包含 TypeScript 源码、`package.json`、`bun.lock`、README 和部署文档；不包含：

- `node_modules/`
- 微信登录凭据
- OpenCode 本地配置
- 运行日志

微信凭据默认保存到：

```bash
~/.claude/channels/wechat/account.json
~/.claude/channels/wechat/sync_buf.txt
```

## 2. 服务器要求

部署机需要满足：

- macOS 或 Linux
- Bun >= 1.0
- OpenCode CLI 可用，且 `opencode` 在 `PATH` 中
- OpenCode 已配置可用模型或已安装并配置 OMO / oh-my-openagent
- 微信 iOS 最新版，并支持 ClawBot

检查命令：

```bash
bun --version
opencode --version
opencode agent list
```

如果要使用 OMO，`opencode agent list` 中应能看到 `Sisyphus - Ultraworker`。

## 3. 解包安装

把源码包放到部署目录，例如 `/opt/opencode-wechat`：

```bash
sudo mkdir -p /opt/opencode-wechat
sudo chown "$USER" /opt/opencode-wechat
tar -xzf opencode-wechat-0.2.0.tar.gz -C /opt/opencode-wechat --strip-components=1
cd /opt/opencode-wechat
bun install --frozen-lockfile
bun run typecheck
```

如果部署机使用非默认 npm registry，可以在安装前设置：

```bash
bunfig.toml
```

或直接使用环境变量 / Bun 全局配置；项目本身不要求固定 registry。

## 4. 首次登录微信 ClawBot

在部署机执行：

```bash
cd /opt/opencode-wechat
bun setup.ts
```

终端会显示二维码。用微信扫码并在 ClawBot 中确认后，凭据会保存到：

```bash
~/.claude/channels/wechat/account.json
```

建议确认权限：

```bash
chmod 600 ~/.claude/channels/wechat/account.json
```

## 5. 前台启动

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

启动成功时应看到类似日志：

```text
[opencode] 使用 OpenCode 默认模型
[opencode] 使用 agent: Sisyphus - Ultraworker
[polling] 开始监听微信消息...
```

`OPENCODE_AGENT=omo` 会自动解析为 OpenCode 注册的 `Sisyphus - Ultraworker`。通常不要同时设置 `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID`，让 OMO 按自身 agent 配置选择模型。

如果确实要固定模型，可以使用：

```bash
OPENCODE_PROVIDER_ID=github-copilot OPENCODE_MODEL_ID=claude-sonnet-4.6 bun index.ts
```

`OPENCODE_PROVIDER_ID` 和 `OPENCODE_MODEL_ID` 必须同时设置或同时不设置。

## 6. macOS launchd 托管

创建 LaunchAgent：

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
    <string>/Users/stevezhou</string>
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
  <string>/Users/stevezhou/Library/Logs/OpenCodeWeChat/stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/stevezhou/Library/Logs/OpenCodeWeChat/stderr.log</string>
</dict>
</plist>
```

根据实际路径替换：

- `/opt/homebrew/bin/bun`：用 `which bun` 查看
- `/opt/opencode-wechat`：项目部署目录
- `/Users/stevezhou`：运行用户的 HOME

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

## 7. Linux systemd 托管

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

## 8. 验证部署

启动后在微信 ClawBot 对话里发送一条测试消息，例如：

```text
hello
```

日志中应出现：

```text
[polling] 收到消息
[polling] 发送至 OpenCode...
[opencode] 响应:
[polling] 已发送回复
```

如果只想验证 OpenCode agent 是否可用，可以先执行：

```bash
opencode agent list | grep "Sisyphus - Ultraworker"
```

## 9. 升级流程

停止服务：

```bash
launchctl stop com.local.opencode-wechat
```

或 Linux：

```bash
sudo systemctl stop opencode-wechat
```

备份凭据：

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

重新启动服务。

## 10. 常见问题

### `Prompt 失败: 500`

先确认启动日志里的 agent：

```text
[opencode] 使用 agent: Sisyphus - Ultraworker
```

如果没有这行，确认启动命令设置了：

```bash
OPENCODE_AGENT=omo
```

如果报 `未找到 OpenCode agent`，说明部署机上的 OpenCode / OMO 没有注册 `Sisyphus - Ultraworker`，需要先修复 OpenCode 插件配置。

### 微信收不到回复

检查日志中是否出现：

```text
[polling] 已发送回复
```

如果只有 `OpenCode 响应` 但没有 `已发送回复`，通常是入站消息没有 `context_token` 或 ilink `sendmessage` 失败。

### 重启后重复或漏消息

同步状态保存在：

```bash
~/.claude/channels/wechat/sync_buf.txt
```

一般不要手动删除。只有在明确需要重新同步时才删除它。

### 避免多个实例同时运行

同一个微信 ClawBot 账号只应运行一个 OpenCodeWeChat 实例。检查命令：

```bash
pgrep -fl "bun index.ts|opencode serve"
```

如果有多个 `bun index.ts`，保留一个并停止其他实例。
