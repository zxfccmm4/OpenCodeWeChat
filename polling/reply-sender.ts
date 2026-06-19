/**
 * 回复发送：把 OpenCode 返回的 fullText 发回微信用户。
 *
 * 文本按 ClawBot / OpenClaw SDK 的普通 FINISH 消息语义发送；长文本拆成
 * 多条 FINISH 文本，媒体指令作为独立媒体消息逐一发送。plan 模式下额外缓存最近计划。
 */
import { splitTextForWechat } from "../core/text-chunks";
import { parseWechatReplyParts } from "../core/wechat-media-directive";
import type { OmoCommand, OmoPlanContext } from "../core/omo-command";
import type { ParsedMessage } from "../types/wechat";
import type { MessageProcessorDeps, ProcessorContext } from "./message-processor-types";

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
  readonly command: OmoCommand;
  readonly deps: MessageProcessorDeps;
  readonly fullText: string;
  readonly message: ParsedMessage;
  readonly ctx: ProcessorContext;
}): Promise<void> {
  const {
    command,
    deps,
    fullText,
    message: parsed,
    ctx,
  } = params;
  const { baseUrl, token } = ctx.account;
  const contextToken = parsed.contextToken ?? deps.getCachedContextToken(parsed.senderId);
  if (!contextToken) {
    ctx.logError(`缺少 context_token，无法回复用户 ${parsed.senderId}`);
    return;
  }

  const replyParts = parseWechatReplyParts(fullText);
  const finalText = replyParts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)
    .join("\n\n");
  const textChunks = splitTextForWechat(finalText, ctx.replyTextChunkChars);

  await sendTextChunks({
    baseUrl,
    channelVersion: ctx.channelVersion,
    chunks: textChunks,
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

  ctx.log("已发送回复");
  if (command.mode === "plan") {
    const planContext: OmoPlanContext = {
      originalRequest: command.body || parsed.text,
      planResponse: fullText,
      savedAt: new Date().toISOString(),
    };
    deps.saveLatestPlanContext(planContext, parsed.senderId);
  }
}
