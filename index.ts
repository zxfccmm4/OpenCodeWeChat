import { loadCredentials } from "./storage/credentials";
import { doQRLogin } from "./login/qr";
import { startPolling } from "./polling/loop";
import { startOpencode } from "./opencode/client";
import { DEFAULT_BASE_URL } from "./config";
import type { OpencodeSession } from "./opencode/client";

function log(msg: string) {
  process.stderr.write(`[opencode-wechat] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[opencode-wechat] ERROR: ${msg}\n`);
}

let activeAccount: ReturnType<typeof loadCredentials>;
let opencodeSession: OpencodeSession | null = null;

async function main() {
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

  activeAccount = account;

  log("启动 OpenCode 会话...");
  opencodeSession = await startOpencode();
  log("OpenCode 就绪");

  await startPolling(account, opencodeSession);
}

main().catch((err) => {
  logError(`Fatal: ${String(err)}`);
  process.exit(1);
});
