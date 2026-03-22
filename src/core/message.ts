import {
  WeixinMessage,
  MSG_ITEM_TEXT,
  MSG_ITEM_VOICE,
  MSG_TYPE_USER,
  MSG_TYPE_BOT,
  MSG_STATE_FINISH,
  type ParsedMessage,
} from "../types/wechat.js";

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

export function parseMessage(msg: WeixinMessage): ParsedMessage | null {
  if (msg.message_type !== MSG_TYPE_USER) return null;
  if (msg.message_state !== MSG_STATE_FINISH) return null;

  const text = extractTextFromMessage(msg);
  if (!text) return null;

  const senderId = msg.from_user_id ?? "unknown";

  return {
    senderId,
    text,
    contextToken: msg.context_token,
    clientId: msg.client_id ?? "",
    raw: msg,
  };
}

export function isBotMessage(msg: WeixinMessage): boolean {
  return msg.message_type === MSG_TYPE_BOT;
}
