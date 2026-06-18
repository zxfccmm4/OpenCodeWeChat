import { describe, expect, test } from "bun:test";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";
import { processUpdateBatch, resetMessageAttemptTracking } from "../polling/loop";
import type { MessageProcessorDeps } from "../polling/message-processor-types";
import type { AccountData, WeixinMessage } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";

type TestDeps = NonNullable<Parameters<typeof processUpdateBatch>[0]["deps"]>;

const TEST_ACCOUNT: AccountData = {
  accountId: "bot-1",
  baseUrl: "https://example.com",
  savedAt: "2026-05-16T00:00:00.000Z",
  token: "token-1",
  userId: "user-1",
};

const TEST_SESSION: OpencodeSession = {
  agents: [],
  authHeader: "Basic test",
  close() {},
  id: "session-1",
  serverUrl: "http://127.0.0.1:1",
};

function createDeps(overrides: Partial<MessageProcessorDeps> = {}): TestDeps {
  return {
    buildOmoPrompt(text, recentPlanContext) {
      return buildOmoPrompt(text, recentPlanContext);
    },
    cacheContextToken() {},
    async downloadIncomingMedia() {
      return { byteLength: 0, savedPath: "/tmp/inbox/mock" };
    },
    generateClientId() {
      return "client-id-1";
    },
    getCachedContextToken() {
      return undefined;
    },
    getLatestPlanContext() {
      return undefined;
    },
    hasProcessedMessage() {
      return false;
    },
    markMessageProcessed() {},
    openReplyStream: null,
    parseOmoCommand(text) {
      return parseOmoCommand(text);
    },
    async restartOpencode(session) {
      return session;
    },
    saveLatestPlanContext() {},
    saveSyncBuffer() {},
    async sendMediaMessage() {},
    async sendPrompt() {
      return "reply";
    },
    async sendStreamingText() {},
    async sendTextMessage() {},
    async startTypingIndicator() {
      return async () => {};
    },
    ...overrides,
  };
}

function createUserMessage(text: string): WeixinMessage {
  return {
    client_id: "msg-1",
    create_time_ms: Date.now(),
    from_user_id: "wx-user-1",
    item_list: [{ text_item: { text }, type: 1 }],
    message_state: 2,
    message_type: 1,
    context_token: "ctx-1",
  };
}

describe("processUpdateBatch streaming preview replies", () => {
  test("sends the complete answer as ordinary text when streaming is not configured", async () => {
    resetMessageAttemptTracking();
    const plainTexts: string[] = [];
    let streamingCalls = 0;
    let typingStarts = 0;
    let typingStops = 0;
    const fullText = "我是 Sisyphus，基于 GPT-5.5 的 OhMyOpenCode 编排智能体。";

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt() {
          return fullText;
        },
        async sendStreamingText() {
          streamingCalls += 1;
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          plainTexts.push(text);
        },
        async startTypingIndicator() {
          typingStarts += 1;
          return async () => {
            typingStops += 1;
          };
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage("你现在的智能体是")],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(typingStarts).toBe(1);
    expect(typingStops).toBe(1);
    expect(streamingCalls).toBe(0);
    expect(plainTexts.join("")).toBe(fullText);
  });

  test("streams a preview bubble and sends the complete answer as ordinary text", async () => {
    resetMessageAttemptTracking();
    const bubbleSends: Array<{ finish: boolean; text: string }> = [];
    const plainTexts: string[] = [];
    let typingStarts = 0;
    let typingStops = 0;
    let streamStops = 0;
    const previewText = "甲".repeat(130);
    const tail = "乙".repeat(40);
    const fullText = `${previewText}\n\n${tail}`;
    let pushText: ((cumulative: string) => void) | null = null;

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async openReplyStream(_session, onText) {
          pushText = onText;
          return {
            stop() {
              streamStops += 1;
              return previewText;
            },
          };
        },
        async sendPrompt() {
          pushText?.(previewText);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return fullText;
        },
        async sendStreamingText(_baseUrl, _token, params) {
          bubbleSends.push({ finish: params.finish, text: params.text });
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          plainTexts.push(text);
        },
        async startTypingIndicator() {
          typingStarts += 1;
          return async () => {
            typingStops += 1;
          };
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage("长任务")],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(typingStarts).toBe(1);
    expect(typingStops).toBe(1);
    expect(streamStops).toBe(1);
    const generating = bubbleSends.filter((send) => !send.finish);
    const finished = bubbleSends.filter((send) => send.finish);
    expect(generating.length).toBeGreaterThanOrEqual(1);
    expect(generating[0]?.text).toBe(previewText);
    expect(finished).toEqual([]);
    expect(plainTexts.join("")).toBe(fullText);
  });
});
