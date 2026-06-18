/**
 * 跨批次的消息失败次数记账。
 *
 * 单例 Map 按 dedupeKey 累计每条消息的处理失败次数；
 * 达到上限后跳过该消息，防止一条无法处理的消息永久阻塞整个队列。
 * 当 Map 超过 500 条时按插入顺序淘汰最旧条目，避免内存无限增长。
 */

const messageAttempts = new Map<string, number>();
const MAX_TRACKED_MESSAGES = 500;

/** 清空所有失败计数（主要供测试使用）。 */
export function resetMessageAttemptTracking(): void {
  messageAttempts.clear();
}

/** 记录一次失败，返回当前累计失败次数。 */
export function recordMessageFailure(dedupeKey: string): number {
  const attempts = (messageAttempts.get(dedupeKey) ?? 0) + 1;
  messageAttempts.set(dedupeKey, attempts);
  if (messageAttempts.size > MAX_TRACKED_MESSAGES) {
    const oldest = messageAttempts.keys().next().value;
    if (oldest !== undefined && oldest !== dedupeKey) {
      messageAttempts.delete(oldest);
    }
  }
  return attempts;
}

/** 清除指定消息的失败计数（成功处理或达到上限跳过后调用）。 */
export function clearMessageAttempts(dedupeKey: string): void {
  messageAttempts.delete(dedupeKey);
}
