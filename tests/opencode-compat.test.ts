import { describe, expect, test } from "bun:test";
import {
  findPreferredAgent,
  parseAgentResponse,
  resolveRequestedAgent,
} from "../opencode/agents";
import {
  createOpencodeSession,
  createLegacySession,
  getModelOverride,
  isOpencodeConnectionError,
  OpencodeTransportManager,
  resumeOpencodeSession,
  restartOpencode,
  sendPrompt,
  startOpencodeTransport,
} from "../opencode/client";
import type { OpencodeSession, OpencodeTransport } from "../opencode/client";
import { parseOpencodeServerUrl } from "../opencode/server";

function createTestSession(params: {
  readonly authHeader?: string;
  readonly id?: string;
  readonly model?: OpencodeSession["model"];
  readonly serverUrl: string;
}): OpencodeSession {
  return {
    id: params.id ?? "session-1",
    ...(params.model ? { model: params.model } : {}),
    transport: {
      agents: [],
      authHeader: params.authHeader ?? "Basic test",
      generation: 0,
      serverUrl: params.serverUrl,
    },
  };
}

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
  test("posts the legacy empty create body with the configured authorization", async () => {
    const requests: Array<{ authorization: string | null; body: unknown; path: string }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          authorization: request.headers.get("authorization"),
          body: await request.json(),
          path: new URL(request.url).pathname,
        });
        return Response.json({ id: "ses_contract" });
      },
    });

    try {
      await createLegacySession({
        authHeader: "Basic contract",
        serverUrl: server.url.toString(),
      });
      expect(requests).toEqual([{
        authorization: "Basic contract",
        body: {},
        path: "/session",
      }]);
    } finally {
      server.stop(true);
    }
  });

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

describe("OpenCode 1.17.15 logical sessions", () => {
  test("creates a directory-scoped session with the exact create model contract", async () => {
    const requests: Array<{ body: unknown; path: string; search: string }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({
          body: await request.json(),
          path: url.pathname,
          search: url.search,
        });
        return Response.json({ id: "ses_directory" });
      },
    });
    let closeCalls = 0;
    const transport: OpencodeTransport = {
      agents: [],
      authHeader: "Basic test",
      close() {
        closeCalls += 1;
      },
      serverUrl: server.url.toString(),
    };

    try {
      const manager = new OpencodeTransportManager(transport, async () => transport);
      const session = await createOpencodeSession(manager.current(), {
        agent: "sisyphus",
        directory: "/tmp/project with spaces",
        model: {
          modelID: "claude-sonnet-4.6",
          providerID: "github-copilot",
          variant: "high",
        },
      });

      expect(session).toEqual({
        agent: "sisyphus",
        directory: "/tmp/project with spaces",
        id: "ses_directory",
        model: {
          modelID: "claude-sonnet-4.6",
          providerID: "github-copilot",
          variant: "high",
        },
        transport: manager.current(),
      });
      expect(requests).toEqual([{
        body: {
          model: {
            id: "claude-sonnet-4.6",
            providerID: "github-copilot",
            variant: "high",
          },
        },
        path: "/session",
        search: "?directory=%2Ftmp%2Fproject+with+spaces",
      }]);
      expect(closeCalls).toBe(0);
      expect("close" in session.transport).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("lets two logical sessions share one transport without owning its lifecycle", async () => {
    let nextId = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        nextId += 1;
        return Response.json({ id: `ses_${nextId}` });
      },
    });
    let closeCalls = 0;
    const transport: OpencodeTransport = {
      agents: [],
      authHeader: "Basic test",
      close() {
        closeCalls += 1;
      },
      serverUrl: server.url.toString(),
    };

    try {
      const manager = new OpencodeTransportManager(transport, async () => transport);
      const connection = manager.current();
      const first = await createOpencodeSession(connection, { directory: "/tmp/a" });
      const second = await createOpencodeSession(connection, { directory: "/tmp/b" });
      expect(first.id).toBe("ses_1");
      expect(second.id).toBe("ses_2");
      expect(first.transport).toBe(connection);
      expect(second.transport).toBe(connection);
      expect(closeCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("recreates only a missing saved descriptor and never closes shared transport", async () => {
    const paths: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        paths.push(`${request.method} ${url.pathname}${url.search}`);
        if (request.method === "GET") return new Response("missing", { status: 404 });
        return Response.json({ id: "ses_recreated" });
      },
    });
    let closeCalls = 0;
    const transport: OpencodeTransport = {
      agents: [],
      authHeader: "Basic test",
      close() {
        closeCalls += 1;
      },
      serverUrl: server.url.toString(),
    };
    const manager = new OpencodeTransportManager(transport, async () => transport);
    const saved: OpencodeSession = {
      directory: "/tmp/recreate",
      id: "ses_missing",
      transport: manager.current(),
    };

    try {
      const resumed = await resumeOpencodeSession(saved);
      expect(resumed.id).toBe("ses_recreated");
      expect(resumed.transport).toBe(manager.current());
      expect(paths).toEqual([
        "GET /session/ses_missing?directory=%2Ftmp%2Frecreate",
        "POST /session?directory=%2Ftmp%2Frecreate",
      ]);
      expect(closeCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });

});

