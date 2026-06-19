import os from "node:os";
import path from "node:path";
import type { MediaKind } from "../api/media";

export type WechatReplyPart =
  | {
    readonly kind: "text";
    readonly text: string;
  }
  | {
    readonly filePath: string;
    readonly kind: "media";
    readonly mediaKind: MediaKind;
    readonly text: string | undefined;
  };

/**
 * 附加到每条发往 OpenCode 的 prompt 末尾。
 * 媒体指令说明同时存在于 system 上下文里，但部分 OpenCode 版本对
 * 自定义 system 字段支持不可靠，模型也容易忽略，所以在消息层再提醒一次，
 * 否则模型会把文件名当普通文本回复，用户收不到真正的文件。
 */
export const WECHAT_MEDIA_PROMPT_HINT = [
  "（微信桥接提醒：当用户需要你把本地文件发给他们时，必须在最终回复中输出媒体指令，每条独占一行：",
  "[[wechat-image:/绝对路径.png|可选说明]]、[[wechat-video:/绝对路径.mp4|可选说明]] 或 [[wechat-file:/绝对路径.pdf|可选说明]]。",
  "路径必须是本机真实存在的绝对路径；只在文本里提到文件名或路径不会发送任何文件。与发文件无关时忽略本提醒。）",
].join("\n");

export const WECHAT_FILE_DELIVERY_PROMPT_HINT = [
  "【微信文件交付硬性要求】",
  "用户当前请求明确需要生成并发送本地文件。不要只回复“我可以生成”或只给文件名；必须实际创建文件，并在最终回复最后单独输出媒体指令。",
  "如果用户要求 PDF/报告/文档，优先生成真实 PDF 文件；如果只能生成其他格式，必须说明原因并发送实际生成的文件。",
  "最终回复必须包含一行：[[wechat-file:/本机真实绝对路径/文件名.pdf|文件说明]]。",
  "路径必须存在于运行 OpenCodeWeChat 的机器上；桥接层只会发送媒体指令指向的真实本地文件。",
].join("\n");

const FILE_DELIVERY_RE = /(?:pdf|文件|文档|下载|打包|zip|发给我|发送给我|传给我|给我一份|报告.*(?:发|给|下载)|生成.*(?:给我|发我|下载|文件|pdf)|export|download|attachment|attach|report.*(?:send|download|attach)|document|spreadsheet)/i;

export function needsWechatFileDeliveryHint(text: string): boolean {
  return FILE_DELIVERY_RE.test(text);
}

const DIRECTIVE_RE = /\[\[\s*wechat-(image|video|file)\s*[:：]([^\]\r\n]+)\]\]/gi;

export function parseWechatReplyParts(text: string): readonly WechatReplyPart[] {
  const parts: WechatReplyPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(DIRECTIVE_RE)) {
    const fullMatch = match[0];
    const index = match.index;
    if (index === undefined) continue;

    const leadingText = text.slice(cursor, index).trim();
    if (leadingText) {
      parts.push({ kind: "text", text: leadingText });
    }

    const directive = parseDirectivePayload(match[1], match[2]);
    if (directive) {
      parts.push(directive);
    }
    cursor = index + fullMatch.length;
  }

  const trailingText = text.slice(cursor).trim();
  if (trailingText) {
    parts.push({ kind: "text", text: trailingText });
  }

  if (parts.length === 0 && text.trim()) {
    parts.push({ kind: "text", text: text.trim() });
  }

  return parts;
}

function parseDirectivePayload(
  rawKind: string | undefined,
  rawPayload: string | undefined,
): WechatReplyPart | undefined {
  const mediaKind = parseMediaKind(rawKind?.toLowerCase());
  const payload = rawPayload?.trim();
  if (!mediaKind || !payload) return undefined;

  const separatorIndex = payload.indexOf("|");
  const rawFilePath = separatorIndex >= 0
    ? payload.slice(0, separatorIndex)
    : payload;
  const text = separatorIndex >= 0
    ? payload.slice(separatorIndex + 1).trim()
    : "";

  const filePath = normalizeFilePath(rawFilePath);
  if (!filePath) return undefined;

  return {
    filePath,
    kind: "media",
    mediaKind,
    text: text || undefined,
  };
}

/**
 * 容忍模型常见的路径写法偏差：包裹的反引号/引号、`~` 开头的家目录写法。
 */
function normalizeFilePath(raw: string): string {
  let filePath = raw.trim();
  filePath = filePath.replace(/^[`"']+/, "").replace(/[`"']+$/, "").trim();
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function parseMediaKind(value: string | undefined): MediaKind | undefined {
  switch (value) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "file":
      return "file";
    default:
      return undefined;
  }
}
