import fs from "node:fs";
import { SYNC_BUFFER_FILE } from "../config.js";

export function loadSyncBuffer(): string {
  try {
    if (fs.existsSync(SYNC_BUFFER_FILE)) {
      return fs.readFileSync(SYNC_BUFFER_FILE, "utf-8");
    }
  } catch {
    // ignore
  }
  return "";
}

export function saveSyncBuffer(buf: string): void {
  try {
    fs.writeFileSync(SYNC_BUFFER_FILE, buf, "utf-8");
  } catch {
    // ignore
  }
}
