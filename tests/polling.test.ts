import { beforeEach, describe, expect, test } from "bun:test";
import { processUpdateBatch, resetMessageAttemptTracking } from "../polling/loop";
import { processMessage } from "../polling/message-processor";
import { parseMessage } from "../core/message";
import type { AccountData, GetUpdatesResp } from "../types/wechat";
import { OpencodeTransportManager } from "../opencode/client";
import type { OpencodeRuntime, OpencodeSession } from "../opencode/client";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";
import type { UserSessionResolver } from "../opencode/user-session-manager";
import type { BotBinding } from "../storage/bot-state-types";

type TestDeps = NonNullable<Parameters<typeof processUpdateBatch>[0]["deps"]>;

const TEST_ACCOUNT: AccountData = {
  accountId: "bot-1",
  baseUrl: "https://example.com",
  savedAt: "2026-05-16T00:00:00.000Z",
  token: "token-1",
  userId: "user-1",
};

const TEST_SESSION: OpencodeSession = {
  id: "session-1",
  transport: {
    agents: [],
    authHeader: "Basic test",
    generation: 0,
    serverUrl: "http://127.0.0.1:1",
  },
};
const TEST_RUNTIME: OpencodeRuntime = {
  manager: new OpencodeTransportManager({
    agents: [],
    authHeader: "Basic test",
    close() {},
    serverUrl: "http://127.0.0.1:1",
  }, async () => {
    throw new Error("not used");
  }),
  session: TEST_SESSION,
};

