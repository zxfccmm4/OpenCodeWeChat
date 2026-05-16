import fs from "node:fs";
import path from "node:path";
import { PROCESSED_MESSAGES_FILE } from "../config.js";

const MAX_PROCESSED_MESSAGES = 1000;
const processedMessageIds = new Set<string>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(PROCESSED_MESSAGES_FILE)) return;
    const raw = fs.readFileSync(PROCESSED_MESSAGES_FILE, "utf-8");
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return;

    for (const value of data) {
      if (typeof value === "string" && value.trim()) {
        processedMessageIds.add(value);
      }
    }
  } catch {
    processedMessageIds.clear();
  }
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(PROCESSED_MESSAGES_FILE), { recursive: true });
    fs.writeFileSync(
      PROCESSED_MESSAGES_FILE,
      JSON.stringify([...processedMessageIds], null, 2),
      "utf-8",
    );
    try {
      fs.chmodSync(PROCESSED_MESSAGES_FILE, 0o600);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}

export function hasProcessedMessage(messageId: string): boolean {
  ensureLoaded();
  return processedMessageIds.has(messageId);
}

export function markMessageProcessed(messageId: string): void {
  ensureLoaded();
  if (!messageId.trim()) return;

  if (processedMessageIds.has(messageId)) return;
  processedMessageIds.add(messageId);

  if (processedMessageIds.size > MAX_PROCESSED_MESSAGES) {
    const overflow = processedMessageIds.size - MAX_PROCESSED_MESSAGES;
    const iterator = processedMessageIds.values();
    for (let index = 0; index < overflow; index += 1) {
      const oldest = iterator.next();
      if (oldest.done) break;
      processedMessageIds.delete(oldest.value);
    }
  }

  persist();
}
