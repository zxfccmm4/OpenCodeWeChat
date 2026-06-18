import fs from "node:fs";
import path from "node:path";
import {
  CONTEXT_TOKENS_FILE,
  CREDENTIALS_FILE,
  OMO_PLAN_CONTEXT_FILE,
  PID_FILE,
  PROCESSED_MESSAGES_FILE,
  SYNC_BUFFER_FILE,
} from "../config";

export function writePidFile(pid = process.pid, pidFile = PID_FILE): void {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(pid), "utf-8");
}

export function removePidFile(pidFile = PID_FILE): void {
  if (!fs.existsSync(pidFile)) return;
  fs.rmSync(pidFile, { force: true });
}

export function readPidFile(pidFile = PID_FILE): number | null {
  try {
    const raw = fs.readFileSync(pidFile, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type StopInstanceResult = "stopped" | "not-running";

/**
 * 停止正在运行的 OpenCodeWeChat 实例（按 pid 文件）。
 * 先 SIGTERM，等待 waitMs 后仍存活则 SIGKILL；过期 pid 文件会被清理。
 */
export async function stopRunningInstance(options: {
  readonly pidFile?: string;
  readonly waitMs?: number;
} = {}): Promise<StopInstanceResult> {
  const pidFile = options.pidFile ?? PID_FILE;
  const waitMs = options.waitMs ?? 3_000;

  const pid = readPidFile(pidFile);
  if (pid === null || !isProcessAlive(pid)) {
    removePidFile(pidFile);
    return "not-running";
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    removePidFile(pidFile);
    return "not-running";
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await sleep(100);
  }

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 进程恰好在两次检查之间退出
    }
  }

  removePidFile(pidFile);
  return "stopped";
}

export interface AccountStateFiles {
  readonly contextTokensFile: string;
  readonly credentialsFile: string;
  readonly omoPlanContextFile: string;
  readonly processedMessagesFile: string;
  readonly syncBufferFile: string;
}

export const DEFAULT_ACCOUNT_STATE_FILES: AccountStateFiles = {
  contextTokensFile: CONTEXT_TOKENS_FILE,
  credentialsFile: CREDENTIALS_FILE,
  omoPlanContextFile: OMO_PLAN_CONTEXT_FILE,
  processedMessagesFile: PROCESSED_MESSAGES_FILE,
  syncBufferFile: SYNC_BUFFER_FILE,
};

/**
 * 登出：删除账号凭据和绑定到该账号的会话状态。
 * 不触碰 inbox/ 里已下载的用户文件。返回实际删除的文件路径。
 */
export function clearAccountState(
  files: AccountStateFiles = DEFAULT_ACCOUNT_STATE_FILES,
): string[] {
  const removed: string[] = [];
  for (const file of [
    files.credentialsFile,
    files.syncBufferFile,
    files.contextTokensFile,
    files.processedMessagesFile,
    files.omoPlanContextFile,
  ]) {
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true });
    removed.push(file);
  }
  return removed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
