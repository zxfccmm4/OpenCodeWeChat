/**
 * 订阅 OpenCode /event SSE 流，聚合当前会话助手回复的文本增量。
 *
 * 事件协议（兼容 v1 和 v2）:
 *   - message.part.updated: part 快照（含 type、累计 text）+ 可选 delta
 *     v1 服务器只发这一种事件，增量文本通过 properties.delta 传递
 *   - message.part.delta (仅 v2): 字段级增量，field="text" 时为文本增量
 *   - 连接建立时服务端可能回放历史快照；只有出现过 delta 的消息才视为
 *     "本轮生成中"，避免把上一轮回复重复发给用户。
 */
import type { OpencodeSession } from "./types";

export interface ReplyStreamHandle {
  /** 中止订阅，返回当前累计文本 */
  stop(): string;
}

export type ReplyTextAggregator = {
  current(): string;
  handleEvent(event: unknown): void;
};

type PartState = {
  messageId: string;
  order: number;
  text: string;
  type?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStr(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function createReplyTextAggregator(
  sessionId: string,
  onText: (cumulative: string) => void,
): ReplyTextAggregator {
  const parts = new Map<string, PartState>();
  const liveMessages = new Set<string>();
  let order = 0;
  let last = "";

  const cumulative = (): string =>
    [...parts.values()]
      .filter((p) => p.type === "text" && liveMessages.has(p.messageId))
      .sort((a, b) => a.order - b.order)
      .map((p) => p.text)
      .join("\n");

  const emit = () => {
    const text = cumulative();
    if (text !== last) {
      last = text;
      onText(text);
    }
  };

  const ensurePart = (partId: string, messageId: string): PartState => {
    let state = parts.get(partId);
    if (!state) {
      state = { messageId, order: order++, text: "" };
      parts.set(partId, state);
    }
    return state;
  };

  return {
    current: () => last,
    handleEvent(event: unknown): void {
      if (!isObject(event)) return;
      const type = getStr(event, "type");
      const props = event.properties;
      if (!isObject(props)) return;

      if (type === "message.part.updated") {
        const part = props.part;
        if (!isObject(part)) return;
        if (getStr(part, "sessionID") !== sessionId) return;
        const partId = getStr(part, "id");
        const messageId = getStr(part, "messageID");
        if (!partId || !messageId) return;
        const state = ensurePart(partId, messageId);
        const partType = getStr(part, "type");
        if (partType) state.type = partType;
        // v1 服务器通过 properties.delta 标记活跃生成（v2 用独立事件）
        // 只有携带 delta 的事件才标记为"本轮生成中"，避免回放历史快照
        const delta = getStr(props, "delta");
        if (delta !== undefined) {
          liveMessages.add(messageId);
        }
        // 快照里的 text 始终是累计全文，直接覆盖
        const text = getStr(part, "text");
        if (text !== undefined) state.text = text;
        emit();
        return;
      }

      // message.part.delta（仅 v2）：字段级增量
      if (type === "message.part.delta") {
        if (getStr(props, "sessionID") !== sessionId) return;
        if (getStr(props, "field") !== "text") return;
        const partId = getStr(props, "partID");
        const messageId = getStr(props, "messageID");
        if (!partId || !messageId) return;
        liveMessages.add(messageId);
        const state = ensurePart(partId, messageId);
        state.text += getStr(props, "delta") ?? "";
        emit();
      }
    },
  };
}

export async function openReplyTextStream(params: {
  readonly onText: (cumulative: string) => void;
  readonly session: OpencodeSession;
}): Promise<ReplyStreamHandle> {
  const controller = new AbortController();
  const res = await fetch(new URL("/event", params.session.serverUrl), {
    headers: {
      Accept: "text/event-stream",
      Authorization: params.session.authHeader,
    },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) {
    controller.abort();
    throw new Error(`SSE 订阅失败: HTTP ${res.status}`);
  }
  const body = res.body;

  const aggregator = createReplyTextAggregator(params.session.id, params.onText);

  void (async () => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data: ")) continue;
          try {
            aggregator.handleEvent(JSON.parse(line.slice(6)));
          } catch {
            // 跳过无法解析的事件
          }
        }
      }
    } catch {
      // 中止或网络断开，由调用方的 stop()/整段回退兜底
    }
  })();

  return {
    stop(): string {
      controller.abort();
      return aggregator.current();
    },
  };
}
