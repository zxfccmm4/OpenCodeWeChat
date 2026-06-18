import crypto from "node:crypto";
import {
  DEFAULT_BASE_URL,
  BOT_TYPE,
  LONG_POLL_TIMEOUT_MS,
  QR_POLL_TIMEOUT_MS,
} from "../config";
import type {
  QRCodeResponse,
  QRStatusResponse,
  GetBotConfigResp,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  SendTypingReq,
  WeixinMessage,
} from "../types/wechat";

export class IlinkApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly ret?: number,
    public readonly errcode?: number,
  ) {
    super(message);
    this.name = "IlinkApiError";
  }
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(token?: string, body?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (body) {
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf-8"));
  }
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
}): Promise<string> {
  const base = params.baseUrl.endsWith("/")
    ? params.baseUrl
    : `${params.baseUrl}/`;
  const url = new URL(params.endpoint, base).toString();
  const headers = buildHeaders(params.token, params.body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new IlinkApiError(`HTTP ${res.status}: ${text}`, res.status);
    return text;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof IlinkApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    throw new IlinkApiError(String(err));
  }
}

export async function fetchQRCode(baseUrl: string): Promise<QRCodeResponse> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`,
    base,
  );
  const res = await fetch(url.toString());
  if (!res.ok) throw new IlinkApiError(`QR fetch failed: ${res.status}`, res.status);
  return res.json() as Promise<QRCodeResponse>;
}

export async function pollQRStatus(
  baseUrl: string,
  qrcode: string,
): Promise<QRStatusResponse> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    base,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new IlinkApiError(`QR status failed: ${res.status}`, res.status);
    return res.json() as Promise<QRStatusResponse>;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    throw err;
  }
}

export async function getUpdates(
  baseUrl: string,
  token: string,
  getUpdatesBuf: string,
  channelVersion: string,
): Promise<GetUpdatesResp> {
  try {
    const raw = await apiFetch({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: getUpdatesBuf,
        base_info: { channel_version: channelVersion },
      }),
      token,
      timeoutMs: LONG_POLL_TIMEOUT_MS,
    });
    return JSON.parse(raw) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    throw err;
  }
}

export function generateClientId(): string {
  return `opencode-wechat:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function sendWeixinMessage(
  baseUrl: string,
  token: string,
  msg: WeixinMessage,
  channelVersion: string,
): Promise<void> {
  await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      msg,
      base_info: { channel_version: channelVersion },
    }),
    token,
    timeoutMs: 15_000,
  });
}

export async function getUploadUrl(
  baseUrl: string,
  token: string,
  request: GetUploadUrlReq,
  channelVersion: string,
): Promise<GetUploadUrlResp> {
  const raw = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      ...request,
      base_info: { channel_version: channelVersion },
    }),
    token,
    timeoutMs: 15_000,
  });
  return JSON.parse(raw) as GetUploadUrlResp;
}

/**
 * 获取 bot 对某个用户的配置（含 typing_ticket，用于"对方正在输入"指示器）。
 */
export async function getBotConfig(
  baseUrl: string,
  token: string,
  params: {
    readonly channelVersion: string;
    readonly contextToken?: string;
    readonly ilinkUserId: string;
  },
): Promise<GetBotConfigResp> {
  const raw = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      ...(params.contextToken ? { context_token: params.contextToken } : {}),
      base_info: { channel_version: params.channelVersion },
    }),
    token,
    timeoutMs: 10_000,
  });
  return JSON.parse(raw) as GetBotConfigResp;
}

export async function sendTypingStatus(
  baseUrl: string,
  token: string,
  request: SendTypingReq,
  channelVersion: string,
): Promise<void> {
  await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({
      ...request,
      base_info: { channel_version: channelVersion },
    }),
    token,
    timeoutMs: 10_000,
  });
}

export async function sendTextMessage(
  baseUrl: string,
  token: string,
  to: string,
  text: string,
  contextToken: string,
  clientId: string,
  channelVersion: string,
): Promise<void> {
  await sendWeixinMessage(baseUrl, token, {
    from_user_id: "",
    to_user_id: to,
    client_id: clientId,
    message_type: 2,
    message_state: 2,
    item_list: [{ type: 1, text_item: { text } }],
    context_token: contextToken,
  }, channelVersion);
}

/**
 * 流式文本：用同一个 client_id 重复发送，message_state=1(GENERATING) 表示
 * 内容仍在生成（微信端原地更新气泡），最后一次用 state=2(FINISH) 收口。
 */
export async function sendStreamingText(
  baseUrl: string,
  token: string,
  params: {
    readonly clientId: string;
    readonly contextToken: string;
    readonly finish: boolean;
    readonly text: string;
    readonly to: string;
  },
  channelVersion: string,
): Promise<void> {
  await sendWeixinMessage(baseUrl, token, {
    from_user_id: "",
    to_user_id: params.to,
    client_id: params.clientId,
    message_type: 2,
    message_state: params.finish ? 2 : 1,
    item_list: [{ type: 1, text_item: { text: params.text } }],
    context_token: params.contextToken,
  }, channelVersion);
}

export function buildCdnBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  parsed.hostname = parsed.hostname.replace(/^ilinkai\./, "ilinkcdn.");
  return parsed.toString().replace(/\/$/, "");
}

export async function uploadEncryptedMedia(params: {
  buffer: Buffer;
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  cdnBaseUrl: string;
  aesKey: Buffer;
}): Promise<string> {
  const encrypted = encryptAesEcb(params.buffer, params.aesKey);
  const url = params.uploadFullUrl?.trim()
    || `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam ?? "")}&filekey=${encodeURIComponent(params.filekey)}`;

  if (!params.uploadFullUrl?.trim() && !params.uploadParam) {
    throw new IlinkApiError("CDN upload URL missing");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(encrypted),
  });
  if (!res.ok) {
    throw new IlinkApiError(`CDN upload failed: HTTP ${res.status}`, res.status);
  }
  const downloadParam = res.headers.get("x-encrypted-param");
  if (!downloadParam) {
    throw new IlinkApiError("CDN upload missing x-encrypted-param header");
  }
  return downloadParam;
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