function runtimeWithSession(session: OpencodeSession): OpencodeRuntime {
  return { manager: TEST_RUNTIME.manager, session };
}

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
      return TEST_RUNTIME;
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
    // 默认不碰本机 welcomed_senders.json
    hasWelcomedSender() {
      return true;
    },
    markMessageProcessed() {
      // noop
    },
    markSenderWelcomed() {
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

function bindingForPolling(senderId: string, sessionId: string): BotBinding {
  return {
    bindingId: `binding-${senderId}`,
    boundAt: 1,
    directory: `/tmp/${senderId}`,
    replyStyle: "standard",
    senderId,
    sessionId,
  };
}

function resolvedForPolling(binding: BotBinding, sessionId: string) {
  return {
    binding: { ...binding, sessionId },
    session: {
      directory: binding.directory,
      id: sessionId,
      transport: TEST_SESSION.transport,
    },
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
    const savedPlans: Array<{
      accountId: string;
      originalRequest: string;
      planResponse: string;
      profileId: string;
      userId: string;
    }> = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        saveLatestPlanContext(scope, planContext, userId) {
          savedPlans.push({
            accountId: scope.accountId,
            originalRequest: planContext.originalRequest,
            planResponse: planContext.planResponse,
            profileId: scope.profileId,
            userId,
          });
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "#plan 帮我拆一下实现步骤" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(savedPlans).toEqual([
      {
        accountId: "bot-1",
        originalRequest: "帮我拆一下实现步骤",
        planResponse: "reply",
        profileId: "user-1",
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
      opencode: TEST_RUNTIME,
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
        ...TEST_RUNTIME,
        session: {
          ...TEST_SESSION,
          transport: {
            ...TEST_SESSION.transport,
            agents: [
              { id: "prometheus", mode: "primary" },
              { id: "sisyphus", mode: "primary" },
            ],
          },
        },
      },
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "#plan 帮我拆一下" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(sentAgents).toEqual(["prometheus"]);
  });

  test("handles local slash commands without calling OpenCode", async () => {
    const texts: string[] = [];
    let promptCalls = 0;
    const localCommands = {
      bindingService: {
        async consumeCode() {
          return { status: "invalid" as const };
        },
        async generateCode() {
          return { code: "000000", createdAt: 0, expiresAt: 1 };
        },
        async listBindings() {
          return [];
        },
        async revoke() {
          return false;
        },
      },
      defaultDirectory: "/tmp",
      discovery: {
        async listAgents() {
          return [];
        },
        async listModels() {
          return [];
        },
        async listProjects() {
          return [];
        },
        async listVariants() {
          return [];
        },
        async selectAgent() {
          return "sisyphus";
        },
        async selectModel() {
          return { model: { modelID: "m", providerID: "p" } };
        },
        async selectProject() {
          return "/tmp";
        },
        async selectVariant() {
          return "high";
        },
        async isVariantCompatible() {
          return true;
        },
      } as never,
      scope: { accountId: "bot-1", profileId: "user-1" },
      sessions: {
        async peekBinding() {
          return undefined;
        },
        async resolve() {
          throw new Error("should not resolve for help");
        },
        async recover() {
          throw new Error("should not recover");
        },
        async reset() {
          throw new Error("should not reset");
        },
        async updatePreferences() {
          throw new Error("should not update");
        },
        defaultDirectory: "/tmp",
        scope: { accountId: "bot-1", profileId: "user-1" },
      } as never,
    };

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        hasWelcomedSender() {
          return true;
        },
        async sendPrompt() {
          promptCalls += 1;
          return "should-not-send";
        },
        async sendTextMessage(_base, _token, _to, text) {
          texts.push(text);
        },
      }),
      localCommands,
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "/帮助" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(promptCalls).toBe(0);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("OpenCode 机器人命令");
    expect(texts[0]).not.toContain("**");
  });

  test("auto-sends first-contact welcome once for unbound ordinary messages", async () => {
    const texts: string[] = [];
    const welcomed: string[] = [];
    let promptCalls = 0;
    const localCommands = {
      bindingService: {
        async consumeCode() {
          return { status: "invalid" as const };
        },
        async generateCode() {
          return { code: "000000", createdAt: 0, expiresAt: 1 };
        },
        async listBindings() {
          return [];
        },
        async revoke() {
          return false;
        },
      },
      defaultDirectory: "/tmp",
      discovery: {} as never,
      scope: { accountId: "bot-1", profileId: "user-1" },
      sessions: {
        async peekBinding() {
          return undefined;
        },
        async resolve() {
          throw new Error("should not resolve");
        },
        async recover() {
          throw new Error("should not recover");
        },
        async reset() {
          throw new Error("should not reset");
        },
        async updatePreferences() {
          throw new Error("should not update");
        },
        defaultDirectory: "/tmp",
        scope: { accountId: "bot-1", profileId: "user-1" },
      } as never,
    };

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        hasWelcomedSender(senderId) {
          return welcomed.includes(senderId);
        },
        markSenderWelcomed(senderId) {
          welcomed.push(senderId);
        },
        async sendPrompt() {
          promptCalls += 1;
          return "should-not-send";
        },
        async sendTextMessage(_base, _token, _to, text) {
          texts.push(text);
        },
      }),
      localCommands,
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(promptCalls).toBe(0);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("你好，我是 OpenCode 微信入口");
    expect(texts[0]).toContain("/bind 123456");
    expect(texts[0]).not.toContain("**");
    expect(welcomed).toEqual(["wx-user-1"]);
  });

  test("replies with unbound guidance when a bound session resolver rejects the sender", async () => {
    const texts: string[] = [];
    let promptCalls = 0;
    const userSessions: UserSessionResolver = {
      async recover() {
        throw new Error("not used");
      },
      async resolve(senderId) {
        const { UserSessionNotBoundError } = await import("../opencode/user-session-manager");
        throw new UserSessionNotBoundError(senderId);
      },
    };

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt() {
          promptCalls += 1;
          return "should-not-send";
        },
        async sendTextMessage(_base, _token, _to, text) {
          texts.push(text);
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "帮我写代码" })],
      },
      userSessions,
    });

    expect(result.batchSucceeded).toBe(true);
    expect(promptCalls).toBe(0);
    expect(texts[0]).toContain("/bind 123456");
  });

  test("uses sender-specific sessions and prompt preferences when a resolver is configured", async () => {
    const sent: Array<{
      readonly agent?: string;
      readonly directory?: string;
      readonly modelId?: string;
      readonly sessionId: string;
    }> = [];
    const bindingFor = (senderId: string): BotBinding => ({
      agent: `agent-${senderId}`,
      bindingId: `binding-${senderId}`,
      boundAt: 1,
      directory: `/tmp/${senderId}`,
      model: { modelId: `model-${senderId}`, providerId: "provider" },
      replyStyle: senderId === "sender-a" ? "concise" : "detailed",
      senderId,
      sessionId: `session-${senderId}`,
    });
    const resolve = async (senderId: string) => {
      const binding = bindingFor(senderId);
      return {
        binding,
        session: {
          directory: binding.directory,
          id: binding.sessionId ?? "missing",
          model: {
            modelID: binding.model?.modelId ?? "missing",
            providerID: binding.model?.providerId ?? "missing",
          },
          transport: TEST_SESSION.transport,
        },
      };
    };
    const userSessions: UserSessionResolver = {
      recover(senderId) {
        return resolve(senderId);
      },
      resolve,
    };

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(session, _prompt, options) {
          sent.push({
            ...(options?.agent ? { agent: options.agent } : {}),
            ...(session.directory ? { directory: session.directory } : {}),
            ...(options?.model ? { modelId: options.model.modelID } : {}),
            sessionId: session.id,
          });
          return "reply";
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [
          createUserMessage({ senderId: "sender-a", text: "first" }),
          createUserMessage({ senderId: "sender-b", text: "second" }),
        ],
      },
      userSessions,
    });

    expect(result.batchSucceeded).toBe(true);
    expect(sent).toEqual([
      {
        agent: "agent-sender-a",
        directory: "/tmp/sender-a",
        modelId: "model-sender-a",
        sessionId: "session-sender-a",
      },
      {
        agent: "agent-sender-b",
        directory: "/tmp/sender-b",
        modelId: "model-sender-b",
        sessionId: "session-sender-b",
      },
    ]);
  });

  test("recovers only the active sender through the shared user-session resolver", async () => {
    const selected = bindingForPolling("sender-a", "old-session");
    let promptCalls = 0;
    let recoverCalls = 0;
    let legacyRestartCalls = 0;
    const userSessions: UserSessionResolver = {
      async recover(senderId, observedGeneration) {
        recoverCalls += 1;
        expect(senderId).toBe("sender-a");
        expect(observedGeneration).toBe(TEST_SESSION.transport.generation);
        return resolvedForPolling(selected, "new-session");
      },
      async resolve() {
        return resolvedForPolling(selected, "old-session");
      },
    };

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async restartOpencode() {
          legacyRestartCalls += 1;
          return TEST_RUNTIME;
        },
        async sendPrompt(session) {
          promptCalls += 1;
          if (promptCalls === 1) throw new Error("Unable to connect");
          return session.id;
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ senderId: "sender-a", text: "recover" })],
      },
      userSessions,
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.opencode.session.id).toBe("new-session");
    expect(recoverCalls).toBe(1);
    expect(legacyRestartCalls).toBe(0);
  });

  test("loads Oh My OpenAgent context for ordinary OpenCode calls", async () => {
    const systems: string[] = [];
    const sentAgents: string[] = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(_session, _prompt, options) {
          if (options?.agent) sentAgents.push(options.agent);
          if (options?.system) systems.push(options.system);
          return "reply";
        },
      }),
      opencode: {
        ...TEST_RUNTIME,
        session: {
          ...TEST_SESSION,
          transport: {
            ...TEST_SESSION.transport,
            agents: [{ id: "sisyphus", mode: "primary" }],
          },
        },
      },
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "普通问题" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(sentAgents).toEqual(["sisyphus"]);
    expect(systems[0]).toContain("Oh My OpenAgent");
    expect(systems[0]).toContain("MCP");
    expect(systems[0]).toContain("Skill");
  });

  test("adds a hard file-delivery contract for PDF requests", async () => {
    const prompts: string[] = [];
    const timeoutMsValues: Array<number | undefined> = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(_session, prompt, options) {
          prompts.push(prompt);
          timeoutMsValues.push(options?.timeoutMs);
          return "reply";
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({
          contextToken: "ctx-1",
          text: "生成精美PDF报告发给我，带封面、表格和图表",
        })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(prompts[0]).toContain("微信文件交付硬性要求");
    expect(prompts[0]).toContain("必须实际创建文件");
    expect(prompts[0]).toContain("[[wechat-file:/本机真实绝对路径/文件名.pdf|文件说明]]");
    expect(timeoutMsValues).toEqual([300_000]);
  });

  test("keeps ordinary messages on the standard OpenCode timeout", async () => {
    const timeoutMsValues: Array<number | undefined> = [];

    const result = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps: createDeps({
        async sendPrompt(_session, _prompt, options) {
          timeoutMsValues.push(options?.timeoutMs);
          return "reply";
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "普通问题" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(timeoutMsValues).toEqual([undefined]);
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
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
          return runtimeWithSession(replacementSession);
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
      opencode: TEST_RUNTIME,
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
    expect(result.opencode.session.id).toBe("session-2");
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
          return runtimeWithSession(replacementSession);
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
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(restartCalls).toBe(1);
    expect(promptCalls).toBe(2);
    expect(result.opencode.session.id).toBe("session-2");
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
          return runtimeWithSession(replacementSession);
        },
        async sendPrompt() {
          promptCalls += 1;
          throw new Error("The operation timed out.");
        },
        async sendTextMessage(_baseUrl, _token, _to, text) {
          sentTexts.push(text);
        },
      }),
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(result.getUpdatesBuf).toBe("new-buf");
    expect(restartCalls).toBe(1);
    expect(promptCalls).toBe(2);
    expect(result.opencode.session.id).toBe("session-2");
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
        account: {
          accountId: TEST_ACCOUNT.accountId,
          baseUrl: TEST_ACCOUNT.baseUrl,
          profileId: TEST_ACCOUNT.userId ?? TEST_ACCOUNT.accountId,
          token: TEST_ACCOUNT.token,
        },
        cdnBaseUrl: "https://cdn.example.com",
        channelVersion: "0.4.0",
        inboxDir: "/tmp/inbox",
        longPromptTimeoutMs: 300_000,
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
      opencode: TEST_RUNTIME,
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
          return TEST_RUNTIME;
        },
        async sendPrompt() {
          throw new Error("HTTP 500: internal error");
        },
      }),
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
      response,
    });
    const second = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps,
      opencode: TEST_RUNTIME,
      response,
    });
    const third = await processUpdateBatch({
      account: TEST_ACCOUNT,
      currentUpdatesBuf: "old-buf",
      deps,
      opencode: TEST_RUNTIME,
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
      opencode: TEST_RUNTIME,
      response: {
        get_updates_buf: "new-buf",
        msgs: [createUserMessage({ contextToken: "ctx-1", text: "你好" })],
      },
    });

    expect(result.batchSucceeded).toBe(true);
    expect(plainTexts).toEqual(["正常的回复内容"]);
  });
});
