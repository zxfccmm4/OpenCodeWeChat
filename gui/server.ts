#!/usr/bin/env bun
/**
 * OpenCodeWeChat GUI 控制台。
 * 本地 HTTP 服务（仅绑定 127.0.0.1），提供启动/停止/扫码登录/登出/日志查看。
 * 通道进程以分离方式启动，日志写入 CHANNEL_LOG_FILE。
 */
import { DEFAULT_BASE_URL, GUI_HOSTNAME, GUI_PORT } from "../config";
import { fetchQRCode, pollQRStatus } from "../api/ilink";
import { buildAccountFromStatus } from "../login/qr";
import { loadCredentials, saveCredentials } from "../storage/credentials";
import {
  clearAccountState,
  isProcessAlive,
  readPidFile,
  stopRunningInstance,
} from "../storage/runtime-state";
import { readChannelLogTail, spawnDetachedChannel } from "./channel-process";
import { GUI_PAGE_HTML } from "./page";
import { createSessionMonitor, type SessionMonitor } from "../opencode/session-monitor";
import { authorizeGuiApiRequest, GUI_ADMIN_TOKEN, isTrustedGuiHost, renderGuiPage } from "./security";
import { isOurGuiRunning, openBrowser } from "./runtime";
import { DEFAULT_BINDING_SERVICE } from "../storage/binding-service";
import type { BindingService } from "../storage/binding-types";
import { handleBindingApiRoute } from "./binding-routes";

const DEFAULT_SESSION_MONITOR = createSessionMonitor();

export type GuiDeps = {
  adminToken: string;
  bindingService: BindingService;
  clearAccountState: typeof clearAccountState;
  fetchQRCode: typeof fetchQRCode;
  isProcessAlive: typeof isProcessAlive;
  loadCredentials: typeof loadCredentials;
  pollQRStatus: typeof pollQRStatus;
  readLogTail: (lines: number) => string;
  readPidFile: typeof readPidFile;
  renderQrAscii: (content: string) => Promise<string>;
  saveCredentials: typeof saveCredentials;
  sessionMonitor: SessionMonitor;
  spawnChannel: () => void;
  stopRunningInstance: typeof stopRunningInstance;
};

const DEFAULT_GUI_DEPS: GuiDeps = {
  adminToken: GUI_ADMIN_TOKEN,
  bindingService: DEFAULT_BINDING_SERVICE,
  clearAccountState,
  fetchQRCode,
  isProcessAlive,
  loadCredentials,
  pollQRStatus,
  readLogTail: readChannelLogTail,
  readPidFile,
  renderQrAscii,
  saveCredentials,
  sessionMonitor: DEFAULT_SESSION_MONITOR,
  spawnChannel: spawnDetachedChannel,
  stopRunningInstance,
};

