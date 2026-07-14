import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { handleLocalCommand } from "../core/local-command-handler";
import { parseLocalCommand } from "../core/local-command";
import { OpencodeDiscovery } from "../opencode/discovery";
import type {
  DiscoveryListKind,
  DiscoverySnapshot,
  DiscoverySnapshotStore,
} from "../opencode/discovery-types";
import {
  UserSessionManager,
} from "../opencode/user-session-manager";
import type { UserSessionStateStore } from "../opencode/user-session-manager";
import { OpencodeTransportManager } from "../opencode/client";
import type { OpencodeTransport } from "../opencode/client";
import type { BindingService } from "../storage/binding-types";
import type {
  AccountScopeInput,
  BotBinding,
} from "../storage/bot-state-types";

const SCOPE: AccountScopeInput = { accountId: "account-a", profileId: "profile-a" };

class MemoryState implements UserSessionStateStore {
  readonly bindings = new Map<string, BotBinding>();

  async getBinding(_scope: AccountScopeInput, senderId: string): Promise<BotBinding | undefined> {
    return this.bindings.get(senderId);
  }

  async putBinding(_scope: AccountScopeInput, binding: BotBinding): Promise<void> {
    this.bindings.set(binding.senderId, binding);
  }
}

function memorySnapshots(): DiscoverySnapshotStore {
  const snapshots = new Map<DiscoveryListKind, DiscoverySnapshot>();
  return {
    async invalidateProjectChange() {
      snapshots.clear();
    },
    async load(kind) {
      return snapshots.get(kind);
    },
    async save(snapshot) {
      snapshots.set(snapshot.kind, snapshot);
    },
  };
}

function transportFor(serverUrl: string, close: () => void): OpencodeTransport {
  return {
    agents: [
      { id: "sisyphus", mode: "primary" },
      { id: "prometheus", mode: "primary" },
    ],
    authHeader: "Basic test",
    close,
    serverUrl,
  };
}

function binding(
  senderId: string,
  directory: string,
  overrides: Partial<BotBinding> = {},
): BotBinding {
  return {
    bindingId: `binding-${senderId}`,
    boundAt: 1,
    directory,
    replyStyle: "standard",
    senderId,
    sessionId: "session-old",
    ...overrides,
  };
}

function createBindingService(overrides: Partial<BindingService> = {}): BindingService {
  return {
    async consumeCode() {
      return { status: "invalid" };
    },
    async generateCode() {
      return { code: "000000", createdAt: 0, expiresAt: 1 };
    },
    async listBindings() {
      return [];
    },
    async revoke() {
      return false;
    },
    ...overrides,
  };
}

async function withFixture(run: (params: {
  readonly deps: Parameters<typeof handleLocalCommand>[0]["deps"];
  readonly directory: string;
  readonly sessions: UserSessionManager;
  readonly state: MemoryState;
  readonly stop: () => void;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "opencode-wechat-local-cmd-"));
  const directory = join(root, "project-a");
  await mkdir(directory);
  const state = new MemoryState();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/session" || url.pathname.startsWith("/session/")) {
        if (request.method === "GET") {
          return Response.json({ id: url.pathname.split("/").pop() });
        }
        return Response.json({ id: `session-${Date.now()}` });
      }
      if (url.pathname === "/project") {
        return Response.json([{ worktree: directory }]);
      }
      if (url.pathname === "/config/providers") {
        return Response.json({
          providers: [
            {
              id: "openai",
              models: {
                "gpt-5": { id: "gpt-5", name: "GPT-5", variants: { high: {}, low: {} } },
                "gpt-4": { id: "gpt-4", name: "GPT-4", variants: {} },
              },
            },
          ],
        });
      }
      if (url.pathname === "/agent") {
        return Response.json([
          { name: "sisyphus", mode: "primary" },
          { name: "prometheus", mode: "primary" },
        ]);
      }
      return new Response("not found", { status: 404 });
    },
  });
  const manager = new OpencodeTransportManager(
    transportFor(server.url.toString(), () => server.stop(true)),
    async () => {
      throw new Error("not used");
    },
  );
  const discovery = new OpencodeDiscovery({
    connection: () => manager.current(),
    snapshots: memorySnapshots(),
  });
  const sessions = new UserSessionManager({
    clearPlan() {},
    defaultDirectory: directory,
    isVariantCompatible: async (_directory, _model, variant) => variant === "high" || variant === "low",
    manager,
    scope: SCOPE,
    state,
  });
  const deps = {
    bindingService: createBindingService(),
    defaultDirectory: directory,
    discovery,
    scope: SCOPE,
    sessions,
  };
  try {
    await run({ deps, directory, sessions, state, stop: () => manager.close() });
  } finally {
    manager.close();
    await rm(root, { force: true, recursive: true });
  }
}

