/**
 * Application configuration constants.
 * All values can be overridden via environment variables.
 */
import os from "node:os";
import path from "node:path";

export const CHANNEL_NAME = "wechat";
export const CHANNEL_VERSION = "0.4.0";
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_CDN_BASE_URL = process.env.OPENCODE_WECHAT_CDN_BASE_URL?.trim()
  || "https://novac2c.cdn.weixin.qq.com/c2c";
export const BOT_TYPE = "3";
export const DEFAULT_OPENCODE_PROVIDER_ID =
  process.env.OPENCODE_WECHAT_DEFAULT_PROVIDER_ID?.trim() || "Steveai";
export const DEFAULT_OPENCODE_MODEL_ID =
  process.env.OPENCODE_WECHAT_DEFAULT_MODEL_ID?.trim() || "gpt-5.4-mini";

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
export const CONTEXT_TOKENS_FILE = path.join(CREDENTIALS_DIR, "context_tokens.json");
export const OMO_PLAN_CONTEXT_FILE = path.join(CREDENTIALS_DIR, "omo_plan_context.json");
export const PROCESSED_MESSAGES_FILE = path.join(CREDENTIALS_DIR, "processed_messages.json");
export const SYNC_BUFFER_FILE = path.join(CREDENTIALS_DIR, "sync_buf.txt");
export const PID_FILE = path.join(CREDENTIALS_DIR, "opencode-wechat.pid");
export const CHANNEL_LOG_FILE = path.join(CREDENTIALS_DIR, "channel.log");
export const INBOX_DIR = process.env.OPENCODE_WECHAT_INBOX_DIR?.trim()
  || path.join(CREDENTIALS_DIR, "inbox");

// GUI 控制台
export const GUI_PORT = Number.parseInt(
  process.env.OPENCODE_WECHAT_GUI_PORT?.trim() || "5179",
  10,
);
export const GUI_HOSTNAME = "127.0.0.1";

// Timing
export const LONG_POLL_TIMEOUT_MS = 35_000;
export const QR_POLL_TIMEOUT_MS = 35_000;
export const QR_LOGIN_DEADLINE_MS = 480_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_MS = 30_000;
export const RETRY_DELAY_MS = 2_000;
const configuredPromptTimeoutMs = Number.parseInt(
  process.env.OPENCODE_WECHAT_PROMPT_TIMEOUT_MS?.trim() || "",
  10,
);
export const OPENCODE_PROMPT_TIMEOUT_MS = Number.isFinite(configuredPromptTimeoutMs)
  && configuredPromptTimeoutMs > 0
  ? configuredPromptTimeoutMs
  : 60_000;
// 同一条消息处理失败的最大重试次数，超过后跳过该消息并通知用户，
// 防止一条无法处理的消息永久阻塞整个队列
export const MAX_MESSAGE_ATTEMPTS = 3;
export const MAX_MESSAGE_TEXT_LEN = 200;
export const ENABLE_VERBOSE_MESSAGE_LOGS = process.env.OPENCODE_WECHAT_VERBOSE_LOGS === "1";
const configuredReplyTextChunkChars = Number.parseInt(
  process.env.OPENCODE_WECHAT_TEXT_CHUNK_CHARS?.trim() || "",
  10,
);
export const WECHAT_REPLY_TEXT_CHUNK_CHARS = Number.isFinite(configuredReplyTextChunkChars)
  && configuredReplyTextChunkChars > 0
  ? configuredReplyTextChunkChars
  : 500;

export const ENABLE_STREAM_CAPTURE = process.env.OPENCODE_WECHAT_STREAM_CAPTURE !== "0";
export const ENABLE_TYPING_INDICATOR = process.env.OPENCODE_WECHAT_TYPING === "1";
const configuredTypingMaxDurationMs = Number.parseInt(
  process.env.OPENCODE_WECHAT_TYPING_MAX_MS?.trim() || "",
  10,
);
export const TYPING_MAX_DURATION_MS = Number.isFinite(configuredTypingMaxDurationMs)
  && configuredTypingMaxDurationMs > 0
  ? configuredTypingMaxDurationMs
  : 45_000;
// 输入中状态的刷新间隔（指示器会自动过期，需要周期性续期）
export const TYPING_REFRESH_INTERVAL_MS = 8_000;
// typing_ticket 缓存时长
export const TYPING_TICKET_TTL_MS = 10 * 60_000;
