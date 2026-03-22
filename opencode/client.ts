import { createOpencodeServer } from "@opencode-ai/sdk";

export interface OpencodeSession {
  id: string;
  serverUrl: string;
  authHeader: string;
}

function getAuthHeader(): string {
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
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

  const response = await fetch(`${server.url}/session`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`创建会话失败: ${response.status}`);
  }

  const sessionData = await response.json() as { id: string };
  const sessionId = sessionData.id;
  process.stderr.write(`[opencode] 会话已创建: ${sessionId}\n`);

  return {
    id: sessionId,
    serverUrl: server.url,
    authHeader,
  };
}

export async function sendPrompt(
  session: OpencodeSession,
  text: string,
): Promise<string> {
  process.stderr.write(`[opencode] 发送 prompt: ${text.slice(0, 50)}...\n`);

  const response = await fetch(
    `${session.serverUrl}/session/${session.id}/message`,
    {
      method: "POST",
      headers: {
        Authorization: session.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parts: [{ type: "text", text }],
        model: {
          providerID: "minimax-cn",
          modelID: "MiniMax-M2.7",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Prompt 失败: ${response.status}`);
  }

  const promptData = await response.json() as { parts?: Array<{ type: string; text?: string }> };
  const parts = promptData.parts || [];

  const textParts = parts.filter(
    (p: { type: string; text?: string }) => p.type === "text",
  ) as Array<{ type: "text"; text: string }>;

  const responseText = textParts.map((p) => p.text).join("\n");
  process.stderr.write(`[opencode] 响应: ${responseText.slice(0, 100)}...\n`);

  return responseText;
}
