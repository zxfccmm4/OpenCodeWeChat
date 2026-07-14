import { getString, isObject } from "./http";
import type { AgentOption, ModelOption } from "./discovery-types";

export function parseProjectPaths(raw: unknown): readonly string[] {
  const projects = arrayPayload(raw);
  if (!projects) return [];
  return projects.flatMap((project): readonly string[] => {
    if (!isObject(project)) return [];
    const paths: string[] = [];
    const worktree = getString(project, "worktree") ?? getString(project, "directory");
    if (worktree) paths.push(worktree);
    const sandboxes = Reflect.get(project, "sandboxes");
    if (!Array.isArray(sandboxes)) return paths;
    for (const sandbox of sandboxes) {
      if (typeof sandbox === "string") {
        paths.push(sandbox);
        continue;
      }
      if (!isObject(sandbox)) continue;
      const path = getString(sandbox, "worktree") ?? getString(sandbox, "directory");
      if (path) paths.push(path);
    }
    return paths;
  });
}

export function parseModelOptions(raw: unknown): readonly ModelOption[] {
  if (!isObject(raw)) return [];
  const providers = Reflect.get(raw, "providers");
  if (!Array.isArray(providers)) return [];
  return providers.flatMap((provider): readonly ModelOption[] => {
    if (!isObject(provider)) return [];
    const providerID = getString(provider, "id");
    const models = Reflect.get(provider, "models");
    if (!providerID || !isObject(models)) return [];
    return Reflect.ownKeys(models).flatMap((key): readonly ModelOption[] => {
      if (typeof key !== "string") return [];
      const model = Reflect.get(models, key);
      if (!isObject(model)) return [];
      const modelID = getString(model, "id") ?? key;
      const value = `${providerID}/${modelID}`;
      return [{
        modelID,
        name: getString(model, "name") ?? modelID,
        providerID,
        value,
        variants: parseVariantNames(Reflect.get(model, "variants")),
      }];
    });
  });
}

export function parseAgentOptions(raw: unknown): readonly AgentOption[] {
  const agents = arrayPayload(raw);
  if (!agents) return [];
  return agents.flatMap((agent): readonly AgentOption[] => {
    if (!isObject(agent)) return [];
    if (Reflect.get(agent, "hidden") === true || getString(agent, "mode") === "subagent") return [];
    const id = getString(agent, "id");
    const name = getString(agent, "name") ?? getString(agent, "displayName") ?? id;
    const value = id ?? name;
    return name && value ? [{ name, value }] : [];
  });
}

function arrayPayload(raw: unknown): readonly unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return undefined;
  const data = Reflect.get(raw, "data");
  return Array.isArray(data) ? data : undefined;
}

function parseVariantNames(raw: unknown): readonly string[] {
  if (!isObject(raw)) return [];
  return Reflect.ownKeys(raw)
    .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    .sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
