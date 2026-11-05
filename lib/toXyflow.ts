import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { DEFAULT_SIZE } from "@nodes/constants";
import type { ShapeNodeData } from "@nodes";
import type { FlowSpec, FlowSpecEdge } from "./schema";

export type FlowNode = Node<ShapeNodeData, "shape">;

type Box = { x: number; y: number; width: number; height: number };

const DASH: Record<FlowSpecEdge["style"], string | undefined> = {
  solid: undefined,
  dashed: "6 4",
  dotted: "2 4",
};

/** Pick the facing sides of two boxes so edges leave/enter on sensible handles. */
export function pickHandles(a: Box, b: Box): { sourceHandle: string; targetHandle: string } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? { sourceHandle: "right", targetHandle: "left" } : { sourceHandle: "left", targetHandle: "right" };
  }
  return dy >= 0 ? { sourceHandle: "bottom", targetHandle: "top" } : { sourceHandle: "top", targetHandle: "bottom" };
}

/** Order nodes so every parent precedes its children (React Flow requirement). */
function parentFirst<T extends { id: string; parentId: string | null }>(nodes: T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: T, seen = new Set<string>()): number => {
    if (!n.parentId || seen.has(n.id)) return 0;
    const p = byId.get(n.parentId);
    if (!p) return 0;
    seen.add(n.id);
    return 1 + depth(p, seen);
  };
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}

export function toXyflow(spec: FlowSpec): { nodes: FlowNode[]; edges: Edge[] } {
  const ids = new Set(spec.nodes.map((n) => n.id));
  const abs = new Map<string, Box>();
  for (const n of spec.nodes) {
    const size = DEFAULT_SIZE[n.shape];
    abs.set(n.id, { x: n.x, y: n.y, width: n.width ?? size.width, height: n.height ?? size.height });
  }

  const nodes: FlowNode[] = parentFirst(spec.nodes).map((n) => {
    const box = abs.get(n.id)!;
    const parentId = n.parentId && n.parentId !== n.id && ids.has(n.parentId) ? n.parentId : undefined;
    const parent = parentId ? abs.get(parentId)! : undefined;
    return {
      id: n.id,
      type: "shape",
      position: parent ? { x: box.x - parent.x, y: box.y - parent.y } : { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { label: n.label, shape: n.shape, color: n.color },
      ...(parentId ? { parentId } : {}),
    };
  });

  const seenEdgeIds = new Set<string>();
  const edges: Edge[] = spec.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e, i) => {
      let id = e.id || `e${i}`;
      while (seenEdgeIds.has(id)) id = `${id}-${i}`;
      seenEdgeIds.add(id);
      const dash = DASH[e.style];
      const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
      return {
        id,
        source: e.source,
        target: e.target,
        ...pickHandles(abs.get(e.source)!, abs.get(e.target)!),
        type: "smoothstep",
        ...(e.label ? { label: e.label } : {}),
        ...(e.directed || e.bidirectional ? { markerEnd: arrow } : {}),
        ...(e.bidirectional ? { markerStart: arrow } : {}),
        ...(dash ? { style: { strokeDasharray: dash } } : {}),
      };
    });

  return { nodes, edges };
}

/** Absolute boxes for nodes, resolving parent-relative positions. */
export function absoluteBoxes(nodes: Node[]): Map<string, Box> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, Box>();
  const resolve = (n: Node, guard = 0): Box => {
    const cached = out.get(n.id);
    if (cached) return cached;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const origin = parent && guard < 50 ? resolve(parent, guard + 1) : { x: 0, y: 0 };
    const box = {
      x: origin.x + n.position.x,
      y: origin.y + n.position.y,
      width: n.width ?? n.measured?.width ?? 160,
      height: n.height ?? n.measured?.height ?? 60,
    };
    out.set(n.id, box);
    return box;
  };
  nodes.forEach((n) => resolve(n));
  return out;
}

/** Count overlapping pairs among nodes that share a parent. Used to decide whether to auto-layout. */
export function countOverlaps(nodes: Node[]): number {
  const boxes = absoluteBoxes(nodes);
  const leaves = nodes.filter((n) => (n.data as ShapeNodeData).shape !== "group");
  let overlaps = 0;
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = boxes.get(leaves[i].id)!;
      const b = boxes.get(leaves[j].id)!;
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
        overlaps++;
      }
    }
  }
  return overlaps;
}

/** Re-pick edge handles from current node positions. */
export function rehandle(nodes: Node[], edges: Edge[]): Edge[] {
  const boxes = absoluteBoxes(nodes);
  return edges.map((e) => {
    const a = boxes.get(e.source);
    const b = boxes.get(e.target);
    return a && b ? { ...e, ...pickHandles(a, b) } : e;
  });
}
