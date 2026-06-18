import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  decryptAesEcb,
  downloadAndDecryptMedia,
  downloadIncomingMedia,
  parseAesKey,
  sanitizeFilename,
  saveToInbox,
} from "../api/media-download";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function mockCdnFetch(params: {
  readonly ciphertext: Buffer;
  readonly requests: string[];
}): typeof fetch {
  return Object.assign(async (
    input: Parameters<typeof fetch>[0],
  ): Promise<Response> => {
    const url = String(input);
    params.requests.push(url);
    if (url.includes("/download?")) {
      return new Response(new Uint8Array(params.ciphertext), { status: 200 });
    }
    throw new Error(`unexpected url: ${url}`);
  }, { preconnect: originalFetch.preconnect });
}

describe("parseAesKey", () => {
  test("accepts a base64-encoded 16-byte raw key", () => {
    const key = crypto.randomBytes(16);
    const parsed = parseAesKey({ aes_key: key.toString("base64") });
    expect(parsed?.equals(key)).toBe(true);
  });

  test("accepts a base64-encoded 32-char hex key (send-side format)", () => {
    const key = crypto.randomBytes(16);
    const hexEncoded = Buffer.from(key.toString("hex"), "utf-8").toString("base64");
    const parsed = parseAesKey({ aes_key: hexEncoded });
    expect(parsed?.equals(key)).toBe(true);
  });

  test("returns null when the key is missing", () => {
    expect(parseAesKey({})).toBeNull();
    expect(parseAesKey({ aes_key: "" })).toBeNull();
  });
});

describe("decryptAesEcb", () => {
  test("round-trips with AES-128-ECB encryption", () => {
    const key = crypto.randomBytes(16);
    const plaintext = Buffer.from("机密文件内容 hello world");
    expect(decryptAesEcb(encryptAesEcb(plaintext, key), key).equals(plaintext)).toBe(true);
  });
});

describe("downloadAndDecryptMedia", () => {
  test("downloads from the CDN /download endpoint and decrypts", async () => {
    const key = crypto.randomBytes(16);
    const plaintext = Buffer.from("downloaded-image-bytes");
    const requests: string[] = [];
    globalThis.fetch = mockCdnFetch({
      ciphertext: encryptAesEcb(plaintext, key),
      requests,
    });

    const result = await downloadAndDecryptMedia(
      "dl-param",
      key,
      "https://cdn.example/c2c",
    );

    expect(result.equals(plaintext)).toBe(true);
    expect(requests).toEqual([
      "https://cdn.example/c2c/download?encrypted_query_param=dl-param",
    ]);
  });

  test("throws on a non-2xx CDN response", async () => {
    globalThis.fetch = Object.assign(async (): Promise<Response> => {
      return new Response("gone", { status: 404 });
    }, { preconnect: originalFetch.preconnect });

    expect(
      downloadAndDecryptMedia("dl-param", crypto.randomBytes(16), "https://cdn.example/c2c"),
    ).rejects.toThrow("CDN download failed: HTTP 404");
  });
});

describe("saveToInbox", () => {
  test("saves with a timestamp prefix and keeps the original extension", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-wechat-inbox-"));
    const saved = await saveToInbox(Buffer.from("hello"), "报告.pdf", tempDir);

    expect(path.dirname(saved)).toBe(tempDir);
    expect(saved.endsWith("-报告.pdf")).toBe(true);
    expect((await fs.readFile(saved)).toString()).toBe("hello");

    await fs.rm(tempDir, { force: true, recursive: true });
  });

  test("never overwrites an existing file on name collision", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-wechat-inbox-"));
    const first = await saveToInbox(Buffer.from("one"), "a.txt", tempDir);
    const second = await saveToInbox(Buffer.from("two"), "a.txt", tempDir);

    if (first === second) throw new Error("collision produced the same path");
    expect((await fs.readFile(first)).toString()).toBe("one");
    expect((await fs.readFile(second)).toString()).toBe("two");

    await fs.rm(tempDir, { force: true, recursive: true });
  });
});

describe("sanitizeFilename", () => {
  test("strips path traversal and reserved characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a<b>:c?.txt")).toBe("a_b__c_.txt");
    expect(sanitizeFilename(".hidden")).toBe("_hidden");
    expect(sanitizeFilename("trailing. ")).toBe("trailing_");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("中文报告.docx")).toBe("中文报告.docx");
  });
});

describe("downloadIncomingMedia", () => {
  test("downloads, decrypts and saves an incoming file with its original name", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-wechat-inbox-"));
    const key = crypto.randomBytes(16);
    const plaintext = Buffer.from("file-from-wechat");
    const requests: string[] = [];
    globalThis.fetch = mockCdnFetch({
      ciphertext: encryptAesEcb(plaintext, key),
      requests,
    });

    const result = await downloadIncomingMedia(
      {
        fileName: "需求文档.md",
        kind: "file",
        media: {
          aes_key: key.toString("base64"),
          encrypt_query_param: "dl-param",
        },
      },
      { cdnBaseUrl: "https://cdn.example/c2c", inboxDir: tempDir },
    );

    expect(result.byteLength).toBe(plaintext.length);
    expect(result.savedPath.endsWith("-需求文档.md")).toBe(true);
    expect((await fs.readFile(result.savedPath)).equals(plaintext)).toBe(true);

    await fs.rm(tempDir, { force: true, recursive: true });
  });

  test("falls back to a kind-based name for unnamed media", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-wechat-inbox-"));
    const key = crypto.randomBytes(16);
    const requests: string[] = [];
    globalThis.fetch = mockCdnFetch({
      ciphertext: encryptAesEcb(Buffer.from("img"), key),
      requests,
    });

    const result = await downloadIncomingMedia(
      {
        kind: "image",
        media: {
          aes_key: key.toString("base64"),
          encrypt_query_param: "dl-param",
        },
      },
      { cdnBaseUrl: "https://cdn.example/c2c", inboxDir: tempDir },
    );

    expect(result.savedPath.endsWith("-wechat-image.jpg")).toBe(true);

    await fs.rm(tempDir, { force: true, recursive: true });
  });

  test("rejects media without a usable aes_key", async () => {
    expect(
      downloadIncomingMedia(
        { kind: "image", media: { encrypt_query_param: "dl-param" } },
        { cdnBaseUrl: "https://cdn.example/c2c", inboxDir: "/tmp" },
      ),
    ).rejects.toThrow("aes_key");
  });
});
