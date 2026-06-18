import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { aesEcbPaddedSize, inferMediaKind, sendMediaMessage } from "../api/media";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sendMediaMessage", () => {
  test("uploads an image and sends an image message item", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-wechat-media-"));
    const imagePath = path.join(tempDir, "result.png");
    await fs.writeFile(imagePath, Buffer.from("fake-image"));
    const requests: Array<{ body?: unknown; url: string }> = [];

    const mockFetch: typeof fetch = Object.assign(async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/ilink/bot/getuploadurl")) {
        requests.push({ body: JSON.parse(String(init?.body)), url });
        return Response.json({ upload_param: "upload-param" });
      }
      if (url.includes("/upload?")) {
        requests.push({ url });
        return new Response("", {
          headers: { "x-encrypted-param": "download-param" },
          status: 200,
        });
      }
      if (url.endsWith("/ilink/bot/sendmessage")) {
        requests.push({ body: JSON.parse(String(init?.body)), url });
        return Response.json({});
      }
      throw new Error(`unexpected url: ${url}`);
    }, { preconnect: originalFetch.preconnect });
    globalThis.fetch = mockFetch;

    await sendMediaMessage({
      baseUrl: "https://ilink.example",
      cdnBaseUrl: "https://cdn.example/c2c",
      channelVersion: "test-version",
      clientId: "client-1",
      contextToken: "ctx-1",
      filePath: imagePath,
      kind: "image",
      text: "结果图",
      to: "wx-user",
      token: "token-1",
    });

    const uploadRequest = requests[0]?.body as Record<string, unknown>;
    expect(uploadRequest.media_type).toBe(1);
    expect(uploadRequest.rawsize).toBe(10);
    expect(uploadRequest.filesize).toBe(aesEcbPaddedSize(10));
    expect(uploadRequest.rawfilemd5).toBe(
      crypto.createHash("md5").update(Buffer.from("fake-image")).digest("hex"),
    );

    const captionRequest = requests[2]?.body as {
      msg: { item_list: Array<{ text_item?: { text?: string }; type?: number }> };
    };
    expect(captionRequest.msg.item_list).toEqual([
      { type: 1, text_item: { text: "结果图" } },
    ]);

    const mediaRequest = requests[3]?.body as {
      msg: {
        item_list: Array<{
          image_item?: {
            media?: { aes_key?: string; encrypt_query_param?: string; encrypt_type?: number };
            mid_size?: number;
          };
          type?: number;
        }>;
      };
    };
    expect(mediaRequest.msg.item_list[0]?.type).toBe(2);
    expect(mediaRequest.msg.item_list[0]?.image_item?.media?.encrypt_query_param).toBe(
      "download-param",
    );
    expect(mediaRequest.msg.item_list[0]?.image_item?.media?.encrypt_type).toBe(1);
    // 官方客户端要求 aes_key 解码后是 32 个 hex 字符，否则手机端无法下载解密
    const aesKey = mediaRequest.msg.item_list[0]?.image_item?.media?.aes_key ?? "";
    expect(Buffer.from(aesKey, "base64").toString("ascii")).toMatch(/^[0-9a-f]{32}$/);
    expect(mediaRequest.msg.item_list[0]?.image_item?.mid_size).toBe(aesEcbPaddedSize(10));

    await fs.rm(tempDir, { force: true, recursive: true });
  });
});

describe("inferMediaKind", () => {
  test("classifies common media extensions", () => {
    expect(inferMediaKind("/tmp/a.jpg")).toBe("image");
    expect(inferMediaKind("/tmp/a.mp4")).toBe("video");
    expect(inferMediaKind("/tmp/a.pdf")).toBe("file");
  });
});
