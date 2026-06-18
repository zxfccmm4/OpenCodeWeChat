#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "opencode-wechat.env" ]; then
  set -a
  . ./opencode-wechat.env
  set +a
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "未找到 Bun。请先安装 Bun: https://bun.sh"
  read -r -p "按回车退出..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖..."
  bun install
fi

exec bun gui/server.ts
