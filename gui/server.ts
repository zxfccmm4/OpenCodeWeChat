#!/usr/bin/env bun
/**
 * OpenCodeWeChat GUI 控制台。
 * 本地 HTTP 服务（仅绑定 127.0.0.1），提供启动/停止/扫码登录/登出/日志查看。
 * 通道进程以分离方式启动，日志写入 CHANNEL_LOG_FILE。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CHANNEL_LOG_FILE,
  DEFAULT_BASE_URL,
  GUI_HOSTNAME,
  GUI_PORT,
} from "../config";
import { fetchQRCode, pollQRStatus } from "../api/ilink";
import { buildAccountFromStatus } from "../login/qr";
import { loadCredentials, saveCredentials } from "../storage/credentials";
import {
  clearAccountState,
  isProcessAlive,
  readPidFile,
  stopRunningInstance,
} from "../storage/runtime-state";
import { rotateChannelLogIfNeeded } from "../storage/channel-log";
import { GUI_PAGE_HTML } from "./page";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const MAX_LOG_LINES = 1000;

export type GuiDeps = {
  clearAccountState: typeof clearAccountState;
  fetchQRCode: typeof fetchQRCode;
  isProcessAlive: typeof isProcessAlive;
  loadCredentials: typeof loadCredentials;
  pollQRStatus: typeof pollQRStatus;
  readLogTail: (lines: number) => string;
  readPidFile: typeof readPidFile;
  renderQrAscii: (content: string) => Promise<string>;
  saveCredentials: typeof saveCredentials;
  spawnChannel: () => void;
  stopRunningInstance: typeof stopRunningInstance;
};

const DEFAULT_GUI_DEPS: GuiDeps = {
  clearAccountState,
  fetchQRCode,
  isProcessAlive,
  loadCredentials,
  pollQRStatus,
  readLogTail: readChannelLogTail,
  readPidFile,
  renderQrAscii,
  saveCredentials,
  spawnChannel: spawnDetachedChannel,
  stopRunningInstance,
};

function log(msg: string) {
  process.stderr.write(`[gui] ${msg}\n`);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
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

/**
 * 解析启动通道的命令。
 * 源码运行: bun index.ts；编译产物运行（虚拟文件系统里没有 index.ts）:
 * 启动同目录下的主程序二进制。
 */
function resolveChannelCommand(): {
  readonly args: string[];
  readonly command: string;
  readonly cwd: string;
} {
  const sourceEntry = path.join(PROJECT_ROOT, "index.ts");
  if (fs.existsSync(sourceEntry)) {
    return { args: [sourceEntry], command: process.execPath, cwd: PROJECT_ROOT };
  }
  const exeDir = path.dirname(process.execPath);
  const mainBinary = process.platform === "win32"
    ? "OpenCodeWeChat.exe"
    : "OpenCodeWeChat";
  return {
    args: [],
    command: path.join(exeDir, mainBinary),
    cwd: path.dirname(exeDir),
  };
}

function spawnDetachedChannel(): void {
  rotateChannelLogIfNeeded();
  fs.mkdirSync(path.dirname(CHANNEL_LOG_FILE), { recursive: true });
  const logFd = fs.openSync(CHANNEL_LOG_FILE, "a");
  try {
    const stamp = new Date().toISOString();
    fs.writeSync(logFd, `\n===== ${stamp} 由 GUI 控制台启动 =====\n`);
    const channel = resolveChannelCommand();
    const child = spawn(channel.command, channel.args, {
      cwd: channel.cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } finally {
    fs.closeSync(logFd);
  }
}

export function readChannelLogTail(lines: number): string {
  const requested = Math.min(Math.max(lines, 1), MAX_LOG_LINES);
  try {
    const raw = fs.readFileSync(CHANNEL_LOG_FILE, "utf-8");
    const allLines = raw.split("\n");
    return allLines.slice(-requested).join("\n").trim();
  } catch {
    return "";
  }
}

export function createGuiApp(deps: GuiDeps = DEFAULT_GUI_DEPS) {
  let loginSession: { qrcode: string } | null = null;

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;

    switch (route) {
      case "GET /":
        return new Response(GUI_PAGE_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });

      case "GET /api/status": {
        const pid = deps.readPidFile();
        const running = pid !== null && deps.isProcessAlive(pid);
        const account = deps.loadCredentials();
        return json({
          account: account
            ? {
              accountId: account.accountId,
              savedAt: account.savedAt,
              userId: account.userId,
            }
            : null,
          pid: running ? pid : null,
          running,
        });
      }

      case "POST /api/start": {
        const pid = deps.readPidFile();
        if (pid !== null && deps.isProcessAlive(pid)) {
          return json({ message: `通道已在运行 (pid ${pid})` });
        }
        if (!deps.loadCredentials()) {
          return json({ error: "未登录微信，请先扫码登录" }, 409);
        }
        deps.spawnChannel();
        return json({ message: "通道启动中，请观察下方日志" });
      }

      case "POST /api/stop": {
        const result = await deps.stopRunningInstance();
        return json({
          message: result === "stopped" ? "已停止通道" : "通道当前未运行",
        });
      }

      case "POST /api/logout": {
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

      default:
        return json({ error: "not found" }, 404);
    }
  }

  return {
    async fetch(req: Request): Promise<Response> {
      try {
        return await handle(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`请求处理失败 (${new URL(req.url).pathname}): ${message}`);
        return json({ error: message }, 500);
      }
    },
  };
}

function openBrowser(url: string): void {
  if (process.env.OPENCODE_WECHAT_GUI_NO_OPEN === "1") return;
  try {
    const child = process.platform === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // 打不开浏览器不致命，URL 已打印在日志里
  }
}

async function isOurGuiRunning(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(`${baseUrl}/api/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json() as { running?: unknown };
    return typeof data.running === "boolean";
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function main() {
  const url = `http://${GUI_HOSTNAME}:${GUI_PORT}`;

  if (await isOurGuiRunning(url)) {
    log(`控制台已在运行: ${url}，直接打开浏览器`);
    openBrowser(url);
    return;
  }

  const app = createGuiApp();
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
  openBrowser(url);
}

if (import.meta.main) {
  main().catch((err) => {
    log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
