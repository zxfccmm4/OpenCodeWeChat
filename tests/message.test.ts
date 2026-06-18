import { describe, expect, test } from "bun:test";
import { extractMediaFromMessage, parseMessage } from "../core/message";
import type { WeixinMessage } from "../types/wechat";

function imageMessage(overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return {
    client_id: "img-1",
    context_token: "ctx-1",
    create_time_ms: 1_715_810_000_000,
    from_user_id: "wx-user-1",
    item_list: [
      {
        image_item: {
          media: { aes_key: "a2V5", encrypt_query_param: "img-param" },
        },
        type: 2,
      },
    ],
    message_state: 2,
    message_type: 1,
    ...overrides,
  };
}

describe("extractMediaFromMessage", () => {
  test("extracts image, video and file items with download params", () => {
    const media = extractMediaFromMessage({
      item_list: [
        { image_item: { media: { encrypt_query_param: "p1" } }, type: 2 },
        { type: 5, video_item: { media: { encrypt_query_param: "p2" } } },
        {
          file_item: {
            file_name: "doc.pdf",
            media: { encrypt_query_param: "p3" },
          },
          type: 4,
        },
      ],
    });

    expect(media).toEqual([
      { kind: "image", media: { encrypt_query_param: "p1" } },
      { kind: "video", media: { encrypt_query_param: "p2" } },
      { fileName: "doc.pdf", kind: "file", media: { encrypt_query_param: "p3" } },
    ]);
  });

  test("skips voice items that already carry a transcription", () => {
    const media = extractMediaFromMessage({
      item_list: [
        {
          type: 3,
          voice_item: {
            media: { encrypt_query_param: "p1" },
            text: "已转写的内容",
          },
        },
      ],
    });
    expect(media).toEqual([]);
  });

  test("keeps voice items without a transcription", () => {
    const media = extractMediaFromMessage({
      item_list: [
        { type: 3, voice_item: { media: { encrypt_query_param: "p1" } } },
      ],
    });
    expect(media).toEqual([
      { kind: "voice", media: { encrypt_query_param: "p1" } },
    ]);
  });

  test("ignores media items without encrypt_query_param", () => {
    const media = extractMediaFromMessage({
      item_list: [{ image_item: { media: {} }, type: 2 }],
    });
    expect(media).toEqual([]);
  });
});

describe("parseMessage with media", () => {
  test("keeps media-only messages instead of dropping them", () => {
    const parsed = parseMessage(imageMessage());

    expect(parsed).not.toBeNull();
    expect(parsed?.text).toBe("");
    expect(parsed?.media).toEqual([
      { kind: "image", media: { aes_key: "a2V5", encrypt_query_param: "img-param" } },
    ]);
    expect(parsed?.dedupeKey).toBe("client:img-1");
  });

  test("still drops messages with neither text nor media", () => {
    const parsed = parseMessage(imageMessage({ item_list: [] }));
    expect(parsed).toBeNull();
  });

  test("includes media markers in the fallback dedupe key", () => {
    const parsed = parseMessage(imageMessage({ client_id: undefined }));
    expect(parsed?.dedupeKey).toBe(
      "fallback:wx-user-1:1715810000000::img-param",
    );
  });

  test("keeps both text and media for captioned messages", () => {
    const parsed = parseMessage(
      imageMessage({
        item_list: [
          { text_item: { text: "看看这张图" }, type: 1 },
          {
            image_item: { media: { encrypt_query_param: "img-param" } },
            type: 2,
          },
        ],
      }),
    );

    expect(parsed?.text).toBe("看看这张图");
    expect(parsed?.media).toHaveLength(1);
  });
});
