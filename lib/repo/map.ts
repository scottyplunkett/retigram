import "server-only";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Edge, Node } from "@xyflow/react";
import type { RepoNodeData } from "@nodes";
import { runAgent, addUsage, emptyUsage, type AgentEvent, type Usage } from "../agent/run";
import { REPO_EXPLORER_PROMPT, REPO_OVERVIEW_PROMPT } from "../agent/prompts";
import type { ModelChoice } from "../models";
import type { RepoModel } from "./analyze";
import { cacheKey, readCache, writeCache } from "./cache";
import { buildDigest } from "./digest";
import { filesUnder } from "./edges";
import { fetchSnapshot, resolveCommit, RepoError, snapshotDir, type RepoRef } from "./github";
import { componentExpansion, fileExpansion, overviewGraph, symbolExpansion, type Expansion } from "./nodes";
import { FeatureBreakdown, RepoOverview, type RepoContext } from "./schema";
import { repoServer, RT } from "./tools";

const OVERVIEW_SCHEMA = z.toJSONSchema(RepoOverview, { target: "draft-7" }) as Record<string, unknown>;
const BREAKDOWN_SCHEMA = z.toJSONSchema(FeatureBreakdown, { target: "draft-7" }) as Record<string, unknown>;
const SCAN_VERSION = "1";

export type LoadedRepo = { ctx: RepoContext; root: string; model: RepoModel };

function scanRoot(dir: string, subpath?: string) {
  if (!subpath) return dir;
  const p = path.join(dir, subpath);
  return p.startsWith(dir + path.sep) && existsSync(p) && statSync(p).isDirectory() ? p : dir;
}

/** Resolve (if needed), download (once per commit) and scan (once per commit) a repository. */
export async function loadRepo(
  ref: RepoRef & { sha?: string },
  status: (text: string) => void = () => {},
): Promise<LoadedRepo> {
  let sha = ref.sha;
  let branch = ref.ref;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    status(`Resolving ${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ""}`);
    ({ sha, branch } = await resolveCommit(ref));
  }
  if (!existsSync(path.join(snapshotDir(ref, sha), ".retigram-complete"))) status("Downloading snapshot");
  const dir = await fetchSnapshot(ref, sha);
  const root = scanRoot(dir, ref.subpath);
  const subpath = root === dir ? undefined : ref.subpath;
  const ctx: RepoContext = { owner: ref.owner, repo: ref.repo, sha, branch, subpath };
  const name = `scan-${SCAN_VERSION}-${cacheKey(subpath ?? "")}`;
  let model = await readCache<RepoModel>(ref.owner, ref.repo, sha, name);
  if (!model) {
    status("Scanning files");
    const { scanSnapshot } = await import("./scan");
    model = await scanSnapshot(root);
    await writeCache(ref.owner, ref.repo, sha, name, model);
  }
  status(`Scanned ${model.files.length} files`);
  return { ctx, root, model };
}

export type OverviewResult = {
  ctx: RepoContext;
  title: string;
  summary: string;
  graph: { nodes: Node[]; edges: Edge[] };
  suggestions: Array<{ label: string; prompt: string }>;
  stats: { files: number; covered: number; truncated: boolean };
  usage: Usage;
  cached: boolean;
};

export async function repoOverview(
  repo: LoadedRepo,
  models: ModelChoice,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  refresh = false,
): Promise<OverviewResult> {
  const { ctx, model } = repo;
  const key = `overview-${cacheKey(ctx.subpath ?? "", models.coordinator)}`;
  let overview = refresh ? undefined : await readCache<RepoOverview>(ctx.owner, ctx.repo, ctx.sha, key);
  let usage = emptyUsage();
  const cached = !!overview;
  if (!overview) {
    onEvent({ type: "status", text: "Mapping features" });
    const digest = buildDigest(model, `${ctx.owner}/${ctx.repo}${ctx.subpath ? `/${ctx.subpath}` : ""}`);
    const r = await runAgent({
      prompt: `<digest>\n${digest}\n</digest>`,
      systemPrompt: REPO_OVERVIEW_PROMPT,
      model: models.coordinator,
      effort: "medium",
      outputSchema: OVERVIEW_SCHEMA,
      maxTurns: 4,
      maxBudgetUsd: 1,
      signal,
      onEvent,
    });
    const parsed = RepoOverview.safeParse(r.structured);
    if (!parsed.success) throw new RepoError("The overview did not match the expected format.", 502);
    overview = parsed.data;
    usage = r.usage;
    await writeCache(ctx.owner, ctx.repo, ctx.sha, key, overview);
  } else {
    onEvent({ type: "status", text: "Using cached feature map" });
  }
  const g = overviewGraph(ctx, model.files, overview);
  return {
    ctx,
    title: overview.title,
    summary: overview.summary,
    graph: { nodes: g.nodes, edges: g.edges },
    suggestions: overview.suggestions,
    stats: { files: model.files.length, covered: g.coverage, truncated: model.truncated },
    usage,
    cached,
  };
}

