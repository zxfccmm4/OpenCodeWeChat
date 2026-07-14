import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { BotStateStore } from "../storage/bot-state";

const WORKER_SCRIPT = `
  const { BotStateStore } = await import("./storage/bot-state.ts");
  const store = new BotStateStore({ databaseFile: process.env.DATABASE_FILE });
  console.log("READY");
  for await (const chunk of Bun.stdin.stream()) {
    if (chunk.byteLength > 0) break;
  }
  const scope = { accountId: process.env.ACCOUNT, profileId: process.env.PROFILE };
  if (process.env.ACTION === "write") {
    await store.putBinding(scope, {
      bindingId: "binding-" + process.env.SENDER,
      boundAt: 1,
      replyStyle: "standard",
      senderId: process.env.SENDER,
      sessionId: process.env.SESSION,
    });
  } else if (process.env.ACTION === "consume") {
    const consumed = await store.mutateAccount(scope, (state) => {
      const exists = state.pendingCodes.some((item) => item.id === "pending-1");
      return {
        result: exists,
        state: exists
          ? { ...state, pendingCodes: state.pendingCodes.filter((item) => item.id !== "pending-1") }
          : state,
      };
    });
    await Bun.write(process.env.RESULT_FILE, consumed ? "1" : "0");
  } else {
    await store.mutateAccount(scope, () => {
      process.exit(17);
    });
  }
  store.close();
`;

function spawnWorker(
  databaseFile: string,
  values: Readonly<Record<string, string>>,
) {
  return Bun.spawn([process.execPath, "-e", WORKER_SCRIPT], {
    cwd: path.resolve(import.meta.dir, ".."),
    env: { ...process.env, ...values, DATABASE_FILE: databaseFile },
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
}

async function awaitReady(worker: ReturnType<typeof spawnWorker>): Promise<void> {
  const reader = worker.stdout.getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(chunk.value)).toContain("READY");
}

function release(workers: readonly ReturnType<typeof spawnWorker>[]): void {
  for (const worker of workers) {
    worker.stdin.write("go\n");
    worker.stdin.end();
  }
}

describe("SQLite cross-process state", () => {
  test("serializes simultaneous mutations for distinct accounts", async () => {
    // Given
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-db-write-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const first = spawnWorker(databaseFile, {
      ACCOUNT: "account-a",
      ACTION: "write",
      PROFILE: "profile-a",
      SENDER: "sender-a",
      SESSION: "session-a",
    });
    const second = spawnWorker(databaseFile, {
      ACCOUNT: "account-b",
      ACTION: "write",
      PROFILE: "profile-b",
      SENDER: "sender-b",
      SESSION: "session-b",
    });
    await Promise.all([awaitReady(first), awaitReady(second)]);

    // When
    release([first, second]);
    await Promise.all([first.exited, second.exited]);

    // Then
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const reader = new BotStateStore({ databaseFile });
    expect(await reader.getBinding(
      { accountId: "account-a", profileId: "profile-a" },
      "sender-a",
    )).toMatchObject({ sessionId: "session-a" });
    expect(await reader.getBinding(
      { accountId: "account-b", profileId: "profile-b" },
      "sender-b",
    )).toMatchObject({ sessionId: "session-b" });
    reader.close();
    fs.rmSync(directory, { force: true, recursive: true });
  });

  test("allows exactly one simultaneous pending-code consumer", async () => {
    // Given
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-db-consume-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const scope = { accountId: "account", profileId: "profile" };
    const seed = new BotStateStore({ databaseFile });
    await seed.mutateAccount(scope, (state) => ({
      result: undefined,
      state: {
        ...state,
        pendingCodes: [{
          attemptsBySender: {},
          createdAt: 1,
          expiresAt: 2,
          id: "pending-1",
          keyedDigest: "sha256:keyed-digest-only",
        }],
      },
    }));
    seed.close();
    const firstResult = path.join(directory, "first.result");
    const secondResult = path.join(directory, "second.result");
    const base = { ACCOUNT: "account", ACTION: "consume", PROFILE: "profile" };
    const first = spawnWorker(databaseFile, { ...base, RESULT_FILE: firstResult });
    const second = spawnWorker(databaseFile, { ...base, RESULT_FILE: secondResult });
    await Promise.all([awaitReady(first), awaitReady(second)]);

    // When
    release([first, second]);
    await Promise.all([first.exited, second.exited]);

    // Then
    expect(Number(fs.readFileSync(firstResult, "utf-8"))
      + Number(fs.readFileSync(secondResult, "utf-8"))).toBe(1);
    const reader = new BotStateStore({ databaseFile });
    expect((await reader.getAccount(scope)).pendingCodes).toEqual([]);
    reader.close();
    fs.rmSync(directory, { force: true, recursive: true });
  });

  test("rolls back an interrupted process transaction", async () => {
    // Given
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-db-crash-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const scope = { accountId: "account", profileId: "profile" };
    const seed = new BotStateStore({ databaseFile });
    await seed.putBinding(scope, {
      bindingId: "binding-before",
      boundAt: 1,
      replyStyle: "standard",
      senderId: "sender",
      sessionId: "session-before",
    });
    seed.close();
    const crashing = spawnWorker(databaseFile, {
      ACCOUNT: "account",
      ACTION: "crash",
      PROFILE: "profile",
    });
    await awaitReady(crashing);

    // When
    release([crashing]);
    await crashing.exited;

    // Then
    expect(crashing.exitCode).toBe(17);
    const reader = new BotStateStore({ databaseFile });
    expect(await reader.getBinding(scope, "sender")).toMatchObject({
      sessionId: "session-before",
    });
    reader.close();
    fs.rmSync(directory, { force: true, recursive: true });
  });
});
