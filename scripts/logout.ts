#!/usr/bin/env bun
/**
 * 登出微信账号：停止运行中的 OpenCodeWeChat，并清除本机保存的
 * 账号凭据与会话状态（同步游标、context token、去重记录、#plan 缓存）。
 * 不会删除 inbox/ 里已下载的文件。
 */
import {
  clearAccountState,
  stopRunningInstance,
} from "../storage/runtime-state";
import { CREDENTIALS_FILE, INBOX_DIR } from "../config";
import fs from "node:fs";

async function main() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.log("当前未登录（没有保存的微信凭据）。");
  }

  const stopResult = await stopRunningInstance();
  if (stopResult === "stopped") {
    console.log("已停止运行中的 OpenCodeWeChat。");
  }

  const removed = clearAccountState();
  if (removed.length === 0) {
    console.log("没有需要清理的本机状态。");
    return;
  }

  console.log("已清除以下本机状态文件：");
  for (const file of removed) {
    console.log(`  - ${file}`);
  }
  console.log(`收件箱目录未改动: ${INBOX_DIR}`);
  console.log("登出完成。下次启动前请重新扫码登录。");
}

main().catch((err) => {
  console.error(`登出失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
