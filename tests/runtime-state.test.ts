import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  clearAccountState,
  isProcessAlive,
  readPidFile,
  removePidFile,
  stopRunningInstance,
  writePidFile,
} from "../storage/runtime-state";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-home-"));
}

describe("runtime pid file", () => {
  test("writes and removes the pid file used by stop scripts", () => {
    const tempDir = makeTempDir();
    const pidFile = path.join(tempDir, "opencode-wechat.pid");

    writePidFile(12345, pidFile);
    expect(fs.readFileSync(pidFile, "utf-8")).toBe("12345");

    removePidFile(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);

    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test("readPidFile parses valid pids and rejects garbage", () => {
    const tempDir = makeTempDir();
    const pidFile = path.join(tempDir, "opencode-wechat.pid");

    writePidFile(4242, pidFile);
    expect(readPidFile(pidFile)).toBe(4242);

    fs.writeFileSync(pidFile, "not-a-pid", "utf-8");
    expect(readPidFile(pidFile)).toBeNull();

    fs.writeFileSync(pidFile, "-5", "utf-8");
    expect(readPidFile(pidFile)).toBeNull();

    expect(readPidFile(path.join(tempDir, "missing.pid"))).toBeNull();

    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test("isProcessAlive detects the current process and rejects stale pids", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    // PID 0xFFFFFFF 几乎不可能存在；信号 0 仅探测不发送
    expect(isProcessAlive(0xfffffff)).toBe(false);
  });
});

describe("stopRunningInstance", () => {
  test("reports not-running and cleans up a stale pid file", async () => {
    const tempDir = makeTempDir();
    const pidFile = path.join(tempDir, "opencode-wechat.pid");
    writePidFile(0xfffffff, pidFile);

    const result = await stopRunningInstance({ pidFile, waitMs: 100 });

    expect(result).toBe("not-running");
    expect(fs.existsSync(pidFile)).toBe(false);

    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test("stops a live process and removes its pid file", async () => {
    const tempDir = makeTempDir();
    const pidFile = path.join(tempDir, "opencode-wechat.pid");
    const child = Bun.spawn(["sleep", "60"]);
    writePidFile(child.pid, pidFile);

    const result = await stopRunningInstance({ pidFile, waitMs: 3_000 });

    expect(result).toBe("stopped");
    expect(fs.existsSync(pidFile)).toBe(false);
    await child.exited;
    expect(isProcessAlive(child.pid)).toBe(false);

    fs.rmSync(tempDir, { force: true, recursive: true });
  });
});

describe("clearAccountState", () => {
  test("removes credential and session files but leaves the inbox alone", () => {
    const tempDir = makeTempDir();
    const files = {
      contextTokensFile: path.join(tempDir, "context_tokens.json"),
      credentialsFile: path.join(tempDir, "account.json"),
      omoPlanContextFile: path.join(tempDir, "omo_plan_context.json"),
      processedMessagesFile: path.join(tempDir, "processed_messages.json"),
      syncBufferFile: path.join(tempDir, "sync_buf.txt"),
    };
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "data", "utf-8");
    }
    const inboxDir = path.join(tempDir, "inbox");
    fs.mkdirSync(inboxDir);
    const inboxFile = path.join(inboxDir, "downloaded.jpg");
    fs.writeFileSync(inboxFile, "media", "utf-8");

    const removed = clearAccountState(files);

    expect(removed.sort()).toEqual(Object.values(files).sort());
    for (const file of Object.values(files)) {
      expect(fs.existsSync(file)).toBe(false);
    }
    expect(fs.existsSync(inboxFile)).toBe(true);

    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test("returns an empty list when nothing is left to clean", () => {
    const tempDir = makeTempDir();
    const files = {
      contextTokensFile: path.join(tempDir, "context_tokens.json"),
      credentialsFile: path.join(tempDir, "account.json"),
      omoPlanContextFile: path.join(tempDir, "omo_plan_context.json"),
      processedMessagesFile: path.join(tempDir, "processed_messages.json"),
      syncBufferFile: path.join(tempDir, "sync_buf.txt"),
    };

    expect(clearAccountState(files)).toEqual([]);

    fs.rmSync(tempDir, { force: true, recursive: true });
  });
});
