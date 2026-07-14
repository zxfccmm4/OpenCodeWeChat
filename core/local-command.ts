import type {
  LocalCommand,
  LocalCommandErrorCode,
  LocalCommandParseOptions,
  LocalCommandParseResult,
  ReplyStyle,
} from "./local-command-contract.js";

export {
  COMMAND_PRECEDENCE,
  REPLY_STYLES,
  REPLY_STYLE_PROMPTS,
  SESSION_RESET_POLICY,
} from "./local-command-contract.js";
export type {
  BotStatusCopy,
  LocalCommand,
  LocalCommandErrorCode,
  LocalCommandParseOptions,
  LocalCommandParseResult,
  ReplyStyle,
} from "./local-command-contract.js";
export {
  buildActivationMessage,
  buildFirstContactMessage,
  buildHelpMessage,
  buildStatusMessage,
  buildUnboundMessage,
} from "./local-command-copy.js";

const COMMAND_ALIASES = {
  "/bind": "bind",
  "/clear": "new_session",
  "/help": "help",
  "/mode": "mode",
  "/model": "model",
  "/new": "new_session",
  "/project": "project",
  "/reply": "reply",
  "/status": "status",
  "/thinking": "thinking",
  "/帮助": "help",
  "/绑定": "bind",
  "/回复": "reply",
  "/模式": "mode",
  "/模型": "model",
  "/思考": "thinking",
  "/新建": "new_session",
  "/项目": "project",
  "/状态": "status",
} as const;

type CommandName = (typeof COMMAND_ALIASES)[keyof typeof COMMAND_ALIASES];

type TokenSelectionRule = {
  readonly kind: "mode" | "model" | "thinking";
  readonly pattern: RegExp;
  readonly usage: string;
};

const DEFAULT_PARSE_OPTIONS: LocalCommandParseOptions = { hasMedia: false };

export function parseLocalCommand(
  text: string,
  options: LocalCommandParseOptions = DEFAULT_PARSE_OPTIONS,
): LocalCommandParseResult {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\/\S+)(?:\s+([\s\S]*))?$/u);
  if (!match) return { kind: "non_local", text };

  const rawCommand = match[1] ?? "";
  const command = parseCommandName(rawCommand.toLowerCase());
  if (!command) return localError("unknown_command", `未知命令：${rawCommand}。发送 /帮助 查看可用命令。`);
  if (options.hasMedia) return localError("media_not_allowed", "斜杠命令不能携带图片、语音、视频或文件，请仅发送文字命令。");

  return parseRecognizedCommand(command, (match[2] ?? "").trim());
}

function parseCommandName(command: string): CommandName | undefined {
  switch (command) {
    case "/bind": case "/绑定": return "bind";
    case "/clear": case "/new": case "/新建": return "new_session";
    case "/help": case "/帮助": return "help";
    case "/mode": case "/模式": return "mode";
    case "/model": case "/模型": return "model";
    case "/project": case "/项目": return "project";
    case "/reply": case "/回复": return "reply";
    case "/status": case "/状态": return "status";
    case "/thinking": case "/思考": return "thinking";
    default: return undefined;
  }
}

function parseRecognizedCommand(command: CommandName, argument: string): LocalCommandParseResult {
  switch (command) {
    case "help": case "status": case "new_session":
      return argument ? localError("unexpected_argument", "这个命令不接受参数。") : { kind: command };
    case "bind":
      if (!argument) return localError("missing_argument", "用法：/bind 六位数字");
      return /^\d{6}$/u.test(argument)
        ? { code: argument, kind: "bind" }
        : localError("invalid_bind_code", "绑定码必须是六位数字。用法：/bind 123456");
    case "project":
      if (!argument) return { kind: "project" };
      return isProjectSelector(argument)
        ? { kind: "project", selector: argument }
        : localError("invalid_project", "项目必须使用列表编号或绝对路径；目录是否存在和可读会在切换时校验。");
    case "model":
      return parseTokenSelection(argument, { kind: "model", pattern: /^\d+$|^[^\s/]+\/[^\s/]+$/u, usage: "/模型 [编号|provider/model]" });
    case "mode":
      return parseTokenSelection(argument, { kind: "mode", pattern: /^\d+$|^[\p{L}\p{N}._-]+$/u, usage: "/模式 [编号|agent]" });
    case "thinking":
      return parseTokenSelection(argument, { kind: "thinking", pattern: /^\d+$|^[\p{L}\p{N}._-]+$/u, usage: "/思考 [编号|级别]" });
    case "reply":
      if (!argument) return { kind: "reply" };
      return parseReplyStyle(argument);
  }
}

function parseTokenSelection(argument: string, rule: TokenSelectionRule): LocalCommandParseResult {
  if (!argument) return { kind: rule.kind };
  return rule.pattern.test(argument)
    ? { kind: rule.kind, selector: argument }
    : localError("invalid_argument", `用法：${rule.usage}`);
}

function parseReplyStyle(argument: string): LocalCommandParseResult {
  const normalized = argument.toLowerCase();
  let style: ReplyStyle | undefined;
  switch (normalized) {
    case "concise": case "简洁": style = "concise"; break;
    case "standard": case "标准": style = "standard"; break;
    case "detailed": case "详细": style = "detailed"; break;
  }
  return style
    ? { kind: "reply", style }
    : localError("invalid_argument", "用法：/回复 [简洁|标准|详细]");
}

function isProjectSelector(argument: string): boolean {
  if (/^\d+$/u.test(argument)) return true;
  const isAbsolute = argument.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(argument);
  return isAbsolute && !argument.split(/[\\/]+/u).includes("..");
}

function localError(code: LocalCommandErrorCode, message: string): LocalCommandParseResult {
  return { code, kind: "error", message };
}

export function isPrivilegedLocalCommand(command: LocalCommand): boolean {
  switch (command.kind) {
    case "help": case "bind": return false;
    case "status": case "new_session": case "project": case "model":
    case "mode": case "thinking": case "reply": return true;
    default: return assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new UnexpectedLocalCommandError(value);
}

class UnexpectedLocalCommandError extends Error {
  readonly value: never;

  constructor(value: never) {
    super("Unexpected local command variant");
    this.name = "UnexpectedLocalCommandError";
    this.value = value;
  }
}
