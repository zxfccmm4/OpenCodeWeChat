/**
 * Execute parsed local slash commands for a WeChat sender.
 *
 * Help/bind are public; privileged commands require an active binding.
 * List-without-selector commands return a numbered menu; selectors apply
 * and persist preferences via UserSessionManager + OpencodeDiscovery.
 */
import type {
  LocalCommand,
  ReplyStyle,
} from "./local-command-contract.js";
import {
  buildActivationMessage,
  buildHelpMessage,
  buildStatusMessage,
  buildUnboundMessage,
} from "./local-command-copy.js";
import { isPrivilegedLocalCommand } from "./local-command.js";
import type { OpencodeDiscovery } from "../opencode/discovery.js";
import { OpencodeDiscoveryError } from "../opencode/discovery.js";
import type {
  AgentOption,
  ModelOption,
} from "../opencode/discovery-types.js";
import type { UserSessionManager } from "../opencode/user-session-manager.js";
import {
  UserSessionNotBoundError,
} from "../opencode/user-session-manager.js";
import type { BindingService } from "../storage/binding-types.js";
import type {
  AccountScopeInput,
  BotBinding,
} from "../storage/bot-state-types.js";

export type LocalCommandHandlerDeps = {
  readonly bindingService: BindingService;
  readonly discovery: OpencodeDiscovery;
  readonly scope: AccountScopeInput;
  readonly sessions: UserSessionManager;
  readonly defaultDirectory: string;
  readonly sessionStateOf?: (
    binding: BotBinding,
  ) => "busy" | "error" | "idle" | "retry" | "stale";
};

export type LocalCommandHandleResult = {
  readonly reply: string;
  readonly kind: LocalCommand["kind"] | "error" | "unbound";
};

export async function handleLocalCommand(params: {
  readonly command: LocalCommand;
  readonly deps: LocalCommandHandlerDeps;
  readonly senderId: string;
}): Promise<LocalCommandHandleResult> {
  const { command, deps, senderId } = params;

  if (command.kind === "help") {
    return { kind: "help", reply: buildHelpMessage() };
  }

  if (command.kind === "bind") {
    return handleBind(command.code, senderId, deps);
  }

  if (isPrivilegedLocalCommand(command)) {
    const binding = await deps.sessions.peekBinding(senderId);
    if (!binding) {
      return { kind: "unbound", reply: buildUnboundMessage() };
    }
  }

  try {
    switch (command.kind) {
      case "status":
        return handleStatus(senderId, deps);
      case "new_session":
        return handleNewSession(senderId, deps);
      case "project":
        return handleProject(command.selector, senderId, deps);
      case "model":
        return handleModel(command.selector, senderId, deps);
      case "mode":
        return handleMode(command.selector, senderId, deps);
      case "thinking":
        return handleThinking(command.selector, senderId, deps);
      case "reply":
        return handleReply(command.style, senderId, deps);
      default:
        return assertNever(command);
    }
  } catch (error) {
    if (error instanceof UserSessionNotBoundError) {
      return { kind: "unbound", reply: buildUnboundMessage() };
    }
    if (error instanceof OpencodeDiscoveryError) {
      return {
        kind: "error",
        reply: discoveryErrorMessage(error),
      };
    }
    throw error;
  }
}

async function handleBind(
  code: string,
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const result = await deps.bindingService.consumeCode(deps.scope, senderId, code);
  switch (result.status) {
    case "bound":
      return {
        kind: "bind",
        reply: buildActivationMessage(),
      };
    case "already-bound":
      return {
        kind: "bind",
        reply: "当前聊天已绑定。发送 /帮助 查看命令，或直接描述你要做的事。",
      };
    case "expired":
      return {
        kind: "error",
        reply: "绑定码已过期。请在 OpenCodeWeChat 控制台重新生成一次性绑定码。",
      };
    case "invalid":
      return {
        kind: "error",
        reply: "绑定码无效。请确认六位数字后重试，或在控制台重新生成。",
      };
    case "rate-limited":
      return {
        kind: "error",
        reply: "绑定码错误次数过多，请稍后再试或在控制台重新生成绑定码。",
      };
    default:
      return assertNever(result);
  }
}

