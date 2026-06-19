/**
 * 单条入站消息的完整处理流程：prompt 构建、typing 指示、
 * OpenCode 调用（含连接中断后自动重启重试）、SSE 完整性补齐、回复发送（文本+媒体）、
 * OMO plan 缓存、失败重试。
 *
 * 这是 polling 层最核心也最重的逻辑单元，从 processUpdateBatch 抽出
 * 以便独立测试和降低 loop.ts 的认知负担。
 */
import { buildOmoSendPromptOptions } from "../core/omo-agent-routing";
import {
  needsWechatFileDeliveryHint,
  WECHAT_FILE_DELIVERY_PROMPT_HINT,
  WECHAT_MEDIA_PROMPT_HINT,
} from "../core/wechat-media-directive";
import { downloadMediaAnnotations } from "./inbound-media";
import { sendReplyToUser } from "./reply-sender";
import {
  clearMessageAttempts,
  recordMessageFailure,
} from "./retry-tracker";
import type { ParsedMessage } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import { isOpencodeConnectionError } from "../opencode/errors";
import type { ReplyStreamHandle } from "../opencode/stream";
import type {
  MessageProcessorDeps,
  ProcessMessageResult,
  ProcessorContext,
} from "./message-processor-types";

export type {
  MessageProcessorDeps,
  ProcessMessageResult,
  ProcessorContext,
} from "./message-processor-types";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarizeMessage(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLen
    ? `${normalized.slice(0, maxLen)}...`
    : normalized;
}

function stopAfterMaxDuration(
  stopTyping: (() => Promise<void>) | null,
  maxDurationMs: number,
): (() => Promise<void>) | null {
  if (!stopTyping) return null;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    await stopTyping();
  };
  const timer = setTimeout(() => {
    void stop();
  }, maxDurationMs);
  return stop;
}

async function notifySkippedMessage(params: {
  readonly attempts: number;
  readonly baseUrl: string;
  readonly ctx: ProcessorContext;
  readonly deps: MessageProcessorDeps;
  readonly error: unknown;
  readonly message: ParsedMessage;
  readonly token: string;
}): Promise<void> {
  const { attempts, baseUrl, ctx, deps, error, message, token } = params;
  const contextToken = message.contextToken
    || deps.getCachedContextToken(message.senderId);
  if (!contextToken) return;

  try {
    await deps.sendTextMessage(
      baseUrl,
      token,
      message.senderId,
      `（这条消息连续 ${attempts} 次处理失败，已跳过。原因：${describeError(error)}。请稍后重新发送。）`,
      contextToken,
      deps.generateClientId(),
      ctx.channelVersion,
    );
  } catch (notifyErr) {
    ctx.logError(`发送失败通知也失败了: ${describeError(notifyErr)}`);
  }
}

