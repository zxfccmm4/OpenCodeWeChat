import { createOpencodeServer } from "@opencode-ai/sdk";

interface OpencodeModel {
  providerID: string;
  modelID: string;
}

interface OpencodeAgent {
  name: string;
  mode: string;
}

export interface OpencodeSession {
  id: string;
  serverUrl: string;
  authHeader: string;
  model?: OpencodeModel;
  agent?: string;
}

function getAuthHeader(): string {
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

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

async function resolveAgentOverride(
  serverUrl: string,
  authHeader: string,
): Promise<string | undefined> {
  const requested = getRequestedAgent();
  if (!requested) return undefined;

  const response = await fetch(`${serverUrl}/agent`, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(
      `读取 OpenCode agent 失败: ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const agents = await response.json() as OpencodeAgent[];
  const normalized = requested.toLowerCase();
  const exact = agents.find((agent) => (
    agent.name === requested || agent.name.toLowerCase() === normalized
  ));

  if (exact) {
    return exact.name;
  }

  if (normalized === "omo" || normalized === "sisyphus") {
    const sisyphus = agents.find((agent) => (
      agent.name === "Sisyphus - Ultraworker" ||
      (agent.mode === "primary" && agent.name.toLowerCase().includes("sisyphus"))
    ));
    if (sisyphus) {
      return sisyphus.name;
    }
  }

  const names = agents.map((agent) => agent.name).slice(0, 20).join(", ");
  throw new Error(`未找到 OpenCode agent: ${requested}. 可用 agent: ${names}`);
}

async function readErrorDetails(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return "";

  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data === "object" && data !== null) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string") return message;

      const dataMessage = (data as { data?: { message?: unknown } }).data
        ?.message;
      if (typeof dataMessage === "string") return dataMessage;

      const errorMessage = (data as { error?: { message?: unknown } }).error
        ?.message;
      if (typeof errorMessage === "string") return errorMessage;
    }
  } catch {
    return text;
  }

  return text;
}

export async function startOpencode(): Promise<OpencodeSession> {
  process.stderr.write("[opencode] 启动 OpenCode 服务器...\n");

  const server = await createOpencodeServer({
    port: 0,
    config: {
      logLevel: "ERROR",
    },
  });

  process.stderr.write(`[opencode] 服务器监听 ${server.url}\n`);

  const authHeader = getAuthHeader();
  const model = getModelOverride();
  const agent = await resolveAgentOverride(server.url, authHeader);

  const response = await fetch(`${server.url}/session`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(
      `创建会话失败: ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const sessionData = await response.json() as { id: string };
  const sessionId = sessionData.id;
  process.stderr.write(`[opencode] 会话已创建: ${sessionId}\n`);
  if (model) {
    process.stderr.write(
      `[opencode] 使用模型: ${model.providerID}/${model.modelID}\n`,
    );
  } else {
    process.stderr.write("[opencode] 使用 OpenCode 默认模型\n");
  }
  if (agent) {
    process.stderr.write(`[opencode] 使用 agent: ${agent}\n`);
  }

  return {
    id: sessionId,
    serverUrl: server.url,
    authHeader,
    model,
    agent,
  };
}

export async function sendPrompt(
  session: OpencodeSession,
  text: string,
): Promise<string> {
  process.stderr.write(`[opencode] 发送 prompt: ${text.slice(0, 50)}...\n`);

  const body: {
    parts: Array<{ type: "text"; text: string }>;
    model?: OpencodeModel;
    agent?: string;
  } = {
    parts: [{ type: "text", text }],
  };

  if (session.model) {
    body.model = session.model;
  }
  if (session.agent) {
    body.agent = session.agent;
  }

  const response = await fetch(
    `${session.serverUrl}/session/${session.id}/message`,
    {
      method: "POST",
      headers: {
        Authorization: session.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(
      `Prompt 失败: ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const promptData = await response.json() as {
    parts?: Array<{ type: string; text?: string }>;
  };
  const parts = promptData.parts || [];

  const textParts = parts.filter(
    (p: { type: string; text?: string }) => p.type === "text",
  ) as Array<{ type: "text"; text: string }>;

  const responseText = textParts.map((p) => p.text).join("\n");
  process.stderr.write(`[opencode] 响应: ${responseText.slice(0, 100)}...\n`);

  return responseText;
}
