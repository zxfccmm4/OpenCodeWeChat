import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

interface OpencodeModel {
  providerID: string;
  modelID: string;
}

interface OpencodeAgent {
  name: string;
  mode: string;
}

export interface OpencodeSession {
  id: string;
  serverUrl: string;
  authHeader: string;
  model?: OpencodeModel;
  agent?: string;
  close(): void;
}

interface StartedOpencodeServer {
  url: string;
  close(): void;
}

function getAuthHeader(): string {
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function getOpencodePathHints(): string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ];
    case "win32": {
      const homeDir = process.env.USERPROFILE?.trim() || os.homedir();
      const localAppData = process.env.LOCALAPPDATA?.trim()
        || path.join(homeDir, "AppData", "Local");
      const programFiles = process.env.ProgramFiles?.trim() || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim();
      return [
        path.join(localAppData, "Programs", "OpenCode", "bin"),
        path.join(localAppData, "Programs", "OpenCode"),
        path.join(programFiles, "OpenCode", "bin"),
        path.join(programFiles, "OpenCode"),
        ...(programFilesX86
          ? [
            path.join(programFilesX86, "OpenCode", "bin"),
            path.join(programFilesX86, "OpenCode"),
          ]
          : []),
      ];
    }
    default:
      return [
        path.join(os.homedir(), ".local", "bin"),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ];
  }
}

function buildOpencodeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] ?? env.PATH ?? "";
  const merged = [...getOpencodePathHints(), ...currentPath.split(path.delimiter)]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  env[pathKey] = merged.join(path.delimiter);
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    logLevel: "ERROR",
  });
  return env;
}

function resolveOpencodeCommand(): string {
  return process.env.OPENCODE_BIN?.trim() || "opencode";
}

function isMissingCommandError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

function buildMissingCommandMessage(command: string): string {
  const sharedHint = "也可以在启动包目录的 opencode-wechat.env 中设置 OPENCODE_BIN。";
  switch (process.platform) {
    case "win32":
      return `未找到 OpenCode CLI（${command}）。请先安装 OpenCode，并确保 opencode.cmd 或 opencode.exe 在 PATH 中。${sharedHint}`;
    case "darwin":
      return `未找到 OpenCode CLI（${command}）。请确认 OpenCode 已安装，并且 opencode 在 PATH 中。${sharedHint}`;
    default:
      return `未找到 OpenCode CLI（${command}）。请确认 opencode 命令可用。${sharedHint}`;
  }
}

function killOpencodeProcess(proc: ChildProcessByStdio<null, Readable, Readable>): void {
  if (proc.killed) return;
  try {
    proc.kill();
  } catch {
    // best-effort
  }
}

