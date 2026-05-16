import { generateClientId, getUpdates, sendTextMessage } from "../api/ilink";
import { cacheContextToken, getCachedContextToken } from "../core/context-token";
import { loadSyncBuffer, saveSyncBuffer } from "../storage/sync-buffer";
import { parseMessage } from "../core/message";
import {
  CHANNEL_VERSION,
  MAX_CONSECUTIVE_FAILURES,
  BACKOFF_DELAY_MS,
  ENABLE_VERBOSE_MESSAGE_LOGS,
  RETRY_DELAY_MS,
  MAX_MESSAGE_TEXT_LEN,
} from "../config";
import type { AccountData } from "../types/wechat";
import type { GetUpdatesResp } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import { sendPrompt } from "../opencode/client";
import {
  hasProcessedMessage,
  markMessageProcessed,
} from "../storage/processed-messages";

type ProcessUpdateBatchDeps = {
  cacheContextToken: typeof cacheContextToken;
  generateClientId: typeof generateClientId;
  getCachedContextToken: typeof getCachedContextToken;
  hasProcessedMessage: typeof hasProcessedMessage;
  markMessageProcessed: typeof markMessageProcessed;
  saveSyncBuffer: typeof saveSyncBuffer;
  sendPrompt: typeof sendPrompt;
  sendTextMessage: typeof sendTextMessage;
};

const DEFAULT_BATCH_DEPS: ProcessUpdateBatchDeps = {
  cacheContextToken,
  generateClientId,
  getCachedContextToken,
  hasProcessedMessage,
  markMessageProcessed,
  saveSyncBuffer,
  sendPrompt,
  sendTextMessage,
};

function log(msg: string) {
  process.stderr.write(`[polling] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[polling] ERROR: ${msg}\n`);
}

function summarizeMessage(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_MESSAGE_TEXT_LEN
    ? `${normalized.slice(0, MAX_MESSAGE_TEXT_LEN)}...`
    : normalized;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function processUpdateBatch(params: {
  account: AccountData;
  currentUpdatesBuf: string;
  deps?: ProcessUpdateBatchDeps;
  opencode: OpencodeSession;
  response: GetUpdatesResp;
}): Promise<{ batchSucceeded: boolean; getUpdatesBuf: string }> {
  const {
    account,
    currentUpdatesBuf,
    deps = DEFAULT_BATCH_DEPS,
    opencode,
    response,
  } = params;
  const { baseUrl, token } = account;
  const nextUpdatesBuf = response.get_updates_buf || currentUpdatesBuf;
  let batchSucceeded = true;

  for (const msg of response.msgs ?? []) {
    const parsed = parseMessage(msg);
    if (!parsed) continue;

    if (deps.hasProcessedMessage(parsed.dedupeKey)) {
      log(`跳过已处理消息: from=${parsed.senderId}`);
      continue;
    }

    if (parsed.contextToken) {
      deps.cacheContextToken(parsed.senderId, parsed.contextToken);
    }

    log(
      ENABLE_VERBOSE_MESSAGE_LOGS
        ? `收到消息: from=${parsed.senderId} summary=${summarizeMessage(parsed.text)}`
        : `收到消息: from=${parsed.senderId} chars=${parsed.text.length}`,
    );

    try {
      log("发送至 OpenCode...");
      const responseText = await deps.sendPrompt(opencode, parsed.text);
      const contextToken = parsed.contextToken || deps.getCachedContextToken(parsed.senderId);
      if (!responseText) {
        log("OpenCode 返回空响应，跳过发送");
        continue;
      }
      if (!contextToken) {
        logError(`缺少 context_token，无法回复用户 ${parsed.senderId}`);
        continue;
      }

      await deps.sendTextMessage(
        baseUrl,
        token,
        parsed.senderId,
        responseText,
        contextToken,
        deps.generateClientId(),
        CHANNEL_VERSION,
      );
      log("已发送回复");
      deps.markMessageProcessed(parsed.dedupeKey);
    } catch (err) {
      batchSucceeded = false;
      logError(`OpenCode 处理失败: ${describeError(err)}`);
      break;
    }
  }

  if (batchSucceeded && nextUpdatesBuf !== currentUpdatesBuf) {
    deps.saveSyncBuffer(nextUpdatesBuf);
    return {
      batchSucceeded,
      getUpdatesBuf: nextUpdatesBuf,
    };
  }

  if (!batchSucceeded) {
    log("本批次未完整处理，保留旧同步游标以便重试");
  }

  return {
    batchSucceeded,
    getUpdatesBuf: currentUpdatesBuf,
  };
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

      const result = await processUpdateBatch({
        account,
        currentUpdatesBuf: getUpdatesBuf,
        opencode,
        response: resp,
      });
      getUpdatesBuf = result.getUpdatesBuf;
    } catch (err) {
      consecutiveFailures++;
      logError(`轮询异常: ${describeError(err)}`);
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
