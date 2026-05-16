type OmoCommandMode =
  | "deep"
  | "delegate"
  | "none"
  | "plan"
  | "review"
  | "start-work"
  | "summary"
  | "ultrawork";

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
  "#deep": "deep",
  "#delegate": "delegate",
  "#plan": "plan",
  "#review": "review",
  "#start": "start-work",
  "#summary": "summary",
  "#ultrawork": "ultrawork",
  "#ulw": "ultrawork",
};

const OMO_PROTOCOL_HEADER = [
  "你正在通过微信桥接通道与用户协作。",
  "输出请优先保持适合微信阅读：短段落、少层级、先结论后细节。",
  "如果任务较大，先给出执行计划，再继续推进，除非用户明确只要结论。",
];

const OMO_MODE_INSTRUCTIONS: Record<Exclude<OmoCommandMode, "none">, string[]> = {
  deep: [
    "用户显式要求深度模式。",
    "请进行更充分的分析，必要时可调用 Oracle、deep 或 ultrabrain 一类的高强度能力来支持推理。",
    "如果 OMO 具备多智能体/并行能力，可在确有帮助时主动使用，并在最终回复里给出明确结论、关键依据和下一步建议。",
  ],
  delegate: [
    "用户显式要求委派/多智能体模式。",
    "请由 Sisyphus 主导，优先采用 Atlas 风格的任务拆分、委派和并行调查来完成工作。",
    "回复里请简洁说明分工思路，并汇总最终结果，不要只返回内部过程。",
  ],
  plan: [
    "用户显式要求 Prometheus 规划模式。",
    "请像 Prometheus 一样先澄清范围、识别歧义并输出一个清晰可执行的计划，再根据情况继续完成第一步，除非用户的请求明显只需要计划本身。",
    "计划应适合微信阅读，使用短列表，避免过度展开。",
  ],
  review: [
    "用户显式要求评审模式。",
    "请采用代码评审视角，优先识别 bug、回归风险、边界条件和缺失测试。",
    "输出请先列问题，再给简短结论；如果没有明显问题，也请明确说明剩余风险。",
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
  ultrawork: [
    "用户显式要求 Ultrawork 全自动模式。",
    "请像官方 ultrawork 模式一样，自主探索、研究、实现、验证，并尽量持续推进直到任务真正完成。",
    "如果 OMO 具备多智能体或并行能力，可主动启用。",
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

  const match = trimmed.match(/^(#[a-zA-Z]+)(?:\s+|$)([\s\S]*)$/);
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
    case "plan":
      return `微信侧指令: ${parsed.rawTag} (映射到 Prometheus / @plan)`;
    case "start-work":
      return `微信侧指令: ${parsed.rawTag} (映射到 Atlas / /start-work)`;
    case "ultrawork":
      return `微信侧指令: ${parsed.rawTag} (映射到 ultrawork)`;
    default:
      return `微信侧指令: ${parsed.rawTag}`;
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
