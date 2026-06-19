import { beforeEach, describe, expect, test } from "bun:test";
import { processUpdateBatch, resetMessageAttemptTracking } from "../polling/loop";
import { processMessage } from "../polling/message-processor";
import { parseMessage } from "../core/message";
import type { AccountData, GetUpdatesResp } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";

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
    buildOmoPrompt(text, recentPlanContext) {
      return buildOmoPrompt(text, recentPlanContext);
    },
    async downloadIncomingMedia() {
      return { byteLength: 4, savedPath: "/tmp/inbox/mock-file" };
    },
    generateClientId() {
      return "client-id-1";
    },
    openReplyStream: null,
    async restartOpencode() {
      return TEST_SESSION;
    },
    async startTypingIndicator() {
      return async () => {};
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
    markMessageProcessed() {
      // noop
    },
    parseOmoCommand(text) {
      return parseOmoCommand(text);
    },
    saveSyncBuffer() {
      // noop
    },
    saveLatestPlanContext() {
      // noop
    },
    async sendPrompt() {
      return "reply";
    },
    async sendMediaMessage() {},
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

function createImageMessage(params: {
  clientId?: string;
  contextToken?: string;
} = {}) {
  return {
    client_id: params.clientId ?? "img-msg-1",
    context_token: params.contextToken ?? "ctx-1",
    create_time_ms: 1_715_810_000_000,
    from_user_id: "wx-user-1",
    item_list: [
      {
        image_item: {
          media: { aes_key: "a2V5", encrypt_query_param: "img-param" },
        },
        type: 2,
      },
    ],
    message_state: 2,
    message_type: 1,
  };
}

describe("processUpdateBatch", () => {
  beforeEach(() => {
    resetMessageAttemptTracking();
  });

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

  test("stores the latest plan response after a #plan request", async () => {
    const savedPlans: Array<{ originalRequest: string; planResponse: string; userId: string }> = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        saveLatestPlanContext(planContext, userId) {
          savedPlans.push({
            originalRequest: planContext.originalRequest,
            planResponse: planContext.planResponse,
            userId,
          });
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "#plan 帮我拆一下实现步骤" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(savedPlans).toEqual([
      {
        originalRequest: "帮我拆一下实现步骤",
        planResponse: "reply",
        userId: "wx-user-1",
      },
    ]);
  });

  test("passes the latest cached plan into #start requests", async () => {
    const prompts: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        getLatestPlanContext() {
          return {
            originalRequest: "先帮我规划",
            planResponse: "这是上一次的计划内容",
            savedAt: "2026-05-16T09:00:00.000Z",
          };
        },
        async sendPrompt(_session, prompt) {
          prompts.push(prompt);
          return "reply";
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "#start 按计划继续执行" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(prompts[0]).toContain("微信侧指令: #start (映射到 Atlas / /start-work)");
    expect(prompts[0]).toContain("规划请求：先帮我规划");
    expect(prompts[0]).toContain("这是上一次的计划内容");
  });

  test("routes OMO commands to matching OpenCode agents when available", async () => {
    const sentAgents: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(_session, _prompt, options) {
          if (options?.agent) sentAgents.push(options.agent);
          return "reply";
        },
      }),
      opencode: {
        ...TEST_SESSION,
        agents: [
          { id: "prometheus", mode: "primary" },
          { id: "sisyphus", mode: "primary" },
        ],
      },
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "#plan 帮我拆一下" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(sentAgents).toEqual(["prometheus"]);
  });

  test("loads Oh My OpenAgent context for ordinary OpenCode calls", async () => {
    const systems: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(_session, _prompt, options) {
          if (options?.system) systems.push(options.system);
          return "reply";
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "普通问题" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(systems[0]).toContain("Oh My OpenAgent");
    expect(systems[0]).toContain("MCP");
    expect(systems[0]).toContain("Skill");
  });

  test("sends media directives as media messages instead of raw text", async () => {
    const sentTexts: string[] = [];
    const sentMedia: Array<{ filePath: string; kind: string; text: string | undefined }> = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt() {
          return "前置说明\n[[wechat-image:/tmp/result.png|结果图]]\n后置说明";
        },
        async sendMediaMessage(params) {
          sentMedia.push({
            filePath: params.filePath,
            kind: params.kind ?? "auto",
            text: params.text,
          });
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          sentTexts.push(text);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "发图" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(sentTexts).toEqual(["前置说明\n\n后置说明"]);
    expect(sentMedia).toEqual([
      { filePath: "/tmp/result.png", kind: "image", text: "结果图" },
    ]);
  });

  test("downloads incoming media and feeds the saved path into the prompt", async () => {
    const prompts: string[] = [];
    const downloadedKinds: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async downloadIncomingMedia(media) {
          downloadedKinds.push(media.kind);
          return { byteLength: 1024, savedPath: "/tmp/inbox/2026-img.jpg" };
        },
        async sendPrompt(_session, prompt) {
          prompts.push(prompt);
          return "reply";
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createImageMessage()],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(downloadedKinds).toEqual(["image"]);
    expect(prompts[0]).toContain("/tmp/inbox/2026-img.jpg");
    expect(prompts[0]).toContain("图片");
  });

  test("keeps processing when a media download fails", async () => {
    const prompts: string[] = [];
    let markedProcessed = 0;

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async downloadIncomingMedia() {
          throw new Error("CDN download failed: HTTP 404");
        },
        markMessageProcessed() {
          markedProcessed += 1;
        },
        async sendPrompt(_session, prompt) {
          prompts.push(prompt);
          return "reply";
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createImageMessage()],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(markedProcessed).toBe(1);
    expect(prompts[0]).toContain("下载失败");
    expect(prompts[0]).toContain("CDN download failed: HTTP 404");
  });

  test("appends the media directive hint to every compiled prompt", async () => {
    const prompts: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(_session, prompt) {
          prompts.push(prompt);
          return "reply";
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "普通问题" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(prompts[0]).toContain("微信桥接提醒");
    expect(prompts[0]).toContain("[[wechat-file:");
  });

  test("falls back to a text notice when media sending fails", async () => {
    const sentTexts: string[] = [];
    let markedProcessed = 0;

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        markMessageProcessed() {
          markedProcessed += 1;
        },
        async sendPrompt() {
          return "[[wechat-image:/tmp/missing.png|结果图]]";
        },
        async sendMediaMessage() {
          throw new Error("ENOENT: no such file or directory");
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          sentTexts.push(text);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "把图发我" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(markedProcessed).toBe(1);
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).toContain("媒体发送失败");
    expect(sentTexts[0]).toContain("/tmp/missing.png");
    expect(sentTexts[0]).toContain("ENOENT");
  });

  test("marks empty-response messages as processed to avoid burning repeat model calls", async () => {
    let markedProcessed = 0;
    let sendTextMessageCalls = 0;

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        markMessageProcessed() {
          markedProcessed += 1;
        },
        async sendPrompt() {
          return "";
        },
        async sendTextMessage() {
          sendTextMessageCalls += 1;
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(markedProcessed).toBe(1);
    expect(sendTextMessageCalls).toBe(0);
  });

  test("restarts the OpenCode session and retries when the server is unreachable", async () => {
    const replacementSession: OpencodeSession = {
      ...TEST_SESSION,
      id: "session-2",
    };
    let restartCalls = 0;
    let promptCalls = 0;
    const sentTexts: string[] = [];
    const promptSessions: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async restartOpencode() {
          restartCalls += 1;
          return replacementSession;
        },
        async sendPrompt(session) {
          promptCalls += 1;
          promptSessions.push(session.id);
          if (promptCalls === 1) {
            throw new Error("Unable to connect. Is the computer able to access the url?");
          }
          return "恢复后的回复";
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          sentTexts.push(text);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(restartCalls).toBe(1);
    expect(promptCalls).toBe(2);
    expect(promptSessions).toEqual(["session-1", "session-2"]);
    expect(result.opencode.id).toBe("session-2");
    expect(sentTexts).toEqual(["恢复后的回复"]);
  });

  test("restarts the OpenCode session and retries when a prompt times out", async () => {
    const replacementSession: OpencodeSession = {
      ...TEST_SESSION,
      id: "session-2",
    };
    let restartCalls = 0;
    let promptCalls = 0;
    const sentTexts: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async restartOpencode() {
          restartCalls += 1;
          return replacementSession;
        },
        async sendPrompt() {
          promptCalls += 1;
          if (promptCalls === 1) {
            throw new Error("The operation timed out.");
          }
          return "超时后完整回复";
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          sentTexts.push(text);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(restartCalls).toBe(1);
    expect(promptCalls).toBe(2);
    expect(result.opencode.id).toBe("session-2");
    expect(sentTexts).toEqual(["超时后完整回复"]);
  });

  test("skips a message when the restarted OpenCode session still times out", async () => {
    const replacementSession: OpencodeSession = {
      ...TEST_SESSION,
      id: "session-2",
    };
    let restartCalls = 0;
    let promptCalls = 0;
    let markedProcessed = 0;
    const sentTexts: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        markMessageProcessed() {
          markedProcessed += 1;
        },
        async restartOpencode() {
          restartCalls += 1;
          return replacementSession;
        },
        async sendPrompt() {
          promptCalls += 1;
          throw new Error("The operation timed out.");
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          sentTexts.push(text);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(restartCalls).toBe(1);
    expect(promptCalls).toBe(2);
    expect(result.opencode.id).toBe("session-2");
    expect(markedProcessed).toBe(1);
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).toContain("2 次处理失败");
    expect(sentTexts[0]).toContain("已跳过");
  });

  test("stops typing while a prompt is still stuck", async () => {
    let typingStops = 0;
    const parsed = parseMessage(createUserMessage({ contextToken: "ctx-1", text: "你好" }));
    if (!parsed) {
      throw new Error("test fixture should parse");
    }

    const run = processMessage({
      ctx: {
        account: { baseUrl: TEST_ACCOUNT.baseUrl, token: TEST_ACCOUNT.token },
        cdnBaseUrl: "https://cdn.example.com",
        channelVersion: "0.4.0",
        inboxDir: "/tmp/inbox",
        log() {},
        logError() {},
        maxMessageAttempts: 3,
        maxTextLen: 200,
        replyTextChunkChars: 500,
        typingMaxDurationMs: 50,
        verboseLogs: false,
      },
      deps: createDeps({
        async sendPrompt() {
          return await new Promise<string>(() => {});
        },
        async startTypingIndicator() {
          return async () => {
            typingStops += 1;
          };
        },
      }),
      message: parsed,
      opencode: TEST_SESSION,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(typingStops).toBe(1);
    void run;
  });

  test("does not restart the session for non-connection errors", async () => {
    let restartCalls = 0;

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async restartOpencode() {
          restartCalls += 1;
          return TEST_SESSION;
        },
        async sendPrompt() {
          throw new Error("HTTP 500: internal error");
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(false);
    expect(result.getUpdatesBuf).toBe("old-buf");
    expect(restartCalls).toBe(0);
  });

  test("skips a message and notifies the user after repeated failures", async () => {
    const sentTexts: string[] = [];
    let markedProcessed = 0;

    const deps = createDeps({
      markMessageProcessed() {
        markedProcessed += 1;
      },
      async sendPrompt() {
        throw new Error("HTTP 500: internal error");
      },
      async sendTextMessage(_baseUrl, _token, _to, text) {
        sentTexts.push(text);
      },
    });
    const message = createUserMessage({
      clientId: "poison-1",
      contextToken: "ctx-1",
      text: "毒消息",
    });
    const response: GetUpdatesResp = {
      get_updates_buf: "new-buf",
      msgs: [message],
    };

    const first = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps,
      opencode: TEST_SESSION,
      response,
    });
    const second = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps,
      opencode: TEST_SESSION,
      response,
    });
    const third = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps,
      opencode: TEST_SESSION,
      response,
    });

    expect(first.batchSucceeded).toBe(false);
    expect(second.batchSucceeded).toBe(false);
    expect(third.batchSucceeded).toBe(true);
    expect(third.getUpdatesBuf).toBe("new-buf");
    expect(markedProcessed).toBe(1);
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).toContain("3 次处理失败");
    expect(sentTexts[0]).toContain("已跳过");
  });

  test("does not send OpenCode deltas as WeChat streaming bubbles", async () => {
    const plainTexts: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async openReplyStream() {
          return {
            async waitForIdle() {},
            stop() {
              return "正常的回复内容";
            },
          };
        },
        async sendPrompt() {
          return "正常";
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          plainTexts.push(text);
        },
      }),
      opencode: TEST_SESSION,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(plainTexts).toEqual(["正常的回复内容"]);
  });
});
