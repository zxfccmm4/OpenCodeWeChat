import { loadCredentials } from "./storage/credentials";
import { doQRLogin } from "./login/qr";
import { startPolling, TerminalWechatSessionError } from "./polling/loop";
import { startOpencode } from "./opencode/client";
import { DEFAULT_BASE_URL } from "./config";
import { installChannelLogTee } from "./storage/channel-log";
import { isOpencodeToolChild } from "./runtime/launch-guard";
import { CREDENTIALS_FILE } from "./config";
import {
  claimPidFile,
  removePidFileIfOwned,
} from "./storage/runtime-state";
import type { OpencodeRuntime } from "./opencode/client";
import fs from "node:fs";

function log(msg: string) {
  process.stderr.write(`[opencode-wechat] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[opencode-wechat] ERROR: ${msg}\n`);
}

let opencodeRuntime: OpencodeRuntime | null = null;
let shuttingDown = false;

function closeOpencodeSession() {
  if (!opencodeRuntime) return;
  opencodeRuntime.manager.close();
  opencodeRuntime = null;
}

function shutdown(code: number, reason?: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) log(reason);
  closeOpencodeSession();
  process.exit(code);
}

process.on("SIGINT", () => {
  shutdown(0, "收到 SIGINT，正在退出...");
});

process.on("SIGTERM", () => {
  shutdown(0, "收到 SIGTERM，正在退出...");
});

process.on("exit", () => {
  closeOpencodeSession();
  removePidFileIfOwned();
});

async function main() {
  if (isOpencodeToolChild()) {
    logError("检测到当前进程由 OpenCode 工具环境启动，拒绝递归启动微信通道。");
    process.exit(1);
  }

  // 终端启动时把日志分流到 channel.log，GUI 日志区才能看到
  if (installChannelLogTee()) {
    log("通道日志同步写入 channel.log（GUI 控制台可实时查看）");
  }
  const pidClaim = claimPidFile();
  if (pidClaim.status === "already-running") {
    log(`通道已在运行 (pid ${pidClaim.pid})，本次启动退出。`);
    process.exit(0);
  }
  let account = loadCredentials();

  if (!account) {
    log("未找到已保存的凭据，启动微信扫码登录...");
    account = await doQRLogin(DEFAULT_BASE_URL);
    if (!account) {
      logError("登录失败，退出。");
      process.exit(1);
    }
  } else {
    log(`使用已保存账号: ${account.accountId}`);
  }

  log("启动 OpenCode 会话...");
  opencodeRuntime = await startOpencode();
  log("OpenCode 就绪");

  await startPolling(account, opencodeRuntime, {
    onSessionReplaced(runtime) {
      // 轮询层在 OpenCode 服务死掉后会自动重建会话，
      // 这里同步引用，保证退出时关闭的是当前会话
      opencodeRuntime = runtime;
      log("OpenCode 会话已自动重启");
    },
  });
}

main().catch((err) => {
  closeOpencodeSession();
  if (err instanceof TerminalWechatSessionError) {
    logError(err.message);
    try {
      // 只清失效凭据；绑定偏好等 SQLite 状态保留，重新扫码后无需再 /bind
      if (fs.existsSync(CREDENTIALS_FILE)) {
        fs.rmSync(CREDENTIALS_FILE, { force: true });
        log("已删除失效的 account.json，请重新扫码登录。");
      }
    } catch (cleanupError) {
      logError(`清理失效登录态失败: ${String(cleanupError)}`);
    }
    process.exit(2);
  }
  logError(`Fatal: ${String(err)}`);
  process.exit(1);
});
