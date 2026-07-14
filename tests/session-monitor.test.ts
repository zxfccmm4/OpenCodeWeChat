import { describe, expect, test } from "bun:test";
import { createSessionMonitor } from "../opencode/session-monitor";

function connection(responses: Record<string, unknown>) {
  return {
    authHeader: "Basic test",
    close() {},
    url: "http://monitor.test",
    responses,
  };
}

describe("OpenCode session monitor", () => {
  test("loads every paginated session and requests complete history", async () => {
    const requestedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = new URL(String(input));
      requestedUrls.push(url.pathname + url.search);
      if (url.pathname === "/api/session" && !url.searchParams.has("cursor")) {
        return Response.json({
          cursor: { next: "page-2" },
          data: [{ id: "ses_1", time: { updated: 20 }, title: "First" }],
        });
      }
      if (url.pathname === "/api/session" && url.searchParams.get("cursor") === "page-2") {
        return Response.json({ data: [{ id: "ses_2", time: { updated: 10 }, title: "Second" }] });
      }
      if (url.pathname === "/session/status") return Response.json({});
      if (url.pathname === "/session/ses_1/message") return Response.json([]);
      return new Response("not found", { status: 404 });
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({ connect: async () => connection({}) });
      const sessions = await monitor.listSessions();
      await monitor.listMessages("ses_1");

      expect(sessions.map((session) => session.id)).toEqual(["ses_1", "ses_2"]);
      expect(requestedUrls).toContain("/api/session?limit=100&cursor=page-2");
      expect(requestedUrls).toContain("/session/ses_1/message?limit=10000");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("parses session progress and message history", async () => {
    const fake = connection({});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/session") {
        return Response.json({ data: [{
          agent: "Sisyphus",
          directory: "/tmp/project",
          id: "ses_1",
          model: { id: "model", providerID: "provider" },
          time: { created: 10, updated: 20 },
          title: "Session one",
        }] });
      }
      if (path === "/session/status") return Response.json({ ses_1: { type: "busy" } });
      if (path === "/session/ses_1/message") {
        return Response.json([{
          info: { id: "msg_1", role: "assistant", time: { completed: 13, created: 11 } },
          parts: [{ type: "text", text: "完成" }, { tool: "bash", type: "tool", state: { status: "completed" } }],
        }]);
      }
      return new Response("not found", { status: 404 });
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({ connect: async () => fake });
      const sessions = await monitor.listSessions();
      const messages = await monitor.listMessages("ses_1");

      expect(sessions[0]?.status).toBe("busy");
      expect(sessions[0]?.progressText).toBe("正在执行：bash");
      expect(sessions[0]?.model).toBe("provider/model");
      expect(messages[0]?.text).toContain("完成");
      expect(messages[0]?.text).toContain("bash: completed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("emits a notification when a busy session becomes idle", async () => {
    let status = "busy";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/session") {
        return Response.json({ data: [{ id: "ses_1", time: { updated: 20 }, title: "Session one" }] });
      }
      if (path === "/session/status") return Response.json({ ses_1: { type: status } });
      return Response.json([]);
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({ connect: async () => connection({}) });
      await monitor.listSessions();
      status = "idle";
      await monitor.listSessions();

      expect(monitor.listNotifications(0)[0]?.type).toBe("completed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("emits one notification for overlapping idle refreshes", async () => {
    let status = "busy";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/session") {
        return Response.json({ data: [{ id: "ses_1", time: { updated: 20 }, title: "Session one" }] });
      }
      if (path === "/session/status") return Response.json({ ses_1: { type: status } });
      return Response.json([]);
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({ connect: async () => connection({}) });
      await monitor.listSessions();
      status = "idle";
      await Promise.all([monitor.listSessions(), monitor.listSessions()]);

      expect(monitor.listNotifications(0)).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reconnects once after a managed connection fails", async () => {
    let connectCalls = 0;
    let closeCalls = 0;
    let failed = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (!failed) {
        failed = true;
        throw new TypeError("connection refused");
      }
      if (path === "/api/session") return Response.json({ data: [] });
      if (path === "/session/status") return Response.json({});
      return Response.json([]);
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({
        connect: async () => {
          connectCalls += 1;
          return {
            authHeader: "Basic test",
            close() { closeCalls += 1; },
            url: `http://monitor-${connectCalls}.test`,
          };
        },
      });
      expect(await monitor.listSessions()).toEqual([]);
      expect(connectCalls).toBe(2);
      expect(closeCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("closes a connection that finishes opening after monitor shutdown", async () => {
    let resolveConnection: ((value: ReturnType<typeof connection>) => void) | undefined;
    let closeCalls = 0;
    let connectCalls = 0;
    const pendingConnection = new Promise<ReturnType<typeof connection>>((resolve) => {
      resolveConnection = resolve;
    });
    const monitor = createSessionMonitor({
      connect: async () => {
        connectCalls += 1;
        return pendingConnection;
      },
    });

    const pendingSessions = monitor.listSessions();
    monitor.close();
    resolveConnection?.({
      authHeader: "Basic test",
      close() { closeCalls += 1; },
      responses: {},
      url: "http://monitor.test",
    });

    await expect(pendingSessions).rejects.toThrow("Session monitor is closed");
    await expect(monitor.listSessions()).rejects.toThrow("Session monitor is closed");
    expect(connectCalls).toBe(1);
    expect(closeCalls).toBe(1);
  });

  test("uses monotonic notification timestamps when completions share a clock tick", async () => {
    let status = "busy";
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    Date.now = () => 1000;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/session") {
        return Response.json({ data: [
          { id: "ses_1", time: { updated: 20 }, title: "First" },
          { id: "ses_2", time: { updated: 21 }, title: "Second" },
        ] });
      }
      if (path === "/session/status") {
        return Response.json({ ses_1: { type: status }, ses_2: { type: status } });
      }
      return Response.json([]);
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({ connect: async () => connection({}) });
      await monitor.listSessions();
      status = "idle";
      await monitor.listSessions();
      const notifications = monitor.listNotifications(0);

      expect(notifications).toHaveLength(2);
      expect(notifications[1]?.createdAt).toBeGreaterThan(notifications[0]?.createdAt ?? 0);
      expect(monitor.listNotifications(notifications[0]?.createdAt ?? 0)).toHaveLength(1);
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    }
  });

  test("emits an error notification when the final assistant message failed", async () => {
    let status = "busy";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/session") return Response.json({ data: [{ id: "ses_1", time: { updated: 20 }, title: "Failed session" }] });
      if (path === "/session/status") return Response.json({ ses_1: { type: status } });
      if (path.endsWith("/message")) {
        return Response.json([{ info: { error: { message: "provider unavailable" }, id: "msg_1", role: "assistant" }, parts: [] }]);
      }
      return Response.json([]);
    }, { preconnect: originalFetch.preconnect });

    try {
      const monitor = createSessionMonitor({ connect: async () => connection({}) });
      await monitor.listSessions();
      status = "idle";
      await monitor.listSessions();

      expect(monitor.listNotifications(0)[0]?.type).toBe("error");
      expect(monitor.listNotifications(0)[0]?.message).toBe("provider unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
