#!/bin/bash
set -euo pipefail

STATE_DIR="${HOME}/.claude/channels/wechat"
PID_FILE="${STATE_DIR}/opencode-wechat.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "未找到运行中的 OpenCodeWeChat。"
  read -r -p "按回车退出..."
  exit 0
fi

PID="$(tr -d '[:space:]' < "$PID_FILE")"

if [ -z "$PID" ] || ! kill -0 "$PID" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "OpenCodeWeChat 未运行，已清理旧 pid 文件。"
  read -r -p "按回车退出..."
  exit 0
fi

echo "正在停止 OpenCodeWeChat (pid=$PID)..."
kill "$PID"
sleep 2

if kill -0 "$PID" >/dev/null 2>&1; then
  echo "进程仍在运行，强制结束..."
  kill -9 "$PID" >/dev/null 2>&1 || true
fi

rm -f "$PID_FILE"
echo "已停止 OpenCodeWeChat。"
read -r -p "按回车退出..."
