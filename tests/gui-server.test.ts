import { describe, expect, test } from "bun:test";
import { createGuiApp, type GuiDeps } from "../gui/server";
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
  return new Request(`http://127.0.0.1:5179${path}`, { method });
}

describe("GUI server routes", () => {
  test("serves the console page", async () => {
    const app = createGuiApp(createDeps());
    const res = await app.fetch(request("GET", "/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("OpenCodeWeChat 控制台");
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
