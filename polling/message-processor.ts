/**
 * 单条入站消息的完整处理流程：本地斜杠命令、prompt 构建、typing 指示、
 * OpenCode 调用（含连接中断后自动重启重试）、SSE 完整性补齐、回复发送（文本+媒体）、
 * OMO plan 缓存、失败重试。
 *
 * 这是 polling 层最核心也最重的逻辑单元，从 processUpdateBatch 抽出
 * 以便独立测试和降低 loop.ts 的认知负担。
 */
import { buildOmoSendPromptOptions } from "../core/omo-agent-routing";
import { parseLocalCommand } from "../core/local-command";
import { handleLocalCommand } from "../core/local-command-handler";
import {
  buildActivationMessage,
  buildFirstContactMessage,
  buildUnboundMessage,
} from "../core/local-command-copy";
import {
  hasWelcomedSender,
  markSenderWelcomed,
} from "../storage/welcomed-senders";
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
import type { OpencodeRuntime } from "../opencode/client";
import {
  buildUserPromptOptions,
  UserSessionNotBoundError,
} from "../opencode/user-session-manager";
import type {
  ResolvedUserSession,
  UserSessionResolver,
} from "../opencode/user-session-manager";
import { isOpencodeConnectionError } from "../opencode/errors";
import type { ReplyStreamHandle } from "../opencode/stream";
import type {
  LocalCommandRuntime,
  MessageProcessorDeps,
  ProcessMessageResult,
  ProcessorContext,
} from "./message-processor-types";
import {
  describeProcessorError,
  notifySkippedMessage,
  stopAfterMaxDuration,
  summarizeMessage,
} from "./message-processor-support";

export type {
  LocalCommandRuntime,
  MessageProcessorDeps,
  ProcessMessageResult,
  ProcessorContext,
} from "./message-processor-types";