describe("handleLocalCommand", () => {
  test("returns help without requiring a binding", async () => {
    await withFixture(async ({ deps }) => {
      const command = parseLocalCommand("/帮助");
      if (command.kind === "error" || command.kind === "non_local") throw new Error("parse failed");
      const result = await handleLocalCommand({
        command,
        deps,
        senderId: "sender-unbound",
      });
      expect(result.kind).toBe("help");
      expect(result.reply).toContain("OpenCode 机器人命令");
      expect(result.reply).toContain("/bind 六位码");
      expect(result.reply).not.toContain("**");
    });
  });

  test("binds a sender and returns the activation message", async () => {
    await withFixture(async ({ deps, directory, state }) => {
      const created = binding("sender-a", directory);
      const localDeps = {
        ...deps,
        bindingService: createBindingService({
          async consumeCode(_scope, senderId, code) {
            expect(senderId).toBe("sender-a");
            expect(code).toBe("012345");
            state.bindings.set(senderId, created);
            return { binding: created, status: "bound" };
          },
        }),
      };
      const command = parseLocalCommand("/bind 012345");
      if (command.kind === "error" || command.kind === "non_local") throw new Error("parse failed");
      const result = await handleLocalCommand({
        command,
        deps: localDeps,
        senderId: "sender-a",
      });
      expect(result.kind).toBe("bind");
      expect(result.reply).toContain("微信 Bot 已激活");
      expect(result.reply).toContain("/帮助");
    });
  });

  test("blocks privileged commands for unbound senders", async () => {
    await withFixture(async ({ deps }) => {
      const command = parseLocalCommand("/状态");
      if (command.kind === "error" || command.kind === "non_local") throw new Error("parse failed");
      const result = await handleLocalCommand({
        command,
        deps,
        senderId: "sender-unbound",
      });
      expect(result.kind).toBe("unbound");
      expect(result.reply).toContain("/bind 123456");
      expect(result.reply).not.toContain("**");
    });
  });

  test("lists and selects models, modes, reply styles for a bound sender", async () => {
    await withFixture(async ({ deps, directory, state }) => {
      state.bindings.set("sender-a", binding("sender-a", directory));

      const listModel = parseLocalCommand("/模型");
      if (listModel.kind === "error" || listModel.kind === "non_local") throw new Error("parse failed");
      const listed = await handleLocalCommand({
        command: listModel,
        deps,
        senderId: "sender-a",
      });
      expect(listed.reply).toContain("可选模型：");
      expect(listed.reply).toContain("openai/gpt-5");

      const setModel = parseLocalCommand("/模型 openai/gpt-5");
      if (setModel.kind === "error" || setModel.kind === "non_local") throw new Error("parse failed");
      const modeled = await handleLocalCommand({
        command: setModel,
        deps,
        senderId: "sender-a",
      });
      expect(modeled.reply).toContain("openai/gpt-5");
      expect(state.bindings.get("sender-a")?.model).toEqual({
        modelId: "gpt-5",
        providerId: "openai",
      });

      const setMode = parseLocalCommand("/模式 sisyphus");
      if (setMode.kind === "error" || setMode.kind === "non_local") throw new Error("parse failed");
      const moded = await handleLocalCommand({
        command: setMode,
        deps,
        senderId: "sender-a",
      });
      expect(moded.reply).toContain("sisyphus");
      expect(state.bindings.get("sender-a")?.agent).toBe("sisyphus");

      const setReply = parseLocalCommand("/回复 详细");
      if (setReply.kind === "error" || setReply.kind === "non_local") throw new Error("parse failed");
      const replied = await handleLocalCommand({
        command: setReply,
        deps,
        senderId: "sender-a",
      });
      expect(replied.reply).toContain("详细");
      expect(state.bindings.get("sender-a")?.replyStyle).toBe("detailed");
    });
  });

  test("starts a new session draft while retaining preferences", async () => {
    await withFixture(async ({ deps, directory, state }) => {
      state.bindings.set("sender-a", binding("sender-a", directory, {
        agent: "sisyphus",
        model: { modelId: "gpt-5", providerId: "openai" },
        replyStyle: "detailed",
        sessionId: "session-old",
      }));
      const command = parseLocalCommand("/新建");
      if (command.kind === "error" || command.kind === "non_local") throw new Error("parse failed");
      const result = await handleLocalCommand({
        command,
        deps,
        senderId: "sender-a",
      });
      expect(result.kind).toBe("new_session");
      expect(result.reply).toContain("已开始新的任务草稿");
      const next = state.bindings.get("sender-a");
      expect(next?.agent).toBe("sisyphus");
      expect(next?.replyStyle).toBe("detailed");
      expect(next?.sessionId).not.toBe("session-old");
    });
  });

  test("reports status with truncated session id", async () => {
    await withFixture(async ({ deps, directory, state }) => {
      state.bindings.set("sender-a", binding("sender-a", directory, {
        agent: "sisyphus",
        model: { modelId: "gpt-5", providerId: "openai" },
        sessionId: "ses_1234567890",
        variant: "high",
      }));
      const command = parseLocalCommand("/状态");
      if (command.kind === "error" || command.kind === "non_local") throw new Error("parse failed");
      const result = await handleLocalCommand({
        command,
        deps,
        senderId: "sender-a",
      });
      expect(result.reply).toContain("OpenCode 机器人状态");
      expect(result.reply).toContain("已绑定");
      expect(result.reply).toContain("openai/gpt-5");
      expect(result.reply).toContain("sisyphus");
      expect(result.reply).not.toContain("token");
    });
  });
});
