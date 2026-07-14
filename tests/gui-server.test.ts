import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createGuiApp, type GuiDeps } from "../gui/server";
import { createBindingService } from "../storage/binding-service";
import { BotStateStore } from "../storage/bot-state";
import type { AccountData } from "../types/wechat";

const TEST_ACCOUNT: AccountData = {
  accountId: "bot-gui-1",
  baseUrl: "https://example.com",
  savedAt: "2026-06-11T00:00:00.000Z",
  token: "token-1",
  userId: "user-1",
};

function createDeps(overrides: Partial<GuiDeps> = {}): GuiDeps {
  return {
    adminToken: "test-token",
    bindingService: {
      async consumeCode() { return { status: "invalid" as const }; },
      async generateCode() { return { code: "000000", createdAt: 0, expiresAt: 600_000 }; },
      async listBindings() { return []; },
      async revoke() { return false; },
    },
    clearAccountState() {
      return [];
    },
    async fetchQRCode() {
      return { qrcode: "qr-1", qrcode_img_content: "https://login.example/qr-1" };
    },
    isProcessAlive() {
      return false;
    },
    loadCredentials() {
      return null;
    },
    async pollQRStatus() {
      return { status: "wait" as const };
    },
    readLogTail() {
      return "";
    },
    readPidFile() {
      return null;
    },
    async renderQrAscii() {
      return "█▀▀█ ascii-qr █▄▄█";
    },
    saveCredentials() {
      // noop
    },
    sessionMonitor: {
      close() {},
      async listMessages() {
        return [];
      },
      listNotifications() {
        return [];
      },
      async listSessions() {
        return [];
      },
    },
    spawnChannel() {
      // noop
    },
    async stopRunningInstance() {
      return "not-running" as const;
    },
    ...overrides,
  };
}

function request(method: string, path: string): Request {
  return new Request(`http://127.0.0.1:5179${path}`, {
    headers: { "X-OpenCode-WeChat-Token": "test-token" },
    method,
  });
}

