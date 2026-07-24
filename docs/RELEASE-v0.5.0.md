# OpenCodeWeChat v0.5.0

OpenCodeWeChat `v0.5.0` 已发布。

本版本在 v0.4.0 桥接能力之上，补齐聊天绑定与斜杠命令闭环，并重做 GUI 控制台（macOS 设置页风格）。

## 更新摘要

### 聊天绑定与机器人命令

- 六位一次性绑定码：GUI 生成，微信 `/bind 123456` 消费；未绑定用户不能调用本机 OpenCode。
- 完整斜杠命令：`/帮助`、`/状态`、`/新建`、`/项目`、`/模型`、`/模式`、`/思考`、`/回复`、`/bind`（中英文别名）。
- 首次联系自动发送欢迎与命令说明（按用户只发一次）。
- 绑定偏好按微信用户持久化（项目、模型、agent、思考级别、回复风格、session）。

### GUI 控制台

- macOS 26 设置页风格：侧边栏 + 分组表单 + 液态玻璃窗体。
- 侧边栏搜索过滤导航项。
- 外观：自动 / 浅色 / 深色（跟随系统，可手动覆盖，localStorage 记忆）。
- 扫码登录、启停通道、生成/复制绑定码、解除绑定、Session 历史、实时日志。

### 稳定性

- 微信 `errcode=-14`（session timeout）视为终端错误：停止空转重试，清理失效 `account.json`，提示重新扫码。
- 帮助/欢迎文案改为微信纯文本分行，去掉 Markdown `**`。

## 下载

- 发布页：[v0.5.0](https://github.com/zxfccmm4/OpenCodeWeChat/releases/tag/v0.5.0)

| 平台 | 文件 | SHA256 |
|------|------|--------|
| macOS Apple Silicon | [OpenCodeWeChat-0.5.0-macos-arm64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.5.0/OpenCodeWeChat-0.5.0-macos-arm64.zip) | `13579140b5d8f5236298a29b68c2bfd73e6dbd5b870fa60e8d3d8a5411674e3c` |
| macOS Intel | [OpenCodeWeChat-0.5.0-macos-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.5.0/OpenCodeWeChat-0.5.0-macos-x64.zip) | `3493ed35ddf0a71122c3d583af51d6b13df21d9de41e9032411f5470783513e6` |
| Windows x64 | [OpenCodeWeChat-0.5.0-windows-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.5.0/OpenCodeWeChat-0.5.0-windows-x64.zip) | `2f243aec5daf9bc144cb7dd745f6a82b1e2acc3e6dce93e0463dc5a3f4301c40` |
| Linux x64 | [OpenCodeWeChat-0.5.0-linux-x64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.5.0/OpenCodeWeChat-0.5.0-linux-x64.zip) | `ed4319b996201369b88347a9fb16cc6324cdd828dc1c97ccef85477720f69b95` |
| Linux arm64 | [OpenCodeWeChat-0.5.0-linux-arm64.zip](https://github.com/zxfccmm4/OpenCodeWeChat/releases/download/v0.5.0/OpenCodeWeChat-0.5.0-linux-arm64.zip) | `e86c44beb8da53e58cb78b8e863f42c06b859599e25ee77ded6f2db9661eefd4` |

## 快速上手

1. 解压对应平台 zip  
2. 双击 `OpenCodeWeChat GUI` 启动控制台  
3. 扫码登录 → 启动通道 → 生成绑定码  
4. 微信发送 `/bind 六位码` 后即可对话  