async function handleStatus(
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const resolved = await deps.sessions.resolve(senderId);
  const binding = resolved.binding;
  const model = binding.model
    ? `${binding.model.providerId}/${binding.model.modelId}`
    : "默认";
  const reply = buildStatusMessage({
    agent: binding.agent ?? "默认",
    bound: true,
    model,
    project: binding.directory ?? deps.defaultDirectory,
    replyStyle: binding.replyStyle,
    sessionId: resolved.session.id,
    sessionState: deps.sessionStateOf?.(binding) ?? "idle",
    variant: binding.variant ?? "默认",
  });
  return { kind: "status", reply };
}

async function handleNewSession(
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const resolved = await deps.sessions.reset(senderId, "new");
  return {
    kind: "new_session",
    reply: [
      "已开始新的任务草稿。",
      `Session：${shortId(resolved.session.id)}`,
      `项目：${resolved.binding.directory ?? deps.defaultDirectory}`,
      "偏好设置已保留；最近一次 #plan 上下文已清除。",
    ].join("\n"),
  };
}

async function handleProject(
  selector: string | undefined,
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const binding = await requireBinding(senderId, deps);
  const directory = binding.directory ?? deps.defaultDirectory;
  if (!selector) {
    const projects = await deps.discovery.listProjects(directory);
    if (projects.length === 0) {
      return {
        kind: "project",
        reply: [
          "当前没有发现可切换的工作区。",
          `当前：${directory}`,
          "用法：/项目 <绝对路径>",
        ].join("\n"),
      };
    }
    const lines = projects.map((project, index) => `${index + 1}. ${project.path}`);
    return {
      kind: "project",
      reply: [
        "可选工作区：",
        ...lines,
        "",
        `当前：${directory}`,
        "用法：/项目 <编号|绝对路径>",
      ].join("\n"),
    };
  }
  const selected = await deps.discovery.selectProject(directory, selector);
  const resolved = await deps.sessions.updatePreferences(senderId, {
    directory: selected,
  });
  return {
    kind: "project",
    reply: [
      "已切换工作区。",
      `项目：${resolved.binding.directory ?? selected}`,
      `Session：${shortId(resolved.session.id)}（新草稿）`,
    ].join("\n"),
  };
}

async function handleModel(
  selector: string | undefined,
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const binding = await requireBinding(senderId, deps);
  const directory = binding.directory ?? deps.defaultDirectory;
  if (!selector) {
    const models = await deps.discovery.listModels(directory);
    return {
      kind: "model",
      reply: formatModelList(models, binding),
    };
  }
  const selected = await deps.discovery.selectModel(
    directory,
    selector,
    binding.variant,
  );
  const resolved = await deps.sessions.updatePreferences(senderId, {
    model: {
      modelId: selected.model.modelID,
      providerId: selected.model.providerID,
    },
    ...(selected.variant
      ? { variant: selected.variant }
      : { clearVariant: true }),
  });
  const modelLabel = resolved.binding.model
    ? `${resolved.binding.model.providerId}/${resolved.binding.model.modelId}`
    : "默认";
  return {
    kind: "model",
    reply: [
      "已切换模型。",
      `模型：${modelLabel}`,
      `思考：${resolved.binding.variant ?? "默认"}`,
    ].join("\n"),
  };
}

async function handleMode(
  selector: string | undefined,
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const binding = await requireBinding(senderId, deps);
  const directory = binding.directory ?? deps.defaultDirectory;
  if (!selector) {
    const agents = await deps.discovery.listAgents(directory);
    return {
      kind: "mode",
      reply: formatAgentList(agents, binding),
    };
  }
  const selected = await deps.discovery.selectAgent(directory, selector);
  const resolved = await deps.sessions.updatePreferences(senderId, {
    agent: selected,
  });
  return {
    kind: "mode",
    reply: `已切换运行模式：${resolved.binding.agent ?? selected}`,
  };
}

