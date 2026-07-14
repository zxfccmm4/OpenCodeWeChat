import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

const WORKER_SCRIPT = `
  const store = await import("./storage/omo-plan-context.ts");
  const scope = { accountId: process.env.ACCOUNT, profileId: process.env.PROFILE };
  console.log("READY");
  for await (const chunk of Bun.stdin.stream()) {
    if (chunk.byteLength > 0) break;
  }
  if (process.env.ACTION === "save") {
    store.saveLatestPlanContext(scope, {
      originalRequest: process.env.REQUEST,
      planResponse: process.env.PLAN,
      savedAt: process.env.SAVED_AT,
    }, process.env.SENDER);
  } else if (process.env.ACTION === "delete") {
    store.deleteLatestPlanContext(scope, process.env.SENDER);
  } else {
    const plan = store.getLatestPlanContext(scope, process.env.SENDER);
    await Bun.write(process.env.RESULT_FILE, JSON.stringify(plan ?? null));
  }
`;

function spawnWorker(home: string, values: Readonly<Record<string, string>>) {
  return Bun.spawn([process.execPath, "-e", WORKER_SCRIPT], {
    cwd: path.resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      ACCOUNT: "account-a",
      PROFILE: "profile-a",
      ...values,
      HOME: home,
    },
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
}

async function waitUntilReady(worker: ReturnType<typeof spawnWorker>): Promise<void> {
  const reader = worker.stdout.getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(chunk.value)).toContain("READY");
}

async function releaseTogether(workers: readonly ReturnType<typeof spawnWorker>[]): Promise<void> {
  for (const worker of workers) {
    worker.stdin.write("go\n");
    worker.stdin.end();
  }
  await Promise.all(workers.map((worker) => worker.exited));
  for (const worker of workers) expect(worker.exitCode).toBe(0);
}

function readPlans(
  databaseFile: string,
  accountId = "account-a",
  profileId = "profile-a",
): Record<string, unknown> {
  const database = new Database(databaseFile, { strict: true });
  const rows = database.query<
    { readonly payload: string; readonly sender_id: string },
    [string, string]
  >(`
    SELECT sender_id, payload FROM omo_plan_context
    WHERE account_id = ? AND profile_id = ?
    ORDER BY sender_id
  `).all(accountId, profileId);
  database.close();
  const plans: Record<string, unknown> = {};
  for (const row of rows) plans[row.sender_id] = JSON.parse(row.payload);
  return plans;
}

describe("OMO plan context cross-process persistence", () => {
  test("isolates the same sender across account and profile scopes", async () => {
    // Given
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-plan-scope-"));
    const first = spawnWorker(home, {
      ACTION: "save",
      PLAN: "plan-a",
      REQUEST: "request-a",
      SAVED_AT: "2026-07-13T00:00:00.000Z",
      SENDER: "shared-sender",
    });
    const second = spawnWorker(home, {
      ACCOUNT: "account-b",
      ACTION: "save",
      PLAN: "plan-b",
      PROFILE: "profile-b",
      REQUEST: "request-b",
      SAVED_AT: "2026-07-13T00:01:00.000Z",
      SENDER: "shared-sender",
    });
    await Promise.all([waitUntilReady(first), waitUntilReady(second)]);

    // When
    await releaseTogether([first, second]);

    // Then
    const databaseFile = path.join(home, ".claude", "channels", "wechat", "bot_state.sqlite");
    expect(readPlans(databaseFile)).toMatchObject({
      "shared-sender": { planResponse: "plan-a" },
    });
    expect(readPlans(databaseFile, "account-b", "profile-b")).toMatchObject({
      "shared-sender": { planResponse: "plan-b" },
    });
    fs.rmSync(home, { force: true, recursive: true });
  });

  test("retains both senders when two ready processes save concurrently", async () => {
    // Given
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-plan-save-"));
    const first = spawnWorker(home, {
      ACTION: "save",
      PLAN: "plan-a",
      REQUEST: "request-a",
      SAVED_AT: "2026-07-13T00:00:00.000Z",
      SENDER: "sender-a",
    });
    const second = spawnWorker(home, {
      ACTION: "save",
      PLAN: "plan-b",
      REQUEST: "request-b",
      SAVED_AT: "2026-07-13T00:01:00.000Z",
      SENDER: "sender-b",
    });
    await Promise.all([waitUntilReady(first), waitUntilReady(second)]);

    // When
    await releaseTogether([first, second]);

    // Then
    const databaseFile = path.join(home, ".claude", "channels", "wechat", "bot_state.sqlite");
    expect(readPlans(databaseFile)).toEqual({
      "sender-a": {
        originalRequest: "request-a",
        planResponse: "plan-a",
        savedAt: "2026-07-13T00:00:00.000Z",
      },
      "sender-b": {
        originalRequest: "request-b",
        planResponse: "plan-b",
        savedAt: "2026-07-13T00:01:00.000Z",
      },
    });
    fs.rmSync(home, { force: true, recursive: true });
  });

  test("applies a sender delete and a different sender save without lost updates", async () => {
    // Given
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-plan-delete-"));
    const stateDirectory = path.join(home, ".claude", "channels", "wechat");
    const legacyFile = path.join(stateDirectory, "omo_plan_context.json");
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify({
      "sender-a": {
        originalRequest: "request-a",
        planResponse: "plan-a",
        savedAt: "2026-07-13T00:00:00.000Z",
      },
      "sender-b": {
        originalRequest: "request-b",
        planResponse: "plan-b",
        savedAt: "2026-07-13T00:01:00.000Z",
      },
    }));
    const deleting = spawnWorker(home, { ACTION: "delete", SENDER: "sender-a" });
    const saving = spawnWorker(home, {
      ACTION: "save",
      PLAN: "plan-c",
      REQUEST: "request-c",
      SAVED_AT: "2026-07-13T00:02:00.000Z",
      SENDER: "sender-c",
    });
    await Promise.all([waitUntilReady(deleting), waitUntilReady(saving)]);

    // When
    await releaseTogether([deleting, saving]);

    // Then
    const databaseFile = path.join(stateDirectory, "bot_state.sqlite");
    expect(readPlans(databaseFile)).toEqual({
      "sender-b": {
        originalRequest: "request-b",
        planResponse: "plan-b",
        savedAt: "2026-07-13T00:01:00.000Z",
      },
      "sender-c": {
        originalRequest: "request-c",
        planResponse: "plan-c",
        savedAt: "2026-07-13T00:02:00.000Z",
      },
    });
    fs.rmSync(home, { force: true, recursive: true });
  });
});
