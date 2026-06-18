import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { getAuthHeader } from "./http";
import type { StartedOpencodeServer } from "./types";

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function getOpencodePathHints(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    case "win32": {
      const homeDir = process.env.USERPROFILE?.trim() || os.homedir();
      const localAppData = process.env.LOCALAPPDATA?.trim()
        || path.join(homeDir, "AppData", "Local");
      const appData = process.env.APPDATA?.trim()
        || path.join(homeDir, "AppData", "Roaming");
      const programFiles = process.env.ProgramFiles?.trim() || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim();
      return [
        path.join(localAppData, "Programs", "OpenCode", "bin"),
        path.join(localAppData, "Programs", "OpenCode"),
        path.join(appData, "npm"),
        path.join(localAppData, "Microsoft", "WinGet", "Packages"),
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
      return [path.join(os.homedir(), ".local", "bin"), "/usr/local/bin", "/usr/bin", "/bin"];
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
      return `未找到 OpenCode CLI（${command}）。请先安装 OpenCode，并确保 opencode.cmd 或 opencode.exe 在 PATH 中。若通过 npm/pnpm 安装，请确认 %APPDATA%\\npm 在 PATH 中。${sharedHint}`;
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
  }
}

export function parseOpencodeServerUrl(output: string): string | undefined {
  const match = output.match(/(?:^|\n)(?:opencode\s+)?server listening.*?\bon\s+(https?:\/\/[^\s]+)/i);
  return match?.[1];
}

export async function startOpencodeServer(): Promise<StartedOpencodeServer> {
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
      const url = parseOpencodeServerUrl(output);
      if (!url) return;

      finish(() => {
        resolve({
          authHeader: getAuthHeader(),
          url,
          close() {
            killOpencodeProcess(proc);
          },
        });
      });
    };

    // 启动完成后继续转发 opencode 的输出（logLevel=ERROR 时平时安静），
    // 服务进程崩溃时的报错信息是诊断"死因"的关键线索
    const handleChunk = (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (settled) {
        const trimmed = text.trim();
        if (trimmed) {
          process.stderr.write(`[opencode-serve] ${trimmed}\n`);
        }
        return;
      }
      tryResolveUrl(text);
    };

    proc.stdout.on("data", handleChunk);

    proc.stderr.on("data", handleChunk);

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
      const startupAlreadySettled = settled;
      finish(() => {
        const details = output.trim() ? `\nOpenCode 输出:\n${output.trim()}` : "";
        reject(
          new Error(
            `OpenCode 服务提前退出（code=${code ?? "null"}, signal=${signal ?? "null"}）。${details}`,
          ),
        );
      });
      // 启动成功后服务进程再退出时，至少在日志里留下死因线索；
      // 实际恢复由轮询层的会话自动重启负责
      if (startupAlreadySettled) {
        process.stderr.write(
          `[opencode] 警告: OpenCode 服务进程已退出 (code=${code ?? "null"}, signal=${signal ?? "null"})，将在下一条消息时自动重启\n`,
        );
      }
    });
  });
}
