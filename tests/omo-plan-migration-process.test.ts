import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

const MIGRATION_WORKER = `
  console.log("READY");
  for await (const chunk of Bun.stdin.stream()) {
    if (chunk.byteLength > 0) break;
  }
  const store = await import("./storage/omo-plan-context.ts");
  const scope = { accountId: process.env.ACCOUNT, profileId: process.env.PROFILE };
  if (process.env.ACTION === "delete") {
    store.deleteLatestPlanContext(scope, process.env.SENDER);
  } else {
    const plan = store.getLatestPlanContext(scope, process.env.SENDER);
    await Bun.write(process.env.RESULT_FILE, JSON.stringify(plan ?? null));
  }
`;

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-plan-migration-"));
}

function legacyFile(home: string): string {
  return path.join(home, ".claude", "channels", "wechat", "omo_plan_context.json");
}

function databaseFile(home: string): string {
  return path.join(home, ".claude", "channels", "wechat", "bot_state.sqlite");
}

function writeLegacyPlan(home: string): void {
  const file = legacyFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    "shared-sender": {
      originalRequest: "legacy-request",
      planResponse: "legacy-plan",
      savedAt: "2026-07-13T00:00:00.000Z",
    },
  }));
}

function spawnMigrationWorker(
  home: string,
  values: Readonly<Record<string, string>>,
) {
  return Bun.spawn([process.execPath, "-e", MIGRATION_WORKER], {
    cwd: path.resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      ACCOUNT: "account-a",
      PROFILE: "profile-a",
      SENDER: "shared-sender",
      ...values,
      HOME: home,
    },
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
}

async function waitReady(worker: ReturnType<typeof spawnMigrationWorker>): Promise<void> {
  const reader = worker.stdout.getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(chunk.value)).toContain("READY");
}

async function releaseWorkers(
  workers: readonly ReturnType<typeof spawnMigrationWorker>[],
): Promise<void> {
  for (const worker of workers) {
    worker.stdin.write("go\n");
    worker.stdin.end();
  }
  await Promise.all(workers.map((worker) => worker.exited));
  for (const worker of workers) expect(worker.exitCode).toBe(0);
}

async function runWorker(
  home: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const worker = spawnMigrationWorker(home, values);
  await waitReady(worker);
  await releaseWorkers([worker]);
}

describe("OMO legacy migration", () => {
  test("does not resurrect a deleted plan in a fresh process", async () => {
    // Given
    const home = makeHome();
    writeLegacyPlan(home);
    const firstResult = path.join(home, "first.json");
    await runWorker(home, { ACTION: "get", RESULT_FILE: firstResult });
    expect(JSON.parse(fs.readFileSync(firstResult, "utf-8"))).toMatchObject({
      planResponse: "legacy-plan",
    });
    await runWorker(home, { ACTION: "delete" });
    const freshResult = path.join(home, "fresh.json");

    // When
    await runWorker(home, { ACTION: "get", RESULT_FILE: freshResult });

    // Then
    expect(JSON.parse(fs.readFileSync(freshResult, "utf-8"))).toBeNull();
    fs.rmSync(home, { force: true, recursive: true });
  });

  test("does not expose migrated plans after an account switch", async () => {
    // Given
    const home = makeHome();
    writeLegacyPlan(home);
    const firstResult = path.join(home, "account-a.json");
    await runWorker(home, { ACTION: "get", RESULT_FILE: firstResult });
    const switchedResult = path.join(home, "account-b.json");

    // When
    await runWorker(home, {
      ACCOUNT: "account-b",
      ACTION: "get",
      PROFILE: "profile-b",
      RESULT_FILE: switchedResult,
    });

    // Then
    expect(JSON.parse(fs.readFileSync(firstResult, "utf-8"))).toMatchObject({
      planResponse: "legacy-plan",
    });
    expect(JSON.parse(fs.readFileSync(switchedResult, "utf-8"))).toBeNull();
    fs.rmSync(home, { force: true, recursive: true });
  });

  test("imports once when two fresh processes migrate concurrently", async () => {
    // Given
    const home = makeHome();
    writeLegacyPlan(home);
    const firstResult = path.join(home, "first.json");
    const secondResult = path.join(home, "second.json");
    const first = spawnMigrationWorker(home, { ACTION: "get", RESULT_FILE: firstResult });
    const second = spawnMigrationWorker(home, { ACTION: "get", RESULT_FILE: secondResult });
    await Promise.all([waitReady(first), waitReady(second)]);

    // When
    await releaseWorkers([first, second]);

    // Then
    expect(JSON.parse(fs.readFileSync(firstResult, "utf-8"))).toMatchObject({
      planResponse: "legacy-plan",
    });
    expect(JSON.parse(fs.readFileSync(secondResult, "utf-8"))).toMatchObject({
      planResponse: "legacy-plan",
    });
    const database = new Database(databaseFile(home), { readonly: true, strict: true });
    expect(database.query("SELECT COUNT(*) AS count FROM state_metadata").get()).toEqual({ count: 1 });
    expect(database.query("SELECT COUNT(*) AS count FROM omo_plan_context").get()).toEqual({ count: 1 });
    database.close();
    fs.rmSync(home, { force: true, recursive: true });
  });

  test("keeps the migration marker when post-commit archive fails", async () => {
    // Given
    const home = makeHome();
    writeLegacyPlan(home);
    fs.mkdirSync(`${legacyFile(home)}.migrated`);
    const firstResult = path.join(home, "first.json");
    await runWorker(home, { ACTION: "get", RESULT_FILE: firstResult });
    expect(fs.existsSync(legacyFile(home))).toBe(true);
    await runWorker(home, { ACTION: "delete" });
    const freshResult = path.join(home, "fresh.json");

    // When
    await runWorker(home, { ACTION: "get", RESULT_FILE: freshResult });

    // Then
    expect(JSON.parse(fs.readFileSync(freshResult, "utf-8"))).toBeNull();
    const database = new Database(databaseFile(home), { readonly: true, strict: true });
    expect(database.query("SELECT COUNT(*) AS count FROM state_metadata").get()).toEqual({ count: 1 });
    database.close();
    fs.rmSync(home, { force: true, recursive: true });
  });
});
