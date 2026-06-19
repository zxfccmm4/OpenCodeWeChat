import { afterEach, describe, expect, test } from "bun:test";
import { sendTextMessage } from "../api/ilink";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sendTextMessage", () => {
  test("sends ClawBot-compatible FINISH text messages", async () => {
    const bodies: unknown[] = [];
    const mockFetch: typeof fetch = Object.assign(async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });
    globalThis.fetch = mockFetch;

    await sendTextMessage(
      "https://ilink.example",
      "token-1",
      "wx-user",
      "完整回复",
      "ctx-1",
      "client-1",
      "test-version",
    );

    expect(bodies).toEqual([
      {
        base_info: { channel_version: "test-version" },
        msg: {
          client_id: "client-1",
          context_token: "ctx-1",
          from_user_id: "",
          item_list: [{ text_item: { text: "完整回复" }, type: 1 }],
          message_state: 2,
          message_type: 2,
          to_user_id: "wx-user",
        },
      },
    ]);
  });
});
