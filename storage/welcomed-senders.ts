/**
 * Track which WeChat senders have already received the first-contact welcome.
 * Persisted so restarts do not spam the same user again.
 */
import fs from "node:fs";
import path from "node:path";
import { CREDENTIALS_DIR } from "../config.js";

export const WELCOMED_SENDERS_FILE = path.join(
  CREDENTIALS_DIR,
  "welcomed_senders.json",
);

const MAX_WELCOMED_SENDERS = 2_000;
const welcomedSenderIds = new Set<string>();
let loaded = false;

function ensureLoaded(file = WELCOMED_SENDERS_FILE): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (!Array.isArray(data)) return;
    for (const value of data) {
      if (typeof value === "string" && value.trim()) welcomedSenderIds.add(value);
    }
  } catch {
    welcomedSenderIds.clear();
  }
}

function persist(file = WELCOMED_SENDERS_FILE): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...welcomedSenderIds], null, 2), "utf-8");
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}

export function hasWelcomedSender(
  senderId: string,
  file = WELCOMED_SENDERS_FILE,
): boolean {
  ensureLoaded(file);
  return welcomedSenderIds.has(senderId);
}

export function markSenderWelcomed(
  senderId: string,
  file = WELCOMED_SENDERS_FILE,
): void {
  ensureLoaded(file);
  const id = senderId.trim();
  if (!id || welcomedSenderIds.has(id)) return;
  welcomedSenderIds.add(id);
  if (welcomedSenderIds.size > MAX_WELCOMED_SENDERS) {
    const overflow = welcomedSenderIds.size - MAX_WELCOMED_SENDERS;
    const iterator = welcomedSenderIds.values();
    for (let index = 0; index < overflow; index += 1) {
      const oldest = iterator.next();
      if (oldest.done) break;
      welcomedSenderIds.delete(oldest.value);
    }
  }
  persist(file);
}

/** Test helper: reset in-memory + optional file. */
export function resetWelcomedSendersForTests(file = WELCOMED_SENDERS_FILE): void {
  welcomedSenderIds.clear();
  loaded = false;
  try {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    // ignore
  }
}
