/**
 * Application configuration constants.
 * All values can be overridden via environment variables.
 */
import os from "node:os";
import path from "node:path";

export const CHANNEL_NAME = "wechat";
export const CHANNEL_VERSION = "0.2.0";
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const BOT_TYPE = "3";

// File paths
const HOME_DIR = process.env.HOME?.trim()
  || process.env.USERPROFILE?.trim()
  || os.homedir();

export const CREDENTIALS_DIR = path.join(
  HOME_DIR,
  ".claude",
  "channels",
  CHANNEL_NAME,
);
export const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "account.json");
export const OMO_PLAN_CONTEXT_FILE = path.join(CREDENTIALS_DIR, "omo_plan_context.json");
export const PROCESSED_MESSAGES_FILE = path.join(CREDENTIALS_DIR, "processed_messages.json");
export const SYNC_BUFFER_FILE = path.join(CREDENTIALS_DIR, "sync_buf.txt");

// Timing
export const LONG_POLL_TIMEOUT_MS = 35_000;
export const QR_POLL_TIMEOUT_MS = 35_000;
export const QR_LOGIN_DEADLINE_MS = 480_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_MS = 30_000;
export const RETRY_DELAY_MS = 2_000;
export const MAX_MESSAGE_TEXT_LEN = 200;
export const ENABLE_VERBOSE_MESSAGE_LOGS = process.env.OPENCODE_WECHAT_VERBOSE_LOGS === "1";
