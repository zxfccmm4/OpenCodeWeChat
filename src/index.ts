import { loadCredentials } from "./storage/credentials.js";
import { doQRLogin } from "./login/qr.js";
import { startPolling } from "./polling/loop.js";
import { createMcpServer } from "./mcp/server.js";
import { DEFAULT_BASE_URL } from "./config.js";

function log(msg: string) {
  process.stderr.write(`[opencode-wechat] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[opencode-wechat] ERROR: ${msg}\n`);
}

let activeAccount: ReturnType<typeof loadCredentials>;

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

  const mcpServer = await createMcpServer(() => activeAccount);
  log("MCP 连接就绪");

  await startPolling(account, mcpServer);
}

main().catch((err) => {
  logError(`Fatal: ${String(err)}`);
  process.exit(1);
});
