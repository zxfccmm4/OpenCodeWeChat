import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CHANNEL_NAME, CHANNEL_VERSION } from "../config.js";
import { createToolHandlers } from "./tools.js";
import type { AccountData } from "../types/wechat.js";

export async function createMcpServer(
  getAccount: () => AccountData | null,
): Promise<Server> {
  const mcp = new Server(
    { name: CHANNEL_NAME, version: CHANNEL_VERSION },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        `Messages from WeChat users arrive as <channel source="wechat" sender="..." sender_id="...">.`,
        "Reply using the wechat_reply tool. You MUST pass the sender_id from the inbound tag.",
        "Messages are from real WeChat users via the WeChat ClawBot interface.",
        "Respond naturally in Chinese unless the user writes in another language.",
        "Keep replies concise — WeChat is a chat app, not an essay platform.",
        "Strip markdown formatting (WeChat doesn't render it). Use plain text.",
      ].join("\n"),
    },
  );

  createToolHandlers(mcp, getAccount);

  await mcp.connect(new StdioServerTransport());

  return mcp;
}
