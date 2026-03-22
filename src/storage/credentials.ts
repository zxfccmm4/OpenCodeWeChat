import fs from "node:fs";
import path from "node:path";
import { CREDENTIALS_DIR, CREDENTIALS_FILE } from "../config.js";
import type { AccountData } from "../types/wechat.js";

export function loadCredentials(): AccountData | null {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8")) as AccountData;
  } catch {
    return null;
  }
}

export function saveCredentials(data: AccountData): void {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    // best-effort
  }
}

export function credentialsFile(): string {
  return CREDENTIALS_FILE;
}

export function credentialsDir(): string {
  return CREDENTIALS_DIR;
}
