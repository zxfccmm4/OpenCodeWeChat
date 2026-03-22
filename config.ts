/**
 * Application configuration constants.
 * All values can be overridden via environment variables.
 */

export const CHANNEL_NAME = "wechat";
export const CHANNEL_VERSION = "0.2.0";
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const BOT_TYPE = "3";

// File paths
export const CREDENTIALS_DIR = `${process.env.HOME}/.claude/channels/wechat`;
export const CREDENTIALS_FILE = `${CREDENTIALS_DIR}/account.json`;
export const SYNC_BUFFER_FILE = `${CREDENTIALS_DIR}/sync_buf.txt`;

// Timing
export const LONG_POLL_TIMEOUT_MS = 35_000;
export const QR_POLL_TIMEOUT_MS = 35_000;
export const QR_LOGIN_DEADLINE_MS = 480_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_MS = 30_000;
export const RETRY_DELAY_MS = 2_000;
export const MAX_MESSAGE_TEXT_LEN = 200;
