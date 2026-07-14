import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { BotStateStore } from "../storage/bot-state";
import type {
  AccountScopeInput,
  BotBinding,
  PendingBindingCode,
} from "../storage/bot-state-types";

const SCOPE_A: AccountScopeInput = { accountId: "account-a", profileId: "profile-a" };
const SCOPE_B: AccountScopeInput = { accountId: "account-b", profileId: "profile-b" };
const BINDING_A: BotBinding = {
  agent: "Sisyphus",
  bindingId: "binding-a",
  boundAt: 1_752_384_000_000,
  directory: "/tmp/project-a",
  model: { modelId: "gpt-5", providerId: "openai" },
  replyStyle: "detailed",
  senderId: "sender-a",
  sessionId: "session-a",
  variant: "high",
};

function makeStoreFiles(): { readonly databaseFile: string; readonly directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-sqlite-"));
  return { databaseFile: path.join(directory, "state.sqlite"), directory };
}

describe("BotStateStore SQLite persistence", () => {
  test("persists account-scoped preferences and Session descriptors privately", async () => {
    // Given
    const files = makeStoreFiles();
    const store = new BotStateStore(files);

    // When
    await store.putBinding(SCOPE_A, BINDING_A);

    // Then
    expect(await store.getBinding(SCOPE_A, "sender-a")).toEqual(BINDING_A);
    expect(await store.getBinding(SCOPE_B, "sender-a")).toBeUndefined();
    expect(fs.statSync(files.databaseFile).mode & 0o777).toBe(0o600);
    for (const suffix of ["-wal", "-shm"]) {
      const artifact = `${files.databaseFile}${suffix}`;
      if (fs.existsSync(artifact)) expect(fs.statSync(artifact).mode & 0o777).toBe(0o600);
    }
    store.close();
    fs.rmSync(files.directory, { force: true, recursive: true });
  });

  test("makes committed mutations visible to another store connection", async () => {
    // Given
    const files = makeStoreFiles();
    const writer = new BotStateStore(files);
    const reader = new BotStateStore(files);
    await writer.putBinding(SCOPE_A, BINDING_A);

    // When
    const observed = await reader.getBinding(SCOPE_A, "sender-a");

    // Then
    expect(observed).toEqual(BINDING_A);
    writer.close();
    reader.close();
    fs.rmSync(files.directory, { force: true, recursive: true });
  });

  test("serializes concurrent pending-code consumption", async () => {
    // Given
    const files = makeStoreFiles();
    const first = new BotStateStore(files);
    const second = new BotStateStore(files);
    const pending: PendingBindingCode = {
      attemptsBySender: {},
      createdAt: 1,
      expiresAt: 2,
      id: "pending-1",
      keyedDigest: "sha256:keyed-digest-only",
    };
    await first.mutateAccount(SCOPE_A, (state) => ({
      result: undefined,
      state: { ...state, pendingCodes: [pending] },
    }));
    const consume = (store: BotStateStore): Promise<boolean> => store.mutateAccount(
      SCOPE_A,
      (state) => {
        const exists = state.pendingCodes.some((item) => item.id === pending.id);
        return {
          result: exists,
          state: exists
            ? { ...state, pendingCodes: state.pendingCodes.filter((item) => item.id !== pending.id) }
            : state,
        };
      },
    );

    // When
    const results = await Promise.all([consume(first), consume(second)]);

    // Then
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await first.getAccount(SCOPE_A)).pendingCodes).toEqual([]);
    first.close();
    second.close();
    fs.rmSync(files.directory, { force: true, recursive: true });
  });

  test("rolls back a failed mutation without changing prior state", async () => {
    // Given
    const files = makeStoreFiles();
    const store = new BotStateStore(files);
    await store.putBinding(SCOPE_A, BINDING_A);

    // When
    const mutation = store.mutateAccount(SCOPE_A, () => {
      throw new Error("injected mutation failure");
    });

    // Then
    await expect(mutation).rejects.toThrow("injected mutation failure");
    expect(await store.getBinding(SCOPE_A, "sender-a")).toEqual(BINDING_A);
    store.close();
    fs.rmSync(files.directory, { force: true, recursive: true });
  });

  test("fails closed when a persisted payload is malformed", async () => {
    // Given
    const files = makeStoreFiles();
    const store = new BotStateStore(files);
    await store.putBinding(SCOPE_A, BINDING_A);
    const database = new Database(files.databaseFile, { strict: true });
    database.query(`
      UPDATE account_state SET payload = ? WHERE account_id = ? AND profile_id = ?
    `).run("{}", SCOPE_A.accountId, SCOPE_A.profileId);
    database.close();

    // When
    const binding = await store.getBinding(SCOPE_A, "sender-a");

    // Then
    expect(binding).toBeUndefined();
    store.close();
    fs.rmSync(files.directory, { force: true, recursive: true });
  });

  test("rejects empty and unknown sender IDs before opening the database", async () => {
    // Given
    const files = makeStoreFiles();
    const store = new BotStateStore(files);

    // When
    const writes = [
      store.putBinding(SCOPE_A, { ...BINDING_A, senderId: "" }),
      store.putBinding(SCOPE_A, { ...BINDING_A, senderId: "unknown" }),
    ];

    // Then
    await expect(Promise.all(writes)).rejects.toThrow("senderId");
    expect(fs.existsSync(files.databaseFile)).toBe(false);
    fs.rmSync(files.directory, { force: true, recursive: true });
  });
});
