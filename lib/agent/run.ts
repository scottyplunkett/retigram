import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";
import {
  query,
  type AgentDefinition,
  type McpServerConfig,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Effort, ModelId } from "../models";

const STATE_DIR = path.join(process.cwd(), ".retigram");
const SANDBOX = path.join(STATE_DIR, "sandbox");
const CONFIG_DIR = path.join(STATE_DIR, "claude");
mkdirSync(SANDBOX, { recursive: true });
mkdirSync(CONFIG_DIR, { recursive: true });

import { emptyUsage, type Usage } from "./usage";
export { addUsage, emptyUsage, type Usage } from "./usage";

function usageFrom(r: SDKResultMessage): Usage {
  const u = emptyUsage();
  u.costUsd = r.total_cost_usd ?? 0;
  u.durationMs = r.duration_ms ?? 0;
  u.turns = r.num_turns ?? 0;
  for (const [model, m] of Object.entries(r.modelUsage ?? {})) {
    u.byModel[model] = {
      input: m.inputTokens,
      output: m.outputTokens,
      cacheRead: m.cacheReadInputTokens,
      cacheWrite: m.cacheCreationInputTokens,
    };
    u.inputTokens += m.inputTokens;
    u.outputTokens += m.outputTokens;
    u.cacheReadTokens += m.cacheReadInputTokens;
    u.cacheWriteTokens += m.cacheCreationInputTokens;
  }
  return u;
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: Usage,
  ) {
    super(message);
  }
}

export type AgentEvent = { type: "status"; text: string; agent?: string };

export type RunOptions = {
  prompt: string | AsyncIterable<SDKUserMessage>;
  systemPrompt: string;
  model: ModelId;
  effort: Effort;
  /** Built-in tools. [] disables all; ["Agent"] allows subagent dispatch only. */
  builtinTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: string[];
  agents?: Record<string, AgentDefinition>;
  outputSchema?: Record<string, unknown>;
  maxTurns?: number;
  maxBudgetUsd?: number;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  /** Labels for tool calls, keyed by full tool name, shown as status lines. */
  toolLabels?: Record<string, string>;
};

export type RunResult = { text: string; structured: unknown; usage: Usage };

/** One image + text user turn, for streaming input. */
export async function* userTurn(content: SDKUserMessage["message"]["content"]): AsyncGenerator<SDKUserMessage> {
  yield { type: "user", parent_tool_use_id: null, message: { role: "user", content } };
}

function describeToolUse(name: string, input: Record<string, unknown>, labels: Record<string, string>) {
  if (name === "Agent" || name === "Task") {
    const who = String(input.subagent_type ?? "worker");
    return { text: `Dispatching ${who}: ${String(input.description ?? "").slice(0, 80)}`, agent: who };
  }
  return labels[name] ? { text: labels[name] } : null;
}

/**
 * Run one stateless Agent SDK query with Claude Code's filesystem behaviour switched off:
 * no settings files, CLAUDE.md, memory, session persistence or built-in tools unless asked for.
 */
export async function runAgent(o: RunOptions): Promise<RunResult> {
  const abort = new AbortController();
  o.signal?.addEventListener("abort", () => abort.abort(), { once: true });

  let result: SDKResultMessage | undefined;
  const stream = query({
    prompt: o.prompt,
    options: {
      abortController: abort,
      model: o.model,
      effort: o.effort,
      systemPrompt: o.systemPrompt,
      tools: o.builtinTools ?? [],
      mcpServers: o.mcpServers,
      allowedTools: o.allowedTools,
      agents: o.agents,
      outputFormat: o.outputSchema ? { type: "json_schema", schema: o.outputSchema } : undefined,
      maxTurns: o.maxTurns ?? 8,
      maxBudgetUsd: o.maxBudgetUsd ?? 1,
      settingSources: [],
      persistSession: false,
      permissionMode: "dontAsk",
      // A fixed title skips automatic title generation (a hidden Haiku call per request).
      title: "retigram",
      cwd: SANDBOX,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: CONFIG_DIR,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        CLAUDE_AGENT_SDK_CLIENT_APP: "retigram/0.2",
      },
    },
  });

  try {
    for await (const m of stream as AsyncIterable<SDKMessage>) {
      if (m.type === "assistant") {
        for (const block of m.message.content) {
          if (block.type !== "tool_use") continue;
          const d = describeToolUse(block.name, block.input as Record<string, unknown>, o.toolLabels ?? {});
          if (d) o.onEvent?.({ type: "status", ...d });
        }
        if (m.error === "authentication_failed") throw new AgentError("The Claude API key was rejected.", 401);
        if (m.error === "rate_limit") throw new AgentError("Rate limited by the Claude API. Try again shortly.", 429);
        if (m.error === "model_not_found") throw new AgentError(`Model ${o.model} is not available.`, 400);
      }
      if (m.type === "result") result = m;
    }
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if (o.signal?.aborted) throw new AgentError("Cancelled.", 499);
    if (!result) {
      const msg = (err as Error).message ?? String(err);
      if (/api key|authentication|credential/i.test(msg)) {
        throw new AgentError("No valid Claude API credentials. Set ANTHROPIC_API_KEY in .env.local.", 500);
      }
      throw new AgentError(`Agent failed: ${msg}`, 502);
    }
    // Error results are followed by a throw; fall through and report the result below.
  }

  if (!result) throw new AgentError("The agent produced no result.", 502);
  const usage = usageFrom(result);
  if (result.subtype !== "success") {
    const reason: Record<string, string> = {
      error_max_turns: "The agent ran out of turns.",
      error_max_budget_usd: "The request hit its cost limit.",
      error_max_structured_output_retries: "The agent could not produce valid structured output.",
      error_during_execution: "The agent failed while running.",
    };
    const detail = result.errors?.length ? ` (${result.errors.join("; ").slice(0, 300)})` : "";
    throw new AgentError((reason[result.subtype] ?? "The agent failed.") + detail, 502, usage);
  }
  if (result.stop_reason === "refusal") throw new AgentError("Claude declined this request.", 422, usage);
  if (o.outputSchema && result.structured_output == null) {
    throw new AgentError("The agent returned no structured output.", 502, usage);
  }
  return { text: result.result, structured: result.structured_output, usage };
}
