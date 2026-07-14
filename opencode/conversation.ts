import { OPENCODE_PROMPT_TIMEOUT_MS } from "../config";
import { isOpencodeConnectionError } from "./errors";
import {
  getString,
  isObject,
  OpencodeHttpError,
  requestJson,
} from "./http";
import {
  extractResponseError,
  extractResponseText,
  getParts,
} from "./response";
import type {
  OpencodeModel,
  OpencodeConnection,
  OpencodeSession,
  SendPromptOptions,
} from "./types";

type TextPart = {
  readonly type: "text";
  readonly text: string;
};

type PromptBody = {
  readonly parts: readonly TextPart[];
  readonly model?: {
    readonly providerID: string;
    readonly modelID: string;
  };
  readonly agent?: string;
  readonly system?: string;
  readonly variant?: string;
};

type CreateSessionOptions = {
  readonly agent?: string;
  readonly directory?: string;
  readonly model?: OpencodeModel;
};

const SESSION_CREATE_ATTEMPTS = 3;

export async function createLegacySession(params: {
  readonly authHeader: string;
  readonly serverUrl: string;
  readonly retryDelayMs?: number;
}): Promise<string> {
  const retryDelayMs = params.retryDelayMs ?? 2_000;
  let lastError: unknown = new Error("未知错误");

  for (let attempt = 1; attempt <= SESSION_CREATE_ATTEMPTS; attempt++) {
    try {
      const data = await requestJson({
        authHeader: params.authHeader,
        body: {},
        method: "POST",
        path: "/session",
        serverUrl: params.serverUrl,
      });
      const sessionId = extractSessionId(data);
      if (sessionId) return sessionId;
      throw new Error("OpenCode 返回中缺少 session id");
    } catch (error) {
      if (error instanceof OpencodeHttpError && isMissingSessionRoute(error.statusCode)) {
        throw new Error(
          "当前 OpenCode 服务没有暴露兼容的 /session 接口。微信桥接需要 OpenCode 的同步 HTTP 会话接口；请使用仍包含该接口的 OpenCode 稳定版，或等待桥接层适配新版 v2 会话创建接口。",
        );
      }
      lastError = error;
      const retryable = (error instanceof OpencodeHttpError && error.statusCode >= 500)
        || isOpencodeConnectionError(error);
      if (!retryable || attempt === SESSION_CREATE_ATTEMPTS) break;
      process.stderr.write(
        `[opencode] 创建会话失败（第 ${attempt}/${SESSION_CREATE_ATTEMPTS} 次）: ${describeError(error)}，${retryDelayMs}ms 后重试...\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `创建会话失败: ${describeError(lastError)}。可查看 OpenCode 日志定位原因: ~/.local/share/opencode/log/opencode.log`,
  );
}

export async function createOpencodeSession(
  transport: OpencodeConnection,
  options: CreateSessionOptions = {},
): Promise<OpencodeSession> {
  const body = options.model
    ? {
        model: {
          id: options.model.modelID,
          providerID: options.model.providerID,
          ...(options.model.variant ? { variant: options.model.variant } : {}),
        },
      }
    : {};
  const data = await requestJson({
    authHeader: transport.authHeader,
    body,
    method: "POST",
    path: withDirectory("/session", options.directory),
    serverUrl: transport.serverUrl,
  });
  const id = extractSessionId(data);
  if (!id) throw new Error("OpenCode 返回中缺少 session id");
  return {
    id,
    transport,
    ...(options.directory ? { directory: options.directory } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
  };
}

export async function resumeOpencodeSession(
  session: OpencodeSession,
): Promise<OpencodeSession> {
  try {
    await requestJson({
      authHeader: session.transport.authHeader,
      path: withDirectory(
        `/session/${encodeURIComponent(session.id)}`,
        session.directory,
      ),
      serverUrl: session.transport.serverUrl,
    });
    return session;
  } catch (error) {
    if (!(error instanceof OpencodeHttpError) || error.statusCode !== 404) throw error;
    return createOpencodeSession(session.transport, {
      ...(session.agent ? { agent: session.agent } : {}),
      ...(session.directory ? { directory: session.directory } : {}),
      ...(session.model ? { model: session.model } : {}),
    });
  }
}

export async function sendPrompt(
  session: OpencodeSession,
  text: string,
  options: SendPromptOptions = {},
): Promise<string> {
  process.stderr.write(`[opencode] 发送 prompt (${text.length} chars)\n`);
  const data = await requestJson({
    authHeader: session.transport.authHeader,
    body: buildPromptBody(session, text, options),
    method: "POST",
    path: withDirectory(
      `/session/${encodeURIComponent(session.id)}/message`,
      session.directory,
    ),
    serverUrl: session.transport.serverUrl,
    timeoutMs: options.timeoutMs ?? OPENCODE_PROMPT_TIMEOUT_MS,
  });
  const responseText = extractResponseText(data);
  logDebugResponse(data, responseText.length);
  if (!responseText) {
    const modelError = extractResponseError(data);
    if (modelError) throw new Error(`OpenCode 模型调用失败: ${modelError}`);
  }
  process.stderr.write(`[opencode] 收到响应 (${responseText.length} chars)\n`);
  return responseText;
}

function buildPromptBody(
  session: OpencodeSession,
  text: string,
  options: SendPromptOptions,
): PromptBody {
  const model = options.model ?? session.model;
  const variant = options.variant ?? model?.variant;
  return {
    parts: [{ type: "text", text }],
    ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
    ...(options.system ? { system: options.system } : {}),
    ...((options.agent ?? session.agent) ? { agent: options.agent ?? session.agent } : {}),
    ...(variant ? { variant } : {}),
  };
}

function withDirectory(path: string, directory: string | undefined): string {
  if (!directory) return path;
  const query = new URLSearchParams({ directory });
  return `${path}?${query.toString()}`;
}

function extractSessionId(data: unknown): string | undefined {
  if (!isObject(data)) return undefined;
  const id = getString(data, "id");
  if (id) return id;
  const nested = Reflect.get(data, "data");
  return isObject(nested) ? getString(nested, "id") : undefined;
}

function logDebugResponse(data: unknown, responseLength: number): void {
  if (process.env.OPENCODE_WECHAT_DEBUG_RESPONSE !== "1") return;
  const partTypes = getParts(data).map((part) => {
    if (!isObject(part)) return "?";
    return `${getString(part, "type")}:${getString(part, "text")?.length ?? 0}chars`;
  });
  process.stderr.write(
    `[opencode] 调试: parts=[${partTypes.join(", ")}] extracted=${responseLength}chars\n`,
  );
}

function isMissingSessionRoute(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 405;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
