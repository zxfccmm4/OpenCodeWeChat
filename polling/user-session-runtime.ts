import { realpathSync } from "node:fs";
import type { AccountData } from "../types/wechat";
import type { OpencodeRuntime } from "../opencode/client";
import { OpencodeDiscovery } from "../opencode/discovery";
import type {
  DiscoveryListKind,
  DiscoverySnapshot,
  DiscoverySnapshotStore,
} from "../opencode/discovery-types";
import { UserSessionManager } from "../opencode/user-session-manager";
import { DEFAULT_BINDING_SERVICE } from "../storage/binding-service";
import { DEFAULT_BOT_STATE_STORE } from "../storage/bot-state";
import { deleteLatestPlanContext } from "../storage/omo-plan-context";
import type { LocalCommandRuntime } from "./message-processor-types";

/** In-memory snapshots so `/模型 1` style numeric selectors work after a list command. */
export function createMemoryDiscoverySnapshots(): DiscoverySnapshotStore {
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

export type PollingUserRuntime = {
  readonly discovery: OpencodeDiscovery;
  readonly localCommands: LocalCommandRuntime;
  readonly userSessions: UserSessionManager;
};

export function createPollingUserRuntime(
  account: AccountData,
  runtime: OpencodeRuntime,
): PollingUserRuntime {
  const scope = {
    accountId: account.accountId,
    profileId: account.userId?.trim() || account.accountId,
  };
  const defaultDirectory = realpathSync(runtime.session.directory ?? process.cwd());
  const discovery = new OpencodeDiscovery({
    connection: () => runtime.manager.current(),
    snapshots: createMemoryDiscoverySnapshots(),
  });
  const userSessions = new UserSessionManager({
    clearPlan(clearScope, senderId) {
      deleteLatestPlanContext(clearScope, senderId);
    },
    defaultDirectory,
    isVariantCompatible(directory, model, variant) {
      return discovery.isVariantCompatible(directory, model, variant);
    },
    manager: runtime.manager,
    scope,
    state: DEFAULT_BOT_STATE_STORE,
  });
  const localCommands: LocalCommandRuntime = {
    bindingService: DEFAULT_BINDING_SERVICE,
    defaultDirectory,
    discovery,
    scope,
    sessions: userSessions,
  };
  return { discovery, localCommands, userSessions };
}

/** @deprecated Prefer createPollingUserRuntime */
export function createPollingUserSessions(
  account: AccountData,
  runtime: OpencodeRuntime,
): UserSessionManager {
  return createPollingUserRuntime(account, runtime).userSessions;
}
