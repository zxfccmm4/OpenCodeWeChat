import { getString, isObject } from "./http";
import type { SessionMessage, SessionProgress, SessionSummary } from "./session-monitor-types";

function readNumber(record: object, key: string): number | undefined {
  const value = Reflect.get(record, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readObject(record: object, key: string): object | undefined {
  const value = Reflect.get(record, key);
  return isObject(value) ? value : undefined;
}

export function readProgress(value: unknown): SessionProgress {
  if (!isObject(value)) return "unknown";
  const type = getString(value, "type");
  switch (type) {
    case "busy":
    case "idle":
    case "retry":
      return type;
    default:
      return "unknown";
  }
}

function progressText(status: SessionProgress, statusValue: unknown): string {
  switch (status) {
    case "busy":
      return "正在执行";
    case "idle":
      return "已完成";
    case "retry": {
      const attempt = isObject(statusValue) ? readNumber(statusValue, "attempt") : undefined;
      return attempt === undefined ? "正在重试" : `第 ${attempt} 次重试`;
    }
    case "unknown":
      return "状态未知";
  }
}

export function parseSession(record: unknown, status: SessionProgress, statusValue: unknown): SessionSummary | undefined {
  if (!isObject(record)) return undefined;
  const id = getString(record, "id");
  if (!id) return undefined;
  const time = readObject(record, "time");
  const location = readObject(record, "location");
  const model = readObject(record, "model");
  const provider = model ? getString(model, "providerID") ?? "" : "";
  const modelId = model ? getString(model, "id") ?? getString(model, "modelID") ?? "" : "";
  return {
    agent: getString(record, "agent") ?? "",
    createdAt: time ? readNumber(time, "created") ?? 0 : 0,
    directory: getString(record, "directory")
      ?? (location ? getString(location, "directory") : undefined)
      ?? "",
    id,
    model: provider && modelId ? `${provider}/${modelId}` : modelId,
    progressText: progressText(status, statusValue),
    status,
    title: getString(record, "title") ?? getString(record, "slug") ?? id,
    updatedAt: time ? readNumber(time, "updated") ?? 0 : 0,
  };
}

export function latestActivity(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const last = messages[messages.length - 1];
  if (!isObject(last)) return undefined;
  const parts = Reflect.get(last, "parts");
  if (!Array.isArray(parts)) return undefined;
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (!isObject(part)) continue;
    const type = getString(part, "type");
    if (type === "tool") return `正在执行：${getString(part, "tool") ?? "工具"}`;
    if (type === "reasoning") return "正在分析";
    if (type === "text") return "正在生成回复";
    if (type === "step-start") return "正在处理";
  }
  return undefined;
}

export function latestFailure(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const item = messages[index];
    if (!isObject(item)) continue;
    const info = readObject(item, "info");
    if (!info || getString(info, "role") !== "assistant") continue;
    const error = Reflect.get(info, "error");
    if (isObject(error)) return getString(error, "message") ?? "Session 执行失败";
    if (getString(info, "finish") === "error") return "Session 执行失败";
    return undefined;
  }
  return undefined;
}

export function parseMessage(record: unknown): SessionMessage | undefined {
  if (!isObject(record)) return undefined;
  const info = readObject(record, "info");
  if (!info) return undefined;
  const id = getString(info, "id");
  const role = getString(info, "role");
  if (!id || (role !== "assistant" && role !== "user")) return undefined;
  const parts = Reflect.get(record, "parts");
  const text = Array.isArray(parts)
    ? parts.flatMap((part): readonly string[] => {
      if (!isObject(part)) return [];
      const type = getString(part, "type");
      if (type === "text") return [getString(part, "text") ?? ""];
      if (type === "tool") {
        const tool = getString(part, "tool") ?? "tool";
        const state = readObject(part, "state");
        return [`[${tool}: ${state ? getString(state, "status") ?? "unknown" : "unknown"}]`];
      }
      return [];
    }).filter(Boolean).join("\n")
    : "";
  const time = readObject(info, "time");
  const completedAt = time ? readNumber(time, "completed") : undefined;
  return {
    ...(completedAt === undefined ? {} : { completedAt }),
    createdAt: time ? readNumber(time, "created") ?? 0 : 0,
    id,
    role,
    text,
  };
}
