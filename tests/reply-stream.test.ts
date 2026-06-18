import { describe, expect, test } from "bun:test";
import { createReplyTextAggregator } from "../opencode/stream";

const SESSION = "ses_test_1";

function partUpdated(part: Record<string, unknown>) {
  return { properties: { part }, type: "message.part.updated" };
}

function partDelta(props: Record<string, unknown>) {
  return { properties: props, type: "message.part.delta" };
}

describe("createReplyTextAggregator", () => {
  test("accumulates text deltas for live messages", () => {
    const seen: string[] = [];
    const agg = createReplyTextAggregator(SESSION, (t) => seen.push(t));

    agg.handleEvent(partUpdated({
      id: "p1", messageID: "m1", sessionID: SESSION, text: "", type: "text",
    }));
    agg.handleEvent(partDelta({
      delta: "你好", field: "text", messageID: "m1", partID: "p1", sessionID: SESSION,
    }));
    agg.handleEvent(partDelta({
      delta: "，世界", field: "text", messageID: "m1", partID: "p1", sessionID: SESSION,
    }));

    expect(agg.current()).toBe("你好，世界");
    expect(seen).toEqual(["你好", "你好，世界"]);
  });

  test("excludes reasoning parts even though their deltas use field=text", () => {
    const agg = createReplyTextAggregator(SESSION, () => {});

    agg.handleEvent(partUpdated({
      id: "pr", messageID: "m1", sessionID: SESSION, text: "", type: "reasoning",
    }));
    agg.handleEvent(partDelta({
      delta: "The user is asking...", field: "text", messageID: "m1", partID: "pr", sessionID: SESSION,
    }));
    agg.handleEvent(partUpdated({
      id: "pt", messageID: "m1", sessionID: SESSION, text: "", type: "text",
    }));
    agg.handleEvent(partDelta({
      delta: "正式回答", field: "text", messageID: "m1", partID: "pt", sessionID: SESSION,
    }));

    expect(agg.current()).toBe("正式回答");
  });

  test("ignores replayed history snapshots that never produce deltas", () => {
    const agg = createReplyTextAggregator(SESSION, () => {});

    // 连接建立时服务端回放的上一轮完整回复（只有快照，没有增量）
    agg.handleEvent(partUpdated({
      id: "old", messageID: "m_old", sessionID: SESSION, text: "上一轮的旧回复", type: "text",
    }));
    expect(agg.current()).toBe("");

    // 新一轮生成有增量，正常计入
    agg.handleEvent(partUpdated({
      id: "new", messageID: "m_new", sessionID: SESSION, text: "", type: "text",
    }));
    agg.handleEvent(partDelta({
      delta: "新回复", field: "text", messageID: "m_new", partID: "new", sessionID: SESSION,
    }));
    expect(agg.current()).toBe("新回复");
  });

  test("ignores other sessions and non-text fields", () => {
    const agg = createReplyTextAggregator(SESSION, () => {});

    agg.handleEvent(partDelta({
      delta: "别的会话", field: "text", messageID: "mx", partID: "px", sessionID: "ses_other",
    }));
    agg.handleEvent(partDelta({
      delta: "别的字段", field: "metadata", messageID: "m1", partID: "p1", sessionID: SESSION,
    }));

    expect(agg.current()).toBe("");
  });

  test("snapshot text overrides accumulated deltas for the same part", () => {
    const agg = createReplyTextAggregator(SESSION, () => {});

    agg.handleEvent(partUpdated({
      id: "p1", messageID: "m1", sessionID: SESSION, text: "", type: "text",
    }));
    agg.handleEvent(partDelta({
      delta: "增量内", field: "text", messageID: "m1", partID: "p1", sessionID: SESSION,
    }));
    agg.handleEvent(partUpdated({
      id: "p1", messageID: "m1", sessionID: SESSION, text: "增量内容的完整快照", type: "text",
    }));

    expect(agg.current()).toBe("增量内容的完整快照");
  });
});
