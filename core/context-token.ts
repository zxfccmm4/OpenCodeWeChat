import fs from "node:fs";
import { CONTEXT_TOKENS_FILE, CREDENTIALS_DIR } from "../config.js";

const CONTEXT_TOKEN_FILE = CONTEXT_TOKENS_FILE;
const cache = new Map<string, string>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(CONTEXT_TOKEN_FILE)) return;
    const raw = fs.readFileSync(CONTEXT_TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    for (const [userId, token] of Object.entries(data)) {
      if (typeof userId === "string" && typeof token === "string" && token.trim()) {
        cache.set(userId, token);
      }
    }
  } catch {
    cache.clear();
  }
}

function persist(): void {
  try {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    fs.writeFileSync(
      CONTEXT_TOKEN_FILE,
      JSON.stringify(Object.fromEntries(cache.entries()), null, 2),
      "utf-8",
    );
    try {
      fs.chmodSync(CONTEXT_TOKEN_FILE, 0o600);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}

export function cacheContextToken(userId: string, token: string): void {
  ensureLoaded();
  if (!userId.trim() || !token.trim()) return;
  cache.set(userId, token);
  persist();
}

export function getCachedContextToken(userId: string): string | undefined {
  ensureLoaded();
  return cache.get(userId);
}

export function clearContextTokenCache(): void {
  ensureLoaded();
  cache.clear();
  persist();
}
