import { loadRepo, repoOverview } from "@/lib/repo/map";
import { parseGithubUrl } from "@/lib/repo/url";
import { parseModels } from "@/lib/models";
import { sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { url?: string; models?: unknown; refresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const ref = parseGithubUrl(String(body.url ?? ""));
  if (!ref)
    return Response.json(
      { error: "Enter a GitHub repository URL, e.g. https://github.com/owner/repo" },
      { status: 400 },
    );
  const models = parseModels(body.models);

  return sseResponse(async (send, signal) => {
    const repo = await loadRepo(ref, (text) => send("status", { type: "status", text }));
    const r = await repoOverview(repo, models, (e) => send("status", e), signal, !!body.refresh);
    send("overview", r);
    send("done", { usage: r.usage });
  }, req.signal);
}