async function startOpencodeServer(): Promise<StartedOpencodeServer> {
  const command = resolveOpencodeCommand();
  const proc = spawn(
    command,
    ["serve", "--hostname=127.0.0.1", "--port=0", "--log-level=ERROR"],
    {
      env: buildOpencodeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let settled = false;
  let output = "";
  let clearTimer = () => {};

  return await new Promise<StartedOpencodeServer>((resolve, reject) => {
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimer();
      callback();
    };

    const timeoutId = setTimeout(() => {
      finish(() => {
        killOpencodeProcess(proc);
        reject(new Error("OpenCode 服务启动超时，请确认 `opencode serve` 能正常运行。"));
      });
    }, 5_000);

    clearTimer = () => clearTimeout(timeoutId);

    const tryResolveUrl = (chunk: string) => {
      output += chunk;
      const match = output.match(/opencode server listening.*?on\s+(https?:\/\/[^\s]+)/);
      const url = match?.[1];
      if (!url) return;

      finish(() => {
        resolve({
          url,
          close() {
            killOpencodeProcess(proc);
          },
        });
      });
    };

    proc.stdout.on("data", (chunk: Buffer | string) => {
      tryResolveUrl(chunk.toString());
    });

    proc.stderr.on("data", (chunk: Buffer | string) => {
      tryResolveUrl(chunk.toString());
    });

    proc.on("error", (err) => {
      finish(() => {
        if (isMissingCommandError(err)) {
          reject(new Error(buildMissingCommandMessage(command)));
          return;
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    proc.on("exit", (code, signal) => {
      finish(() => {
        const details = output.trim() ? `\nOpenCode 输出:\n${output.trim()}` : "";
        reject(
          new Error(
            `OpenCode 服务提前退出（code=${code ?? "null"}, signal=${signal ?? "null"}）。${details}`,
          ),
        );
      });
    });
  });
}

function getModelOverride(): OpencodeModel | undefined {
  const providerID = process.env.OPENCODE_PROVIDER_ID?.trim();
  const modelID = process.env.OPENCODE_MODEL_ID?.trim();

  if (!providerID && !modelID) return undefined;
  if (!providerID || !modelID) {
    throw new Error(
      "OPENCODE_PROVIDER_ID 和 OPENCODE_MODEL_ID 必须同时设置，或同时不设置以使用 OpenCode 默认模型",
    );
  }

  return { providerID, modelID };
}

function getRequestedAgent(): string | undefined {
  return process.env.OPENCODE_AGENT?.trim() || undefined;
}

async function resolveAgentOverride(
  serverUrl: string,
  authHeader: string,
): Promise<string | undefined> {
  const requested = getRequestedAgent();
  if (!requested) return undefined;

  const response = await fetch(`${serverUrl}/agent`, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(
      `读取 OpenCode agent 失败: ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const agents = await response.json() as OpencodeAgent[];
  const normalized = requested.toLowerCase();
  const exact = agents.find((agent) => (
    agent.name === requested || agent.name.toLowerCase() === normalized
  ));

  if (exact) {
    return exact.name;
  }

  if (normalized === "omo" || normalized === "sisyphus") {
    const sisyphus = agents.find((agent) => (
      agent.name === "Sisyphus - Ultraworker" ||
      (agent.mode === "primary" && agent.name.toLowerCase().includes("sisyphus"))
    ));
    if (sisyphus) {
      return sisyphus.name;
    }
  }

  const names = agents.map((agent) => agent.name).slice(0, 20).join(", ");
  throw new Error(`未找到 OpenCode agent: ${requested}. 可用 agent: ${names}`);
}

async function readErrorDetails(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return "";

  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data === "object" && data !== null) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string") return message;

      const dataMessage = (data as { data?: { message?: unknown } }).data
        ?.message;
      if (typeof dataMessage === "string") return dataMessage;

      const errorMessage = (data as { error?: { message?: unknown } }).error
        ?.message;
      if (typeof errorMessage === "string") return errorMessage;
    }
  } catch {
    return text;
  }

  return text;
}

export async function startOpencode(): Promise<OpencodeSession> {
  process.stderr.write("[opencode] 启动 OpenCode 服务器...\n");

  const server = await startOpencodeServer();

  process.stderr.write(`[opencode] 服务器监听 ${server.url}\n`);

  const authHeader = getAuthHeader();
  const model = getModelOverride();
  const agent = await resolveAgentOverride(server.url, authHeader);

  const response = await fetch(`${server.url}/session`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(
      `创建会话失败: ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const sessionData = await response.json() as { id: string };
  const sessionId = sessionData.id;
  process.stderr.write(`[opencode] 会话已创建: ${sessionId}\n`);
  if (model) {
    process.stderr.write(
      `[opencode] 使用模型: ${model.providerID}/${model.modelID}\n`,
    );
  } else {
    process.stderr.write("[opencode] 使用 OpenCode 默认模型\n");
  }
  if (agent) {
    process.stderr.write(`[opencode] 使用 agent: ${agent}\n`);
  }

  return {
    id: sessionId,
    serverUrl: server.url,
    authHeader,
    model,
    agent,
    close() {
      server.close();
    },
  };
}

export async function sendPrompt(
  session: OpencodeSession,
  text: string,
): Promise<string> {
  process.stderr.write(`[opencode] 发送 prompt: ${text.slice(0, 50)}...\n`);

  const body: {
    parts: Array<{ type: "text"; text: string }>;
    model?: OpencodeModel;
    agent?: string;
  } = {
    parts: [{ type: "text", text }],
  };

  if (session.model) {
    body.model = session.model;
  }
  if (session.agent) {
    body.agent = session.agent;
  }

  const response = await fetch(
    `${session.serverUrl}/session/${session.id}/message`,
    {
      method: "POST",
      headers: {
        Authorization: session.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(
      `Prompt 失败: ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const promptData = await response.json() as {
    parts?: Array<{ type: string; text?: string }>;
  };
  const parts = promptData.parts || [];

  const textParts = parts.filter(
    (p: { type: string; text?: string }) => p.type === "text",
  ) as Array<{ type: "text"; text: string }>;

  const responseText = textParts.map((p) => p.text).join("\n");
  process.stderr.write(`[opencode] 响应: ${responseText.slice(0, 100)}...\n`);

  return responseText;
}
