import "server-only";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { ModelId } from "../models";
import { ILLUSTRATOR_PROMPT, STYLIST_PROMPT } from "./prompts";
import { T } from "./flowTools";

export function workers(model: ModelId): Record<string, AgentDefinition> {
  return {
    illustrator: {
      description: "Draws an SVG illustration or icon for one diagram node and applies it.",
      prompt: ILLUSTRATOR_PROMPT,
      model,
      effort: "low",
      tools: [T.applyOps, T.readNodes],
      maxTurns: 4,
    },
    stylist: {
      description: "Designs and applies a coordinated visual theme across many diagram nodes.",
      prompt: STYLIST_PROMPT,
      model,
      effort: "low",
      tools: [T.applyOps, T.readNodes],
      maxTurns: 4,
    },
  };
}
