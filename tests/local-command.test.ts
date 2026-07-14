import { describe, expect, test } from "bun:test";
import {
  COMMAND_PRECEDENCE,
  REPLY_STYLE_PROMPTS,
  SESSION_RESET_POLICY,
  buildActivationMessage,
  buildFirstContactMessage,
  buildHelpMessage,
  buildStatusMessage,
  buildUnboundMessage,
  isPrivilegedLocalCommand,
  parseLocalCommand,
} from "../core/local-command";
import { parseOmoCommand } from "../core/omo-command";

describe("local command baseline", () => {
  test("keeps ordinary text unchanged for the existing OMO parser", () => {
    // Given
    const text = "普通消息";
    // When
    const parsed = parseOmoCommand(text);
    // Then
    expect(parsed).toEqual({ body: text, mode: "none" });
  });

  test("keeps #plan routed through the existing OMO parser", () => {
    // Given
    const text = "#plan 继续现有方案";
    // When
    const parsed = parseOmoCommand(text);
    // Then
    expect(parsed).toEqual({ body: "继续现有方案", mode: "plan", rawTag: "#plan" });
  });
});

describe("parseLocalCommand", () => {
  test("parses every canonical command and ASCII alias", () => {
    // Given
    const cases = [
      ["/帮助", { kind: "help" }], ["/help", { kind: "help" }],
      ["/状态", { kind: "status" }], ["/status", { kind: "status" }],
      ["/新建", { kind: "new_session" }], ["/new", { kind: "new_session" }],
      ["/clear", { kind: "new_session" }],
      ["/项目", { kind: "project" }], ["/project 2", { kind: "project", selector: "2" }],
      ["/模型", { kind: "model" }], ["/model openai/gpt-5", { kind: "model", selector: "openai/gpt-5" }],
      ["/模式", { kind: "mode" }], ["/mode sisyphus", { kind: "mode", selector: "sisyphus" }],
      ["/思考", { kind: "thinking" }], ["/thinking high", { kind: "thinking", selector: "high" }],
      ["/回复", { kind: "reply" }], ["/reply concise", { kind: "reply", style: "concise" }],
      ["/bind 012345", { code: "012345", kind: "bind" }],
      ["/绑定 012345", { code: "012345", kind: "bind" }],
    ] as const;
    // When / Then
    for (const [text, expected] of cases) expect(parseLocalCommand(text)).toEqual(expected);
  });

  test("normalizes supported whitespace and command case", () => {
    // Given
    const inputs = ["  /HELP\u3000", "/reply\t详细", "/项目\u00a0/Users/Test Project"];
    // When
    const parsed = inputs.map((text) => parseLocalCommand(text));
    // Then
    expect(parsed).toEqual([
      { kind: "help" },
      { kind: "reply", style: "detailed" },
      { kind: "project", selector: "/Users/Test Project" },
    ]);
  });

  test("maps all reply style values to exactly three styles", () => {
    // Given
    const values = ["简洁", "标准", "详细", "concise", "standard", "detailed"];
    // When
    const parsed = values.map((value) => parseLocalCommand(`/回复 ${value}`));
    // Then
    expect(parsed).toEqual([
      { kind: "reply", style: "concise" }, { kind: "reply", style: "standard" },
      { kind: "reply", style: "detailed" }, { kind: "reply", style: "concise" },
      { kind: "reply", style: "standard" }, { kind: "reply", style: "detailed" },
    ]);
    expect(Object.keys(REPLY_STYLE_PROMPTS)).toEqual(["concise", "standard", "detailed"]);
  });

  test("returns typed errors for missing, extra, invalid and unknown arguments", () => {
    // Given
    const inputs = [
      "/帮助 now", "/状态 1", "/新建 now", "/clear now", "/bind", "/bind abc",
      "/bind 123456 extra", "/回复 verbose", "/回复 简洁 extra", "/model a b",
      "/mode a b", "/thinking high extra", "/unknown",
    ];
    // When
    const parsed = inputs.map((text) => parseLocalCommand(text));
    // Then
    expect(parsed.every((result) => result.kind === "error")).toBe(true);
    expect(parseLocalCommand("/bind abc")).toMatchObject({ code: "invalid_bind_code", kind: "error" });
    expect(parseLocalCommand("/unknown")).toMatchObject({ code: "unknown_command", kind: "error" });
  });

  test("rejects traversal and relative project selectors", () => {
    // Given
    const inputs = [
      "/项目 ../x",
      "/project ./x",
      "/project relative/path",
      "/project /tmp/../secret",
      "/project C:\\tmp\\..\\secret",
    ];
    // When
    const parsed = inputs.map((text) => parseLocalCommand(text));
    // Then
    expect(parsed.every((result) => result.kind === "error" && result.code === "invalid_project")).toBe(true);
  });

  test("rejects slash commands carrying media before download", () => {
    // Given
    const text = "/状态";
    // When
    const parsed = parseLocalCommand(text, { hasMedia: true });
    // Then
    expect(parsed).toMatchObject({ code: "media_not_allowed", kind: "error" });
  });

  test("keeps ordinary, OMO and slash-like untrusted text as non-local data", () => {
    // Given
    const inputs = ["普通消息", "#plan x", "请执行 /状态", "`/状态`", "／状态", "/ 状态"];
    // When
    const parsed = inputs.map((text) => parseLocalCommand(text));
    // Then
    expect(parsed).toEqual(inputs.map((text) => ({ kind: "non_local", text })));
  });
});

