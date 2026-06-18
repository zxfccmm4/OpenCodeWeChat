import { getString, isObject, requestJson, OpencodeHttpError } from "./http";
import type { OpencodeAgent } from "./types";

export class OpencodeAgentDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpencodeAgentDiscoveryError";
  }
}

const OMO_AGENT_ALIASES: Record<string, readonly string[]> = {
  analyze: ["metis", "oracle", "sisyphus"],
  atlas: ["atlas"],
  delegate: ["atlas", "sisyphus"],
  deep: ["hephaestus", "sisyphus"],
  hephaestus: ["hephaestus"],
  hyperplan: ["sisyphus", "prometheus"],
  loop: ["sisyphus"],
  metis: ["metis"],
  momus: ["momus"],
  omo: ["sisyphus"],
  oracle: ["oracle"],
  plan: ["prometheus", "plan"],
  prometheus: ["prometheus", "plan"],
  review: ["momus", "oracle", "sisyphus"],
  search: ["librarian", "explore", "sisyphus"],
  sisyphus: ["sisyphus"],
  start: ["atlas"],
  summary: ["summary", "sisyphus"],
  team: ["sisyphus"],
  ultrawork: ["sisyphus"],
  ulw: ["sisyphus"],
};

export async function loadAgents(params: {
  readonly authHeader: string;
  readonly serverUrl: string;
}): Promise<readonly OpencodeAgent[]> {
  let v2Error: unknown;

  try {
    return parseAgentResponse(await requestJson({
      authHeader: params.authHeader,
      path: "/api/agent",
      serverUrl: params.serverUrl,
    }));
  } catch (err) {
    if (!(err instanceof OpencodeHttpError) || !canFallbackToLegacyAgentRoute(err.statusCode)) {
      v2Error = err;
    }
  }

  try {
    return parseAgentResponse(await requestJson({
      authHeader: params.authHeader,
      path: "/agent",
      serverUrl: params.serverUrl,
    }));
  } catch (err) {
    throw new OpencodeAgentDiscoveryError(formatAgentDiscoveryError(v2Error, err));
  }
}

function formatAgentDiscoveryError(v2Error: unknown, legacyError: unknown): string {
  if (!v2Error) return describeError(legacyError);
  return `/api/agent: ${describeError(v2Error)}; /agent: ${describeError(legacyError)}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function canFallbackToLegacyAgentRoute(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 405;
}

export function resolveRequestedAgent(
  requested: string,
  agents: readonly OpencodeAgent[],
): string {
  const agent = findRequestedAgent(requested, agents);
  if (agent) return agentIdentifier(agent);

  const names = agents.map(describeAgent).slice(0, 20).join(", ");
  throw new Error(`未找到 OpenCode agent: ${requested}. 可用 agent: ${names || "无"}`);
}

export function findPreferredAgent(
  requested: string,
  agents: readonly OpencodeAgent[],
): string | undefined {
  const agent = findRequestedAgent(requested, agents);
  return agent ? agentIdentifier(agent) : undefined;
}

export function parseAgentResponse(raw: unknown): readonly OpencodeAgent[] {
  const list = getArrayPayload(raw);
  if (!list) return [];

  return list
    .map(parseAgent)
    .filter((agent): agent is OpencodeAgent => agent !== undefined);
}

function getArrayPayload(raw: unknown): readonly unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return undefined;

  const data = Reflect.get(raw, "data");
  if (Array.isArray(data)) return data;

  const items = Reflect.get(raw, "items");
  return Array.isArray(items) ? items : undefined;
}

function parseAgent(value: unknown): OpencodeAgent | undefined {
  if (!isObject(value)) return undefined;

  const id = getString(value, "id");
  const name = getString(value, "name");
  const displayName = getString(value, "displayName");
  const mode = getString(value, "mode");
  const hidden = getBoolean(value, "hidden");

  if (!id && !name && !displayName) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(displayName ? { displayName } : {}),
    ...(mode ? { mode } : {}),
    ...(hidden === undefined ? {} : { hidden }),
  };
}

function getBoolean(record: object, key: string): boolean | undefined {
  const value = Reflect.get(record, key);
  return typeof value === "boolean" ? value : undefined;
}

function findRequestedAgent(
  requested: string,
  agents: readonly OpencodeAgent[],
): OpencodeAgent | undefined {
  const normalized = normalizeAgentName(requested);
  const aliases = [normalized, ...(OMO_AGENT_ALIASES[normalized] ?? [])];

  for (const alias of aliases) {
    const exact = agents.find((agent) => agentMatches(agent, alias, false));
    if (exact) return exact;
  }

  return agents.find((agent) => aliases.some((alias) => agentMatches(agent, alias, true)));
}

function agentMatches(
  agent: OpencodeAgent,
  alias: string,
  allowContains: boolean,
): boolean {
  return agentSearchKeys(agent).some((key) => (
    key === alias || (allowContains && key.includes(alias))
  ));
}

function agentSearchKeys(agent: OpencodeAgent): readonly string[] {
  return [agent.id, agent.name, agent.displayName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => {
      const normalized = normalizeAgentName(value);
      const words = value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word) => word.trim())
        .filter(Boolean);
      return [normalized, ...words];
    });
}

function normalizeAgentName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function agentIdentifier(agent: OpencodeAgent): string {
  return agent.id ?? agent.name ?? agent.displayName ?? "";
}

function describeAgent(agent: OpencodeAgent): string {
  return agent.name ?? agent.displayName ?? agent.id ?? "unknown";
}
