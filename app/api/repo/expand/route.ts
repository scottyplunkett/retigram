import type { RepoNodeData } from "@nodes";
import { expandMany, loadRepo } from "@/lib/repo/map";
import type { RepoContext } from "@/lib/repo/schema";
import { parseModels } from "@/lib/models";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 300;

const NAME = /^[A-Za-z0-9_.-]+$/;

export async function POST(req: Request) {
  let body: { repo?: RepoContext; nodes?: Array<{ id: string; data: RepoNodeData }>; models?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const repo = body.repo;
  if (!repo || !NAME.test(repo.owner) || !NAME.test(repo.repo) || !/^[0-9a-f]{40}$/.test(repo.sha)) {
    return Response.json({ error: "Missing repository context." }, { status: 400 });
  }
  const nodes = (Array.isArray(body.nodes) ? body.nodes : [])
    .filter((n) => typeof n?.id === "string" && n.data)
    .slice(0, 20);
  if (!nodes.length) return Response.json({ error: "No nodes to expand." }, { status: 400 });
  const models = parseModels(body.models);

  return sseResponse(async (send, signal) => {
    const loaded = await loadRepo({
      owner: repo.owner,
      repo: repo.repo,
      ref: repo.branch,
      subpath: repo.subpath,
      sha: repo.sha,
    });
    const usage = await expandMany(
      loaded,
      nodes,
      models,
      (e) => send("status", e),
      (exp) => send("expansion", exp),
      (id, message) => send("node_error", { id, message }),
      signal,
    );
    send("done", { usage });
  }, req.signal);
}
