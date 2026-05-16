import { describe, expect, test } from "bun:test";
import { processUpdateBatch } from "../polling/loop";
import type { AccountData, GetUpdatesResp } from "../types/wechat";
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
  authHeader: "Basic test",
  close() {
    // noop
  },
  id: "session-1",
  serverUrl: "http://127.0.0.1:1",
};

function createDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  return {
    cacheContextToken() {
      // noop
    },
    generateClientId() {
      return "client-id-1";
    },
    getCachedContextToken() {
      return undefined;
    },
    hasProcessedMessage() {
      return false;
    },
    markMessageProcessed() {
      // noop
    },
    saveSyncBuffer() {
      // noop
    },
    async sendPrompt() {
      return "reply";
    },
    async sendTextMessage() {
      // noop
    },
    ...overrides,
  };
}

function createUserMessage(params: {
  clientId?: string;
  contextToken?: string;
  createTimeMs?: number;
  senderId?: string;
  text: string;
}) {
  return {
    client_id: params.clientId,
    context_token: params.contextToken,
    create_time_ms: params.createTimeMs ?? 1_715_810_000_000,
    from_user_id: params.senderId ?? "wx-user-1",
    item_list: [{ text_item: { text: params.text }, type: 1 }],
    message_state: 2,
    message_type: 1,
  };
}

describe("processUpdateBatch", () => {
  test("advances the sync cursor only after the batch fully succeeds", async () => {
    const savedBuffers: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        saveSyncBuffer(buffer) {
          savedBuffers.push(buffer);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "hello" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(savedBuffers).toEqual(["new-buf"]);
  });

  test("keeps the previous cursor when processing fails", async () => {
    const savedBuffers: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        saveSyncBuffer(buffer) {
          savedBuffers.push(buffer);
        },
        async sendPrompt() {
          throw new Error("OpenCode down");
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "hello" })],
      },
    });

    expect(result.batchSucceeded).toBe(false);
    expect(result.getUpdatesBuf).toBe("old-buf");
    expect(savedBuffers).toEqual([]);
  });

  test("skips already processed messages without sending them again", async () => {
    let sendPromptCalls = 0;
    let sendTextMessageCalls = 0;
    const savedBuffers: string[] = [];

    const response: GetUpdatesResp = {
      get_updates_buf: "new-buf",
      msgs: [createUserMessage({ clientId: "dup-1", contextToken: "ctx-1", text: "hello" })],
    };

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        hasProcessedMessage(messageId) {
          return messageId === "client:dup-1";
        },
        saveSyncBuffer(buffer) {
          savedBuffers.push(buffer);
        },
        async sendPrompt() {
          sendPromptCalls += 1;
          return "reply";
        },
        async sendTextMessage() {
          sendTextMessageCalls += 1;
        },
      }),
      opencode: TEST_SESSION,
      response,
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(savedBuffers).toEqual(["new-buf"]);
    expect(sendPromptCalls).toBe(0);
    expect(sendTextMessageCalls).toBe(0);
  });

  test("falls back to the cached context token when the message omits one", async () => {
    const sentTokens: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        getCachedContextToken() {
          return "cached-ctx";
        },
        async sendTextMessage(_baseUrl, _token, _to, _text, contextToken) {
          sentTokens.push(contextToken);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ text: "hello without inline token" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(sentTokens).toEqual(["cached-ctx"]);
  });
});
