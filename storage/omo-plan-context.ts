import fs from "node:fs";
import path from "node:path";
import { OMO_PLAN_CONTEXT_FILE } from "../config.js";
import type { OmoPlanContext } from "../core/omo-command.js";

const planContexts = new Map<string, OmoPlanContext>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(OMO_PLAN_CONTEXT_FILE)) return;
    const raw = fs.readFileSync(OMO_PLAN_CONTEXT_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, OmoPlanContext>;

    for (const [userId, planContext] of Object.entries(data)) {
      if (!isValidPlanContext(planContext) || !userId.trim()) continue;
      planContexts.set(userId, planContext);
    }
  } catch {
    planContexts.clear();
  }
}

function isValidPlanContext(value: unknown): value is OmoPlanContext {
  if (typeof value !== "object" || value === null) return false;

  const originalRequest = (value as { originalRequest?: unknown }).originalRequest;
  const planResponse = (value as { planResponse?: unknown }).planResponse;
  const savedAt = (value as { savedAt?: unknown }).savedAt;

  return (
    typeof originalRequest === "string"
    && typeof planResponse === "string"
    && typeof savedAt === "string"
    && originalRequest.trim().length > 0
    && planResponse.trim().length > 0
    && savedAt.trim().length > 0
  );
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(OMO_PLAN_CONTEXT_FILE), { recursive: true });
    fs.writeFileSync(
      OMO_PLAN_CONTEXT_FILE,
      JSON.stringify(Object.fromEntries(planContexts.entries()), null, 2),
      "utf-8",
    );
    try {
      fs.chmodSync(OMO_PLAN_CONTEXT_FILE, 0o600);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}

export function getLatestPlanContext(userId: string): OmoPlanContext | undefined {
  ensureLoaded();
  return planContexts.get(userId);
}

export function saveLatestPlanContext(
  planContext: OmoPlanContext,
  userId: string,
): void {
  ensureLoaded();
  if (!userId.trim()) return;
  if (!isValidPlanContext(planContext)) return;

  planContexts.set(userId, planContext);
  persist();
}
