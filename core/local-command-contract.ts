export const REPLY_STYLES = ["concise", "standard", "detailed"] as const;

export type ReplyStyle = (typeof REPLY_STYLES)[number];

export const REPLY_STYLE_PROMPTS = {
  concise: "回复保持简洁：先给结论，只保留完成任务所需的关键步骤和风险。",
  standard: "回复采用标准详细度：先结论后细节，使用适合微信阅读的短段落。",
  detailed: "回复可以更详细：说明关键依据、实现细节、验证结果和剩余风险，但避免重复。",
} as const satisfies Record<ReplyStyle, string>;

export const COMMAND_PRECEDENCE = {
  agent: ["explicit_omo", "saved_agent", "omo_default"],
  model: ["saved_model", "agent_or_default"],
} as const;

export const SESSION_RESET_POLICY = {
  clearOmoPlan: true,
  retainHistory: true,
  retainPreferences: true,
} as const;

export type LocalCommand =
  | { readonly kind: "help" }
  | { readonly code: string; readonly kind: "bind" }
  | { readonly kind: "status" }
  | { readonly kind: "new_session" }
  | { readonly kind: "project"; readonly selector?: string }
  | { readonly kind: "model"; readonly selector?: string }
  | { readonly kind: "mode"; readonly selector?: string }
  | { readonly kind: "thinking"; readonly selector?: string }
  | { readonly kind: "reply"; readonly style?: ReplyStyle };

export type LocalCommandErrorCode =
  | "invalid_argument"
  | "invalid_bind_code"
  | "invalid_project"
  | "media_not_allowed"
  | "missing_argument"
  | "unexpected_argument"
  | "unknown_command";

export type LocalCommandParseResult =
  | LocalCommand
  | {
      readonly code: LocalCommandErrorCode;
      readonly kind: "error";
      readonly message: string;
    }
  | { readonly kind: "non_local"; readonly text: string };

export type LocalCommandParseOptions = {
  readonly hasMedia: boolean;
};

export type BotStatusCopy = {
  readonly agent: string;
  readonly bound: boolean;
  readonly model: string;
  readonly project: string;
  readonly replyStyle: ReplyStyle;
  readonly sessionId: string;
  readonly sessionState: "busy" | "error" | "idle" | "retry" | "stale";
  readonly variant: string;
};
