#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="${HOME}/.claude/channels/wechat"
ACCOUNT_FILE="${STATE_DIR}/account.json"

cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/opencode-wechat.env" ]; then
  set -a
  . "$PROJECT_ROOT/opencode-wechat.env"
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "未找到 Bun。请先安装 Bun: https://bun.sh"
  read -r -p "按回车退出..."
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1 && [ -z "${OPENCODE_BIN:-}" ]; then
  echo "未找到 OpenCode CLI。请确认 opencode 在 PATH 中，或在 opencode-wechat.env 设置 OPENCODE_BIN。"
  read -r -p "按回车退出..."
  exit 1
fi

if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
  echo "首次运行，正在安装依赖..."
  bun install
fi

if [ ! -f "$ACCOUNT_FILE" ]; then
  echo "未找到微信凭据，先启动扫码登录..."
  bun setup.ts
fi

echo "启动 OpenCodeWeChat..."
bun index.ts

