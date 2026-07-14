import {
  loadAgents,
  resolveRequestedAgent,
} from "./agents";
import {
  createOpencodeSession,
} from "./conversation";
import { startOpencodeServer } from "./server";
import { OpencodeTransportManager } from "./transport-manager";
import type {
  OpencodeModel,
  OpencodeSession,
  OpencodeTransport,
} from "./types";

export {
  createLegacySession,
  createOpencodeSession,
  resumeOpencodeSession,
  sendPrompt,
} from "./conversation";
export { isOpencodeConnectionError } from "./errors";
export {
  canonicalizeProjectPath,
  OpencodeDiscovery,
  OpencodeDiscoveryError,
} from "./discovery";
export {
  OpencodeTransportClosedError,
  OpencodeTransportManager,
} from "./transport-manager";
export type {
  AgentOption,
  DiscoveryListKind,
  DiscoverySnapshot,
  DiscoverySnapshotStore,
  ModelOption,
  ProjectOption,
  ReconciledModelSelection,
} from "./discovery-types";
export type {
  OpencodeConnection,
  OpencodeModel,
  OpencodeSession,
  OpencodeTransport,
} from "./types";

export type OpencodeRuntime = {
  readonly manager: OpencodeTransportManager;
  readonly session: OpencodeSession;
};

export function getModelOverride(): OpencodeModel | undefined {
  const providerID = process.env.OPENCODE_PROVIDER_ID?.trim();
  const modelID = process.env.OPENCODE_MODEL_ID?.trim();

  if (!providerID && !modelID) return undefined;
  if (!providerID || !modelID) {
    throw new Error(
      "OPENCODE_PROVIDER_ID 和 OPENCODE_MODEL_ID 必须同时设置；不设置时会使用 OpenCode / OMO 自己配置的默认模型",
    );
  }
  return { providerID, modelID };
}

function getRequestedAgent(): string | undefined {
  return process.env.OPENCODE_AGENT?.trim() || undefined;
}

async function loadAgentList(params: {
  readonly authHeader: string;
  readonly requestedAgent?: string;
  readonly serverUrl: string;
}) {
  try {
    return await loadAgents(params);
  } catch (error) {
    if (params.requestedAgent) {
      throw new Error(`读取 OpenCode agent 失败: ${describeError(error)}`);
    }
    process.stderr.write("[opencode] 未发现可用 agent 列表，使用会话默认 agent\n");
    return [];
  }
}

export async function startOpencodeTransport(): Promise<OpencodeTransport> {
  process.stderr.write("[opencode] 启动 OpenCode 服务器...\n");
  const server = await startOpencodeServer();
  try {
    process.stderr.write(`[opencode] 服务器监听 ${server.url}\n`);
    const requestedAgent = getRequestedAgent();
    const agents = await loadAgentList({
      authHeader: server.authHeader,
      requestedAgent,
      serverUrl: server.url,
    });
    if (agents.length > 0) {
      process.stderr.write(`[opencode] 已发现 ${agents.length} 个 agent\n`);
    }
    return {
      agents,
      authHeader: server.authHeader,
      close: server.close,
      serverUrl: server.url,
    };
  } catch (error) {
    server.close();
    throw error;
  }
}

export async function startOpencode(): Promise<OpencodeRuntime> {
  const transport = await startOpencodeTransport();
  const manager = new OpencodeTransportManager(transport, startOpencodeTransport);
  try {
    const model = getModelOverride();
    const requestedAgent = getRequestedAgent();
    const agent = requestedAgent
      ? resolveRequestedAgent(requestedAgent, transport.agents)
      : undefined;
    const session = await createOpencodeSession(manager.current(), {
      ...(agent ? { agent } : {}),
      directory: process.cwd(),
      ...(model ? { model } : {}),
    });
    process.stderr.write(`[opencode] 会话已创建: ${session.id}\n`);
    process.stderr.write(
      model
        ? `[opencode] 使用模型: ${model.providerID}/${model.modelID}\n`
        : "[opencode] 使用 OpenCode / OMO 配置的默认模型\n",
    );
    if (agent) process.stderr.write(`[opencode] 使用 agent: ${agent}\n`);
    return { manager, session };
  } catch (error) {
    manager.close();
    throw error;
  }
}

export async function restartOpencode(
  previous: OpencodeRuntime,
): Promise<OpencodeRuntime> {
  const connection = await previous.manager.restart(
    previous.session.transport.generation,
  );
  const session = await createOpencodeSession(connection, {
    ...(previous.session.agent ? { agent: previous.session.agent } : {}),
    ...(previous.session.directory ? { directory: previous.session.directory } : {}),
    ...(previous.session.model ? { model: previous.session.model } : {}),
  });
  return { manager: previous.manager, session };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