export async function processMessage(params: {
  readonly message: ParsedMessage;
  readonly opencode: OpencodeRuntime;
  readonly userSessions?: UserSessionResolver;
  readonly localCommands?: LocalCommandRuntime;
  readonly deps: MessageProcessorDeps;
  readonly ctx: ProcessorContext;
}): Promise<ProcessMessageResult> {
  const {
    message: parsed,
    opencode: initialOpencode,
    deps,
    ctx,
    userSessions,
    localCommands,
  } = params;
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

  const parseLocal = deps.parseLocalCommand ?? parseLocalCommand;
  const runLocal = deps.handleLocalCommand ?? handleLocalCommand;
  const isWelcomed = deps.hasWelcomedSender ?? hasWelcomedSender;
  const markWelcomed = deps.markSenderWelcomed ?? markSenderWelcomed;

  if (localCommands) {
    const local = parseLocal(parsed.text, { hasMedia: parsed.media.length > 0 });
    if (local.kind === "error") {
      await replyLocalText({
        ctx,
        deps,
        message: parsed,
        text: local.message,
      });
      deps.markMessageProcessed(parsed.dedupeKey);
      clearMessageAttempts(parsed.dedupeKey);
      return { status: "processed" };
    }
    if (local.kind !== "non_local") {
      try {
        const handled = await runLocal({
          command: local,
          deps: localCommands,
          senderId: parsed.senderId,
        });
        await replyLocalText({
          ctx,
          deps,
          message: parsed,
          text: handled.reply,
        });
        // 绑定成功文案已含激活说明，记为已欢迎
        if (handled.kind === "bind") {
          markWelcomed(parsed.senderId);
        } else if (handled.kind === "help" || handled.kind === "unbound") {
          markWelcomed(parsed.senderId);
        }
        deps.markMessageProcessed(parsed.dedupeKey);
        clearMessageAttempts(parsed.dedupeKey);
        return { status: "processed" };
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const attempts = recordMessageFailure(parsed.dedupeKey);
        ctx.logError(
          `本地命令处理失败 (第 ${attempts}/${ctx.maxMessageAttempts} 次): ${describeProcessorError(err)}`,
        );
        if (attempts >= ctx.maxMessageAttempts) {
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
        return { status: "failed-retryable" };
      }
    }

    // 首次连接且非斜杠命令：只发欢迎，本条不再进 OpenCode
    if (!isWelcomed(parsed.senderId)) {
      try {
        const binding = await localCommands.sessions.peekBinding(parsed.senderId);
        const welcome = binding ? buildActivationMessage() : buildFirstContactMessage();
        await replyLocalText({
          ctx,
          deps,
          message: parsed,
          text: welcome,
        });
        markWelcomed(parsed.senderId);
        ctx.log(`已向 ${parsed.senderId} 发送首次连接欢迎`);
        deps.markMessageProcessed(parsed.dedupeKey);
        clearMessageAttempts(parsed.dedupeKey);
        return { status: "processed" };
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        ctx.logError(`首次欢迎发送失败: ${describeProcessorError(err)}`);
        // 欢迎失败仍继续后续绑定检查 / OpenCode，避免丢消息
      }
    }
  }

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
    const latestPlanContext = deps.getLatestPlanContext(ctx.account, parsed.senderId);
    const needsFileDelivery = needsWechatFileDeliveryHint(parsed.text);
    const compiledPrompt = [
      deps.buildOmoPrompt(promptText, latestPlanContext),
      WECHAT_MEDIA_PROMPT_HINT,
      ...(needsFileDelivery ? [WECHAT_FILE_DELIVERY_PROMPT_HINT] : []),
    ].join("\n\n");
    if (needsFileDelivery) {
      ctx.log(`检测到文件交付任务，OpenCode 超时放宽至 ${ctx.longPromptTimeoutMs}ms`);
    }

    let resolved: ResolvedUserSession | undefined;
    try {
      resolved = userSessions ? await userSessions.resolve(parsed.senderId) : undefined;
    } catch (err) {
      if (!(err instanceof UserSessionNotBoundError)) throw err;
      // 已接入绑定体系时，未绑定用户不能直接调用 OpenCode
      // 首次欢迎已在上方发送；后续普通消息只回简短绑定提示
      if (isWelcomed(parsed.senderId)) {
        await replyLocalText({
          ctx,
          deps,
          message: parsed,
          text: buildUnboundMessage(),
        });
      }
      deps.markMessageProcessed(parsed.dedupeKey);
      clearMessageAttempts(parsed.dedupeKey);
      return { status: "processed" };
    }
    let activeSession = resolved?.session ?? initialOpencode.session;
    const sendOnce = async (): Promise<string> => {
      const promptOptions = resolved
        ? buildUserPromptOptions(omoCommand, resolved.binding, activeSession)
        : buildOmoSendPromptOptions(omoCommand, activeSession);
      if (promptOptions.agent) {
        ctx.log(`路由至 OpenCode agent: ${promptOptions.agent}`);
      }
      return deps.sendPrompt(
        activeSession,
        compiledPrompt,
        needsFileDelivery
          ? { ...promptOptions, timeoutMs: ctx.longPromptTimeoutMs }
          : promptOptions,
      );
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
        streamHandle = await deps.openReplyStream(activeSession, (cumulative) => {
          streamCapturedText = cumulative;
        });
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        ctx.log(`OpenCode SSE 订阅不可用，仅使用同步回复: ${describeProcessorError(err)}`);
        streamHandle = null;
      }
    }

    let responseText = "";
    let streamFinalText = "";
    let sessionRestarted = false;
    try {
      try {
        responseText = await sendOnce();
      } catch (err) {
        if (!isOpencodeConnectionError(err)) throw err;
        ctx.logError(`OpenCode 连接失败: ${describeProcessorError(err)}`);
        ctx.log("尝试自动重启 OpenCode 会话...");
        if (userSessions) {
          resolved = await userSessions.recover(
            parsed.senderId,
            activeSession.transport.generation,
          );
          activeSession = resolved.session;
          currentOpencode = { manager: initialOpencode.manager, session: activeSession };
        } else {
          currentOpencode = await deps.restartOpencode(initialOpencode);
          activeSession = currentOpencode.session;
        }
        sessionRestarted = true;
        ctx.log("OpenCode 会话已重启，重试当前消息...");
        try {
          responseText = await sendOnce();
        } catch (retryErr) {
          if (!isOpencodeConnectionError(retryErr)) throw retryErr;
          ctx.logError(`OpenCode 重启后仍连接失败，跳过当前消息: ${describeProcessorError(retryErr)}`);
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
    if (!(err instanceof Error)) throw err;
    const attempts = recordMessageFailure(parsed.dedupeKey);
    ctx.logError(
      `OpenCode 处理失败 (第 ${attempts}/${ctx.maxMessageAttempts} 次): ${describeProcessorError(err)}`,
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

async function replyLocalText(params: {
  readonly ctx: ProcessorContext;
  readonly deps: MessageProcessorDeps;
  readonly message: ParsedMessage;
  readonly text: string;
}): Promise<void> {
  const { ctx, deps, message, text } = params;
  const contextToken = message.contextToken
    || deps.getCachedContextToken(message.senderId);
  if (!contextToken) {
    ctx.logError(`缺少 context_token，无法回复本地命令结果给 ${message.senderId}`);
    return;
  }
  await deps.sendTextMessage(
    ctx.account.baseUrl,
    ctx.account.token,
    message.senderId,
    text,
    contextToken,
    deps.generateClientId(),
    ctx.channelVersion,
  );
}
