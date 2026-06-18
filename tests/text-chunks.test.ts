import { describe, expect, test } from "bun:test";
import { splitTextForWechat } from "../core/text-chunks";

describe("splitTextForWechat", () => {
  test("keeps long unicode text complete while enforcing chunk size", () => {
    const text = `${"甲".repeat(7)}\n\n${"乙".repeat(5)}🙂${"丙".repeat(4)}`;
    const chunks = splitTextForWechat(text, 6);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 6)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  test("drops blank text", () => {
    expect(splitTextForWechat(" \n\t ", 6)).toEqual([]);
  });
});
