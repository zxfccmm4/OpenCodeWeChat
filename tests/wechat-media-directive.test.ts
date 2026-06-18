import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildStreamPreview,
  parseWechatReplyParts,
} from "../core/wechat-media-directive";

describe("parseWechatReplyParts", () => {
  test("splits text and media directives in order", () => {
    const parts = parseWechatReplyParts(
      "先看图\n[[wechat-image:/tmp/a.png|截图]]\n再看文件\n[[wechat-file:/tmp/a.zip]]",
    );

    expect(parts).toEqual([
      { kind: "text", text: "先看图" },
      {
        filePath: "/tmp/a.png",
        kind: "media",
        mediaKind: "image",
        text: "截图",
      },
      { kind: "text", text: "再看文件" },
      {
        filePath: "/tmp/a.zip",
        kind: "media",
        mediaKind: "file",
        text: undefined,
      },
    ]);
  });

  test("keeps ordinary replies as one text part", () => {
    expect(parseWechatReplyParts("普通回复")).toEqual([
      { kind: "text", text: "普通回复" },
    ]);
  });

  test("accepts a full-width colon after the directive kind", () => {
    expect(parseWechatReplyParts("[[wechat-file：/tmp/报告.pdf|说明]]")).toEqual([
      {
        filePath: "/tmp/报告.pdf",
        kind: "media",
        mediaKind: "file",
        text: "说明",
      },
    ]);
  });

  test("matches the directive kind case-insensitively", () => {
    expect(parseWechatReplyParts("[[Wechat-Image:/tmp/a.PNG]]")).toEqual([
      {
        filePath: "/tmp/a.PNG",
        kind: "media",
        mediaKind: "image",
        text: undefined,
      },
    ]);
  });

  test("strips backticks and quotes the model wraps around the path", () => {
    expect(parseWechatReplyParts("[[wechat-file:`/tmp/a.zip`]]")).toEqual([
      { filePath: "/tmp/a.zip", kind: "media", mediaKind: "file", text: undefined },
    ]);
    expect(parseWechatReplyParts('[[wechat-file:"/tmp/b.zip"|备份]]')).toEqual([
      { filePath: "/tmp/b.zip", kind: "media", mediaKind: "file", text: "备份" },
    ]);
  });

  test("expands a leading ~ to the home directory", () => {
    const parts = parseWechatReplyParts(
      "[[wechat-file:~/.claude/channels/wechat/inbox/a.pdf]]",
    );
    expect(parts).toEqual([
      {
        filePath: path.join(os.homedir(), ".claude/channels/wechat/inbox/a.pdf"),
        kind: "media",
        mediaKind: "file",
        text: undefined,
      },
    ]);
  });

  test("tolerates extra whitespace inside the directive", () => {
    expect(parseWechatReplyParts("[[ wechat-image : /tmp/a.png | 图 ]]")).toEqual([
      { filePath: "/tmp/a.png", kind: "media", mediaKind: "image", text: "图" },
    ]);
  });
});

describe("buildStreamPreview", () => {
  test("strips complete media directives from the preview", () => {
    expect(
      buildStreamPreview("结果如下\n[[wechat-image:/tmp/a.png|图]]\n说明文字"),
    ).toBe("结果如下\n\n说明文字");
  });

  test("hides a trailing half-written directive", () => {
    expect(buildStreamPreview("文件已生成\n[[wechat-file:/tmp/repo")).toBe("文件已生成");
    expect(buildStreamPreview("文件已生成\n[[")).toBe("文件已生成");
  });

  test("keeps closed brackets that are not directives", () => {
    expect(buildStreamPreview("数组写法 [[1, 2], [3, 4]] 保持原样")).toBe(
      "数组写法 [[1, 2], [3, 4]] 保持原样",
    );
  });
});
