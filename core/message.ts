import {
  WeixinMessage,
  MSG_ITEM_TEXT,
  MSG_ITEM_IMAGE,
  MSG_ITEM_VOICE,
  MSG_ITEM_FILE,
  MSG_ITEM_VIDEO,
  MSG_TYPE_USER,
  MSG_TYPE_BOT,
  MSG_STATE_FINISH,
  type IncomingMedia,
  type ParsedMessage,
} from "../types/wechat.js";
import { buildOmoPrompt } from "./omo-command.js";

export function extractTextFromMessage(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MSG_ITEM_TEXT && item.text_item?.text) {
      const text = item.text_item.text;
      const ref = item.ref_msg;
      if (!ref) return text;
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    if (item.type === MSG_ITEM_VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export function extractMediaFromMessage(msg: WeixinMessage): IncomingMedia[] {
  const result: IncomingMedia[] = [];
  for (const item of msg.item_list ?? []) {
    if (item.type === MSG_ITEM_IMAGE && item.image_item?.media?.encrypt_query_param) {
      result.push({ kind: "image", media: item.image_item.media });
      continue;
    }
    if (item.type === MSG_ITEM_VIDEO && item.video_item?.media?.encrypt_query_param) {
      result.push({ kind: "video", media: item.video_item.media });
      continue;
    }
    if (item.type === MSG_ITEM_FILE && item.file_item?.media?.encrypt_query_param) {
      result.push({
        fileName: item.file_item.file_name,
        kind: "file",
        media: item.file_item.media,
      });
      continue;
    }
    // 带转写文本的语音已按文本处理，仅下载没有转写的语音
    if (
      item.type === MSG_ITEM_VOICE
      && item.voice_item?.media?.encrypt_query_param
      && !item.voice_item.text
    ) {
      result.push({ kind: "voice", media: item.voice_item.media });
    }
  }
  return result;
}

export function parseMessage(msg: WeixinMessage): ParsedMessage | null {
  if (msg.message_type !== MSG_TYPE_USER) return null;
  if (msg.message_state !== MSG_STATE_FINISH) return null;

  const text = extractTextFromMessage(msg);
  const media = extractMediaFromMessage(msg);
  if (!text && media.length === 0) return null;

  const senderId = msg.from_user_id ?? "unknown";

  return {
    compiledPrompt: buildOmoPrompt(text),
    dedupeKey: buildMessageDedupeKey(msg, senderId, text, media),
    senderId,
    text,
    media,
    contextToken: msg.context_token,
    clientId: msg.client_id ?? "",
    raw: msg,
  };
}

export function isBotMessage(msg: WeixinMessage): boolean {
  return msg.message_type === MSG_TYPE_BOT;
}

function buildMessageDedupeKey(
  msg: WeixinMessage,
  senderId: string,
  text: string,
  media: IncomingMedia[],
): string {
  if (msg.client_id?.trim()) {
    return `client:${msg.client_id.trim()}`;
  }

  const createdAt = msg.create_time_ms ?? 0;
  // 纯媒体消息没有文本，用 encrypt_query_param（每次上传唯一）参与去重
  const mediaMarker = media
    .map((item) => item.media.encrypt_query_param ?? "")
    .join(",");
  return `fallback:${senderId}:${createdAt}:${text}:${mediaMarker}`;
}
