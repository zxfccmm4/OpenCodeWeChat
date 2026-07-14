import type { BotStatusCopy, ReplyStyle } from "./local-command-contract.js";

/**
 * Plain-text copy for WeChat. Avoid Markdown (**bold** etc.) — ClawBot
 * delivers ordinary text and phones often collapse it into one unreadable line.
 */
export function buildHelpMessage(): string {
  return [
    "OpenCode 机器人命令",
    "",
    "/帮助 — 查看这份说明",
    "/状态 — 查看工作区、模型和任务状态",
    "/新建 或 /clear — 开始新的任务草稿",
    "/项目 — 切换工作区",
    "/模型 — 切换模型",
    "/模式 — 切换运行模式",
    "/思考 — 切换思考级别",
    "/回复 — 切换回复详细程度",
    "/bind 六位码 — 绑定当前聊天",
    "",
    "示例：/bind 123456",
  ].join("\n");
}

export function buildActivationMessage(): string {
  return [
    "微信 Bot 已激活。",
    "发送 /帮助 查看命令，或直接描述你要做的事。",
    "",
    buildHelpMessage(),
  ].join("\n");
}

export function buildUnboundMessage(): string {
  return [
    "当前聊天尚未绑定。",
    "请先在 OpenCodeWeChat 控制台生成一次性绑定码，",
    "然后发送：/bind 123456（换成你的六位码）。",
  ].join("\n");
}

/** First inbound message from a chat that is not yet bound. */
export function buildFirstContactMessage(): string {
  return [
    "你好，我是 OpenCode 微信入口。",
    "",
    buildUnboundMessage(),
    "",
    buildHelpMessage(),
  ].join("\n");
}

export function buildStatusMessage(status: BotStatusCopy): string {
  const shortSessionId = status.sessionId.length > 8 ? `${status.sessionId.slice(0, 8)}…` : status.sessionId;
  return [
    "OpenCode 机器人状态",
    `绑定：${status.bound ? "已绑定" : "未绑定"}`,
    `项目：${status.project}`,
    `Session：${shortSessionId}（${status.sessionState}）`,
    `模型：${status.model}`,
    `模式：${status.agent}`,
    `思考：${status.variant}`,
    `回复：${replyStyleLabel(status.replyStyle)}`,
  ].join("\n");
}

function replyStyleLabel(style: ReplyStyle): string {
  switch (style) {
    case "concise":
      return "简洁";
    case "standard":
      return "标准";
    case "detailed":
      return "详细";
    default:
      return assertNever(style);
  }
}

function assertNever(value: never): never {
  throw new UnexpectedReplyStyleError(value);
}

class UnexpectedReplyStyleError extends Error {
  readonly value: never;

  constructor(value: never) {
    super("Unexpected reply style variant");
    this.name = "UnexpectedReplyStyleError";
    this.value = value;
  }
}
