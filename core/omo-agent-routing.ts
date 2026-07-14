import { findPreferredAgent } from "../opencode/agents";
import type { OpencodeSession } from "../opencode/client";
import type { SendPromptOptions } from "../opencode/types";
import { buildOhMyOpenAgentSystemPrompt } from "./oh-my-openagent";
import {
  getPreferredOmoAgents,
  type OmoCommand,
} from "./omo-command";

export function buildOmoSendPromptOptions(
  command: OmoCommand,
  session: OpencodeSession,
): SendPromptOptions {
  const system = buildOhMyOpenAgentSystemPrompt(command);
  for (const agentName of getPreferredOmoAgents(command.mode)) {
    const agent = findPreferredAgent(agentName, session.transport.agents);
    if (agent) return { agent, system };
  }
  return { system };
}
