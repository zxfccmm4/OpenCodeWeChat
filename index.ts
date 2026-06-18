import { loadCredentials } from "./storage/credentials";
import { doQRLogin } from "./login/qr";
import { startPolling } from "./polling/loop";
import { startOpencode } from "./opencode/client";
import { DEFAULT_BASE_URL } from "./config";
import { installChannelLogTee } from "./storage/channel-log";
import { isOpencodeToolChild } from "./runtime/launch-guard";
import { claimPidFile, removePidFileIfOwned } from "./storage/runtime-state";
import type { OpencodeSession } from "./opencode/client";

function log(msg: string) {
  process.stderr.write(`[opencode-wechat] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[opencode-wechat] ERROR: ${msg}\n`);
}

let opencodeSession: OpencodeSession | null = null;
let shuttingDown = false;

function closeOpencodeSession() {
  if (!opencodeSession) return;
  opencodeSession.close();
  opencodeSession = null;
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
  opencodeSession = await startOpencode();
  log("OpenCode 就绪");

  await startPolling(account, opencodeSession, {
    onSessionReplaced(session) {
      // 轮询层在 OpenCode 服务死掉后会自动重建会话，
      // 这里同步引用，保证退出时关闭的是当前会话
      opencodeSession = session;
      log("OpenCode 会话已自动重启");
    },
  });
}

main().catch((err) => {
  closeOpencodeSession();
  logError(`Fatal: ${String(err)}`);
  process.exit(1);
});