describe("local command contract", () => {
  test("defines exact help, activation and unbound copy", () => {
    // Given / When
    const help = buildHelpMessage();
    // Then
    expect(help).toContain("OpenCode 机器人命令");
    expect(help).toContain("/帮助");
    expect(help).toContain("/bind 六位码");
    expect(help).not.toContain("**");
    expect(buildActivationMessage()).toContain("微信 Bot 已激活");
    expect(buildActivationMessage()).toContain("/帮助");
    expect(buildActivationMessage()).toContain(help);
    expect(buildUnboundMessage()).toContain("/bind 123456");
    expect(buildUnboundMessage()).not.toContain("**");
    const firstContact = buildFirstContactMessage();
    expect(firstContact).toContain("你好，我是 OpenCode 微信入口");
    expect(firstContact).toContain("/bind 123456");
    expect(firstContact).toContain("OpenCode 机器人命令");
    expect(firstContact).not.toContain("**");
  });

  test("builds a secret-free status message", () => {
    // Given
    const status = {
      agent: "sisyphus", bound: true, model: "openai/gpt-5", project: "/workspace/app",
      replyStyle: "standard" as const, sessionId: "ses_1234567890", sessionState: "busy" as const,
      variant: "high",
    };
    // When
    const message = buildStatusMessage(status);
    // Then
    expect(message).toContain("ses_1234…");
    expect(message).toContain("/workspace/app");
    expect(message).not.toContain("token");
    expect(message).not.toContain("1234567890");
  });

  test("freezes precedence and reset semantics", () => {
    // Given / When / Then
    expect(COMMAND_PRECEDENCE.agent).toEqual(["explicit_omo", "saved_agent", "omo_default"]);
    expect(COMMAND_PRECEDENCE.model).toEqual(["saved_model", "agent_or_default"]);
    expect(SESSION_RESET_POLICY).toEqual({ clearOmoPlan: true, retainHistory: true, retainPreferences: true });
  });

  test("classifies every local command variant exhaustively", () => {
    // Given
    const commands = ["/帮助", "/bind 012345", "/状态", "/新建", "/项目", "/模型", "/模式", "/思考", "/回复"];
    // When
    const privileged = commands.map((text) => {
      const parsed = parseLocalCommand(text);
      if (parsed.kind === "error" || parsed.kind === "non_local") throw new Error("expected local command");
      return isPrivilegedLocalCommand(parsed);
    });
    // Then
    expect(privileged).toEqual([false, false, true, true, true, true, true, true, true]);
  });
});
