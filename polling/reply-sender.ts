/**
 * 回复发送：把 OpenCode 返回的 fullText 发回微信用户。
 *
 * 拆成两步：先收口流式气泡（一条文本气泡），再把其中解析出的
 * 媒体指令作为独立媒体消息逐一发送。plan 模式下额外缓存最近计划。
 */
import type { StreamingTextBubble } from "../core/streaming-bubble";
import { splitTextForWechat } from "../core/text-chunks";
import { parseWechatReplyParts } from "../core/wechat-media-directive";
import { WECHAT_REPLY_TEXT_CHUNK_CHARS } from "../config";
import type { OmoCommand, OmoPlanContext } from "../core/omo-command";
import type { ParsedMessage } from "../types/wechat";
import type { MessageProcessorDeps } from "./message-processor";
import type { ProcessorContext } from "./message-processor";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function sendTextChunks(params: {
  readonly baseUrl: string;
  readonly channelVersion: string;
  readonly chunks: readonly string[];
  readonly contextToken: string;
  readonly deps: MessageProcessorDeps;
  readonly to: string;
  readonly token: string;
}): Promise<void> {
  const { baseUrl, channelVersion, chunks, contextToken, deps, to, token } = params;
  for (const chunk of chunks) {
    await deps.sendTextMessage(
      baseUrl,
      token,
      to,
      chunk,
      contextToken,
      deps.generateClientId(),
      channelVersion,
    );
  }
}

export async function sendReplyToUser(params: {
  readonly bubble: StreamingTextBubble;
  readonly command: OmoCommand;
  readonly deps: MessageProcessorDeps;
  readonly fullText: string;
  readonly message: ParsedMessage;
  readonly ctx: ProcessorContext;
}): Promise<void> {
  const { bubble, command, deps, fullText, message: parsed, ctx } = params;
  const { baseUrl, token } = ctx.account;
  const contextToken = parsed.contextToken ?? deps.getCachedContextToken(parsed.senderId);
  if (!contextToken) {
    ctx.logError(`缺少 context_token，无法回复用户 ${parsed.senderId}`);
    return;
  }

  // 文本走流式气泡收口（一条气泡），媒体指令随后作为独立消息发送
  const replyParts = parseWechatReplyParts(fullText);
  const finalText = replyParts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)
    .join("\n\n");
  const textChunks = splitTextForWechat(finalText, WECHAT_REPLY_TEXT_CHUNK_CHARS);
  let plainTextChunks: readonly string[] = textChunks.slice(1);

  try {
    await bubble.finalize(textChunks[0] ?? "");
  } catch (err) {
    ctx.logError(`流式收口失败，降级为普通消息: ${describeError(err)}`);
    plainTextChunks = textChunks;
  }

  await sendTextChunks({
    baseUrl,
    channelVersion: ctx.channelVersion,
    chunks: plainTextChunks,
    contextToken,
    deps,
    to: parsed.senderId,
    token,
  });
  if (textChunks.length > 1) {
    ctx.log(`长回复已分片发送: ${textChunks.length} 段 (${finalText.length} chars)`);
  }

  for (const part of replyParts) {
    if (part.kind !== "media") continue;
    ctx.log(`发送媒体回复: kind=${part.mediaKind} path=${part.filePath}`);
    try {
      await deps.sendMediaMessage({
        baseUrl,
        channelVersion: ctx.channelVersion,
        clientId: deps.generateClientId(),
        contextToken,
        filePath: part.filePath,
        kind: part.mediaKind,
        text: part.text,
        to: parsed.senderId,
        token,
      });
    } catch (err) {
      ctx.logError(`媒体发送失败 (${part.filePath}): ${describeError(err)}`);
      await deps.sendTextMessage(
        baseUrl,
        token,
        parsed.senderId,
        `（媒体发送失败：${part.filePath}\n原因：${describeError(err)}）`,
        contextToken,
        deps.generateClientId(),
        ctx.channelVersion,
      );
    }
  }

  ctx.log(bubble.hasSentUpdates ? "已发送回复（流式气泡）" : "已发送回复");
  if (command.mode === "plan") {
    const planContext: OmoPlanContext = {
      originalRequest: command.body || parsed.text,
      planResponse: fullText,
      savedAt: new Date().toISOString(),
    };
    deps.saveLatestPlanContext(planContext, parsed.senderId);
  }
}
