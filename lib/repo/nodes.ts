// Pure builders that turn analysis + model output into React Flow nodes. Shared by routes and tests.
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { REPO_SIZE } from "@nodes/constants";
import type { RepoNodeData } from "@nodes";
import type { RepoFile } from "./analyze";
import { filesUnder, groupEdges } from "./edges";
import type { FeatureBreakdown, RepoContext, RepoOverview } from "./schema";

export type Expansion = { parentId: string; nodes: Node[]; edges: Edge[]; cached: boolean; note?: string };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "x";

export function permalink(ctx: RepoContext, file: string, line?: number) {
  const p = (ctx.subpath ? `${ctx.subpath}/${file}` : file).split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${ctx.owner}/${ctx.repo}/blob/${ctx.sha}/${p}${line ? `#L${line}` : ""}`;
}

function edgesFor(files: RepoFile[], groups: Array<{ id: string; files: string[] }>, prefix: string): Edge[] {
  return groupEdges(files, groups).map((e) => ({
    id: `${prefix}${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    label: `${e.count} import${e.count === 1 ? "" : "s"}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { strokeWidth: Math.min(1 + Math.log2(e.count), 5), stroke: "#94a3b8" },
    labelStyle: { fontSize: 10, fill: "#64748b" },
  }));
}

function repoNode(id: string, data: RepoNodeData, parentId?: string): Node {
  const size = REPO_SIZE[data.kind];
  return {
    id,
    type: "repo",
    position: { x: 0, y: 0 },
    ...size,
    data: { ...data, collapsedSize: size },
    ...(parentId ? { parentId } : {}),
  };
}

/** Layer swimlanes holding feature nodes, with import-derived edges between features. */
export function overviewGraph(ctx: RepoContext, files: RepoFile[], o: RepoOverview) {
  const all = files.map((f) => f.path);
  const layerIds = new Map(o.layers.map((l) => [l.id, `layer:${slug(l.id)}`]));
  const fallbackLayer = o.layers[0]?.id;
  const nodes: Node[] = o.layers.map((l) => ({
    id: layerIds.get(l.id)!,
    type: "shape",
    position: { x: 0, y: 0 },
    width: 400,
    height: 200,
    data: { label: l.name, shape: "group" },
  }));
  const groups: Array<{ id: string; files: string[] }> = [];
  const seen = new Set<string>();
  for (const f of o.features) {
    let id = `f:${slug(f.id)}`;
    while (seen.has(id)) id += "-2";
    seen.add(id);
    const covered = filesUnder(all, f.paths);
    groups.push({ id, files: covered });
    nodes.push(
      repoNode(
        id,
        {
          kind: "feature",
          title: f.name,
          summary: f.summary,
          layer: o.layers.find((l) => l.id === f.layer)?.name,
          fileCount: covered.length,
          expandable: covered.length > 0,
          expanded: false,
          paths: f.paths,
        },
        layerIds.get(f.layer) ?? layerIds.get(fallbackLayer ?? ""),
      ),
    );
  }
  return { nodes, edges: edgesFor(files, groups, "e:"), coverage: new Set(groups.flatMap((g) => g.files)).size };
}

/** Components of a feature from the explorer's breakdown; uncovered files go to "Other files". */
export function componentExpansion(
  ctx: RepoContext,
  files: RepoFile[],
  parentId: string,
  featureFiles: string[],
  b: FeatureBreakdown,
  cached: boolean,
): Expansion {
  const allowed = new Set(featureFiles);
  const known = new Set(files.map((f) => f.path));
  const used = new Set<string>();
  const groups: Array<{ id: string; files: string[] }> = [];
  const nodes: Node[] = [];
  for (const c of b.components) {
    const mine = c.files.map((f) => f.replace(/^\.?\/+/, "")).filter((f) => allowed.has(f) && !used.has(f));
    if (!mine.length) continue;
    mine.forEach((f) => used.add(f));
    const id = `${parentId}/c:${slug(c.id)}`;
    groups.push({ id, files: mine });
    nodes.push(
      repoNode(
        id,
        {
          kind: "component",
          title: c.name,
          summary: c.summary,
          fileCount: mine.length,
          expandable: true,
          expanded: false,
          paths: mine,
          citations: c.citations
            .filter((x) => known.has(x.path))
            .slice(0, 3)
            .map((x) => ({ path: x.path, line: x.line, note: x.note, url: permalink(ctx, x.path, x.line) })),
          ...(c.citations[0] && known.has(c.citations[0].path)
            ? {
                path: c.citations[0].path,
                line: c.citations[0].line,
                url: permalink(ctx, c.citations[0].path, c.citations[0].line),
              }
            : {}),
        },
        parentId,
      ),
    );
  }
  const rest = featureFiles.filter((f) => !used.has(f));
  if (rest.length) {
    const id = `${parentId}/c:other`;
    groups.push({ id, files: rest });
    nodes.push(
      repoNode(
        id,
        {
          kind: "component",
          title: "Other files",
          summary: "Files in this feature not assigned to a component.",
          fileCount: rest.length,
          expandable: true,
          expanded: false,
          paths: rest,
        },
        parentId,
      ),
    );
  }
  return { parentId, nodes, edges: edgesFor(files, groups, `${parentId}|`), cached };
}

const MAX_FILE_NODES = 60;

/** Files of a component, straight from the scan (no model). */
export function fileExpansion(ctx: RepoContext, files: RepoFile[], parentId: string, paths: string[]): Expansion {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const list = paths.map((p) => byPath.get(p)).filter((f): f is RepoFile => !!f);
  list.sort((a, b) => b.symbols.length - a.symbols.length || b.lines - a.lines);
  const shown = list.slice(0, MAX_FILE_NODES);
  const groups = shown.map((f) => ({ id: `${parentId}/p:${f.path}`, files: [f.path] }));
  const nodes = shown.map((f) =>
    repoNode(
      `${parentId}/p:${f.path}`,
      {
        kind: "file",
        title: f.path.split("/").pop()!,
        summary: `${f.lines} lines · ${f.symbols.length} declarations`,
        path: f.path,
        url: permalink(ctx, f.path),
        expandable: f.symbols.length > 0,
        expanded: false,
      },
      parentId,
    ),
  );
  return {
    parentId,
    nodes,
    edges: edgesFor(files, groups, `${parentId}|`),
    cached: true,
    note: list.length > shown.length ? `Showing the ${shown.length} largest of ${list.length} files.` : undefined,
  };
}

/** Top-level declarations of a file, from the scan (no model). */
export function symbolExpansion(ctx: RepoContext, files: RepoFile[], parentId: string, filePath: string): Expansion {
  const f = files.find((x) => x.path === filePath);
  const nodes = (f?.symbols ?? []).map((s) =>
    repoNode(
      `${parentId}#${s.name}@${s.line}`,
      {
        kind: "symbol",
        title: s.name,
        summary: s.kind,
        path: filePath,
        line: s.line,
        url: permalink(ctx, filePath, s.line),
        expandable: false,
      },
      parentId,
    ),
  );
  return { parentId, nodes, edges: [], cached: true };
}

/** Merge an expansion into a graph: replaces any previous children of the parent and expands it. */
export function mergeExpansion(graph: { nodes: Node[]; edges: Edge[] }, exp: Expansion) {
  const drop = new Set<string>();
  const collect = (id: string) => {
    for (const n of graph.nodes)
      if (n.parentId === id && !drop.has(n.id)) {
        drop.add(n.id);
        collect(n.id);
      }
  };
  collect(exp.parentId);
  const nodes = graph.nodes
    .filter((n) => !drop.has(n.id))
    .map((n) => {
      if (n.id !== exp.parentId) return n;
      const d = n.data as RepoNodeData;
      return {
        ...n,
        data: {
          ...d,
          expanded: exp.nodes.length > 0,
          expandable: exp.nodes.length > 0,
          loading: false,
          error: exp.nodes.length ? undefined : "Nothing to expand.",
          collapsedSize: d.collapsedSize ?? { width: n.width ?? 0, height: n.height ?? 0 },
        },
      };
    });
  const edges = graph.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
  return { nodes: [...nodes, ...exp.nodes], edges: [...edges, ...exp.edges] };
}
