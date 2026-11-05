import type { Edge, Node } from "@xyflow/react";
import type { RepoNodeData } from "@nodes";
import { COORDINATOR_PROMPT } from "@/lib/agent/prompts";
import { flowServer, T } from "@/lib/agent/flowTools";
import { runAgent, addUsage } from "@/lib/agent/run";
import { workers } from "@/lib/agent/workers";
import { parseModels } from "@/lib/models";
import { outline } from "@/lib/outline";
import { sseResponse } from "@/lib/sse";
import type { RepoContext } from "@/lib/repo/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_NODES = 3000;

type Body = {
  graph?: { nodes?: Node[]; edges?: Edge[] };
  message?: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  models?: unknown;
  repo?: RepoContext;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  const nodes = Array.isArray(body.graph?.nodes) ? body.graph!.nodes! : [];
  const edges = Array.isArray(body.graph?.edges) ? body.graph!.edges! : [];
  if (!message) return Response.json({ error: "Message is required." }, { status: 400 });
  if (nodes.length > MAX_NODES) return Response.json({ error: "Diagram is too large to edit." }, { status: 413 });
  const models = parseModels(body.models);
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-3)
    .map((h) => `${h.role === "user" ? "User" : "You"}: ${String(h.text).slice(0, 500)}`)
    .join("\n");
  const repo = body.repo && /^[0-9a-f]{40}$/.test(body.repo.sha ?? "") ? body.repo : undefined;

  return sseResponse(async (send, signal) => {
    const loaded = repo ? await (await import("@/lib/repo/map")).loadRepo({ ...repo, ref: repo.branch }) : undefined;
    let usage = undefined as ReturnType<typeof addUsage> | undefined;

    const flow = flowServer(
      { nodes, edges },
      {
        onOps: (ops) => send("ops", ops),
        onGraph: (g) => send("graph", g),
        onSuggestions: (s) => send("suggestions", s),
        onExpansion: (e) => send("expansion", e),
        expand: loaded
          ? async (ids, graph) => {
              const { expandNode } = await import("@/lib/repo/map");
              const expansions = [];
              const notes: string[] = [];
              for (const id of ids) {
                const n = graph.nodes.find((x) => x.id === id && x.type === "repo");
                if (!n) {
                  notes.push(`${id}: not a repo node`);
                  continue;
                }
                try {
                  const r = await expandNode(
                    loaded,
                    { id, data: n.data as RepoNodeData },
                    models,
                    (e) => send("status", e),
                    signal,
                  );
                  usage = usage ? addUsage(usage, r.usage) : r.usage;
                  expansions.push(r.expansion);
                } catch (err) {
                  notes.push(`${id}: ${(err as Error).message}`);
                }
              }
              return { expansions, notes };
            }
          : undefined,
      },
    );

    const allowed = [T.readNodes, T.applyOps, T.suggest, ...(loaded ? [T.expand] : [])];
    const prompt =
      `<diagram>\n${outline(nodes, edges)}\n</diagram>\n` +
      (loaded ? `<repo>${loaded.ctx.owner}/${loaded.ctx.repo}@${loaded.ctx.sha.slice(0, 7)}</repo>\n` : "") +
      (history ? `<recent_conversation>\n${history}\n</recent_conversation>\n` : "") +
      `<request>\n${message}\n</request>`;

    send("status", { type: "status", text: "Thinking" });
    const r = await runAgent({
      prompt,
      systemPrompt: COORDINATOR_PROMPT,
      model: models.coordinator,
      effort: "low",
      builtinTools: ["Agent"],
      mcpServers: { flow: flow.server },
      allowedTools: allowed,
      agents: workers(models.worker),
      toolLabels: { [T.applyOps]: "Applying changes", [T.readNodes]: "Reading nodes", [T.expand]: "Expanding nodes" },
      maxTurns: 12,
      maxBudgetUsd: 1,
      signal,
      onEvent: (e) => send("status", e),
    });
    send("done", { text: r.text, usage: usage ? addUsage(r.usage, usage) : r.usage });
  }, req.signal);
}
