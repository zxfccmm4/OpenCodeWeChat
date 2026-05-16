/**
 * Strict TypeScript types for WeChat ilink API structures.
 */

// ── QR Login ─────────────────────────────────────────────────────────────────

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export type QRStatus = "wait" | "scaned" | "confirmed" | "expired";

export interface QRStatusResponse {
  status: QRStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

// ── Account Credentials ────────────────────────────────────────────────────

export interface AccountData {
  token: string;
  baseUrl: string;
  accountId: string;
  userId?: string;
  savedAt: string;
}

// ── Message Items ────────────────────────────────────────────────────────────

export interface TextItem {
  text?: string;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  voice_item?: { text?: string };
  ref_msg?: RefMessage;
}

// ── WeChat Message ───────────────────────────────────────────────────────────

export interface WeixinMessage {
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  create_time_ms?: number;
}

// ── getUpdates Response ─────────────────────────────────────────────────────

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const MSG_TYPE_USER = 1;
export const MSG_TYPE_BOT = 2;
export const MSG_ITEM_TEXT = 1;
export const MSG_ITEM_VOICE = 3;
export const MSG_STATE_FINISH = 2;

// ── Parsed Inbound Message ───────────────────────────────────────────────────

export interface ParsedMessage {
  compiledPrompt?: string;
  dedupeKey: string;
  senderId: string;
  text: string;
  contextToken: string | undefined;
  clientId: string;
  raw: WeixinMessage;
}
