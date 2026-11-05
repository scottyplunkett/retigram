import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { rehandle } from "./toXyflow";

export type Direction = "TB" | "LR" | "BT" | "RL";

const PAD = 30;
const PAD_TOP = { group: 56, repo: 48 } as const;

/** A node lays out as a container when it is a group shape or has visible children. */
function containers(nodes: Node[]) {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (n.type === "shape" && (n.data as { shape?: string }).shape === "group") ids.add(n.id);
    if (n.parentId && !n.hidden) ids.add(n.parentId);
  }
  return ids;
}

/**
 * Lay out visible nodes with dagre as a compound graph so containers (groups, swimlanes, expanded
 * repo nodes) wrap their children. Hidden nodes keep their positions. Returns new arrays.
 */
export function autoLayout(nodes: Node[], edges: Edge[], direction: Direction = "TB") {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const visible = nodes.filter((n) => !n.hidden);
  const visibleIds = new Set(visible.map((n) => n.id));
  const groupIds = containers(visible);

  for (const n of visible) {
    if (groupIds.has(n.id)) {
      const top = n.type === "repo" ? PAD_TOP.repo : PAD_TOP.group;
      g.setNode(n.id, { paddingTop: top, paddingLeft: PAD, paddingRight: PAD, paddingBottom: PAD });
    } else {
      g.setNode(n.id, { width: n.width ?? n.measured?.width ?? 160, height: n.height ?? n.measured?.height ?? 60 });
    }
  }
  for (const n of visible) if (n.parentId && visibleIds.has(n.parentId)) g.setParent(n.id, n.parentId);
  // dagre cannot route edges that touch clusters; lay out leaf-to-leaf edges only.
  for (const e of edges) {
    if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
    if (groupIds.has(e.source) || groupIds.has(e.target)) continue;
    g.setEdge(e.source, e.target, {}, e.id);
  }
  for (const id of groupIds) {
    if (!(g.children(id) ?? []).length) g.setNode(id, { width: 200, height: 120 });
  }

  dagre.layout(g);

  const abs = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const n of visible) {
    const d = g.node(n.id);
    if (d) abs.set(n.id, { x: d.x - d.width / 2, y: d.y - d.height / 2, width: d.width, height: d.height });
  }
  const laidOut = nodes.map((n) => {
    const box = abs.get(n.id);
    if (!box) return n;
    const parent = n.parentId ? abs.get(n.parentId) : undefined;
    const position = parent ? { x: box.x - parent.x, y: box.y - parent.y } : { x: box.x, y: box.y };
    return groupIds.has(n.id) ? { ...n, position, width: box.width, height: box.height } : { ...n, position };
  });
  return { nodes: laidOut, edges: rehandle(laidOut, edges) };
}
