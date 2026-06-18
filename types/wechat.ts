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

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
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

export interface GetUploadUrlReq {
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
}

export interface GetUploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

// ── Typing Indicator ─────────────────────────────────────────────────────────

export interface GetBotConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1=输入中, 2=取消 */
  status?: number;
}

export const TYPING_STATUS_TYPING = 1;
export const TYPING_STATUS_CANCEL = 2;

// ── Constants ────────────────────────────────────────────────────────────────

export const MSG_TYPE_USER = 1;
export const MSG_TYPE_BOT = 2;
export const MSG_ITEM_TEXT = 1;
export const MSG_ITEM_IMAGE = 2;
export const MSG_ITEM_VOICE = 3;
export const MSG_ITEM_FILE = 4;
export const MSG_ITEM_VIDEO = 5;
export const MSG_STATE_GENERATING = 1;
export const MSG_STATE_FINISH = 2;

export const UPLOAD_MEDIA_IMAGE = 1;
export const UPLOAD_MEDIA_VIDEO = 2;
export const UPLOAD_MEDIA_FILE = 3;

// ── Parsed Inbound Message ───────────────────────────────────────────────────

export type IncomingMediaKind = "image" | "video" | "file" | "voice";

export interface IncomingMedia {
  kind: IncomingMediaKind;
  media: CDNMedia;
  fileName?: string;
}

export interface ParsedMessage {
  compiledPrompt?: string;
  dedupeKey: string;
  senderId: string;
  text: string;
  media: IncomingMedia[];
  contextToken: string | undefined;
  clientId: string;
  raw: WeixinMessage;
}