function log(msg: string) {
  process.stderr.write(`[gui] ${msg}\n`);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

async function renderQrAscii(content: string): Promise<string> {
  const qrterm = await import("qrcode-terminal");
  return new Promise<string>((resolve) => {
    qrterm.default.generate(content, { small: true }, (qr: string) => {
      resolve(qr);
    });
  });
}

export function createGuiApp(deps: GuiDeps = DEFAULT_GUI_DEPS) {
  let loginSession: { qrcode: string } | null = null;
  let channelLaunchPending = false;

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    const bindingResponse = await handleBindingApiRoute(req, route, deps);
    if (bindingResponse !== undefined) return bindingResponse;

    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/messages")) {
      const encodedId = url.pathname.slice("/api/sessions/".length, -"/messages".length);
      const sessionId = decodeURIComponent(encodedId);
      return json({ messages: await deps.sessionMonitor.listMessages(sessionId) });
    }

    switch (route) {
      case "GET /":
        return new Response(renderGuiPage(GUI_PAGE_HTML, deps.adminToken), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      case "GET /api/health":
        return json({ service: "opencode-wechat-gui" });

      case "GET /api/status": {
        const pid = deps.readPidFile();
        const running = pid !== null && deps.isProcessAlive(pid);
        if (running) channelLaunchPending = false;
        const account = deps.loadCredentials();
        const logTail = deps.readLogTail(80);
        const sessionExpired = /session timeout|微信会话已过期|errcode=-14/i.test(logTail);
        const needsRelogin = !running && (!account || sessionExpired);
        return json({
          account: account
            ? {
              accountId: account.accountId,
              savedAt: account.savedAt,
              userId: account.userId,
            }
            : null,
          needsRelogin,
          lastError: sessionExpired ? "session timeout" : null,
          pid: running ? pid : null,
          running,
        });
      }

      case "POST /api/start": {
        const pid = deps.readPidFile();
        if (pid !== null && deps.isProcessAlive(pid)) {
          channelLaunchPending = false;
          return json({ message: `通道已在运行 (pid ${pid})` });
        }
        if (channelLaunchPending) {
          return json({ message: "通道启动中，请观察下方日志" });
        }
        if (!deps.loadCredentials()) {
          return json({ error: "未登录微信，请先扫码登录" }, 409);
        }
        channelLaunchPending = true;
        deps.spawnChannel();
        return json({ message: "通道启动中，请观察下方日志" });
      }

      case "POST /api/stop": {
        channelLaunchPending = false;
        const result = await deps.stopRunningInstance();
        return json({
          message: result === "stopped" ? "已停止通道" : "通道当前未运行",
        });
      }

      case "POST /api/logout": {
        channelLaunchPending = false;
        const stopResult = await deps.stopRunningInstance();
        const removed = deps.clearAccountState();
        const stopNote = stopResult === "stopped" ? "已停止通道，" : "";
        return json({
          message: `${stopNote}已清除 ${removed.length} 个本机状态文件（收件箱保留）`,
          removed,
        });
      }

      case "POST /api/login": {
        // 凭据变更需要重启通道才生效，扫码前先停掉
        channelLaunchPending = false;
        await deps.stopRunningInstance();
        const qr = await deps.fetchQRCode(DEFAULT_BASE_URL);
        loginSession = { qrcode: qr.qrcode };
        const ascii = await deps.renderQrAscii(qr.qrcode_img_content);
        return json({ ascii });
      }

      case "GET /api/login/status": {
        if (!loginSession) {
          return json({ error: "没有进行中的登录流程" }, 400);
        }
        const status = await deps.pollQRStatus(DEFAULT_BASE_URL, loginSession.qrcode);
        if (status.status === "confirmed") {
          const account = buildAccountFromStatus(status, DEFAULT_BASE_URL);
          loginSession = null;
          if (!account) {
            return json({ error: "登录确认但未返回 bot 信息" }, 500);
          }
          deps.saveCredentials(account);
          log(`扫码登录成功: ${account.accountId}`);
          return json({ accountId: account.accountId, status: "confirmed" });
        }
        if (status.status === "expired") {
          loginSession = null;
        }
        return json({ status: status.status });
      }

      case "GET /api/logs": {
        const lines = Number.parseInt(url.searchParams.get("lines") || "200", 10);
        return json({ text: deps.readLogTail(Number.isNaN(lines) ? 200 : lines) });
      }

      case "GET /api/sessions": return json({ connected: true, sessions: await deps.sessionMonitor.listSessions() });

      case "GET /api/session-notifications":
        return json({ notifications: deps.sessionMonitor.listNotifications(Number.parseInt(url.searchParams.get("since") || "0", 10) || 0) });

      default:
        return json({ error: "not found" }, 404);
    }
  }

  return {
    async fetch(req: Request): Promise<Response> {
      try {
        const url = new URL(req.url);
        if (!isTrustedGuiHost(req)) return json({ error: "forbidden" }, 403);
        const requiresAuthorization = url.pathname.startsWith("/api/") && url.pathname !== "/api/health";
        if (requiresAuthorization && !authorizeGuiApiRequest(req, deps.adminToken)) {
          return json({ error: "forbidden" }, 403);
        }
        return await handle(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`请求处理失败 (${new URL(req.url).pathname}): ${message}`);
        return json({ error: message }, 500);
      }
    },
  };
}

async function main() {
  const url = `http://${GUI_HOSTNAME}:${GUI_PORT}`;

  if (await isOurGuiRunning(url)) {
    log(`控制台已在运行: ${url}，直接打开浏览器`);
    openBrowser(url, log);
    return;
  }

  const app = createGuiApp();
  const closeSessionMonitor = () => DEFAULT_SESSION_MONITOR.close();
  process.once("exit", closeSessionMonitor);
  process.once("SIGINT", () => {
    closeSessionMonitor();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    closeSessionMonitor();
    process.exit(0);
  });
  try {
    Bun.serve({
      fetch: app.fetch,
      hostname: GUI_HOSTNAME,
      idleTimeout: 60,
      port: GUI_PORT,
    });
  } catch (err) {
    log(`启动失败: 端口 ${GUI_PORT} 被其他程序占用（${err instanceof Error ? err.message : err}）`);
    log("可设置环境变量 OPENCODE_WECHAT_GUI_PORT 换一个端口");
    process.exit(1);
  }

  log(`控制台已启动: ${url}`);
  log("按 Ctrl+C 退出控制台（不影响已启动的通道进程）");
  openBrowser(url, log);
}

if (import.meta.main) {
  main().catch((err) => {
    log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
