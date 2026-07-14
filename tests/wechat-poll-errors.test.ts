import { describe, expect, test } from "bun:test";
import {
  classifyWechatPollError,
  isTerminalWechatPollError,
  TerminalWechatSessionError,
} from "../polling/wechat-poll-errors";

describe("wechat poll error classification", () => {
  test("treats errcode -14 / session timeout as terminal", () => {
    const classified = classifyWechatPollError({
      errcode: -14,
      errmsg: "session timeout",
    });
    expect(classified.kind).toBe("session_timeout");
    expect(isTerminalWechatPollError(classified)).toBe(true);
    const error = new TerminalWechatSessionError(classified);
    expect(error.message).toContain("重新扫码");
  });

  test("keeps ordinary transport failures retryable", () => {
    const classified = classifyWechatPollError({
      errcode: -1,
      errmsg: "temporary network glitch",
    });
    expect(classified.kind).toBe("retryable");
    expect(isTerminalWechatPollError(classified)).toBe(false);
  });
});
