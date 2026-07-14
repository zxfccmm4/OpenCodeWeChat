import type { ParsedMessage } from "../types/wechat";
import type {
  MessageProcessorDeps,
  ProcessorContext,
} from "./message-processor-types";

export function describeProcessorError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function summarizeMessage(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLen
    ? `${normalized.slice(0, maxLen)}...`
    : normalized;
}

export function stopAfterMaxDuration(
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

export async function notifySkippedMessage(params: {
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
      `（这条消息连续 ${attempts} 次处理失败，已跳过。原因：${describeProcessorError(error)}。请稍后重新发送。）`,
      contextToken,
      deps.generateClientId(),
      ctx.channelVersion,
    );
  } catch (notifyError) {
    if (!(notifyError instanceof Error)) throw notifyError;
    ctx.logError(`发送失败通知也失败了: ${describeProcessorError(notifyError)}`);
  }
}