async function handleThinking(
  selector: string | undefined,
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  const binding = await requireBinding(senderId, deps);
  const directory = binding.directory ?? deps.defaultDirectory;
  if (!binding.model) {
    return {
      kind: "error",
      reply: "请先用 /模型 选择模型，再切换思考级别。",
    };
  }
  const model = {
    modelID: binding.model.modelId,
    providerID: binding.model.providerId,
  };
  if (!selector) {
    const variants = await deps.discovery.listVariants(directory, model);
    if (variants.length === 0) {
      return {
        kind: "thinking",
        reply: [
          "当前模型没有可切换的思考级别。",
          `模型：${binding.model.providerId}/${binding.model.modelId}`,
        ].join("\n"),
      };
    }
    const lines = variants.map((variant, index) => `${index + 1}. ${variant}`);
    return {
      kind: "thinking",
      reply: [
        "可选思考级别：",
        ...lines,
        "",
        `当前：${binding.variant ?? "默认"}`,
        "用法：/思考 <编号|级别>",
      ].join("\n"),
    };
  }
  const selected = await deps.discovery.selectVariant(directory, model, selector);
  const resolved = await deps.sessions.updatePreferences(senderId, {
    variant: selected,
  });
  return {
    kind: "thinking",
    reply: `已切换思考级别：${resolved.binding.variant ?? selected}`,
  };
}

async function handleReply(
  style: ReplyStyle | undefined,
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<LocalCommandHandleResult> {
  if (!style) {
    const binding = await requireBinding(senderId, deps);
    return {
      kind: "reply",
      reply: [
        "可选回复详细程度：",
        "1. 简洁（concise）",
        "2. 标准（standard）",
        "3. 详细（detailed）",
        "",
        `当前：${replyStyleLabel(binding.replyStyle)}`,
        "用法：/回复 [简洁|标准|详细]",
      ].join("\n"),
    };
  }
  const resolved = await deps.sessions.updatePreferences(senderId, {
    replyStyle: style,
  });
  return {
    kind: "reply",
    reply: `已切换回复详细程度：${replyStyleLabel(resolved.binding.replyStyle)}`,
  };
}

async function requireBinding(
  senderId: string,
  deps: LocalCommandHandlerDeps,
): Promise<BotBinding> {
  const binding = await deps.sessions.peekBinding(senderId);
  if (!binding) throw new UserSessionNotBoundError(senderId);
  return binding;
}

function formatModelList(models: readonly ModelOption[], binding: BotBinding): string {
  const current = binding.model
    ? `${binding.model.providerId}/${binding.model.modelId}`
    : "默认";
  if (models.length === 0) {
    return [
      "当前工作区没有可用模型。",
      `当前：${current}`,
      "用法：/模型 <编号|provider/model>",
    ].join("\n");
  }
  const lines = models.map((model, index) => {
    const mark = model.value === current ? " ← 当前" : "";
    return `${index + 1}. ${model.value}${mark}`;
  });
  return [
    "可选模型：",
    ...lines,
    "",
    `当前：${current}`,
    "用法：/模型 <编号|provider/model>",
  ].join("\n");
}

function formatAgentList(agents: readonly AgentOption[], binding: BotBinding): string {
  const current = binding.agent ?? "默认";
  if (agents.length === 0) {
    return [
      "当前工作区没有可用运行模式。",
      `当前：${current}`,
      "用法：/模式 <编号|agent>",
    ].join("\n");
  }
  const lines = agents.map((agent, index) => {
    const mark = agent.value === current ? " ← 当前" : "";
    return `${index + 1}. ${agent.value}${mark}`;
  });
  return [
    "可选运行模式：",
    ...lines,
    "",
    `当前：${current}`,
    "用法：/模式 <编号|agent>",
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

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function discoveryErrorMessage(error: OpencodeDiscoveryError): string {
  switch (error.code) {
    case "invalid_path":
      return `路径无效：${error.message}`;
    case "invalid_selection":
      return `${error.message}。发送对应命令（不带参数）可查看可选列表。`;
    case "stale_snapshot":
      return `${error.message}。请重新发送命令查看最新列表后再选编号。`;
    default:
      return error.message;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected local command variant: ${JSON.stringify(value)}`);
}
