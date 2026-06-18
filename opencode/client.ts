import {
  loadAgents,
  resolveRequestedAgent,
} from "./agents";
import {
  getString,
  isObject,
  requestJson,
  OpencodeHttpError,
} from "./http";
import { startOpencodeServer } from "./server";
import type {
  OpencodeModel,
  OpencodeSession,
  SendPromptOptions,
} from "./types";

export type { OpencodeSession } from "./types";

type TextPart = {
  readonly type: "text";
  readonly text: string;
};

type PromptBody = {
  readonly parts: readonly TextPart[];
  readonly model?: OpencodeModel;
  readonly agent?: string;
  readonly system?: string;
};

function getModelOverride(): OpencodeModel | undefined {
  const providerID = process.env.OPENCODE_PROVIDER_ID?.trim();
  const modelID = process.env.OPENCODE_MODEL_ID?.trim();

  if (!providerID && !modelID) return undefined;
  if (!providerID || !modelID) {
    throw new Error(
      "OPENCODE_PROVIDER_ID 和 OPENCODE_MODEL_ID 必须同时设置，或同时不设置以使用 OpenCode 默认模型",
    );
  }

  return { providerID, modelID };
}

function getRequestedAgent(): string | undefined {
  return process.env.OPENCODE_AGENT?.trim() || undefined;
}

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
    } catch (err) {
      if (err instanceof OpencodeHttpError && isMissingLegacySessionRoute(err.statusCode)) {
        throw new Error(
          "当前 OpenCode 服务没有暴露兼容的 /session 接口。微信桥接需要 OpenCode 的同步 HTTP 会话接口；请使用仍包含该接口的 OpenCode 稳定版，或等待桥接层适配新版 v2 会话创建接口。",
        );
      }
      lastError = err;
      // 5xx 多为 OpenCode 初始化期间的瞬时错误（如远程配置拉取失败），值得重试
      const retryable = (err instanceof OpencodeHttpError && err.statusCode >= 500)
        || isOpencodeConnectionError(err);
      if (!retryable || attempt === SESSION_CREATE_ATTEMPTS) break;
      process.stderr.write(
        `[opencode] 创建会话失败（第 ${attempt}/${SESSION_CREATE_ATTEMPTS} 次）: ${describeError(err)}，${retryDelayMs}ms 后重试...\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `创建会话失败: ${describeError(lastError)}。可查看 OpenCode 日志定位原因: ~/.local/share/opencode/log/opencode.log`,
  );
}

function extractSessionId(data: unknown): string | undefined {
  if (!isObject(data)) return undefined;

  const id = getString(data, "id");
  if (id) return id;

  const nested = Reflect.get(data, "data");
  return isObject(nested) ? getString(nested, "id") : undefined;
}

async function loadAgentList(params: {
  readonly authHeader: string;
  readonly requestedAgent?: string;
  readonly serverUrl: string;
}) {
  try {
    return await loadAgents(params);
  } catch (err) {
    if (params.requestedAgent) {
      throw new Error(`读取 OpenCode agent 失败: ${describeError(err)}`);
    }
    process.stderr.write("[opencode] 未发现可用 agent 列表，使用会话默认 agent\n");
    return [];
  }
}

export async function startOpencode(): Promise<OpencodeSession> {
  process.stderr.write("[opencode] 启动 OpenCode 服务器...\n");

  const server = await startOpencodeServer();

  try {
    process.stderr.write(`[opencode] 服务器监听 ${server.url}\n`);

    const authHeader = server.authHeader;
    const model = getModelOverride();
    const requestedAgent = getRequestedAgent();
    const agents = await loadAgentList({
      authHeader,
      requestedAgent,
      serverUrl: server.url,
    });
    const agent = requestedAgent
      ? resolveRequestedAgent(requestedAgent, agents)
      : undefined;

    const sessionId = await createLegacySession({
      authHeader,
      serverUrl: server.url,
    });

    process.stderr.write(`[opencode] 会话已创建: ${sessionId}\n`);
    process.stderr.write(
      model
        ? `[opencode] 使用模型: ${model.providerID}/${model.modelID}\n`
        : "[opencode] 使用 OpenCode 默认模型\n",
    );
    if (agent) process.stderr.write(`[opencode] 使用 agent: ${agent}\n`);
    if (agents.length > 0) process.stderr.write(`[opencode] 已发现 ${agents.length} 个 agent\n`);

    return {
      id: sessionId,
      serverUrl: server.url,
      authHeader,
      model,
      agent,
      agents,
      close() {
        server.close();
      },
    };
  } catch (err) {
    server.close();
    throw err;
  }
}

/**
 * 判断错误是否是"OpenCode 服务器不可达"一类的连接错误。
 * Bun 的 fetch 在连接被拒时抛 "Unable to connect. Is the computer able to access the url?"。
 */
export function isOpencodeConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.name}: ${err.message}`.toLowerCase();
  return (
    text.includes("unable to connect")
    || text.includes("econnrefused")
    || text.includes("connection refused")
    || text.includes("connectionrefused")
    || text.includes("connection closed")
    || text.includes("socket connection was closed")
    || text.includes("fetch failed")
  );
}

/**
 * OpenCode 服务进程死掉后重建：关闭旧会话（杀掉残留子进程），
 * 重新拉起 `opencode serve` 并创建新会话。
 */
export async function restartOpencode(
  previous: OpencodeSession,
): Promise<OpencodeSession> {
  try {
    previous.close();
  } catch {
    // 旧进程可能已经死了
  }
  return startOpencode();
}

export async function sendPrompt(
  session: OpencodeSession,
  text: string,
  options: SendPromptOptions = {},
): Promise<string> {  process.stderr.write(`[opencode] 发送 prompt (${text.length} chars)\n`);

  const body = buildPromptBody(session, text, options);
  const data = await requestJson({
    authHeader: session.authHeader,
    body,
    method: "POST",
    path: `/session/${encodeURIComponent(session.id)}/message`,
    serverUrl: session.serverUrl,
  });

  const responseText = extractResponseText(data);
  if (!responseText) {
    // 新版 OpenCode 在模型调用失败时返回 200 + 空 parts，错误藏在 info.error 里
    // （例如 "Token refresh failed: 401"）；把它抛出来走失败重试/通知链路
    const modelError = extractResponseError(data);
    if (modelError) {
      throw new Error(`OpenCode 模型调用失败: ${modelError}`);
    }
  }
  process.stderr.write(`[opencode] 收到响应 (${responseText.length} chars)\n`);

  return responseText;
}

function extractResponseError(data: unknown): string | undefined {
  if (!isObject(data)) return undefined;
  const info = Reflect.get(data, "info");
  if (!isObject(info)) return undefined;
  const error = Reflect.get(info, "error");
  if (!isObject(error)) return undefined;
  const nested = Reflect.get(error, "data");
  const message = isObject(nested) ? getString(nested, "message") : undefined;
  return message || getString(error, "name");
}

function buildPromptBody(
  session: OpencodeSession,
  text: string,
  options: SendPromptOptions,
): PromptBody {
  const base: PromptBody = {
    parts: [{ type: "text", text }],
  };
  const withModel = session.model ? { ...base, model: session.model } : base;
  const withSystem = options.system ? { ...withModel, system: options.system } : withModel;
  const agent = options.agent ?? session.agent;
  return agent ? { ...withSystem, agent } : withSystem;
}

function extractResponseText(data: unknown): string {
  return getParts(data)
    .map(getTextPart)
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function getParts(data: unknown): readonly unknown[] {
  if (!isObject(data)) return [];

  const parts = Reflect.get(data, "parts");
  if (Array.isArray(parts)) return parts;

  const nested = Reflect.get(data, "data");
  if (!isObject(nested)) return [];

  const nestedParts = Reflect.get(nested, "parts");
  return Array.isArray(nestedParts) ? nestedParts : [];
}

function getTextPart(part: unknown): string | undefined {
  if (!isObject(part)) return undefined;
  const type = getString(part, "type");
  const text = getString(part, "text");
  return type === "text" && text ? text : undefined;
}

function isMissingLegacySessionRoute(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 405;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
