import type { OpencodeConnection, OpencodeModel } from "./types";

export type DiscoveryListKind = "agent" | "model" | "project" | "variant";

export type DiscoverySnapshot = {
  readonly directory: string;
  readonly kind: DiscoveryListKind;
  readonly scope: string;
  readonly values: readonly string[];
};

export interface DiscoverySnapshotStore {
  load(kind: DiscoveryListKind): Promise<DiscoverySnapshot | undefined>;
  save(snapshot: DiscoverySnapshot): Promise<void>;
  invalidateProjectChange(previousDirectory: string): Promise<void>;
}

export type ProjectOption = {
  readonly path: string;
};

export type ModelOption = {
  readonly modelID: string;
  readonly name: string;
  readonly providerID: string;
  readonly value: string;
  readonly variants: readonly string[];
};

export type AgentOption = {
  readonly name: string;
  readonly value: string;
};

export type ReconciledModelSelection = {
  readonly model: OpencodeModel;
  readonly variant?: string;
};

export type OpencodeDiscoveryOptions = {
  readonly connection: () => OpencodeConnection;
  readonly snapshots: DiscoverySnapshotStore;
};