describe("GUI server routes", () => {
  test("serves an unprotected health check without exposing GUI state", async () => {
    const app = createGuiApp(createDeps());
    const res = await app.fetch(new Request("http://127.0.0.1:5179/api/health"));
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.service).toBe("opencode-wechat-gui");
  });

  test("rejects an untrusted host before serving the token page or health check", async () => {
    const app = createGuiApp(createDeps());
    const page = await app.fetch(new Request("http://attacker.invalid/"));
    const health = await app.fetch(new Request("http://attacker.invalid/api/health"));

    expect(page.status).toBe(403);
    expect(health.status).toBe(403);
  });

  test("serves the console page", async () => {
    const app = createGuiApp(createDeps());
    const res = await app.fetch(request("GET", "/"));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("OpenCodeWeChat");
    expect(html).toContain("聊天绑定");
    expect(html).toContain("生成绑定码");
    expect(html).toContain("btn-binding-code");
    expect(html).toContain("btn-copy-bind-command");
    expect(html).toContain("nav-tab");
    expect(html).toContain("sidebar");
    expect(html).toContain("window");
    expect(html).toContain("sidebar-search");
    expect(html).toContain("appearance-btn");
    expect(html).toContain("panel-overview");
    expect(html).toContain("panel-binding");
    expect(html).toContain("/api/bindings/code");
    expect(html).toContain("/bind ");
    expect(html).toContain("/帮助");
  });

  test("reports running status with pid and account", async () => {
    const app = createGuiApp(createDeps({
      isProcessAlive() {
        return true;
      },
      loadCredentials() {
        return TEST_ACCOUNT;
      },
      readPidFile() {
        return 4242;
      },
    }));

    const res = await app.fetch(request("GET", "/api/status"));
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.running).toBe(true);
    expect(data.pid).toBe(4242);
    expect((data.account as Record<string, unknown>).accountId).toBe("bot-gui-1");
  });

  test("refuses to start the channel without credentials", async () => {
    let spawned = 0;
    const app = createGuiApp(createDeps({
      spawnChannel() {
        spawned += 1;
      },
    }));

    const res = await app.fetch(request("POST", "/api/start"));
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(String(data.error)).toContain("扫码登录");
    expect(spawned).toBe(0);
  });

  test("starts the channel when logged in and not running", async () => {
    let spawned = 0;
    const app = createGuiApp(createDeps({
      loadCredentials() {
        return TEST_ACCOUNT;
      },
      spawnChannel() {
        spawned += 1;
      },
    }));

    const res = await app.fetch(request("POST", "/api/start"));

    expect(res.status).toBe(200);
    expect(spawned).toBe(1);
  });

  test("does not double-start while a channel launch is pending", async () => {
    let spawned = 0;
    const app = createGuiApp(createDeps({
      loadCredentials() {
        return TEST_ACCOUNT;
      },
      spawnChannel() {
        spawned += 1;
      },
    }));

    const first = await app.fetch(request("POST", "/api/start"));
    const second = await app.fetch(request("POST", "/api/start"));
    const data = await second.json() as Record<string, unknown>;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(String(data.message)).toContain("启动中");
    expect(spawned).toBe(1);
  });

  test("does not double-start a running channel", async () => {
    let spawned = 0;
    const app = createGuiApp(createDeps({
      isProcessAlive() {
        return true;
      },
      loadCredentials() {
        return TEST_ACCOUNT;
      },
      readPidFile() {
        return 4242;
      },
      spawnChannel() {
        spawned += 1;
      },
    }));

    const res = await app.fetch(request("POST", "/api/start"));
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(String(data.message)).toContain("已在运行");
    expect(spawned).toBe(0);
  });

  test("logout stops the channel and clears local state", async () => {
    let stopped = 0;
    let cleared = 0;
    const app = createGuiApp(createDeps({
      clearAccountState() {
        cleared += 1;
        return ["/tmp/account.json"];
      },
      async stopRunningInstance() {
        stopped += 1;
        return "stopped" as const;
      },
    }));

    const res = await app.fetch(request("POST", "/api/logout"));
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(stopped).toBe(1);
    expect(cleared).toBe(1);
    expect(String(data.message)).toContain("已清除 1 个");
  });

  test("login flow: fetch QR, then confirm saves credentials", async () => {
    const saved: AccountData[] = [];
    let stopCalls = 0;
    const app = createGuiApp(createDeps({
      async pollQRStatus() {
        return {
          status: "confirmed" as const,
          bot_token: "bot-token-1",
          ilink_bot_id: "bot-gui-2",
          ilink_user_id: "user-2",
        };
      },
      saveCredentials(account) {
        saved.push(account);
      },
      async stopRunningInstance() {
        stopCalls += 1;
        return "not-running" as const;
      },
    }));

    const loginRes = await app.fetch(request("POST", "/api/login"));
    const loginData = await loginRes.json() as Record<string, unknown>;
    expect(loginRes.status).toBe(200);
    expect(String(loginData.ascii)).toContain("ascii-qr");
    expect(stopCalls).toBe(1);

    const statusRes = await app.fetch(request("GET", "/api/login/status"));
    const statusData = await statusRes.json() as Record<string, unknown>;
    expect(statusRes.status).toBe(200);
    expect(statusData.status).toBe("confirmed");
    expect(statusData.accountId).toBe("bot-gui-2");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.token).toBe("bot-token-1");
  });

  test("login status without an active login returns 400", async () => {
    const app = createGuiApp(createDeps());
    const res = await app.fetch(request("GET", "/api/login/status"));
    expect(res.status).toBe(400);
  });

  test("expired QR clears the login session", async () => {
    const app = createGuiApp(createDeps({
      async pollQRStatus() {
        return { status: "expired" as const };
      },
    }));

    await app.fetch(request("POST", "/api/login"));
    const first = await app.fetch(request("GET", "/api/login/status"));
    expect(((await first.json()) as Record<string, unknown>).status).toBe("expired");

    const second = await app.fetch(request("GET", "/api/login/status"));
    expect(second.status).toBe(400);
  });

  test("returns log tail text", async () => {
    const app = createGuiApp(createDeps({
      readLogTail(lines) {
        return `tail-${lines}`;
      },
    }));

    const res = await app.fetch(request("GET", "/api/logs?lines=50"));
    const data = await res.json() as Record<string, unknown>;
    expect(data.text).toBe("tail-50");
  });

  test("returns OpenCode sessions with progress", async () => {
    const app = createGuiApp(createDeps({
      sessionMonitor: {
        close() {},
        async listMessages() { return []; },
        listNotifications() { return []; },
        async listSessions() {
          return [{
            agent: "Sisyphus",
            createdAt: 10,
            directory: "/tmp/project",
            id: "ses_1",
            model: "provider/model",
            progressText: "正在执行",
            status: "busy" as const,
            title: "实现 Session 面板",
            updatedAt: 20,
          }];
        },
      },
    }));

    const res = await app.fetch(request("GET", "/api/sessions"));
    const data = await res.json() as { sessions: readonly Record<string, unknown>[] };

    expect(res.status).toBe(200);
    expect(data.sessions[0]?.id).toBe("ses_1");
    expect(data.sessions[0]?.status).toBe("busy");
  });

  test("returns messages for the selected OpenCode session", async () => {
    let requestedId = "";
    const app = createGuiApp(createDeps({
      sessionMonitor: {
        close() {},
        async listMessages(sessionId) {
          requestedId = sessionId;
          return [{ createdAt: 10, id: "msg_1", role: "user" as const, text: "hello" }];
        },
        listNotifications() { return []; },
        async listSessions() { return []; },
      },
    }));

    const res = await app.fetch(request("GET", "/api/sessions/ses_1/messages"));
    const data = await res.json() as { messages: readonly Record<string, unknown>[] };

    expect(res.status).toBe(200);
    expect(requestedId).toBe("ses_1");
    expect(data.messages[0]?.text).toBe("hello");
  });

  test("rejects API requests with an untrusted host or missing token", async () => {
    const app = createGuiApp(createDeps());
    const hostileHost = await app.fetch(new Request("http://attacker.invalid/api/sessions", {
      headers: { "X-OpenCode-WeChat-Token": "test-token" },
    }));
    const missingToken = await app.fetch(new Request("http://127.0.0.1:5179/api/sessions"));

    expect(hostileHost.status).toBe(403);
    expect(missingToken.status).toBe(403);
  });

  test("preserves localhost token and Origin authorization with no-store API responses", async () => {
    // Given
    const app = createGuiApp(createDeps());
    const authenticated = request("GET", "/api/status");
    const missingToken = new Request("http://127.0.0.1:5179/api/status");
    const hostileOrigin = new Request("http://127.0.0.1:5179/api/status", {
      headers: {
        Origin: "http://attacker.invalid",
        "X-OpenCode-WeChat-Token": "test-token",
      },
    });

    // When
    const responses = await Promise.all([
      app.fetch(authenticated),
      app.fetch(missingToken),
      app.fetch(hostileOrigin),
    ]);

    // Then
    expect(responses.map((response) => response.status)).toEqual([200, 403, 403]);
    expect(responses.map((response) => response.headers.get("Cache-Control"))).toEqual([
      "no-store",
      "no-store",
      "no-store",
    ]);
  });

  test("generates lists and revokes bindings through authenticated no-store APIs", async () => {
    // Given
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-gui-binding-"));
    const store = new BotStateStore({ databaseFile: path.join(directory, "state.sqlite") });
    const bindingService = createBindingService({
      digestKey: "22".repeat(32),
      now: () => 100,
      randomId: () => "opaque-binding-id",
      randomInt: () => 0,
      store,
    });
    const app = createGuiApp(createDeps({
      bindingService,
      loadCredentials() { return TEST_ACCOUNT; },
    }));
    const generate = await app.fetch(request("POST", "/api/bindings/code"));
    const generated = await generate.json() as { code: string };
    await bindingService.consumeCode(
      { accountId: TEST_ACCOUNT.accountId, profileId: TEST_ACCOUNT.userId ?? TEST_ACCOUNT.accountId },
      "private-sender-1234",
      generated.code,
    );

    // When
    const list = await app.fetch(request("GET", "/api/bindings"));
    const listed = await list.json() as { bindings?: readonly { bindingId: string }[] };
    const revoke = await app.fetch(new Request("http://127.0.0.1:5179/api/bindings/revoke", {
      body: JSON.stringify({ bindingId: listed.bindings?.[0]?.bindingId ?? "missing" }),
      headers: {
        "Content-Type": "application/json",
        "X-OpenCode-WeChat-Token": "test-token",
      },
      method: "POST",
    }));

    // Then
    expect(generate.status).toBe(200);
    expect(generated.code).toBe("000000");
    expect(generate.headers.get("Cache-Control")).toBe("no-store");
    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(listed)).not.toContain(generated.code);
    expect(JSON.stringify(listed)).not.toContain("private-sender-1234");
    expect(JSON.stringify(listed)).not.toContain("keyedDigest");
    expect(revoke.status).toBe(200);
    expect((await revoke.json()) as Record<string, unknown>).toMatchObject({ revoked: true });
    store.close();
    fs.rmSync(directory, { force: true, recursive: true });
  });

  test("rejects unauthorized binding APIs and malformed revoke input", async () => {
    // Given
    const app = createGuiApp(createDeps({ loadCredentials() { return TEST_ACCOUNT; } }));
    const missingToken = new Request("http://127.0.0.1:5179/api/bindings");
    const hostileHost = new Request("http://attacker.invalid/api/bindings", {
      headers: { "X-OpenCode-WeChat-Token": "test-token" },
    });
    const hostileOrigin = new Request("http://127.0.0.1:5179/api/bindings", {
      headers: {
        Origin: "http://attacker.invalid",
        "X-OpenCode-WeChat-Token": "test-token",
      },
    });
    const malformed = new Request("http://127.0.0.1:5179/api/bindings/revoke", {
      body: JSON.stringify({ bindingId: 123 }),
      headers: {
        "Content-Type": "application/json",
        "X-OpenCode-WeChat-Token": "test-token",
      },
      method: "POST",
    });

    // When
    const responses = await Promise.all([
      app.fetch(missingToken),
      app.fetch(hostileHost),
      app.fetch(hostileOrigin),
      app.fetch(malformed),
    ]);

    // Then
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 400]);
    expect(responses.every((response) => response.headers.get("Cache-Control") === "no-store")).toBe(true);
  });

  test("wraps handler errors as JSON 500", async () => {
    const app = createGuiApp(createDeps({
      async fetchQRCode() {
        throw new Error("network down");
      },
    }));

    const res = await app.fetch(request("POST", "/api/login"));
    const data = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(500);
    expect(data.error).toBe("network down");
  });
});
