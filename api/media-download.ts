import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { IlinkApiError } from "./ilink";
import type { CDNMedia, IncomingMedia } from "../types/wechat";

export interface DownloadedMedia {
  readonly byteLength: number;
  readonly savedPath: string;
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * 微信 CDN 媒体的 aes_key 有两种编码:
 *   - base64 → 16 字节原始密钥（接收方向常见）
 *   - base64 → 32 个 hex 字符 → 16 字节密钥（发送方向使用 hex 编码）
 */
export function parseAesKey(media: CDNMedia): Buffer | null {
  const raw = media.aes_key;
  if (!raw) return null;

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32) {
    const hexStr = decoded.toString("ascii");
    if (/^[0-9a-fA-F]{32}$/.test(hexStr)) {
      return Buffer.from(hexStr, "hex");
    }
  }
  if (decoded.length > 16) return decoded.subarray(0, 16);
  return null;
}

export async function downloadAndDecryptMedia(
  encryptQueryParam: string,
  aesKey: Buffer,
  cdnBaseUrl: string,
): Promise<Buffer> {
  const url = `${cdnBaseUrl.replace(/\/$/, "")}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new IlinkApiError(`CDN download failed: HTTP ${res.status}`, res.status);
  }
  const ciphertext = Buffer.from(await res.arrayBuffer());
  return decryptAesEcb(ciphertext, aesKey);
}

export async function downloadIncomingMedia(
  media: IncomingMedia,
  options: {
    readonly cdnBaseUrl: string;
    readonly inboxDir: string;
  },
): Promise<DownloadedMedia> {
  const aesKey = parseAesKey(media.media);
  if (!aesKey) {
    throw new IlinkApiError("incoming media is missing a usable aes_key");
  }
  if (!media.media.encrypt_query_param) {
    throw new IlinkApiError("incoming media is missing encrypt_query_param");
  }
  const buffer = await downloadAndDecryptMedia(
    media.media.encrypt_query_param,
    aesKey,
    options.cdnBaseUrl,
  );
  const savedPath = await saveToInbox(
    buffer,
    media.fileName ?? defaultFileName(media.kind),
    options.inboxDir,
  );
  return { byteLength: buffer.length, savedPath };
}

function defaultFileName(kind: IncomingMedia["kind"]): string {
  switch (kind) {
    case "image":
      return "wechat-image.jpg";
    case "video":
      return "wechat-video.mp4";
    case "voice":
      return "wechat-voice.silk";
    case "file":
      return "wechat-file";
  }
}

// 收到的文件常含个人信息，目录 0o700 / 文件 0o600 防止多用户系统上被其他本地用户读取。
const INBOX_DIR_MODE = 0o700;
const INBOX_FILE_MODE = 0o600;
const INBOX_MAX_COLLISION_RETRIES = 100;

/**
 * 把下载好的明文写入收件箱目录，返回绝对路径。
 * 文件名格式: `${ISO 时间戳}-${清洗后的原始文件名}`，重名时插入 `-N-` 序号；
 * 使用 wx 标志（已存在则失败）避免并发或重复发送时静默覆盖。
 */
export async function saveToInbox(
  buffer: Buffer,
  fileName: string,
  inboxDir: string,
): Promise<string> {
  await fs.mkdir(inboxDir, { recursive: true, mode: INBOX_DIR_MODE });
  await fs.chmod(inboxDir, INBOX_DIR_MODE).catch(() => {});

  const safeBase = sanitizeFilename(fileName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (let attempt = 0; attempt < INBOX_MAX_COLLISION_RETRIES; attempt++) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const target = path.resolve(inboxDir, `${stamp}${suffix}-${safeBase}`);
    try {
      await fs.writeFile(target, buffer, { flag: "wx", mode: INBOX_FILE_MODE });
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new IlinkApiError(
    `saveToInbox: exhausted ${INBOX_MAX_COLLISION_RETRIES} collision retries for ${safeBase}`,
  );
}

export function sanitizeFilename(name: string): string {
  // 丢弃发送方可能携带的路径分隔符，替换控制字符与 Windows 保留字符；
  // 前导点、尾部点/空格归一为 `_`，保留 Unicode 让中文文件名可读。
  const tail = name.split(/[\\/]/).pop() ?? "";
  const cleaned = tail
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "_")
    .replace(/[. ]+$/, "_");
  return cleaned.length > 0 ? cleaned : "file";
}
