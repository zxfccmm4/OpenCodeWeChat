#!/usr/bin/env bun
import { doQRLogin } from "./login/qr";
import { loadCredentials, credentialsFile, credentialsDir } from "./storage/credentials";
import { DEFAULT_BASE_URL } from "./config";
import fs from "node:fs";

async function main() {
  if (fs.existsSync(credentialsFile())) {
    try {
      const existing = JSON.parse(fs.readFileSync(credentialsFile(), "utf-8"));
      console.log(`已有保存的账号: ${existing.accountId}`);
      console.log(`保存时间: ${existing.savedAt}`);
      console.log();
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise<string>((resolve) => {
        rl.question("是否重新登录？(y/N) ", resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log("保持现有凭据，退出。");
        process.exit(0);
      }
    } catch {
      // ignore
    }
  }

  const account = await doQRLogin(DEFAULT_BASE_URL);
  if (!account) {
    console.error("登录失败。");
    process.exit(1);
  }

  console.log(`\n账号 ID: ${account.accountId}`);
  console.log(`用户 ID: ${account.userId}`);
  console.log(`凭据保存至: ${credentialsFile()}`);
  console.log();
  console.log("现在可以启动 Claude Code 通道：");
  console.log("  bun index.ts");
}

main().catch((err) => {
  console.error(`错误: ${err}`);
  process.exit(1);
});
