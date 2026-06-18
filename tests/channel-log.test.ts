import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  appendChannelLog,
  installChannelLogTee,
  rotateChannelLogIfNeeded,
} from "../storage/channel-log";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-log-"));
}

describe("appendChannelLog", () => {
  test("creates the directory and appends text", () => {
    const tempDir = makeTempDir();
    const logFile = path.join(tempDir, "nested", "channel.log");

    appendChannelLog("第一行\n", logFile);
    appendChannelLog("第二行\n", logFile);

    expect(fs.readFileSync(logFile, "utf-8")).toBe("第一行\n第二行\n");
    fs.rmSync(tempDir, { force: true, recursive: true });
  });
});

describe("rotateChannelLogIfNeeded", () => {
  test("rotates the log to .old once it exceeds the limit", () => {
    const tempDir = makeTempDir();
    const logFile = path.join(tempDir, "channel.log");
    fs.writeFileSync(logFile, "x".repeat(100), "utf-8");

    rotateChannelLogIfNeeded(logFile, 50);

    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.readFileSync(`${logFile}.old`, "utf-8")).toBe("x".repeat(100));
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test("keeps small logs untouched", () => {
    const tempDir = makeTempDir();
    const logFile = path.join(tempDir, "channel.log");
    fs.writeFileSync(logFile, "small", "utf-8");

    rotateChannelLogIfNeeded(logFile, 1024);

    expect(fs.readFileSync(logFile, "utf-8")).toBe("small");
    expect(fs.existsSync(`${logFile}.old`)).toBe(false);
    fs.rmSync(tempDir, { force: true, recursive: true });
  });
});

describe("installChannelLogTee", () => {
  test("tees stderr writes into the log file and restores cleanly", () => {
    const tempDir = makeTempDir();
    const logFile = path.join(tempDir, "channel.log");
    const writesBefore = process.stderr.write;

    const restore = installChannelLogTee({ force: true, logFile });
    expect(restore).not.toBeNull();

    try {
      process.stderr.write("[test] tee 写入验证\n");
    } finally {
      restore?.();
    }

    expect(process.stderr.write).toBe(writesBefore);
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("通道在终端启动");
    expect(content).toContain("[test] tee 写入验证");
    fs.rmSync(tempDir, { force: true, recursive: true });
  });
});
