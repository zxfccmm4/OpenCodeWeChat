import { describe, expect, test } from "bun:test";
import { buildOmoSendPromptOptions } from "../core/omo-agent-routing";
import { parseOmoCommand } from "../core/omo-command";
import type { OpencodeSession } from "../opencode/client";

const TEST_SESSION: OpencodeSession = {
  agents: [],
  authHeader: "Basic test",
  close() {},
  id: "session-1",
  serverUrl: "http://127.0.0.1:1",
};

describe("Oh My OpenAgent system context", () => {
  test("loads Oh My OpenAgent context for ordinary messages", () => {
    const options = buildOmoSendPromptOptions(
      parseOmoCommand("帮我看看这个问题"),
      TEST_SESSION,
    );

    expect(options.system).toContain("Oh My OpenAgent");
    expect(options.system).toContain("MCP");
    expect(options.system).toContain("Skill");
  });

  test("keeps command-specific workflow context in the system prompt", () => {
    const options = buildOmoSendPromptOptions(
      parseOmoCommand("#team 并行排查这个问题"),
      {
        ...TEST_SESSION,
        agents: [{ id: "sisyphus" }],
      },
    );

    expect(options.agent).toBe("sisyphus");
    expect(options.system).toContain("team mode");
  });
});
