import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AccountData } from "../types/wechat";
import { sendTextMessage, generateClientId } from "../api/ilink";
import { getCachedContextToken } from "../core/context-token";
import { CHANNEL_NAME, CHANNEL_VERSION } from "../config.js";

export function createToolHandlers(
  mcp: Server,
  getAccount: () => AccountData | null,
) {
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "wechat_reply",
        description: "Send a text reply back to the WeChat user",
        inputSchema: {
          type: "object" as const,
          properties: {
            sender_id: {
              type: "string",
              description:
                "The sender_id from the inbound <channel> tag (xxx@im.wechat format)",
            },
            text: {
              type: "string",
              description: "The plain-text message to send (no markdown)",
            },
          },
          required: ["sender_id", "text"],
        },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "wechat_reply") {
      const { sender_id, text } = req.params.arguments as {
        sender_id: string;
        text: string;
      };
      const account = getAccount();
      if (!account) {
        return {
          content: [{ type: "text" as const, text: "error: not logged in" }],
        };
      }
      const contextToken = getCachedContextToken(sender_id);
      if (!contextToken) {
        return {
          content: [
            {
              type: "text" as const,
              text: `error: no context_token for ${sender_id}. The user may need to send a message first.`,
            },
          ],
        };
      }
      try {
        await sendTextMessage(
          account.baseUrl,
          account.token,
          sender_id,
          text,
          contextToken,
          generateClientId(),
          CHANNEL_VERSION,
        );
        return { content: [{ type: "text" as const, text: "sent" }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `send failed: ${String(err)}` }],
        };
      }
    }
    throw new Error(`unknown tool: ${req.params.name}`);
  });
}
