#!/usr/bin/env bash
# OpenCodeWeChat 一键启动器（macOS / Linux 共用）
# 菜单: 登录微信 / 登出 / 启动 / 停止
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="${HOME}/.claude/channels/wechat"
ACCOUNT_FILE="${STATE_DIR}/account.json"
PID_FILE="${STATE_DIR}/opencode-wechat.pid"

cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/opencode-wechat.env" ]; then
  set -a
  . "$PROJECT_ROOT/opencode-wechat.env"
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$PID_FILE")"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  printf '%s' "$pid"
}

account_id() {
  [ -f "$ACCOUNT_FILE" ] || return 1
  sed -n 's/.*"accountId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ACCOUNT_FILE" | head -1
}

ensure_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "未找到 Bun。请先安装 Bun: https://bun.sh"
    return 1
  fi
}

ensure_deps() {
  if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo "首次运行，正在安装依赖..."
    bun install || return 1
  fi
}

ensure_opencode() {
  if ! command -v opencode >/dev/null 2>&1 && [ -z "${OPENCODE_BIN:-}" ]; then
    echo "未找到 OpenCode CLI。请确认 opencode 在 PATH 中，或在 opencode-wechat.env 设置 OPENCODE_BIN。"
    return 1
  fi
}

stop_instance() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    echo "OpenCodeWeChat 当前未运行。"
    return 0
  fi
  echo "正在停止 OpenCodeWeChat (pid=$pid)..."
  kill "$pid" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6; do
    kill -0 "$pid" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "进程仍在运行，强制结束..."
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE"
  echo "已停止 OpenCodeWeChat。"
}

do_login() {
  ensure_bun || return 1
  ensure_deps || return 1
  if running_pid >/dev/null; then
    echo "检测到通道正在运行，重新登录前先停止..."
    stop_instance
  fi
  bun setup.ts
}

do_logout() {
  ensure_bun || return 1
  ensure_deps || return 1
  bun scripts/logout.ts
}

do_start() {
  if pid="$(running_pid)"; then
    echo "OpenCodeWeChat 已在运行 (pid=$pid)，无需重复启动。"
    return 0
  fi
  ensure_bun || return 1
  ensure_opencode || return 1
  ensure_deps || return 1
  if [ ! -f "$ACCOUNT_FILE" ]; then
    echo "未找到微信凭据，先启动扫码登录..."
    bun setup.ts || return 1
  fi
  echo "启动 OpenCodeWeChat...（按 Ctrl+C 停止并返回菜单）"
  trap ':' INT
  bun index.ts
  trap - INT
  echo
  echo "OpenCodeWeChat 已退出。"
}

do_gui() {
  ensure_bun || return 1
  ensure_deps || return 1
  echo "启动图形控制台...（按 Ctrl+C 退出控制台并返回菜单）"
  trap ':' INT
  bun gui/server.ts
  trap - INT
}

show_menu() {
  clear 2>/dev/null || true
  echo "========================================"
  echo "       OpenCodeWeChat 一键启动器"
  echo "========================================"
  if pid="$(running_pid)"; then
    echo " 状态: ● 运行中 (pid=$pid)"
  else
    echo " 状态: ○ 未运行"
  fi
  if acct="$(account_id)" && [ -n "$acct" ]; then
    echo " 账号: 已登录 ($acct)"
  else
    echo " 账号: 未登录"
  fi
  echo "----------------------------------------"
  echo "  1) 登录微信（扫码）"
  echo "  2) 登出并清除本机凭据"
  echo "  3) 启动 OpenCodeWeChat"
  echo "  4) 停止 OpenCodeWeChat"
  echo "  5) 打开图形控制台 (GUI)"
  echo "  q) 退出"
  echo "----------------------------------------"
}

while true; do
  show_menu
  read -r -p "请选择操作: " choice || exit 0
  echo
  case "$choice" in
    1) do_login ;;
    2) do_logout ;;
    3) do_start ;;
    4) stop_instance ;;
    5) do_gui ;;
    q|Q) exit 0 ;;
    *) echo "无效选项: $choice" ;;
  esac
  echo
  read -r -p "按回车返回菜单..." _ || exit 0
done
