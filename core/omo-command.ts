export type OmoCommandMode =
  | "analyze"
  | "deep"
  | "delegate"
  | "hyperplan"
  | "none"
  | "plan"
  | "review"
  | "search"
  | "start-work"
  | "summary"
  | "team"
  | "ultrawork"
  | "ulw-loop";

export type OmoCommand = {
  body: string;
  mode: OmoCommandMode;
  rawTag?: string;
};

export type OmoPlanContext = {
  originalRequest: string;
  planResponse: string;
  savedAt: string;
};

const OMO_COMMAND_ALIASES: Record<string, OmoCommandMode> = {
  "#analysis": "analyze",
  "#analyze": "analyze",
  "#atlas": "start-work",
  "#deep": "deep",
  "#delegate": "delegate",
  "#explore": "search",
  "#hephaestus": "deep",
  "#hyperplan": "hyperplan",
  "#librarian": "search",
  "#loop": "ulw-loop",
  "#metis": "analyze",
  "#momus": "review",
  "#oracle": "review",
  "#plan": "plan",
  "#prometheus": "plan",
  "#ralph": "ulw-loop",
  "#review": "review",
  "#search": "search",
  "#start": "start-work",
  "#summary": "summary",
  "#team": "team",
  "#ultrawork": "ultrawork",
  "#ulw": "ultrawork",
  "#ulw-loop": "ulw-loop",
};

const OMO_PROTOCOL_HEADER = [
  "你正在通过微信桥接通道与用户协作。",
  "输出请优先保持适合微信阅读：短段落、少层级、先结论后细节。",
  "如果任务较大，先给出执行计划，再继续推进，除非用户明确只要结论。",
];

const OMO_MODE_INSTRUCTIONS: Record<Exclude<OmoCommandMode, "none">, string[]> = {
  analyze: [
    "用户显式要求分析/诊断模式。",
    "请优先采用 Metis/Oracle 风格的证据核查、根因归纳和反例检查，把不确定性说清楚。",
    "如果需要动代码，请先定位可验证的事实，再给出最小修复路径。",
  ],
  deep: [
    "用户显式要求深度模式。",
    "请进行更充分的分析，必要时可调用 Hephaestus、Oracle、deep 或 ultrabrain 一类的高强度能力来支持推理。",
    "如果 OMO 具备多智能体/并行能力，可在确有帮助时主动使用，并在最终回复里给出明确结论、关键依据和下一步建议。",
  ],
  delegate: [
    "用户显式要求委派/多智能体模式。",
    "请由 Sisyphus 主导，优先采用 Atlas 风格的任务拆分、委派和并行调查来完成工作。",
    "回复里请简洁说明分工思路，并汇总最终结果，不要只返回内部过程。",
  ],
  plan: [
    "用户显式要求 Prometheus 规划模式。",
    "请像 Prometheus 一样先澄清范围、识别歧义并输出一个清晰可执行的计划；如果当前 OMO 支持 hyperplan/default_mode，请按当前配置选择最合适的规划深度。",
    "计划应适合微信阅读，使用短列表，避免过度展开。",
  ],
  hyperplan: [
    "用户显式要求 hyperplan 模式。",
    "请采用 OMO 的 hyperplan / hyperplan-ultrawork 思路，先形成结构化计划、关键假设和验证点，再决定是否进入执行。",
    "回复中保留可以直接交给后续 #start 或 #ulw-loop 继续的任务边界。",
  ],
  review: [
    "用户显式要求评审模式。",
    "请采用代码评审视角，优先识别 bug、回归风险、边界条件和缺失测试。",
    "输出请先列问题，再给简短结论；如果没有明显问题，也请明确说明剩余风险。",
  ],
  search: [
    "用户显式要求检索/探索模式。",
    "请优先采用 Librarian/Explore 风格的并行检索和来源核验，区分已确认事实、推断和仍缺的证据。",
    "最终输出要给出可行动的结论，而不是只罗列搜索过程。",
  ],
  "start-work": [
    "用户显式要求 Atlas 执行最新计划。",
    "如果当前上下文里已有最近的计划，请进入执行阶段，分发任务、累计发现并验证完成情况。",
    "如果当前没有可执行计划，请先指出这一点，并补一个最小可执行计划再开始。",
  ],
  summary: [
    "用户显式要求总结模式。",
    "请把当前结论、进展或结果压缩成适合微信阅读的短摘要。",
    "优先保留结论、关键变化和下一步，不要展开过多中间过程。",
  ],
  team: [
    "用户显式要求 team mode。",
    "请在 OMO 当前 team_mode 配置允许时使用多成员协作、并行调查和汇总；如果不可用，则由 Sisyphus 采用单 agent 的等价拆分方式完成。",
    "最终回复只汇总任务分工、关键发现和结果，不要泄露冗长内部日志。",
  ],
  ultrawork: [
    "用户显式要求 Ultrawork 全自动模式。",
    "请像官方 ultrawork 模式一样，自主探索、研究、实现、验证，并尽量持续推进直到任务真正完成。",
    "如果 OMO 具备多智能体或并行能力，可主动启用。",
  ],
  "ulw-loop": [
    "用户显式要求 /ulw-loop 或 Ralph loop 模式。",
    "请以持续循环的方式拆解、执行、验证并更新状态，直到任务完成、被阻塞，或需要用户输入。",
    "每轮回复都应包含当前完成度、下一步和阻塞条件，保持适合微信阅读。",
  ],
};

function normalizeCommandTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function parseOmoCommand(text: string): OmoCommand {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      body: "",
      mode: "none",
    };
  }

  const match = trimmed.match(/^(#[a-zA-Z][a-zA-Z-]*)(?:\s+|$)([\s\S]*)$/);
  if (!match) {
    return {
      body: trimmed,
      mode: "none",
    };
  }

  const rawTag = match[1] || "";
  const mode = OMO_COMMAND_ALIASES[normalizeCommandTag(rawTag)] || "none";
  const body = (match[2] || "").trim();

  if (mode === "none") {
    return {
      body: trimmed,
      mode,
    };
  }

  return {
    body,
    mode,
    rawTag,
  };
}

export function buildOmoPrompt(
  text: string,
  recentPlanContext?: OmoPlanContext,
): string {
  const parsed = parseOmoCommand(text);
  if (parsed.mode === "none") {
    return parsed.body;
  }

  const instructions = OMO_MODE_INSTRUCTIONS[parsed.mode];
  const commandLine = buildModePreamble(parsed);
  const taskBody = parsed.body || "用户没有补充正文，请结合最近上下文理解其意图并先给出一个合理的起步方案。";
  const latestPlanSection = buildLatestPlanSection(parsed, recentPlanContext);

  return [
    ...OMO_PROTOCOL_HEADER,
    commandLine,
    ...instructions,
    ...latestPlanSection,
    "",
    "用户原始请求：",
    taskBody,
  ].join("\n");
}

function buildModePreamble(parsed: OmoCommand): string {
  switch (parsed.mode) {
    case "analyze":
      return `微信侧指令: ${parsed.rawTag} (映射到 Metis / Oracle 分析)`;
    case "hyperplan":
      return `微信侧指令: ${parsed.rawTag} (映射到 hyperplan / hyperplan-ultrawork)`;
    case "plan":
      return `微信侧指令: ${parsed.rawTag} (映射到 Prometheus / @plan)`;
    case "search":
      return `微信侧指令: ${parsed.rawTag} (映射到 Librarian / Explore)`;
    case "start-work":
      return `微信侧指令: ${parsed.rawTag} (映射到 Atlas / /start-work)`;
    case "team":
      return `微信侧指令: ${parsed.rawTag} (映射到 OMO team mode)`;
    case "ultrawork":
      return `微信侧指令: ${parsed.rawTag} (映射到 ultrawork)`;
    case "ulw-loop":
      return `微信侧指令: ${parsed.rawTag} (映射到 /ulw-loop / Ralph loop)`;
    default:
      return `微信侧指令: ${parsed.rawTag}`;
  }
}

export function getPreferredOmoAgents(mode: OmoCommandMode): readonly string[] {
  switch (mode) {
    case "analyze":
      return ["metis", "oracle", "sisyphus"];
    case "deep":
      return ["hephaestus", "sisyphus"];
    case "delegate":
    case "start-work":
      return ["atlas", "sisyphus"];
    case "hyperplan":
    case "team":
    case "ultrawork":
    case "ulw-loop":
      return ["sisyphus"];
    case "plan":
      return ["prometheus", "plan", "sisyphus"];
    case "review":
      return ["momus", "oracle", "sisyphus"];
    case "search":
      return ["librarian", "explore", "sisyphus"];
    case "summary":
      return ["summary", "sisyphus"];
    case "none":
      return [];
  }
}

function buildLatestPlanSection(
  parsed: OmoCommand,
  recentPlanContext?: OmoPlanContext,
): string[] {
  if (parsed.mode !== "start-work") {
    return [];
  }

  if (!recentPlanContext) {
    return [
      "",
      "桥接层提示：当前没有为该微信用户缓存到最近一次 #plan 结果。",
    ];
  }

  return [
    "",
    "桥接层附加的最近一次 #plan 上下文：",
    `- 规划请求：${recentPlanContext.originalRequest}`,
    `- 规划时间：${recentPlanContext.savedAt}`,
    "- 规划回复：",
    recentPlanContext.planResponse,
  ];
}
