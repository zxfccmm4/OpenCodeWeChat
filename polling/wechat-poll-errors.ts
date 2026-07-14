/**
 * Classify WeChat getUpdates failures so the channel can stop on terminal
 * auth/session errors instead of retrying forever.
 */

export type WechatPollErrorKind = "retryable" | "session_timeout" | "auth_failed";

export type ClassifiedWechatPollError = {
  readonly errcode?: number;
  readonly errmsg: string;
  readonly kind: WechatPollErrorKind;
  readonly ret?: number;
};

const SESSION_TIMEOUT_ERRCODES = new Set([-14]);
const AUTH_FAILED_ERRCODES = new Set([-13, -15, 401, 403]);

export class TerminalWechatSessionError extends Error {
  readonly kind: Extract<WechatPollErrorKind, "session_timeout" | "auth_failed">;
  readonly errcode?: number;
  readonly ret?: number;

  constructor(classified: ClassifiedWechatPollError) {
    super(userFacingMessage(classified));
    this.name = "TerminalWechatSessionError";
    this.kind = classified.kind === "retryable" ? "session_timeout" : classified.kind;
    this.errcode = classified.errcode;
    this.ret = classified.ret;
  }
}

export function classifyWechatPollError(params: {
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly ret?: number;
}): ClassifiedWechatPollError {
  const errmsg = (params.errmsg ?? "").trim();
  const errcode = params.errcode;
  const ret = params.ret;
  const lowered = errmsg.toLowerCase();

  if (
    (errcode !== undefined && SESSION_TIMEOUT_ERRCODES.has(errcode))
    || lowered.includes("session timeout")
    || lowered.includes("session expired")
  ) {
    return {
      ...(errcode !== undefined ? { errcode } : {}),
      errmsg: errmsg || "session timeout",
      kind: "session_timeout",
      ...(ret !== undefined ? { ret } : {}),
    };
  }

  if (
    (errcode !== undefined && AUTH_FAILED_ERRCODES.has(errcode))
    || lowered.includes("unauthorized")
    || lowered.includes("invalid token")
    || lowered.includes("token expired")
  ) {
    return {
      ...(errcode !== undefined ? { errcode } : {}),
      errmsg: errmsg || "auth failed",
      kind: "auth_failed",
      ...(ret !== undefined ? { ret } : {}),
    };
  }

  return {
    ...(errcode !== undefined ? { errcode } : {}),
    errmsg,
    kind: "retryable",
    ...(ret !== undefined ? { ret } : {}),
  };
}

export function isTerminalWechatPollError(
  classified: ClassifiedWechatPollError,
): classified is ClassifiedWechatPollError & {
  readonly kind: "session_timeout" | "auth_failed";
} {
  return classified.kind === "session_timeout" || classified.kind === "auth_failed";
}

function userFacingMessage(classified: ClassifiedWechatPollError): string {
  if (classified.kind === "session_timeout") {
    return "微信会话已过期（session timeout）。请在 GUI 控制台重新扫码登录后再启动通道。";
  }
  if (classified.kind === "auth_failed") {
    return "微信登录凭据已失效。请在 GUI 控制台重新扫码登录后再启动通道。";
  }
  return classified.errmsg || "微信轮询失败";
}
