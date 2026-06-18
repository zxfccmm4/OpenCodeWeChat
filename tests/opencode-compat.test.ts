import { describe, expect, test } from "bun:test";
import {
  findPreferredAgent,
  parseAgentResponse,
  resolveRequestedAgent,
} from "../opencode/agents";
import { createLegacySession, sendPrompt } from "../opencode/client";
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

describe("sendPrompt", () => {
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
});
