import "server-only";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { applyOps, OpSchema, type Graph, type Op } from "../ops";
import type { Suggestion } from "../schema";
import { mergeExpansion, type Expansion } from "../repo/nodes";

export const FLOW_SERVER = "flow";
export const T = {
  readNodes: `mcp__${FLOW_SERVER}__read_nodes`,
  applyOps: `mcp__${FLOW_SERVER}__apply_ops`,
  suggest: `mcp__${FLOW_SERVER}__suggest`,
  expand: `mcp__${FLOW_SERVER}__expand_nodes`,
} as const;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export type FlowToolHooks = {
  onOps: (ops: Op[]) => void;
  onSuggestions: (s: Suggestion[]) => void;
  /** Repo mode: expand nodes server-side. Each expansion is merged here and streamed to the client. */
  expand?: (ids: string[], graph: Graph) => Promise<{ expansions: Expansion[]; notes: string[] }>;
  onExpansion?: (e: Expansion) => void;
  /** Full graph after every accepted change. The browser merges this instead of replaying ops. */
  onGraph?: (g: Graph) => void;
};

/**
 * Tools over a request-local copy of the graph. Every accepted change is streamed to the client as
 * ops, so the browser replays exactly what the server applied.
 */
export function flowServer(initial: Graph, hooks: FlowToolHooks) {
  let graph = initial;

  const tools = [
    tool(
      "read_nodes",
      "Full detail (data, size, parent, connected edges) for specific nodes. Use only when the outline is not enough.",
      { ids: z.array(z.string()).min(1).max(50) },
      async ({ ids }) => {
        const set = new Set(ids);
        const nodes = graph.nodes
          .filter((n) => set.has(n.id))
          .map((n) => ({
            id: n.id,
            type: n.type,
            parentId: n.parentId,
            width: n.width,
            height: n.height,
            data: n.data,
          }));
        const edges = graph.edges.filter((e) => set.has(e.source) || set.has(e.target));
        return text(JSON.stringify({ nodes, edges }));
      },
    ),
    tool(
      "apply_ops",
      "Apply a batch of graph changes. Batch everything for one request into a single call. Returns what was applied and any rejected ops.",
      { ops: z.array(OpSchema).min(1).max(200) },
      async ({ ops }) => {
        const r = applyOps(graph, ops);
        graph = { nodes: r.nodes, edges: r.edges };
        if (r.applied.length) {
          hooks.onOps(r.applied);
          hooks.onGraph?.(graph);
        }
        return text(
          `applied ${r.applied.length} op(s)` +
            (r.applied.some((o) => o.op === "add_node" || o.op === "add_edge")
              ? `; new ids: ${r.applied
                  .map((o) => ("id" in o ? o.id : ""))
                  .filter(Boolean)
                  .join(", ")}`
              : "") +
            (r.errors.length ? `\nrejected:\n${r.errors.join("\n")}` : ""),
        );
      },
    ),
    tool(
      "suggest",
      "Offer the user 1 to 4 follow-up choices as buttons instead of guessing. Use when the request is ambiguous or an enhancement would clearly help.",
      {
        options: z
          .array(z.object({ label: z.string().max(60), prompt: z.string().max(400) }))
          .min(1)
          .max(4),
      },
      async ({ options }) => {
        hooks.onSuggestions(options);
        return text("shown to the user");
      },
    ),
  ];

  if (hooks.expand) {
    const expand = hooks.expand;
    tools.push(
      tool(
        "expand_nodes",
        "Repo maps only: expand feature/component/file nodes to their next level (uses cached results when available).",
        { ids: z.array(z.string()).min(1).max(12) },
        async ({ ids }) => {
          const { expansions, notes } = await expand(ids, graph);
          for (const e of expansions) {
            graph = mergeExpansion(graph, e);
            hooks.onExpansion?.(e);
          }
          if (expansions.length) hooks.onGraph?.(graph);
          const added = expansions.flatMap((e) =>
            e.nodes.map((n) => `${n.id} (${(n.data as { title?: string }).title ?? ""})`),
          );
          return text(
            `expanded ${expansions.length} node(s); new nodes:\n${added.slice(0, 80).join("\n")}${notes.length ? `\n${notes.join("\n")}` : ""}`,
          );
        },
      ) as (typeof tools)[number],
    );
  }

  return {
    server: createSdkMcpServer({ name: FLOW_SERVER, version: "0.2.0", tools }),
    get graph() {
      return graph;
    },
  };
}
