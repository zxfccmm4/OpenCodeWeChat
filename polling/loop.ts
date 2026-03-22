import { getUpdates } from "../api/ilink";
import { loadSyncBuffer, saveSyncBuffer } from "../storage/sync-buffer";
import { cacheContextToken } from "../core/context-token";
import { parseMessage } from "../core/message";
import {
  CHANNEL_NAME,
  CHANNEL_VERSION,
  MAX_CONSECUTIVE_FAILURES,
  BACKOFF_DELAY_MS,
  RETRY_DELAY_MS,
  MAX_MESSAGE_TEXT_LEN,
} from "../config.js";
import type { AccountData, ParsedMessage } from "../types/wechat";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

function log(msg: string) {
  process.stderr.write(`[polling] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[polling] ERROR: ${msg}\n`);
}

export async function startPolling(
  account: AccountData,
  mcpServer: Server,
): Promise<never> {
  const { baseUrl, token } = account;
  let getUpdatesBuf = loadSyncBuffer();

  if (getUpdatesBuf) {
    log(`恢复上次同步状态 (${getUpdatesBuf.length} bytes)`);
  }

  log("开始监听微信消息...");

  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await getUpdates(baseUrl, token, getUpdatesBuf, CHANNEL_VERSION);

      const isError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isError) {
        consecutiveFailures++;
        logError(
          `getUpdates 失败: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`,
        );
        await sleep(
          consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
            ? BACKOFF_DELAY_MS
            : RETRY_DELAY_MS,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        getUpdatesBuf = resp.get_updates_buf;
        saveSyncBuffer(getUpdatesBuf);
      }

      for (const msg of resp.msgs ?? []) {
        const parsed = parseMessage(msg);
        if (!parsed) continue;

        if (parsed.contextToken) {
          cacheContextToken(parsed.senderId, parsed.contextToken);
        }

        log(
          `收到消息: from=${parsed.senderId} text=${parsed.text.slice(0, MAX_MESSAGE_TEXT_LEN)}...`,
        );

        await mcpServer.notification({
          method: "notifications/claude/channel",
          params: {
            content: parsed.text,
            meta: {
              sender: parsed.senderId.split("@")[0] || parsed.senderId,
              sender_id: parsed.senderId,
            },
          },
        });
      }
    } catch (err) {
      consecutiveFailures++;
      logError(`轮询异常: ${String(err)}`);
      await sleep(
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
          ? BACKOFF_DELAY_MS
          : RETRY_DELAY_MS,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
