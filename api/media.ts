import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CDN_BASE_URL,
} from "../config";
import {
  getUploadUrl,
  sendWeixinMessage,
  uploadEncryptedMedia,
} from "./ilink";
import type { MessageItem } from "../types/wechat";
import {
  MSG_ITEM_FILE,
  MSG_ITEM_IMAGE,
  MSG_ITEM_TEXT,
  MSG_ITEM_VIDEO,
  MSG_STATE_FINISH,
  MSG_TYPE_BOT,
  UPLOAD_MEDIA_FILE,
  UPLOAD_MEDIA_IMAGE,
  UPLOAD_MEDIA_VIDEO,
} from "../types/wechat";

export type MediaKind = "image" | "video" | "file";

export interface UploadedMedia {
  readonly aesKey: Buffer;
  readonly ciphertextSize: number;
  readonly downloadParam: string;
  readonly filekey: string;
  readonly plaintextSize: number;
}

export interface SendMediaMessageParams {
  readonly baseUrl: string;
  readonly cdnBaseUrl?: string;
  readonly channelVersion: string;
  readonly clientId: string;
  readonly contextToken: string;
  readonly filePath: string;
  readonly kind?: MediaKind;
  readonly text?: string;
  readonly to: string;
  readonly token: string;
}

const IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);
const VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".m4v",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
]);

export async function sendMediaMessage(
  params: SendMediaMessageParams,
): Promise<void> {
  const mediaKind = params.kind ?? inferMediaKind(params.filePath);
  const uploaded = await uploadLocalMedia({
    baseUrl: params.baseUrl,
    cdnBaseUrl: params.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    channelVersion: params.channelVersion,
    filePath: params.filePath,
    kind: mediaKind,
    to: params.to,
    token: params.token,
  });
  const mediaItem = buildMediaItem({
    fileName: path.basename(params.filePath),
    kind: mediaKind,
    uploaded,
  });
  const items = params.text?.trim()
    ? [{ type: MSG_ITEM_TEXT, text_item: { text: params.text } }, mediaItem]
    : [mediaItem];

  let index = 0;
  for (const item of items) {
    await sendWeixinMessage(params.baseUrl, params.token, {
      from_user_id: "",
      to_user_id: params.to,
      client_id: index === 0 ? params.clientId : `${params.clientId}:${index}`,
      message_type: MSG_TYPE_BOT,
      message_state: MSG_STATE_FINISH,
      item_list: [item],
      context_token: params.contextToken,
    }, params.channelVersion);
    index += 1;
  }
}

export async function uploadLocalMedia(params: {
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  readonly channelVersion: string;
  readonly filePath: string;
  readonly kind: MediaKind;
  readonly to: string;
  readonly token: string;
}): Promise<UploadedMedia> {
  const buffer = await fs.readFile(params.filePath);
  const aesKey = crypto.randomBytes(16);
  const filekey = crypto.randomBytes(16).toString("hex");
  const uploadUrl = await getUploadUrl(
    params.baseUrl,
    params.token,
    {
      aeskey: aesKey.toString("hex"),
      filekey,
      filesize: aesEcbPaddedSize(buffer.length),
      media_type: uploadMediaType(params.kind),
      no_need_thumb: true,
      rawfilemd5: crypto.createHash("md5").update(buffer).digest("hex"),
      rawsize: buffer.length,
      to_user_id: params.to,
    },
    params.channelVersion,
  );
  const downloadParam = await uploadEncryptedMedia({
    aesKey,
    buffer,
    cdnBaseUrl: params.cdnBaseUrl,
    filekey,
    uploadFullUrl: uploadUrl.upload_full_url,
    uploadParam: uploadUrl.upload_param,
  });
  return {
    aesKey,
    ciphertextSize: aesEcbPaddedSize(buffer.length),
    downloadParam,
    filekey,
    plaintextSize: buffer.length,
  };
}

export function inferMediaKind(filePath: string): MediaKind {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "file";
}

export function aesEcbPaddedSize(size: number): number {
  const blockSize = 16;
  return size + (blockSize - (size % blockSize || blockSize));
}

function uploadMediaType(kind: MediaKind): number {
  switch (kind) {
    case "image":
      return UPLOAD_MEDIA_IMAGE;
    case "video":
      return UPLOAD_MEDIA_VIDEO;
    case "file":
      return UPLOAD_MEDIA_FILE;
  }
}

function buildMediaItem(params: {
  readonly fileName: string;
  readonly kind: MediaKind;
  readonly uploaded: UploadedMedia;
}): MessageItem {
  const media = {
    // 微信客户端期望 aes_key 解码后是 32 个 hex 字符（与官方 openclaw-weixin 一致），
    // 直接 base64 原始 16 字节会导致手机端密钥解析失败、媒体无法下载
    aes_key: Buffer.from(params.uploaded.aesKey.toString("hex")).toString("base64"),
    encrypt_query_param: params.uploaded.downloadParam,
    encrypt_type: 1,
  };
  switch (params.kind) {
    case "image":
      return {
        image_item: {
          media,
          mid_size: params.uploaded.ciphertextSize,
        },
        type: MSG_ITEM_IMAGE,
      };
    case "video":
      return {
        type: MSG_ITEM_VIDEO,
        video_item: {
          media,
          video_size: params.uploaded.ciphertextSize,
        },
      };
    case "file":
      return {
        file_item: {
          file_name: params.fileName,
          len: String(params.uploaded.plaintextSize),
          media,
        },
        type: MSG_ITEM_FILE,
      };
  }
}