export async function processMessage(params: {
  readonly message: ParsedMessage;
  readonly opencode: OpencodeSession;
  readonly deps: MessageProcessorDeps;
  readonly ctx: ProcessorContext;
}): Promise<ProcessMessageResult> {
  const { message: parsed, opencode: initialOpencode, deps, ctx } = params;
  const { baseUrl, token } = ctx.account;
  const omoCommand = deps.parseOmoCommand(parsed.text);
  let currentOpencode = initialOpencode;

  if (deps.hasProcessedMessage(parsed.dedupeKey)) {
    ctx.log(`跳过已处理消息: from=${parsed.senderId}`);
    return { status: "skipped" };
  }

  if (parsed.contextToken) {
    deps.cacheContextToken(parsed.senderId, parsed.contextToken);
  }

  ctx.log(
    ctx.verboseLogs
      ? `收到消息: from=${parsed.senderId} summary=${summarizeMessage(parsed.text, ctx.maxTextLen)} media=${parsed.media.length}`
      : `收到消息: from=${parsed.senderId} chars=${parsed.text.length} media=${parsed.media.length}`,
  );

  try {
    let promptText = parsed.text;
    if (parsed.media.length > 0) {
      const annotations = await downloadMediaAnnotations(
        parsed.media,
        { downloadIncomingMedia: deps.downloadIncomingMedia },
        {
          cdnBaseUrl: ctx.cdnBaseUrl,
          inboxDir: ctx.inboxDir,
          logError: ctx.logError,
          logInfo: ctx.log,
        },
      );
      promptText = [parsed.text, ...annotations]
        .filter((part) => part.length > 0)
        .join("\n");
    }

    ctx.log("发送至 OpenCode...");
    const latestPlanContext = deps.getLatestPlanContext(parsed.senderId);
    const compiledPrompt = [
      deps.buildOmoPrompt(promptText, latestPlanContext),
      WECHAT_MEDIA_PROMPT_HINT,
      ...(needsWechatFileDeliveryHint(promptText) ? [WECHAT_FILE_DELIVERY_PROMPT_HINT] : []),
    ].join("\n\n");

    const sendOnce = async (session: OpencodeSession): Promise<string> => {
      const promptOptions = buildOmoSendPromptOptions(omoCommand, session);
      if (promptOptions.agent) {
        ctx.log(`路由至 OpenCode agent: ${promptOptions.agent}`);
      }
      return deps.sendPrompt(session, compiledPrompt, promptOptions);
    };

    const contextToken = parsed.contextToken
      || deps.getCachedContextToken(parsed.senderId);

    // 微信"对方正在输入"指示器
    const rawStopTyping = contextToken
      ? await deps.startTypingIndicator({
        baseUrl,
        contextToken,
        ilinkUserId: parsed.senderId,
        token,
      })
      : null;
    const stopTyping = stopAfterMaxDuration(rawStopTyping, ctx.typingMaxDurationMs);
    let streamHandle: ReplyStreamHandle | null = null;
    let streamCapturedText = "";
    if (contextToken && deps.openReplyStream) {
      try {
        streamHandle = await deps.openReplyStream(initialOpencode, (cumulative) => {
          streamCapturedText = cumulative;
        });
      } catch (err) {
        ctx.log(`OpenCode SSE 订阅不可用，仅使用同步回复: ${describeError(err)}`);
        streamHandle = null;
      }
    }

    let responseText = "";
    let streamFinalText = "";
    let sessionRestarted = false;
    try {
      try {
        responseText = await sendOnce(initialOpencode);
      } catch (err) {
        if (!isOpencodeConnectionError(err)) throw err;
        ctx.logError(`OpenCode 连接失败: ${describeError(err)}`);
        ctx.log("尝试自动重启 OpenCode 会话...");
        currentOpencode = await deps.restartOpencode(initialOpencode);
        sessionRestarted = true;
        ctx.log("OpenCode 会话已重启，重试当前消息...");
        try {
          responseText = await sendOnce(currentOpencode);
        } catch (retryErr) {
          if (!isOpencodeConnectionError(retryErr)) throw retryErr;
          ctx.logError(`OpenCode 重启后仍连接失败，跳过当前消息: ${describeError(retryErr)}`);
          await notifySkippedMessage({
            attempts: 2,
            baseUrl,
            ctx,
            deps,
            error: retryErr,
            message: parsed,
            token,
          });
          deps.markMessageProcessed(parsed.dedupeKey);
          clearMessageAttempts(parsed.dedupeKey);
          return { status: "skipped", opencode: currentOpencode };
        }
      }
    } finally {
      if (streamHandle) {
        await streamHandle.waitForIdle(500);
        streamFinalText = streamHandle.stop() || streamCapturedText;
      }
      if (stopTyping) {
        await stopTyping();
      }
    }

    // 取同步响应和 SSE 流中较长的一份：两者都可能有对方没有的内容
    // （SSE 被提前中断、或同步端点返回不完整），取 max 降低截断风险
    let displayText = responseText.length >= streamFinalText.length
      ? responseText
      : streamFinalText;
    if (sessionRestarted && streamFinalText) {
      displayText = `（OpenCode 连接中断，以下为重新生成的完整回复）\n\n${responseText}`;
    }
    if (!displayText) {
      ctx.log("OpenCode 返回空响应，跳过发送");
      deps.markMessageProcessed(parsed.dedupeKey);
      clearMessageAttempts(parsed.dedupeKey);
      return { status: "skipped" };
    }

    await sendReplyToUser({
      command: omoCommand,
      deps,
      fullText: displayText,
      message: parsed,
      ctx,
    });
    deps.markMessageProcessed(parsed.dedupeKey);
    clearMessageAttempts(parsed.dedupeKey);
    return sessionRestarted
      ? { status: "processed", opencode: currentOpencode }
      : { status: "processed" };
  } catch (err) {
    const attempts = recordMessageFailure(parsed.dedupeKey);
    ctx.logError(
      `OpenCode 处理失败 (第 ${attempts}/${ctx.maxMessageAttempts} 次): ${describeError(err)}`,
    );

    if (attempts >= ctx.maxMessageAttempts) {
      ctx.logError(`消息重试 ${attempts} 次仍失败，跳过: from=${parsed.senderId}`);
      await notifySkippedMessage({
        attempts,
        baseUrl,
        ctx,
        deps,
        error: err,
        message: parsed,
        token,
      });
      deps.markMessageProcessed(parsed.dedupeKey);
      clearMessageAttempts(parsed.dedupeKey);
      return { status: "skipped" };
    }

    return currentOpencode !== initialOpencode
      ? { status: "failed-retryable", opencode: currentOpencode }
      : { status: "failed-retryable" };
  }
}
