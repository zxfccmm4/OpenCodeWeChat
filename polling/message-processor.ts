/**
 * 单条入站消息的完整处理流程：prompt 构建、typing 指示、流式气泡、
 * OpenCode 调用（含连接中断后自动重启重试）、回复发送（文本+媒体）、
 * OMO plan 缓存、失败重试。
 *
 * 这是 polling 层最核心也最重的逻辑单元，从 processUpdateBatch 抽出
 * 以便独立测试和降低 loop.ts 的认知负担。
 */
import { buildOmoSendPromptOptions } from "../core/omo-agent-routing";
import { sendMediaMessage } from "../api/media";
import type { DownloadedMedia } from "../api/media-download";
import {
  cacheContextToken,
  getCachedContextToken,
} from "../core/context-token";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";
import { StreamingTextBubble } from "../core/streaming-bubble";
import type { StopTypingFn } from "../core/typing-indicator";
import {
  buildStreamPreview,
  WECHAT_MEDIA_PROMPT_HINT,
} from "../core/wechat-media-directive";
import { downloadMediaAnnotations } from "./inbound-media";
import { sendReplyToUser } from "./reply-sender";
import {
  clearMessageAttempts,
  recordMessageFailure,
} from "./retry-tracker";
import type { ParsedMessage } from "../types/wechat";
import type { IncomingMedia } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import {
  isOpencodeConnectionError,
  restartOpencode,
  sendPrompt,
} from "../opencode/client";
import { openReplyTextStream } from "../opencode/stream";
import type { ReplyStreamHandle } from "../opencode/stream";
import {
  generateClientId,
  sendStreamingText,
  sendTextMessage,
} from "../api/ilink";
import {
  getLatestPlanContext,
  saveLatestPlanContext,
} from "../storage/omo-plan-context";
import {
  hasProcessedMessage,
  markMessageProcessed,
} from "../storage/processed-messages";

type OpenReplyStreamFn = (
  session: OpencodeSession,
  onText: (cumulative: string) => void,
) => Promise<ReplyStreamHandle>;

type StartTypingIndicatorFn = (params: {
  readonly baseUrl: string;
  readonly contextToken?: string;
  readonly ilinkUserId: string;
  readonly token: string;
}) => Promise<StopTypingFn>;

export type MessageProcessorDeps = {
  readonly buildOmoPrompt: typeof buildOmoPrompt;
  readonly cacheContextToken: typeof cacheContextToken;
  readonly downloadIncomingMedia: (
    media: IncomingMedia,
    options: {
      readonly cdnBaseUrl: string;
      readonly inboxDir: string;
    },
  ) => Promise<DownloadedMedia>;
  readonly generateClientId: typeof generateClientId;
  readonly getCachedContextToken: typeof getCachedContextToken;
  readonly getLatestPlanContext: typeof getLatestPlanContext;
  readonly hasProcessedMessage: typeof hasProcessedMessage;
  readonly markMessageProcessed: typeof markMessageProcessed;
  readonly openReplyStream: OpenReplyStreamFn | null;
  readonly parseOmoCommand: typeof parseOmoCommand;
  readonly restartOpencode: typeof restartOpencode;
  readonly saveLatestPlanContext: typeof saveLatestPlanContext;
  readonly sendMediaMessage: typeof sendMediaMessage;
  readonly sendPrompt: typeof sendPrompt;
  readonly sendStreamingText: typeof sendStreamingText;
  readonly sendTextMessage: typeof sendTextMessage;
  readonly startTypingIndicator: StartTypingIndicatorFn;
};

export type ProcessorContext = {
  readonly account: {
    readonly baseUrl: string;
    readonly token: string;
  };
  readonly channelVersion: string;
  readonly cdnBaseUrl: string;
  readonly inboxDir: string;
  readonly maxMessageAttempts: number;
  readonly streamUpdateIntervalMs: number;
  readonly verboseLogs: boolean;
  readonly maxTextLen: number;
  readonly log: (msg: string) => void;
  readonly logError: (msg: string) => void;
};

export type ProcessMessageResult =
  | { readonly status: "processed"; readonly opencode?: OpencodeSession }
  | { readonly status: "skipped" }
  | { readonly status: "failed-retryable"; readonly opencode?: OpencodeSession };

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarizeMessage(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLen
    ? `${normalized.slice(0, maxLen)}...`
    : normalized;
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
    const stopTyping = contextToken
      ? await deps.startTypingIndicator({
        baseUrl,
        contextToken,
        ilinkUserId: parsed.senderId,
        token,
      })
      : null;

    // 流式气泡：同一 client_id 原地更新（GENERATING → FINISH）
    const bubbleClientId = deps.generateClientId();
    const bubble = contextToken
      ? new StreamingTextBubble(
        (text, finish) => deps.sendStreamingText(baseUrl, token, {
          clientId: bubbleClientId,
          contextToken,
          finish,
          text,
          to: parsed.senderId,
        }, ctx.channelVersion),
        ctx.streamUpdateIntervalMs,
        (err) => ctx.logError(`流式更新失败，停止增量、整段收口: ${describeError(err)}`),
      )
      : null;

    let streamHandle: ReplyStreamHandle | null = null;
    if (bubble && deps.openReplyStream) {
      try {
        streamHandle = await deps.openReplyStream(initialOpencode, (cumulative) => {
          bubble.update(buildStreamPreview(cumulative));
        });
      } catch (err) {
        ctx.log(`流式订阅不可用，使用整段回复: ${describeError(err)}`);
        streamHandle = null;
      }
    }

    let responseText = "";
    let streamFinalText = "";
    let sessionRestarted = false;
    let currentOpencode = initialOpencode;
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
        responseText = await sendOnce(currentOpencode);
      }
    } finally {
      if (streamHandle) {
        streamFinalText = streamHandle.stop();
      }
      if (stopTyping) {
        await stopTyping();
      }
    }

    let fullText = responseText || streamFinalText;
    if (sessionRestarted && bubble?.hasSentUpdates) {
      fullText = `（OpenCode 连接中断，以下为重新生成的完整回复）\n\n${responseText}`;
    }
    if (!fullText && !bubble?.hasSentUpdates) {
      ctx.log("OpenCode 返回空响应，跳过发送");
      deps.markMessageProcessed(parsed.dedupeKey);
      clearMessageAttempts(parsed.dedupeKey);
      return { status: "skipped" };
    }
    if (!bubble) {
      ctx.logError(`缺少流式气泡上下文，无法回复用户 ${parsed.senderId}`);
      return { status: "skipped" };
    }

    await sendReplyToUser({
      bubble,
      command: omoCommand,
      deps,
      fullText,
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
      const contextToken = parsed.contextToken
        || deps.getCachedContextToken(parsed.senderId);
      if (contextToken) {
        try {
          await deps.sendTextMessage(
            baseUrl,
            token,
            parsed.senderId,
            `（这条消息连续 ${attempts} 次处理失败，已跳过。原因：${describeError(err)}。请稍后重新发送。）`,
            contextToken,
            deps.generateClientId(),
            ctx.channelVersion,
          );
        } catch (notifyErr) {
          ctx.logError(`发送失败通知也失败了: ${describeError(notifyErr)}`);
        }
      }
      deps.markMessageProcessed(parsed.dedupeKey);
      clearMessageAttempts(parsed.dedupeKey);
      return { status: "skipped" };
    }

    return { status: "failed-retryable" };
  }
}
