/**
 * 微信消息长轮询编排层。
 *
 * 职责：调用 getUpdates 拉取一批消息，逐条交给 message-processor 处理，
 * 根据处理结果推进或保留同步游标，并在连续失败时退避。
 * 单条消息的完整处理逻辑位于 message-processor.ts。
 */
import { getUpdates } from "../api/ilink";
import { sendMediaMessage } from "../api/media";
import { downloadIncomingMedia } from "../api/media-download";
import { cacheContextToken, getCachedContextToken } from "../core/context-token";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";
import { startTypingIndicator } from "../core/typing-indicator";
import {
  generateClientId,
  sendTextMessage,
} from "../api/ilink";
import { parseMessage } from "../core/message";
import {
  BACKOFF_DELAY_MS,
  CHANNEL_VERSION,
  DEFAULT_CDN_BASE_URL,
  ENABLE_STREAM_CAPTURE,
  ENABLE_TYPING_INDICATOR,
  ENABLE_VERBOSE_MESSAGE_LOGS,
  INBOX_DIR,
  MAX_CONSECUTIVE_FAILURES,
  MAX_MESSAGE_ATTEMPTS,
  MAX_MESSAGE_TEXT_LEN,
  RETRY_DELAY_MS,
  TYPING_MAX_DURATION_MS,
  WECHAT_REPLY_TEXT_CHUNK_CHARS,
} from "../config";
import type { AccountData, GetUpdatesResp } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import { restartOpencode, sendPrompt } from "../opencode/client";
import { openReplyTextStream } from "../opencode/stream";
import {
  processMessage,
} from "./message-processor";
import type {
  MessageProcessorDeps,
  ProcessorContext,
} from "./message-processor-types";
import { resetMessageAttemptTracking } from "./retry-tracker";
import { loadSyncBuffer, saveSyncBuffer } from "../storage/sync-buffer";
import {
  getLatestPlanContext,
  saveLatestPlanContext,
} from "../storage/omo-plan-context";
import {
  hasProcessedMessage,
  markMessageProcessed,
} from "../storage/processed-messages";

export { resetMessageAttemptTracking };

/**
 * 依赖注入容器。测试通过 processUpdateBatch 的 deps 参数覆盖。
 * 在 MessageProcessorDeps 基础上增加 saveSyncBuffer（批次级游标持久化）。
 */
export type ProcessUpdateBatchDeps = MessageProcessorDeps & {
  readonly saveSyncBuffer: typeof saveSyncBuffer;
};

const DEFAULT_BATCH_DEPS: ProcessUpdateBatchDeps = {
  buildOmoPrompt,
  cacheContextToken,
  downloadIncomingMedia,
  generateClientId,
  getCachedContextToken,
  getLatestPlanContext,
  hasProcessedMessage,
  markMessageProcessed,
  openReplyStream: ENABLE_STREAM_CAPTURE
    ? (session, onText) => openReplyTextStream({ onText, session })
    : null,
  parseOmoCommand,
  restartOpencode,
  saveLatestPlanContext,
  saveSyncBuffer,
  sendMediaMessage,
  sendPrompt,
  sendTextMessage,
  startTypingIndicator: ENABLE_TYPING_INDICATOR
    ? startTypingIndicator
    : async () => async () => {},
};

function log(msg: string) {
  process.stderr.write(`[polling] ${msg}\n`);
}

function logError(msg: string) {
  process.stderr.write(`[polling] ERROR: ${msg}\n`);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildProcessorContext(account: AccountData): ProcessorContext {
  return {
    account: { baseUrl: account.baseUrl, token: account.token },
    cdnBaseUrl: DEFAULT_CDN_BASE_URL,
    channelVersion: CHANNEL_VERSION,
    inboxDir: INBOX_DIR,
    log,
    logError,
    maxMessageAttempts: MAX_MESSAGE_ATTEMPTS,
    maxTextLen: MAX_MESSAGE_TEXT_LEN,
    replyTextChunkChars: WECHAT_REPLY_TEXT_CHUNK_CHARS,
    typingMaxDurationMs: TYPING_MAX_DURATION_MS,
    verboseLogs: ENABLE_VERBOSE_MESSAGE_LOGS,
  };
}

export async function processUpdateBatch(params: {
  account: AccountData;
  currentUpdatesBuf: string;
  deps?: ProcessUpdateBatchDeps;
  opencode: OpencodeSession;
  response: GetUpdatesResp;
}): Promise<{
  batchSucceeded: boolean;
  getUpdatesBuf: string;
  opencode: OpencodeSession;
}> {
  const {
    account,
    currentUpdatesBuf,
    deps = DEFAULT_BATCH_DEPS,
    response,
  } = params;
  const nextUpdatesBuf = response.get_updates_buf || currentUpdatesBuf;
  let batchSucceeded = true;
  let opencode = params.opencode;
  const ctx = buildProcessorContext(account);

  for (const msg of response.msgs ?? []) {
    const parsed = parseMessage(msg);
    if (!parsed) continue;

    const result = await processMessage({
      ctx,
      deps,
      message: parsed,
      opencode,
    });

    if ("opencode" in result && result.opencode) {
      opencode = result.opencode;
    }

    if (result.status === "failed-retryable") {
      batchSucceeded = false;
      break;
    }
    // "processed" 和 "skipped" 都继续处理下一条
  }

  if (batchSucceeded && nextUpdatesBuf !== currentUpdatesBuf) {
    deps.saveSyncBuffer(nextUpdatesBuf);
    return {
      batchSucceeded,
      getUpdatesBuf: nextUpdatesBuf,
      opencode,
    };
  }

  if (!batchSucceeded) {
    log("本批次未完整处理，保留旧同步游标以便重试");
  }

  return {
    batchSucceeded,
    getUpdatesBuf: currentUpdatesBuf,
    opencode,
  };
}

export async function startPolling(
  account: AccountData,
  opencode: OpencodeSession,
  hooks: {
    onSessionReplaced?: (session: OpencodeSession) => void;
  } = {},
): Promise<never> {
  const { baseUrl, token } = account;
  let getUpdatesBuf = loadSyncBuffer();
  let currentOpencode = opencode;

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

      const result = await processUpdateBatch({
        account,
        currentUpdatesBuf: getUpdatesBuf,
        opencode: currentOpencode,
        response: resp,
      });
      getUpdatesBuf = result.getUpdatesBuf;
      if (result.opencode !== currentOpencode) {
        currentOpencode = result.opencode;
        hooks.onSessionReplaced?.(currentOpencode);
      }

      if (!result.batchSucceeded) {
        consecutiveFailures++;
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
