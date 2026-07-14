import { parseAgentOptions, parseModelOptions, parseProjectPaths } from "./discovery-parse";
import {
  canonicalizeDiscoveredPaths,
  canonicalizeProjectPath as canonicalizePath,
  ProjectPathError,
} from "./discovery-path";
import { requestJson } from "./http";
import type {
  AgentOption,
  DiscoveryListKind,
  DiscoverySnapshot,
  ModelOption,
  OpencodeDiscoveryOptions,
  ProjectOption,
  ReconciledModelSelection,
} from "./discovery-types";
import type { OpencodeModel } from "./types";

export class OpencodeDiscoveryError extends Error {
  readonly code: "invalid_path" | "invalid_selection" | "stale_snapshot";

  constructor(
    code: OpencodeDiscoveryError["code"],
    message: string,
  ) {
    super(message);
    this.name = "OpencodeDiscoveryError";
    this.code = code;
  }
}

export class OpencodeDiscovery {
  readonly #options: OpencodeDiscoveryOptions;
  readonly #agentCache = new Map<string, readonly AgentOption[]>();
  readonly #modelCache = new Map<string, readonly ModelOption[]>();

  constructor(options: OpencodeDiscoveryOptions) {
    this.#options = options;
  }

  async listProjects(directory: string): Promise<readonly ProjectOption[]> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const raw = await this.#get("/project", canonicalDirectory);
    const canonicalPaths = await canonicalizeDiscoveredPaths(parseProjectPaths(raw));
    const projects = sortedUnique(canonicalPaths).map((path) => ({ path }));
    await this.#saveSnapshot({
      directory: canonicalDirectory,
      kind: "project",
      scope: "projects",
      values: projects.map((item) => item.path),
    });
    return projects;
  }

  async selectProject(currentDirectory: string, selector: string): Promise<string> {
    const snapshotValue = await this.#snapshotValue("project", "projects", selector);
    let selected: string;
    try {
      selected = await canonicalizeProjectPath(snapshotValue ?? selector);
    } catch (error) {
      if (snapshotValue !== undefined && error instanceof OpencodeDiscoveryError) {
        throw staleSelection(selector);
      }
      throw error;
    }
    const current = await canonicalizeProjectPath(currentDirectory);
    if (selected === current) return selected;
    await this.#options.snapshots.invalidateProjectChange(current);
    this.#agentCache.clear();
    this.#modelCache.clear();
    return selected;
  }

  async listModels(directory: string): Promise<readonly ModelOption[]> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const models = await this.#models(canonicalDirectory);
    await this.#saveSnapshot({
      directory: canonicalDirectory,
      kind: "model",
      scope: canonicalDirectory,
      values: models.map((model) => model.value),
    });
    return models;
  }

  async selectModel(
    directory: string,
    selector: string,
    savedVariant?: string,
  ): Promise<ReconciledModelSelection> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const models = await this.#models(canonicalDirectory);
    const snapshotValue = await this.#snapshotValue("model", canonicalDirectory, selector);
    const selected = models.find((model) => model.value === (snapshotValue ?? selector.trim()));
    if (!selected) {
      if (snapshotValue !== undefined) throw staleSelection(selector);
      throw invalidSelection("model", selector);
    }
    const model = { modelID: selected.modelID, providerID: selected.providerID };
    return savedVariant && selected.variants.includes(savedVariant)
      ? { model, variant: savedVariant }
      : { model };
  }

  async listAgents(directory: string): Promise<readonly AgentOption[]> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const agents = await this.#agents(canonicalDirectory);
    await this.#saveSnapshot({
      directory: canonicalDirectory,
      kind: "agent",
      scope: canonicalDirectory,
      values: agents.map((agent) => agent.value),
    });
    return agents;
  }

  async selectAgent(directory: string, selector: string): Promise<string> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const agents = await this.#agents(canonicalDirectory);
    const snapshotValue = await this.#snapshotValue("agent", canonicalDirectory, selector);
    const value = snapshotValue ?? selector.trim();
    if (!agents.some((agent) => agent.value === value)) {
      if (snapshotValue !== undefined) throw staleSelection(selector);
      throw invalidSelection("agent", selector);
    }
    return value;
  }

  async listVariants(directory: string, model: OpencodeModel): Promise<readonly string[]> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const selected = await this.#findModel(canonicalDirectory, model);
    const scope = modelScope(canonicalDirectory, selected);
    await this.#saveSnapshot({
      directory: canonicalDirectory,
      kind: "variant",
      scope,
      values: selected.variants,
    });
    return selected.variants;
  }

  async isVariantCompatible(
    directory: string,
    model: OpencodeModel,
    variant: string,
  ): Promise<boolean> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    try {
      return (await this.#findModel(canonicalDirectory, model)).variants.includes(variant);
    } catch (error) {
      if (error instanceof OpencodeDiscoveryError && error.code === "invalid_selection") {
        return false;
      }
      throw error;
    }
  }

  async selectVariant(
    directory: string,
    model: OpencodeModel,
    selector: string,
  ): Promise<string> {
    const canonicalDirectory = await canonicalizeProjectPath(directory);
    const selectedModel = await this.#findModel(canonicalDirectory, model);
    const scope = modelScope(canonicalDirectory, selectedModel);
    const snapshotValue = await this.#snapshotValue("variant", scope, selector);
    const value = snapshotValue ?? selector.trim();
    if (!selectedModel.variants.includes(value)) {
      if (snapshotValue !== undefined) throw staleSelection(selector);
      throw invalidSelection("variant", selector);
    }
    return value;
  }

  async #get(path: string, directory: string): Promise<unknown> {
    const connection = this.#options.connection();
    const query = new URLSearchParams({ directory });
    return requestJson({
      authHeader: connection.authHeader,
      path: `${path}?${query.toString()}`,
      serverUrl: connection.serverUrl,
    });
  }

  async #models(directory: string): Promise<readonly ModelOption[]> {
    const cached = this.#modelCache.get(directory);
    if (cached) return cached;
    const parsed = parseModelOptions(await this.#get("/config/providers", directory));
    const models = uniqueByValue(parsed);
    this.#modelCache.set(directory, models);
    return models;
  }

  async #agents(directory: string): Promise<readonly AgentOption[]> {
    const cached = this.#agentCache.get(directory);
    if (cached) return cached;
    const agents = uniqueByValue(parseAgentOptions(await this.#get("/agent", directory)));
    this.#agentCache.set(directory, agents);
    return agents;
  }

  async #findModel(directory: string, model: OpencodeModel): Promise<ModelOption> {
    const value = `${model.providerID}/${model.modelID}`;
    const selected = (await this.#models(directory)).find((item) => item.value === value);
    if (!selected) throw invalidSelection("model", value);
    return selected;
  }

  async #snapshotValue(
    kind: DiscoveryListKind,
    scope: string,
    selector: string,
  ): Promise<string | undefined> {
    const trimmed = selector.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
    const number = Number(trimmed);
    if (!Number.isSafeInteger(number)) throw staleSelection(selector);
    const index = number - 1;
    const snapshot = await this.#options.snapshots.load(kind);
    const value = snapshot?.scope === scope ? snapshot.values[index] : undefined;
    if (!value) throw staleSelection(selector);
    return value;
  }

  #saveSnapshot(snapshot: DiscoverySnapshot): Promise<void> {
    return this.#options.snapshots.save(snapshot);
  }
}

export async function canonicalizeProjectPath(input: string): Promise<string> {
  try {
    return await canonicalizePath(input);
  } catch (error) {
    if (error instanceof ProjectPathError) {
      throw new OpencodeDiscoveryError("invalid_path", error.message);
    }
    throw error;
  }
}

function uniqueByValue<T extends { readonly value: string }>(items: readonly T[]): readonly T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(item.value, item);
  return [...unique.values()].sort((left, right) => compareText(left.value, right.value));
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidSelection(kind: string, selector: string): OpencodeDiscoveryError {
  return new OpencodeDiscoveryError("invalid_selection", `未知 ${kind}: ${selector}`);
}

function staleSelection(selector: string): OpencodeDiscoveryError {
  return new OpencodeDiscoveryError("stale_snapshot", `列表编号已过期: ${selector}`);
}

function modelScope(directory: string, model: ModelOption): string {
  return `${directory}\n${model.value}`;
}
