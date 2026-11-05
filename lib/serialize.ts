import type { Edge, Node } from "@xyflow/react";

const NODE_KEYS = [
  "id",
  "type",
  "position",
  "width",
  "height",
  "parentId",
  "extent",
  "data",
  "style",
  "zIndex",
  "hidden",
] as const;
const EDGE_KEYS = [
  "id",
  "source",
  "target",
  "sourceHandle",
  "targetHandle",
  "type",
  "label",
  "animated",
  "markerStart",
  "markerEnd",
  "style",
  "hidden",
] as const;

function pick<T extends object>(obj: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

const RUNTIME_DATA = new Set(["loading", "error"]);

/** Strip runtime-only fields (measured, selected, dragging, internals) for a portable definition. */
export function cleanNodes(nodes: Node[], opts: { forExport?: boolean } = {}): Node[] {
  const parents = new Set(nodes.map((n) => n.parentId).filter(Boolean));
  return nodes.map((n) => {
    const out = pick(n, NODE_KEYS) as unknown as Node;
    out.position = { x: round(n.position.x), y: round(n.position.y) };
    if (typeof out.width === "number") out.width = round(out.width);
    if (typeof out.height === "number") out.height = round(out.height);
    if (out.data && typeof out.data === "object") {
      out.data = Object.fromEntries(
        Object.entries(out.data).filter(([k, v]) => v !== null && v !== undefined && !RUNTIME_DATA.has(k)),
      );
      // Levels that were never loaded cannot be expanded offline.
      // Exported projects can't fetch unloaded levels, so leaves there are not expandable.
      // The live config panel keeps the flag so the app can still expand them.
      if (opts.forExport && n.type === "repo" && !parents.has(n.id)) out.data.expandable = false;
    }
    return out;
  });
}

export function cleanEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => pick(e, EDGE_KEYS) as unknown as Edge);
}

/** A self-contained TypeScript module exporting initialNodes / initialEdges. */
export function serializeFlow(nodes: Node[], edges: Edge[]): string {
  const ns = JSON.stringify(cleanNodes(nodes, { forExport: true }), null, 2);
  const es = JSON.stringify(cleanEdges(edges), null, 2);
  return `import type { Edge, Node } from "@xyflow/react";

export const initialNodes: Node[] = ${ns};

export const initialEdges: Edge[] = ${es};
`;
}
