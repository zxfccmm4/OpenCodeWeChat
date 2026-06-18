import { describe, expect, test } from "bun:test";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";
import { parseMessage } from "../core/message";

function createUserMessage(text: string) {
  return {
    client_id: "msg-1",
    context_token: "ctx-1",
    create_time_ms: 1_715_810_000_000,
    from_user_id: "wx-user-1",
    item_list: [{ text_item: { text }, type: 1 }],
    message_state: 2,
    message_type: 1,
  };
}

describe("parseOmoCommand", () => {
  test("leaves ordinary messages unchanged", () => {
    expect(parseOmoCommand("帮我看看这个 bug")).toEqual({
      body: "帮我看看这个 bug",
      mode: "none",
    });
  });

  test("parses #plan commands", () => {
    expect(parseOmoCommand("#plan 重构这个模块")).toEqual({
      body: "重构这个模块",
      mode: "plan",
      rawTag: "#plan",
    });
  });

  test("parses #delegate commands case-insensitively", () => {
    expect(parseOmoCommand("#DELEGATE 查一下根因")).toEqual({
      body: "查一下根因",
      mode: "delegate",
      rawTag: "#DELEGATE",
    });
  });

  test("parses #ulw as ultrawork mode", () => {
    expect(parseOmoCommand("#ulw 修好这个功能")).toEqual({
      body: "修好这个功能",
      mode: "ultrawork",
      rawTag: "#ulw",
    });
  });

  test("parses #start as atlas execution mode", () => {
    expect(parseOmoCommand("#start 开始执行")).toEqual({
      body: "开始执行",
      mode: "start-work",
      rawTag: "#start",
    });
  });

  test("parses current OMO keyword commands", () => {
    expect(parseOmoCommand("#team 并行调查")).toEqual({
      body: "并行调查",
      mode: "team",
      rawTag: "#team",
    });
    expect(parseOmoCommand("#hyperplan 设计路线")).toEqual({
      body: "设计路线",
      mode: "hyperplan",
      rawTag: "#hyperplan",
    });
    expect(parseOmoCommand("#ulw-loop 持续推进")).toEqual({
      body: "持续推进",
      mode: "ulw-loop",
      rawTag: "#ulw-loop",
    });
  });

  test("parses #review and #summary commands", () => {
    expect(parseOmoCommand("#review 看看这次改动")).toEqual({
      body: "看看这次改动",
      mode: "review",
      rawTag: "#review",
    });
    expect(parseOmoCommand("#summary 帮我总结一下")).toEqual({
      body: "帮我总结一下",
      mode: "summary",
      rawTag: "#summary",
    });
  });
});

describe("buildOmoPrompt", () => {
  test("adds plan instructions for #plan", () => {
    const prompt = buildOmoPrompt("#plan 给我设计一下改造方案");
    expect(prompt).toContain("微信侧指令: #plan");
    expect(prompt).toContain("用户显式要求 Prometheus 规划模式。");
    expect(prompt).toContain("用户原始请求：\n给我设计一下改造方案");
  });

  test("adds delegate instructions for #delegate", () => {
    const prompt = buildOmoPrompt("#delegate 帮我并行排查这个问题");
    expect(prompt).toContain("微信侧指令: #delegate");
    expect(prompt).toContain("请由 Sisyphus 主导，优先采用 Atlas 风格的任务拆分、委派和并行调查来完成工作。");
  });

  test("adds deep instructions for #deep", () => {
    const prompt = buildOmoPrompt("#deep 帮我彻底分析这段实现");
    expect(prompt).toContain("微信侧指令: #deep");
    expect(prompt).toContain("用户显式要求深度模式。");
  });

  test("adds review instructions for #review", () => {
    const prompt = buildOmoPrompt("#review 帮我检查这次改动");
    expect(prompt).toContain("微信侧指令: #review");
    expect(prompt).toContain("用户显式要求评审模式。");
  });

  test("adds summary instructions for #summary", () => {
    const prompt = buildOmoPrompt("#summary 帮我总结一下");
    expect(prompt).toContain("微信侧指令: #summary");
    expect(prompt).toContain("用户显式要求总结模式。");
  });

  test("maps #plan to the Prometheus concept", () => {
    const prompt = buildOmoPrompt("#plan 给我一个方案");
    expect(prompt).toContain("微信侧指令: #plan (映射到 Prometheus / @plan)");
    expect(prompt).toContain("用户显式要求 Prometheus 规划模式。");
  });

  test("maps #ulw to the official ultrawork concept", () => {
    const prompt = buildOmoPrompt("#ulw 直接做完这个任务");
    expect(prompt).toContain("微信侧指令: #ulw (映射到 ultrawork)");
    expect(prompt).toContain("用户显式要求 Ultrawork 全自动模式。");
  });

  test("maps #start to the Atlas execution concept", () => {
    const prompt = buildOmoPrompt("#start 按刚才的计划继续");
    expect(prompt).toContain("微信侧指令: #start (映射到 Atlas / /start-work)");
    expect(prompt).toContain("用户显式要求 Atlas 执行最新计划。");
  });

  test("maps current OMO workflow prompts", () => {
    expect(buildOmoPrompt("#team 并行查一下")).toContain("映射到 OMO team mode");
    expect(buildOmoPrompt("#hyperplan 做一个方案")).toContain("hyperplan / hyperplan-ultrawork");
    expect(buildOmoPrompt("#search 查资料")).toContain("Librarian / Explore");
    expect(buildOmoPrompt("#analyze 看根因")).toContain("Metis / Oracle 分析");
    expect(buildOmoPrompt("#ulw-loop 继续循环")).toContain("/ulw-loop / Ralph loop");
  });

  test("injects the latest cached plan into #start prompts", () => {
    const prompt = buildOmoPrompt("#start 继续执行", {
      originalRequest: "帮我先出一个计划",
      planResponse: "1. 先调查\n2. 再实现",
      savedAt: "2026-05-16T09:00:00.000Z",
    });
    expect(prompt).toContain("桥接层附加的最近一次 #plan 上下文：");
    expect(prompt).toContain("规划请求：帮我先出一个计划");
    expect(prompt).toContain("1. 先调查\n2. 再实现");
  });

  test("warns when #start has no cached plan", () => {
    const prompt = buildOmoPrompt("#start 继续执行");
    expect(prompt).toContain("当前没有为该微信用户缓存到最近一次 #plan 结果");
  });
});

describe("parseMessage with OMO protocol", () => {
  test("stores a compiled prompt for command-style messages", () => {
    const parsed = parseMessage(createUserMessage("#plan 帮我梳理实现步骤"));
    expect(parsed?.text).toBe("#plan 帮我梳理实现步骤");
    expect(parsed?.compiledPrompt).toContain("微信侧指令: #plan");
    expect(parsed?.compiledPrompt).toContain("用户原始请求：\n帮我梳理实现步骤");
  });

  test("keeps normal messages readable for downstream handling", () => {
    const parsed = parseMessage(createUserMessage("正常消息"));
    expect(parsed?.text).toBe("正常消息");
    expect(parsed?.compiledPrompt).toBe("正常消息");
  });
});
