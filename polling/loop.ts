import { getUpdates, sendTextMessage } from "../api/ilink";
import { loadSyncBuffer, saveSyncBuffer } from "../storage/sync-buffer";
import { parseMessage } from "../core/message";
import {
  CHANNEL_NAME,
  CHANNEL_VERSION,
  MAX_CONSECUTIVE_FAILURES,
  BACKOFF_DELAY_MS,
  RETRY_DELAY_MS,
  MAX_MESSAGE_TEXT_LEN,
} from "../config";
import type { AccountData } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import { sendPrompt } from "../opencode/client";

function log(msg: string) {
  process.stderr.write(`[polling] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[polling] ERROR: ${msg}\n`);
}

export async function startPolling(
  account: AccountData,
  opencode: OpencodeSession,
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

        log(
          `收到消息: from=${parsed.senderId} text=${parsed.text.slice(0, MAX_MESSAGE_TEXT_LEN)}...`,
        );

        try {
          log(`发送至 OpenCode...`);
          const response = await sendPrompt(opencode, parsed.text);
          log(`OpenCode 响应: ${response.slice(0, MAX_MESSAGE_TEXT_LEN)}...`);

          if (parsed.contextToken && response) {
            await sendTextMessage(
              baseUrl,
              token,
              parsed.senderId,
              response,
              parsed.contextToken,
              `opencode-wechat:${Date.now()}`,
              CHANNEL_VERSION,
            );
            log("已发送回复");
          }
        } catch (err) {
          logError(`OpenCode 处理失败: ${String(err)}`);
        }
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
