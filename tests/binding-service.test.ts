import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createBindingService } from "../storage/binding-service";
import { BotStateStore } from "../storage/bot-state";

const SCOPE = { accountId: "account-a", profileId: "profile-a" } as const;
const DIGEST_KEY = "11".repeat(32);

function makeFixture(options: {
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly randomInt?: (maxExclusive: number) => number;
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-binding-"));
  const databaseFile = path.join(directory, "state.sqlite");
  const store = new BotStateStore({ databaseFile });
  const service = createBindingService({
    digestKey: DIGEST_KEY,
    store,
    ...options,
  });
  return { databaseFile, directory, service, store };
}

describe("binding service", () => {
  test("generates leading-zero-safe codes and replaces the previous active code", async () => {
    // Given
    const values = [0, 123_456];
    const fixture = makeFixture({
      now: () => 1_000,
      randomId: () => "pending-id",
      randomInt: () => values.shift() ?? 0,
    });

    // When
    const first = await fixture.service.generateCode(SCOPE);
    const second = await fixture.service.generateCode(SCOPE);

    // Then
    expect(first).toEqual({ code: "000000", createdAt: 1_000, expiresAt: 601_000 });
    expect(second.code).toBe("123456");
    expect((await fixture.store.getAccount(SCOPE)).pendingCodes).toHaveLength(1);
    expect(JSON.stringify(await fixture.store.getAccount(SCOPE))).not.toContain("000000");
    expect((await fixture.service.consumeCode(SCOPE, "sender-a", first.code)).status).toBe("invalid");
    fixture.store.close();
    fs.rmSync(fixture.directory, { force: true, recursive: true });
  });

  test("expires at exactly 600000ms while accepting the preceding millisecond", async () => {
    // Given
    let now = 0;
    const valid = makeFixture({ now: () => now, randomInt: () => 1 });
    const validCode = await valid.service.generateCode(SCOPE);
    now = 599_999;
    const accepted = await valid.service.consumeCode(SCOPE, "sender-a", validCode.code);
    const expired = makeFixture({ now: () => now, randomInt: () => 2 });
    now = 0;
    const expiredCode = await expired.service.generateCode(SCOPE);

    // When
    now = 600_000;
    const rejected = await expired.service.consumeCode(SCOPE, "sender-b", expiredCode.code);

    // Then
    expect(accepted.status).toBe("bound");
    expect(rejected.status).toBe("expired");
    expect(await expired.store.getBinding(SCOPE, "sender-b")).toBeUndefined();
    valid.store.close();
    expired.store.close();
    fs.rmSync(valid.directory, { force: true, recursive: true });
    fs.rmSync(expired.directory, { force: true, recursive: true });
  });

  test("rate limits wrong attempts per sender and code without creating a binding", async () => {
    // Given
    const fixture = makeFixture({ randomInt: () => 123_456 });
    const generated = await fixture.service.generateCode(SCOPE);

    // When
    const results = await Promise.all([
      fixture.service.consumeCode(SCOPE, "sender-a", "999999"),
      fixture.service.consumeCode(SCOPE, "sender-a", "999999"),
      fixture.service.consumeCode(SCOPE, "sender-a", "999999"),
    ]);

    // Then
    expect(results.map((result) => result.status)).toEqual([
      "invalid",
      "invalid",
      "rate-limited",
    ]);
    expect(await fixture.store.getBinding(SCOPE, "sender-a")).toBeUndefined();
    expect((await fixture.service.consumeCode(SCOPE, "sender-b", generated.code)).status).toBe("bound");
    fixture.store.close();
    fs.rmSync(fixture.directory, { force: true, recursive: true });
  });

  test("lists redacted active bindings and revoke retains Session preferences", async () => {
    // Given
    let id = 0;
    const fixture = makeFixture({
      now: () => 10,
      randomId: () => `opaque-${id += 1}`,
      randomInt: () => 42,
    });
    const generated = await fixture.service.generateCode(SCOPE);
    await fixture.service.consumeCode(SCOPE, "private-sender-1234", generated.code);
    const binding = await fixture.store.getBinding(SCOPE, "private-sender-1234");
    if (binding === undefined) throw new Error("binding fixture missing");
    await fixture.store.putBinding(SCOPE, {
      ...binding,
      directory: "/tmp/project",
      sessionId: "session-preserved",
      variant: "high",
    });
    const listed = await fixture.service.listBindings(SCOPE);

    // When
    const revoked = await fixture.service.revoke(SCOPE, listed[0]?.bindingId ?? "missing");

    // Then
    expect(revoked).toBe(true);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("private-sender-1234");
    expect(JSON.stringify(listed)).not.toContain(generated.code);
    expect(JSON.stringify(listed)).not.toContain("keyedDigest");
    expect(await fixture.service.listBindings(SCOPE)).toEqual([]);
    expect(await fixture.store.getBinding(SCOPE, "private-sender-1234")).toMatchObject({
      sessionId: "session-preserved",
      variant: "high",
    });
    fixture.store.close();
    fs.rmSync(fixture.directory, { force: true, recursive: true });
  });

  test("is idempotent for an active sender and reactivation preserves retained state", async () => {
    // Given
    let now = 10;
    const fixture = makeFixture({ now: () => now, randomInt: () => 8 });
    const firstCode = await fixture.service.generateCode(SCOPE);
    const first = await fixture.service.consumeCode(SCOPE, "sender-a", firstCode.code);
    if (first.status !== "bound") throw new Error("binding fixture missing");
    await fixture.store.putBinding(SCOPE, {
      ...first.binding,
      directory: "/tmp/project",
      sessionId: "session-retained",
    });
    const idempotent = await fixture.service.consumeCode(SCOPE, "sender-a", "999999");
    await fixture.service.revoke(SCOPE, first.binding.bindingId);
    now = 20;
    const secondCode = await fixture.service.generateCode(SCOPE);

    // When
    const reactivated = await fixture.service.consumeCode(SCOPE, "sender-a", secondCode.code);

    // Then
    expect(idempotent.status).toBe("already-bound");
    expect(reactivated.status).toBe("bound");
    if (reactivated.status === "bound") {
      expect(reactivated.binding).toMatchObject({
        bindingId: first.binding.bindingId,
        directory: "/tmp/project",
        sessionId: "session-retained",
      });
      expect(reactivated.binding.revokedAt).toBeUndefined();
    }
    fixture.store.close();
    fs.rmSync(fixture.directory, { force: true, recursive: true });
  });

  test("shares a persisted digest key across service instances", async () => {
    // Given
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-binding-key-"));
    const databaseFile = path.join(directory, "state.sqlite");
    const firstStore = new BotStateStore({ databaseFile });
    const firstService = createBindingService({ randomInt: () => 9, store: firstStore });
    const generated = await firstService.generateCode(SCOPE);
    firstStore.close();
    const secondStore = new BotStateStore({ databaseFile });
    const secondService = createBindingService({ store: secondStore });

    // When
    const consumed = await secondService.consumeCode(SCOPE, "sender-a", generated.code);

    // Then
    expect(consumed.status).toBe("bound");
    secondStore.close();
    fs.rmSync(directory, { force: true, recursive: true });
  });

  test("allows only one of two processes to consume the same code", async () => {
    // Given
    const fixture = makeFixture({ randomInt: () => 7 });
    const generated = await fixture.service.generateCode(SCOPE);
    fixture.store.close();
    const workerScript = `
      const { BotStateStore } = await import("./storage/bot-state.ts");
      const { createBindingService } = await import("./storage/binding-service.ts");
      console.log("READY");
      for await (const chunk of Bun.stdin.stream()) { if (chunk.byteLength > 0) break; }
      const store = new BotStateStore({ databaseFile: process.env.DATABASE_FILE });
      const service = createBindingService({ digestKey: process.env.DIGEST_KEY, store });
      const result = await service.consumeCode(
        { accountId: "account-a", profileId: "profile-a" },
        process.env.SENDER,
        process.env.CODE,
      );
      await Bun.write(process.env.RESULT_FILE, result.status);
      store.close();
    `;
    const spawn = (sender: string, resultFile: string) => Bun.spawn(
      [process.execPath, "-e", workerScript],
      {
        cwd: path.resolve(import.meta.dir, ".."),
        env: {
          ...process.env,
          CODE: generated.code,
          DATABASE_FILE: fixture.databaseFile,
          DIGEST_KEY,
          RESULT_FILE: resultFile,
          SENDER: sender,
        },
        stdin: "pipe",
        stdout: "pipe",
      },
    );
    const firstFile = path.join(fixture.directory, "first.result");
    const secondFile = path.join(fixture.directory, "second.result");
    const first = spawn("sender-a", firstFile);
    const second = spawn("sender-b", secondFile);
    const ready = async (worker: typeof first) => {
      const reader = worker.stdout.getReader();
      const chunk = await reader.read();
      reader.releaseLock();
      expect(new TextDecoder().decode(chunk.value)).toContain("READY");
    };
    await Promise.all([ready(first), ready(second)]);

    // When
    first.stdin.write("go\n");
    second.stdin.write("go\n");
    first.stdin.end();
    second.stdin.end();
    await Promise.all([first.exited, second.exited]);

    // Then
    const statuses = [
      fs.readFileSync(firstFile, "utf-8"),
      fs.readFileSync(secondFile, "utf-8"),
    ];
    expect(statuses.filter((status) => status === "bound")).toHaveLength(1);
    expect(statuses.filter((status) => status === "invalid")).toHaveLength(1);
    fs.rmSync(fixture.directory, { force: true, recursive: true });
  });
});
