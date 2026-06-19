import { describe, expect, test } from "bun:test";
import {
  findPreferredAgent,
  parseAgentResponse,
  resolveRequestedAgent,
} from "../opencode/agents";
import {
  createLegacySession,
  getModelOverride,
  isOpencodeConnectionError,
  sendPrompt,
} from "../opencode/client";
import type { OpencodeSession } from "../opencode/client";
import { parseOpencodeServerUrl } from "../opencode/server";

describe("parseOpencodeServerUrl", () => {
  test("parses legacy opencode serve output", () => {
    expect(parseOpencodeServerUrl("opencode server listening on http://127.0.0.1:40913"))
      .toBe("http://127.0.0.1:40913");
  });

  test("parses current opencode serve output", () => {
    expect(parseOpencodeServerUrl("server listening on http://127.0.0.1:40913"))
      .toBe("http://127.0.0.1:40913");
  });
});

describe("OpenCode agent compatibility", () => {
  test("parses current v2 agent list responses", () => {
    expect(parseAgentResponse({
      data: [
        { hidden: false, id: "sisyphus", mode: "primary" },
        { hidden: false, id: "prometheus", mode: "subagent" },
      ],
    })).toEqual([
      { hidden: false, id: "sisyphus", mode: "primary" },
      { hidden: false, id: "prometheus", mode: "subagent" },
    ]);
  });

  test("parses legacy agent list responses", () => {
    expect(parseAgentResponse([
      { mode: "primary", name: "Sisyphus - Ultraworker" },
    ])).toEqual([
      { mode: "primary", name: "Sisyphus - Ultraworker" },
    ]);
  });

  test("resolves OMO aliases across old and current agent names", () => {
    expect(resolveRequestedAgent("omo", [
      { id: "sisyphus", mode: "primary" },
    ])).toBe("sisyphus");

    expect(resolveRequestedAgent("omo", [
      { mode: "primary", name: "Sisyphus - Ultraworker" },
    ])).toBe("Sisyphus - Ultraworker");
  });

  test("finds preferred per-command agents", () => {
    expect(findPreferredAgent("plan", [
      { id: "sisyphus" },
      { id: "prometheus" },
    ])).toBe("prometheus");
  });
});

describe("createLegacySession", () => {
  test("retries transient 500s during OpenCode startup and succeeds", async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        if (calls < 3) {
          return Response.json(
            { name: "UnknownError", data: { message: "Unexpected server error." } },
            { status: 500 },
          );
        }
        return Response.json({ id: "ses_retry_ok" });
      },
    });

    try {
      const sessionId = await createLegacySession({
        authHeader: "Basic test",
        retryDelayMs: 10,
        serverUrl: server.url.toString(),
      });
      expect(sessionId).toBe("ses_retry_ok");
      expect(calls).toBe(3);
    } finally {
      server.stop(true);
    }
  });

  test("gives up after exhausting retries and points at the OpenCode log", async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return new Response("boom", { status: 500 });
      },
    });

    try {
      await expect(
        createLegacySession({
          authHeader: "Basic test",
          retryDelayMs: 10,
          serverUrl: server.url.toString(),
        }),
      ).rejects.toThrow("opencode.log");
      expect(calls).toBe(3);
    } finally {
      server.stop(true);
    }
  });

  test("fails fast without retry when the /session route is missing", async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return new Response("not found", { status: 404 });
      },
    });

    try {
      await expect(
        createLegacySession({
          authHeader: "Basic test",
          retryDelayMs: 10,
          serverUrl: server.url.toString(),
        }),
      ).rejects.toThrow("/session 接口");
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  });
});

describe("isOpencodeConnectionError", () => {
  test("treats timed out prompt requests as restartable connection failures", () => {
    expect(isOpencodeConnectionError(new Error("The operation timed out."))).toBe(true);
  });
});

describe("getModelOverride", () => {
  test("does not override the model when provider and model env vars are unset", () => {
    const previousProvider = process.env.OPENCODE_PROVIDER_ID;
    const previousModel = process.env.OPENCODE_MODEL_ID;
    delete process.env.OPENCODE_PROVIDER_ID;
    delete process.env.OPENCODE_MODEL_ID;

    try {
      expect(getModelOverride()).toBeUndefined();
    } finally {
      if (previousProvider === undefined) {
        delete process.env.OPENCODE_PROVIDER_ID;
      } else {
        process.env.OPENCODE_PROVIDER_ID = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.OPENCODE_MODEL_ID;
      } else {
        process.env.OPENCODE_MODEL_ID = previousModel;
      }
    }
  });

  test("requires explicit provider and model overrides to be configured together", () => {
    const previousProvider = process.env.OPENCODE_PROVIDER_ID;
    const previousModel = process.env.OPENCODE_MODEL_ID;
    process.env.OPENCODE_PROVIDER_ID = "github-copilot";
    delete process.env.OPENCODE_MODEL_ID;

    try {
      expect(() => getModelOverride()).toThrow("必须同时设置");
    } finally {
      if (previousProvider === undefined) {
        delete process.env.OPENCODE_PROVIDER_ID;
      } else {
        process.env.OPENCODE_PROVIDER_ID = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.OPENCODE_MODEL_ID;
      } else {
        process.env.OPENCODE_MODEL_ID = previousModel;
      }
    }
  });

  test("uses an explicit provider and model override when both are set", () => {
    const previousProvider = process.env.OPENCODE_PROVIDER_ID;
    const previousModel = process.env.OPENCODE_MODEL_ID;
    process.env.OPENCODE_PROVIDER_ID = "github-copilot";
    process.env.OPENCODE_MODEL_ID = "claude-sonnet-4.6";

    try {
      expect(getModelOverride()).toEqual({
        providerID: "github-copilot",
        modelID: "claude-sonnet-4.6",
      });
    } finally {
      if (previousProvider === undefined) {
        delete process.env.OPENCODE_PROVIDER_ID;
      } else {
        process.env.OPENCODE_PROVIDER_ID = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.OPENCODE_MODEL_ID;
      } else {
        process.env.OPENCODE_MODEL_ID = previousModel;
      }
    }
  });
});

