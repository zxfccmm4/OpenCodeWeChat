import { describe, expect, test } from "bun:test";
import { StreamingTextBubble } from "../core/streaming-bubble";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("StreamingTextBubble", () => {
  test("sends the first update immediately and throttles the rest", async () => {
    const sends: Array<{ finish: boolean; text: string }> = [];
    const bubble = new StreamingTextBubble(async (text, finish) => {
      sends.push({ finish, text });
    }, 50);

    bubble.update("第一");
    await sleep(10);
    bubble.update("第一二");
    bubble.update("第一二三");
    await sleep(10);

    expect(sends).toEqual([{ finish: false, text: "第一" }]);

    await sleep(60);
    expect(sends).toEqual([
      { finish: false, text: "第一" },
      { finish: false, text: "第一二三" },
    ]);

    await bubble.finalize("第一二三四（完）");
    expect(sends[sends.length - 1]).toEqual({ finish: true, text: "第一二三四（完）" });
  });

  test("finalize cancels pending updates and sends exactly one FINISH", async () => {
    const sends: Array<{ finish: boolean; text: string }> = [];
    const bubble = new StreamingTextBubble(async (text, finish) => {
      sends.push({ finish, text });
    }, 10_000);

    bubble.update("更新一");
    await sleep(10);
    bubble.update("更新二（还在节流中）");
    await bubble.finalize("最终内容");

    const finishes = sends.filter((send) => send.finish);
    expect(finishes).toEqual([{ finish: true, text: "最终内容" }]);
    // finalize 后的更新被忽略
    bubble.update("迟到的更新");
    await sleep(10);
    expect(sends.filter((send) => send.finish)).toHaveLength(1);
  });

  test("stops updating after a send failure but finalize still closes the bubble", async () => {
    let updateCalls = 0;
    const sends: Array<{ finish: boolean; text: string }> = [];
    const errors: unknown[] = [];
    const bubble = new StreamingTextBubble(async (text, finish) => {
      if (!finish) {
        updateCalls += 1;
        throw new Error("gateway error");
      }
      sends.push({ finish, text });
    }, 5, (err) => errors.push(err));

    bubble.update("第一次更新");
    await sleep(20);
    expect(bubble.isBroken).toBe(true);
    expect(errors).toHaveLength(1);

    bubble.update("损坏后的更新");
    await sleep(20);
    expect(updateCalls).toBe(1);

    await bubble.finalize("最终内容");
    expect(sends).toEqual([{ finish: true, text: "最终内容" }]);
  });

  test("finalize with empty text leaves an already streamed preview unchanged", async () => {
    const sends: Array<{ finish: boolean; text: string }> = [];
    const bubble = new StreamingTextBubble(async (text, finish) => {
      sends.push({ finish, text });
    }, 5);

    bubble.update("已经流出去的内容");
    await sleep(20);
    await bubble.finalize("");

    expect(sends).toEqual([
      { finish: false, text: "已经流出去的内容" },
    ]);
  });

  test("finalize with no content at all sends nothing", async () => {
    const sends: Array<{ finish: boolean; text: string }> = [];
    const bubble = new StreamingTextBubble(async (text, finish) => {
      sends.push({ finish, text });
    }, 5);

    await bubble.finalize("");
    expect(sends).toEqual([]);
  });
});