/** Expand one node to its next level. Features use a worker (cached); deeper levels use the scan only. */
export async function expandNode(
  repo: LoadedRepo,
  node: { id: string; data: RepoNodeData },
  models: ModelChoice,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  refresh = false,
): Promise<{ expansion: Expansion; usage: Usage }> {
  const { ctx, model, root } = repo;
  const all = model.files.map((f) => f.path);
  const d = node.data;
  if (d.kind === "component") {
    const paths = (d.paths ?? []).filter((p) => all.includes(p));
    return { expansion: fileExpansion(ctx, model.files, node.id, paths), usage: emptyUsage() };
  }
  if (d.kind === "file" && d.path) {
    return { expansion: symbolExpansion(ctx, model.files, node.id, d.path), usage: emptyUsage() };
  }
  if (d.kind !== "feature") throw new RepoError("This node has no further level.", 400);

  const featureFiles = filesUnder(all, d.paths ?? []);
  if (!featureFiles.length) throw new RepoError("This feature has no files to expand.", 400);
  const key = `feature-${cacheKey(node.id, featureFiles.join("|"), models.worker)}`;
  const hit = refresh ? undefined : await readCache<FeatureBreakdown>(ctx.owner, ctx.repo, ctx.sha, key);
  if (hit) {
    onEvent({ type: "status", text: `${d.title}: cached` });
    return { expansion: componentExpansion(ctx, model.files, node.id, featureFiles, hit, true), usage: emptyUsage() };
  }

  onEvent({ type: "status", text: `Exploring ${d.title}`, agent: "repo-explorer" });
  const byPath = new Map(model.files.map((f) => [f.path, f]));
  const listing = featureFiles
    .slice(0, 250)
    .map((p) => {
      const f = byPath.get(p)!;
      return `${p} ${f.lines}l${
        f.symbols.length
          ? ` [${f.symbols
              .slice(0, 6)
              .map((s) => s.name)
              .join(", ")}]`
          : ""
      }`;
    })
    .join("\n");
  const r = await runAgent({
    prompt: `Feature: ${d.title}\nSummary: ${d.summary ?? ""}\n\nFiles (${featureFiles.length}${featureFiles.length > 250 ? ", first 250 shown" : ""}):\n${listing}`,
    systemPrompt: REPO_EXPLORER_PROMPT,
    model: models.worker,
    effort: "low",
    mcpServers: { repo: repoServer(root, model) },
    allowedTools: [RT.listFiles, RT.readFile, RT.findSymbol],
    toolLabels: { [RT.readFile]: `${d.title}: reading source` },
    outputSchema: BREAKDOWN_SCHEMA,
    maxTurns: 10,
    maxBudgetUsd: 0.5,
    signal,
    onEvent,
  });
  const parsed = FeatureBreakdown.safeParse(r.structured);
  if (!parsed.success) throw new RepoError(`Could not break down ${d.title}.`, 502);
  await writeCache(ctx.owner, ctx.repo, ctx.sha, key, parsed.data);
  return { expansion: componentExpansion(ctx, model.files, node.id, featureFiles, parsed.data, false), usage: r.usage };
}

/** Expand several nodes in parallel (hub-and-spoke from the server), at most `concurrency` at once. */
export async function expandMany(
  repo: LoadedRepo,
  nodes: Array<{ id: string; data: RepoNodeData }>,
  models: ModelChoice,
  onEvent: (e: AgentEvent) => void,
  onExpansion: (e: Expansion) => void,
  onError: (id: string, message: string) => void,
  signal?: AbortSignal,
  concurrency = 4,
): Promise<Usage> {
  let usage = emptyUsage();
  const queue = [...nodes];
  async function worker() {
    for (let n = queue.shift(); n; n = queue.shift()) {
      try {
        const r = await expandNode(repo, n, models, onEvent, signal);
        usage = addUsage(usage, r.usage);
        onExpansion(r.expansion);
      } catch (err) {
        onError(n.id, (err as Error).message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, worker));
  return usage;
}