describe("sendPrompt", () => {
  test("lets OpenCode or OMO use its configured default model when no explicit model is configured", async () => {
    const previousProvider = process.env.OPENCODE_PROVIDER_ID;
    const previousModel = process.env.OPENCODE_MODEL_ID;
    delete process.env.OPENCODE_PROVIDER_ID;
    delete process.env.OPENCODE_MODEL_ID;

    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.json());
        return Response.json({
          parts: [{ text: "ok", type: "text" }],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      expect(await sendPrompt(session, "hello")).toBe("ok");
      expect(bodies[0]).toEqual({
        parts: [{ text: "hello", type: "text" }],
      });
    } finally {
      if (previousProvider === undefined) {
        delete process.env.OPENCODE_PROVIDER_ID;
      } else {
        process.env.OPENCODE_PROVIDER_ID = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.OPENCODE_MODEL_ID;
      } else {
        process.env.OPENCODE_MODEL_ID = previousModel;
      }
      server.stop(true);
    }
  });

  test("passes an explicit provider and model only when the session is configured with one", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.json());
        return Response.json({
          parts: [{ text: "ok", type: "text" }],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      model: { providerID: "github-copilot", modelID: "claude-sonnet-4.6" },
      serverUrl: server.url.toString(),
    };

    try {
      expect(await sendPrompt(session, "hello")).toBe("ok");
      expect(bodies[0]).toEqual({
        model: { providerID: "github-copilot", modelID: "claude-sonnet-4.6" },
        parts: [{ text: "hello", type: "text" }],
      });
    } finally {
      server.stop(true);
    }
  });

  test("surfaces model errors hidden inside empty responses", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          info: {
            error: {
              name: "UnknownError",
              data: { message: "Token refresh failed: 401" },
            },
          },
          parts: [],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      await expect(sendPrompt(session, "hello")).rejects.toThrow(
        "OpenCode 模型调用失败: Token refresh failed: 401",
      );
    } finally {
      server.stop(true);
    }
  });

  test("explains provider/model lookup failures from OpenCode responses", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          info: {
            error: {
              name: "ProviderModelNotFoundError",
              data: {
                providerID: "Steveai",
                modelID: "gpt-5.4-mini",
                suggestions: [],
              },
            },
          },
          parts: [],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      await expect(sendPrompt(session, "hello")).rejects.toThrow(
        "模型不存在或不可用: Steveai/gpt-5.4-mini",
      );
      await expect(sendPrompt(session, "hello")).rejects.toThrow(
        "让 OpenCode / OMO 使用自己的模型配置",
      );
    } finally {
      server.stop(true);
    }
  });

  test("returns an empty string for empty responses without errors", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ info: {}, parts: [] });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      expect(await sendPrompt(session, "hello")).toBe("");
    } finally {
      server.stop(true);
    }
  });

  test("extracts complete text from nested message parts", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          data: {
            messages: [
              {
                parts: [
                  { text: "完整回复第一段", type: "text" },
                  { text: "完整回复第二段", type: "text" },
                ],
                role: "assistant",
              },
            ],
          },
          parts: [{ text: "完整", type: "text" }],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      expect(await sendPrompt(session, "hello")).toBe("完整回复第一段\n完整回复第二段");
    } finally {
      server.stop(true);
    }
  });

  test("passes Oh My OpenAgent system context to OpenCode", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.json());
        return Response.json({
          parts: [{ text: "ok", type: "text" }],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      const response = await sendPrompt(session, "hello", {
        agent: "sisyphus",
        system: "Oh My OpenAgent\nMCP\nSkill",
      });

      expect(response).toBe("ok");
      expect(bodies[0]).toEqual({
        agent: "sisyphus",
        parts: [{ text: "hello", type: "text" }],
        system: "Oh My OpenAgent\nMCP\nSkill",
      });
    } finally {
      server.stop(true);
    }
  });

  test("aborts stuck prompt requests at the configured timeout", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Response.json({
          parts: [{ text: "too late", type: "text" }],
        });
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      const startedAt = Date.now();
      await expect(sendPrompt(session, "hello", { timeoutMs: 30 })).rejects.toThrow(
        "The operation timed out.",
      );
      expect(Date.now() - startedAt).toBeLessThan(300);
    } finally {
      server.stop(true);
    }
  });

  test("aborts stuck response bodies at the configured timeout", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
        }));
      },
    });
    const session: OpencodeSession = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      id: "session-1",
      serverUrl: server.url.toString(),
    };

    try {
      const startedAt = Date.now();
      await expect(sendPrompt(session, "hello", { timeoutMs: 30 })).rejects.toThrow(
        "The operation timed out.",
      );
      expect(Date.now() - startedAt).toBeLessThan(300);
    } finally {
      server.stop(true);
    }
  });
});
