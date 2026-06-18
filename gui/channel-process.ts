import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CHANNEL_LOG_FILE } from "../config";
import { rotateChannelLogIfNeeded } from "../storage/channel-log";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const MAX_LOG_LINES = 1000;

function resolveChannelCommand(): {
  readonly args: string[];
  readonly command: string;
  readonly cwd: string;
} {
  const sourceEntry = path.join(PROJECT_ROOT, "index.ts");
  if (fs.existsSync(sourceEntry)) {
    return { args: [sourceEntry], command: process.execPath, cwd: PROJECT_ROOT };
  }
  const exeDir = path.dirname(process.execPath);
  const mainBinary = process.platform === "win32"
    ? "OpenCodeWeChat.exe"
    : "OpenCodeWeChat";
  return {
    args: [],
    command: path.join(exeDir, mainBinary),
    cwd: path.dirname(exeDir),
  };
}

export function spawnDetachedChannel(): void {
  rotateChannelLogIfNeeded();
  fs.mkdirSync(path.dirname(CHANNEL_LOG_FILE), { recursive: true });
  const logFd = fs.openSync(CHANNEL_LOG_FILE, "a");
  try {
    const stamp = new Date().toISOString();
    fs.writeSync(logFd, `\n===== ${stamp} 由 GUI 控制台启动 =====\n`);
    const channel = resolveChannelCommand();
    const child = spawn(channel.command, channel.args, {
      cwd: channel.cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } finally {
    fs.closeSync(logFd);
  }
}

export function readChannelLogTail(lines: number): string {
  const requested = Math.min(Math.max(lines, 1), MAX_LOG_LINES);
  try {
    const raw = fs.readFileSync(CHANNEL_LOG_FILE, "utf-8");
    const allLines = raw.split("\n");
    return allLines.slice(-requested).join("\n").trim();
  } catch {
    return "";
  }
}
