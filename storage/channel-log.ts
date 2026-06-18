import fs from "node:fs";
import path from "node:path";
import { CHANNEL_LOG_FILE } from "../config";

export const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * 超过上限时把当前日志轮转为 `.old`（覆盖旧的 `.old`）。
 */
export function rotateChannelLogIfNeeded(
  logFile = CHANNEL_LOG_FILE,
  maxBytes = LOG_ROTATE_BYTES,
): void {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size < maxBytes) return;
    const oldFile = `${logFile}.old`;
    fs.rmSync(oldFile, { force: true });
    fs.renameSync(logFile, oldFile);
  } catch {
    // 文件不存在等情况直接忽略
  }
}

export function appendChannelLog(text: string, logFile = CHANNEL_LOG_FILE): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, text);
  } catch {
    // 日志落盘失败不能影响通道本身
  }
}

/**
 * 把通道进程写到 stderr 的日志同步追加到 channel.log，
 * 让 GUI 日志区对终端/启动器启动的通道同样生效。
 *
 * 仅在 stderr 是 TTY（终端启动）时安装：GUI 分离启动的通道
 * stderr 已经重定向到 channel.log 本身，再分流会写两份。
 * 返回恢复函数；不满足安装条件时返回 null。
 */
export function installChannelLogTee(options: {
  readonly force?: boolean;
  readonly logFile?: string;
} = {}): (() => void) | null {
  if (!process.stderr.isTTY && !options.force) return null;

  const logFile = options.logFile ?? CHANNEL_LOG_FILE;
  rotateChannelLogIfNeeded(logFile);
  appendChannelLog(
    `\n===== ${new Date().toISOString()} 通道在终端启动，日志同步写入此文件 =====\n`,
    logFile,
  );

  const originalWrite = process.stderr.write;
  const boundWrite = originalWrite.bind(process.stderr);
  const teeWrite: typeof process.stderr.write = (
    chunk: Uint8Array | string,
    ...rest: never[]
  ) => {
    const text = typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk).toString("utf-8");
    appendChannelLog(text, logFile);
    return boundWrite(chunk, ...rest);
  };
  process.stderr.write = teeWrite;

  return () => {
    process.stderr.write = originalWrite;
  };
}
