import { describe, expect, test } from "bun:test";
import { isOpencodeToolChild } from "../runtime/launch-guard";

describe("isOpencodeToolChild", () => {
  test("detects OpenCode tool child environments", () => {
    expect(isOpencodeToolChild({ OPENCODE: "1" })).toBe(true);
    expect(isOpencodeToolChild({ OPENCODE_PID: "12345" })).toBe(true);
  });

  test("allows normal terminal and GUI launches", () => {
    expect(isOpencodeToolChild({})).toBe(false);
    expect(isOpencodeToolChild({ OPENCODE: "0", OPENCODE_PID: "" })).toBe(false);
  });
});