describe("OpencodeTransportManager", () => {
  test("shares one replacement across concurrent restart callers", async () => {
    let closeCalls = 0;
    let startCalls = 0;
    let resolveStart: ((transport: OpencodeTransport) => void) | undefined;
    const initial: OpencodeTransport = {
      agents: [],
      authHeader: "Basic old",
      close() {
        closeCalls += 1;
      },
      serverUrl: "http://127.0.0.1:1",
    };
    const replacement: OpencodeTransport = {
      agents: [],
      authHeader: "Basic new",
      close() {},
      serverUrl: "http://127.0.0.1:2",
    };
    const manager = new OpencodeTransportManager(initial, () => {
      startCalls += 1;
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    });
    const generation = manager.current().generation;

    const first = manager.restart(generation);
    const second = manager.restart(generation);
    resolveStart?.(replacement);

    expect(await first).toBe(await second);
    expect(closeCalls).toBe(1);
    expect(startCalls).toBe(1);
    expect(manager.current().generation).toBe(generation + 1);
  });

  test("retries a rejected replacement without closing the old child twice", async () => {
    let closeCalls = 0;
    let startCalls = 0;
    const replacement: OpencodeTransport = {
      agents: [],
      authHeader: "Basic new",
      close() {},
      serverUrl: "http://127.0.0.1:2",
    };
    const manager = new OpencodeTransportManager({
      agents: [],
      authHeader: "Basic old",
      close() {
        closeCalls += 1;
      },
      serverUrl: "http://127.0.0.1:1",
    }, async () => {
      startCalls += 1;
      if (startCalls === 1) throw new Error("starter rejected");
      return replacement;
    });
    const generation = manager.current().generation;

    await expect(manager.restart(generation)).rejects.toThrow("starter rejected");
    const result = await manager.restart(generation);

    expect(result.serverUrl).toBe("http://127.0.0.1:2");
    expect(closeCalls).toBe(1);
    expect(startCalls).toBe(2);
  });

  test("returns the current generation to a repeated stale restart caller", async () => {
    let startCalls = 0;
    const manager = new OpencodeTransportManager({
      agents: [],
      authHeader: "Basic old",
      close() {},
      serverUrl: "http://127.0.0.1:1",
    }, async () => {
      startCalls += 1;
      return {
        agents: [],
        authHeader: "Basic new",
        close() {},
        serverUrl: "http://127.0.0.1:2",
      };
    });
    const staleGeneration = manager.current().generation;
    const replacement = await manager.restart(staleGeneration);

    const repeated = await manager.restart(staleGeneration);

    expect(repeated).toBe(replacement);
    expect(startCalls).toBe(1);
  });

  test("closes an eventual replacement when shutdown happens during restart", async () => {
    let initialCloseCalls = 0;
    let replacementCloseCalls = 0;
    let resolveStart: ((transport: OpencodeTransport) => void) | undefined;
    const replacement: OpencodeTransport = {
      agents: [],
      authHeader: "Basic new",
      close() {
        replacementCloseCalls += 1;
      },
      serverUrl: "http://127.0.0.1:2",
    };
    const manager = new OpencodeTransportManager({
      agents: [],
      authHeader: "Basic old",
      close() {
        initialCloseCalls += 1;
      },
      serverUrl: "http://127.0.0.1:1",
    }, () => new Promise((resolve) => {
      resolveStart = resolve;
    }));

    const restart = manager.restart(manager.current().generation);
    manager.close();
    resolveStart?.(replacement);

    await expect(restart).rejects.toThrow("已关闭");
    expect(initialCloseCalls).toBe(1);
    expect(replacementCloseCalls).toBe(1);
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
  test("sends the exact directory model and top-level variant contract", async () => {
    const requests: Array<{ body: unknown; path: string; search: string }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({
          body: await request.json(),
          path: url.pathname,
          search: url.search,
        });
        return Response.json({ parts: [{ text: "ok", type: "text" }] });
      },
    });
    const transport: OpencodeTransport = {
      agents: [],
      authHeader: "Basic test",
      close() {},
      serverUrl: server.url.toString(),
    };
    const manager = new OpencodeTransportManager(transport, async () => transport);
    const session: OpencodeSession = {
      directory: "/tmp/send with spaces",
      id: "ses/model",
      model: {
        modelID: "claude-sonnet-4.6",
        providerID: "github-copilot",
        variant: "high",
      },
      transport: manager.current(),
    };

    try {
      expect(await sendPrompt(session, "hello")).toBe("ok");
      expect(requests).toEqual([{
        body: {
          model: {
            modelID: "claude-sonnet-4.6",
            providerID: "github-copilot",
          },
          parts: [{ text: "hello", type: "text" }],
          variant: "high",
        },
        path: "/session/ses%2Fmodel/message",
        search: "?directory=%2Ftmp%2Fsend+with+spaces",
      }]);
    } finally {
      server.stop(true);
    }
  });

  test("targets the configured session endpoint with its authorization header", async () => {
    const requests: Array<{ authorization: string | null; path: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push({
          authorization: request.headers.get("authorization"),
          path: new URL(request.url).pathname,
        });
        return Response.json({ parts: [{ text: "ok", type: "text" }] });
      },
    });
    const session = createTestSession({
      authHeader: "Basic prompt-contract",
      id: "session with spaces",
      serverUrl: server.url.toString(),
    });

    try {
      await sendPrompt(session, "hello");
      expect(requests).toEqual([{
        authorization: "Basic prompt-contract",
        path: "/session/session%20with%20spaces/message",
      }]);
    } finally {
      server.stop(true);
    }
  });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      model: { providerID: "github-copilot", modelID: "claude-sonnet-4.6" },
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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
    const session = createTestSession({
      serverUrl: server.url.toString(),
    });

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

describe("restartOpencode", () => {
  test("closes the previous owned process before attempting replacement", async () => {
    const previousBin = process.env.OPENCODE_BIN;
    process.env.OPENCODE_BIN = "/definitely/missing/opencode-characterization";
    let closeCalls = 0;
    const initial: OpencodeTransport = {
      agents: [],
      authHeader: "Basic test",
      close() {
        closeCalls += 1;
      },
      serverUrl: "http://127.0.0.1:1",
    };
    const manager = new OpencodeTransportManager(initial, startOpencodeTransport);
    const runtime = {
      manager,
      session: {
        id: "session-1",
        transport: manager.current(),
      },
    };

    try {
      await expect(restartOpencode(runtime)).rejects.toThrow("未找到 OpenCode CLI");
      expect(closeCalls).toBe(1);
    } finally {
      if (previousBin === undefined) delete process.env.OPENCODE_BIN;
      else process.env.OPENCODE_BIN = previousBin;
    }
  });
});
