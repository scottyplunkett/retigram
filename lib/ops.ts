import { z } from "zod";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { DEFAULT_SIZE, REPO_SIZE } from "@nodes/constants";
import { COLOR, PATH_D } from "@nodes/types";
import { SHAPE_VALUES } from "./schema";
import { absoluteBoxes, pickHandles, rehandle } from "./toXyflow";
import { alignTo, arrange, boxOf, fitGroup, isDescendant, placeBeside, reparent, setAbsolute } from "./geometry";
import { autoLayout } from "./layout";

export type Graph = { nodes: Node[]; edges: Edge[] };

const color = z.string().regex(COLOR, "hex colour like #1d4ed8");

export const NodeStyleSchema = z
  .object({
    fill: color.nullable(),
    borderColor: color.nullable(),
    borderWidth: z.number().min(0).max(12).nullable(),
    borderStyle: z.enum(["solid", "dashed", "dotted"]).nullable(),
    textColor: color.nullable(),
    fontWeight: z.enum(["normal", "bold"]).nullable(),
    fontSize: z.number().min(8).max(48).nullable(),
  })
  .partial()
  .describe("Only the fields to change. null clears a field.");

export const PathSchema = z.object({
  d: z.string().max(8000).regex(PATH_D, "SVG path commands only"),
  fill: color.optional(),
  stroke: color.optional(),
  strokeWidth: z.number().min(0).max(10).optional(),
});

const edgeStyle = z.enum(["solid", "dashed", "dotted"]);

export const OpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    id: z.string().optional().describe("New unique id; generated if omitted"),
    label: z.string(),
    shape: z.enum(SHAPE_VALUES).optional().describe("Default rectangle"),
    parentId: z.string().optional().describe("Group to place it in"),
    near: z.string().optional().describe("Existing node to place it next to"),
    side: z.enum(["below", "right", "above", "left"]).optional().describe("Side of `near`; default below"),
  }),
  z.object({
    op: z.literal("update_node"),
    id: z.string(),
    label: z.string().optional(),
    shape: z.enum(SHAPE_VALUES).optional(),
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe("Same as set_parent: move into a group (or null to move out) without moving on the canvas"),
  }),
  z.object({
    op: z.literal("move_node"),
    id: z.string(),
    x: z.number().optional().describe("New absolute top-left x in canvas pixels"),
    y: z.number().optional().describe("New absolute top-left y in canvas pixels (y grows downward)"),
    dx: z.number().optional().describe("Shift right by this many pixels (negative = left)"),
    dy: z.number().optional().describe("Shift down by this many pixels (negative = up)"),
  }),
  z.object({
    op: z.literal("place_node"),
    id: z.string(),
    relativeTo: z.string().describe("Reference node"),
    side: z.enum(["above", "below", "left", "right"]),
    align: z.enum(["start", "center", "end"]).optional().describe("Alignment along the other axis; default center"),
    gap: z.number().min(0).max(1000).optional().describe("Pixels between the two nodes; default 40"),
  }),
  z.object({
    op: z.literal("resize_node"),
    id: z.string(),
    width: z.number().min(20).max(5000).optional(),
    height: z.number().min(20).max(5000).optional(),
  }),
  z.object({
    op: z.literal("set_parent"),
    id: z.string(),
    parentId: z
      .string()
      .nullable()
      .describe("Container to move into, or null for the top level. The node keeps its canvas position."),
    fit: z.boolean().optional().describe("Grow the new container to wrap the node; default true"),
  }),
  z.object({
    op: z.literal("arrange_nodes"),
    ids: z.array(z.string()).min(2).describe("Nodes in the order they should appear"),
    direction: z.enum(["row", "column"]).describe("row = left to right, column = top to bottom"),
    gap: z.number().min(0).max(1000).optional().describe("Default 40"),
    align: z.enum(["start", "center", "end"]).optional().describe("Cross-axis alignment; default center"),
    x: z.number().optional().describe("Absolute start x; default the first node's current x"),
    y: z.number().optional().describe("Absolute start y; default the first node's current y"),
  }),
  z.object({
    op: z.literal("align_nodes"),
    ids: z.array(z.string()).min(2).describe("The first node is the reference; the others move"),
    edge: z.enum(["left", "center", "right", "top", "middle", "bottom"]),
  }),
  z.object({
    op: z.literal("set_z"),
    ids: z.array(z.string()).min(1),
    to: z.enum(["front", "back"]).describe("Stacking order when nodes overlap"),
  }),
  z.object({
    op: z.literal("fit_group"),
    id: z.string().describe("Container to resize around its children"),
    padding: z.number().min(0).max(400).optional(),
  }),
  z.object({
    op: z.literal("auto_layout"),
    direction: z
      .enum(["TB", "LR", "BT", "RL"])
      .optional()
      .describe("Re-run automatic layout for the whole diagram; default TB"),
  }),
  z.object({ op: z.literal("remove_node"), id: z.string() }),
  z.object({
    op: z.literal("add_edge"),
    id: z.string().optional(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
    directed: z.boolean().optional().describe("Arrow at target; default true"),
    style: edgeStyle.optional(),
  }),
  z.object({
    op: z.literal("update_edge"),
    id: z.string(),
    label: z.string().nullable().optional(),
    directed: z.boolean().optional(),
    style: edgeStyle.optional(),
    color: color.optional(),
  }),
  z.object({ op: z.literal("remove_edge"), id: z.string() }),
  z.object({ op: z.literal("set_style"), ids: z.array(z.string()).min(1), style: NodeStyleSchema }),
  z.object({
    op: z.literal("set_illustration"),
    id: z.string().describe("Existing node to turn into an illustration, or a new id with `near`"),
    near: z.string().optional(),
    label: z.string().optional(),
    paths: z.array(PathSchema).min(1).max(60).describe("SVG paths in a 100x100 viewBox"),
  }),
]);

export type Op = z.infer<typeof OpSchema>;
export type ApplyResult = Graph & { applied: Op[]; errors: string[] };

const DASH = { solid: undefined, dashed: "6 4", dotted: "2 4" } as const;

function uniqueId(base: string, taken: Set<string>) {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "node";
  let id = slug;
  for (let i = 2; taken.has(id); i++) id = `${slug}-${i}`;
  return id;
}

function sizeOf(n: Node) {
  return { width: n.width ?? n.measured?.width ?? 160, height: n.height ?? n.measured?.height ?? 60 };
}

function placeNear(
  g: Graph,
  nearId: string | undefined,
  side: string | undefined,
  size: { width: number; height: number },
) {
  const near = nearId ? g.nodes.find((n) => n.id === nearId) : undefined;
  if (!near) {
    // Below everything at the top level.
    const boxes = absoluteBoxes(g.nodes);
    const maxY = Math.max(0, ...[...boxes.values()].map((b) => b.y + b.height));
    return { position: { x: 0, y: maxY + 60 }, parentId: undefined };
  }
  const s = sizeOf(near);
  const gap = 60;
  const offsets: Record<string, { x: number; y: number }> = {
    below: { x: (s.width - size.width) / 2, y: s.height + gap },
    above: { x: (s.width - size.width) / 2, y: -size.height - gap },
    right: { x: s.width + gap, y: (s.height - size.height) / 2 },
    left: { x: -size.width - gap, y: (s.height - size.height) / 2 },
  };
  const o = offsets[side ?? "below"] ?? offsets.below;
  return { position: { x: near.position.x + o.x, y: near.position.y + o.y }, parentId: near.parentId };
}

function cleanStyle(prev: Record<string, unknown> | undefined, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function edgeHandles(g: Graph, source: string, target: string) {
  const boxes = absoluteBoxes(g.nodes);
  const a = boxes.get(source);
  const b = boxes.get(target);
  return a && b ? pickHandles(a, b) : {};
}

/** Order nodes so parents precede children (React Flow requirement). */
export function parentsFirst(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: Node, guard = 0): number =>
    n.parentId && byId.has(n.parentId) && guard < 50 ? 1 + depth(byId.get(n.parentId)!, guard + 1) : 0;
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}

/**
 * Apply patch ops to a graph. Pure: returns a new graph plus the ops as applied (with generated ids
 * filled in) and a message for each op that was rejected. Clients replay `applied` to stay in sync.
 */
export function applyOps(graph: Graph, ops: unknown[]): ApplyResult {
  let g: Graph = { nodes: [...graph.nodes], edges: [...graph.edges] };
  const applied: Op[] = [];
  const errors: string[] = [];
  let geometry = false;

  for (const raw of ops) {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`invalid op ${JSON.stringify(raw).slice(0, 120)}: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const op = { ...parsed.data } as Op;
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    const edgeIds = new Set(g.edges.map((e) => e.id));
    const fail = (msg: string) => errors.push(`${op.op}: ${msg}`);

    switch (op.op) {
      case "add_node": {
        if (op.parentId && !nodeIds.has(op.parentId)) {
          fail(`unknown parent ${op.parentId}`);
          continue;
        }
        if (op.near && !nodeIds.has(op.near)) {
          fail(`unknown node ${op.near}`);
          continue;
        }
        const id = op.id && !nodeIds.has(op.id) ? op.id : uniqueId(op.id ?? op.label, nodeIds);
        op.id = id;
        const shape = op.shape ?? "rectangle";
        const size = DEFAULT_SIZE[shape];
        const placed = placeNear(g, op.near, op.side, size);
        const parentId = op.parentId ?? placed.parentId;
        g.nodes = parentsFirst([
          ...g.nodes,
          {
            id,
            type: "shape",
            position: placed.position,
            ...size,
            data: { label: op.label, shape },
            ...(parentId ? { parentId } : {}),
          },
        ]);
        break;
      }
      case "update_node": {
        if (!nodeIds.has(op.id)) {
          fail(`unknown node ${op.id}`);
          continue;
        }
        if (
          op.parentId &&
          (!nodeIds.has(op.parentId) || op.parentId === op.id || isDescendant(g.nodes, op.parentId, op.id))
        ) {
          fail(`bad parent ${op.parentId} (unknown, itself, or one of its descendants)`);
          continue;
        }
        if (op.parentId !== undefined) g.nodes = parentsFirst(reparent(g.nodes, op.id, op.parentId));
        g.nodes = parentsFirst(
          g.nodes.map((n) => {
            if (n.id !== op.id) return n;
            const data = { ...n.data } as Record<string, unknown>;
            if (op.label !== undefined) {
              if (n.type === "repo") data.title = op.label;
              else data.label = op.label;
            }
            if (op.shape && n.type === "shape") data.shape = op.shape;
            return { ...n, data };
          }),
        );
        break;
      }
      case "remove_node": {
        if (!nodeIds.has(op.id)) {
          fail(`unknown node ${op.id}`);
          continue;
        }
        const removed = g.nodes.find((n) => n.id === op.id)!;
        // Children move up to the removed node's parent so nothing is orphaned.
        g.nodes = g.nodes
          .filter((n) => n.id !== op.id)
          .map((n) =>
            n.parentId === op.id
              ? {
                  ...n,
                  parentId: removed.parentId,
                  position: { x: n.position.x + removed.position.x, y: n.position.y + removed.position.y },
                }
              : n,
          )
          .map((n) => {
            if (n.parentId === undefined) {
              const { parentId: _drop, ...rest } = n;
              return rest as Node;
            }
            return n;
          });
        g.edges = g.edges.filter((e) => e.source !== op.id && e.target !== op.id);
        break;
      }
      case "add_edge": {
        if (!nodeIds.has(op.source) || !nodeIds.has(op.target)) {
          fail(`unknown endpoint ${op.source} -> ${op.target}`);
          continue;
        }
        const id = op.id && !edgeIds.has(op.id) ? op.id : uniqueId(op.id ?? `${op.source}-${op.target}`, edgeIds);
        op.id = id;
        const dash = DASH[op.style ?? "solid"];
        g.edges = [
          ...g.edges,
          {
            id,
            source: op.source,
            target: op.target,
            ...edgeHandles(g, op.source, op.target),
            type: "smoothstep",
            ...(op.label ? { label: op.label } : {}),
            ...(op.directed === false ? {} : { markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } }),
            ...(dash ? { style: { strokeDasharray: dash } } : {}),
          },
        ];
        break;
      }
      case "update_edge": {
        if (!edgeIds.has(op.id)) {
          fail(`unknown edge ${op.id}`);
          continue;
        }
        g.edges = g.edges.map((e) => {
          if (e.id !== op.id) return e;
          const next: Edge = { ...e };
          if (op.label === null) delete next.label;
          else if (op.label !== undefined) next.label = op.label;
          if (op.directed === false) delete next.markerEnd;
          if (op.directed === true) next.markerEnd = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
          const style: Record<string, unknown> = { ...(e.style ?? {}) };
          if (op.style) {
            const d = DASH[op.style];
            if (d) style.strokeDasharray = d;
            else delete style.strokeDasharray;
          }
          if (op.color) style.stroke = op.color;
          next.style = style;
          return next;
        });
        break;
      }
      case "remove_edge": {
        if (!edgeIds.has(op.id)) {
          fail(`unknown edge ${op.id}`);
          continue;
        }
        g.edges = g.edges.filter((e) => e.id !== op.id);
        break;
      }
      case "set_style": {
        const missing = op.ids.filter((id) => !nodeIds.has(id));
        if (missing.length) fail(`unknown nodes ${missing.join(", ")} (others styled)`);
        const ids = new Set(op.ids);
        g.nodes = g.nodes.map((n) =>
          ids.has(n.id)
            ? {
                ...n,
                data: { ...n.data, style: cleanStyle((n.data as { style?: Record<string, unknown> }).style, op.style) },
              }
            : n,
        );
        break;
      }
      case "move_node": {
        const b = boxOf(g.nodes, op.id);
        if (!b) {
          fail(`unknown node ${op.id}`);
          continue;
        }
        if (op.x === undefined && op.y === undefined && op.dx === undefined && op.dy === undefined) {
          fail("give x/y or dx/dy");
          continue;
        }
        g.nodes = setAbsolute(g.nodes, op.id, (op.x ?? b.x) + (op.dx ?? 0), (op.y ?? b.y) + (op.dy ?? 0));
        geometry = true;
        break;
      }
      case "place_node": {
        const me = boxOf(g.nodes, op.id);
        const ref = boxOf(g.nodes, op.relativeTo);
        if (!me || !ref) {
          fail(`unknown node ${!me ? op.id : op.relativeTo}`);
          continue;
        }
        if (op.id === op.relativeTo) {
          fail("a node cannot be placed relative to itself");
          continue;
        }
        const at = placeBeside(ref, me, op.side, op.align, op.gap);
        g.nodes = setAbsolute(g.nodes, op.id, at.x, at.y);
        geometry = true;
        break;
      }
      case "resize_node": {
        if (!nodeIds.has(op.id)) {
          fail(`unknown node ${op.id}`);
          continue;
        }
        g.nodes = g.nodes.map((n) =>
          n.id === op.id
            ? {
                ...n,
                width: Math.round(op.width ?? sizeOf(n).width),
                height: Math.round(op.height ?? sizeOf(n).height),
              }
            : n,
        );
        geometry = true;
        break;
      }
      case "set_parent": {
        if (!nodeIds.has(op.id)) {
          fail(`unknown node ${op.id}`);
          continue;
        }
        if (
          op.parentId &&
          (!nodeIds.has(op.parentId) || op.parentId === op.id || isDescendant(g.nodes, op.parentId, op.id))
        ) {
          fail(`bad parent ${op.parentId} (unknown, itself, or one of its descendants)`);
          continue;
        }
        g.nodes = parentsFirst(reparent(g.nodes, op.id, op.parentId, op.fit ?? true));
        geometry = true;
        break;
      }
      case "arrange_nodes": {
        const missing = op.ids.filter((id) => !nodeIds.has(id));
        if (missing.length) {
          fail(`unknown nodes ${missing.join(", ")}`);
          continue;
        }
        if (new Set(op.ids).size !== op.ids.length) {
          fail("ids must be unique");
          continue;
        }
        const start =
          op.x !== undefined || op.y !== undefined
            ? { x: op.x ?? boxOf(g.nodes, op.ids[0])!.x, y: op.y ?? boxOf(g.nodes, op.ids[0])!.y }
            : undefined;
        g.nodes = arrange(g.nodes, op.ids, op.direction, op.gap ?? 40, op.align ?? "center", start);
        geometry = true;
        break;
      }
      case "align_nodes": {
        const missing = op.ids.filter((id) => !nodeIds.has(id));
        if (missing.length) {
          fail(`unknown nodes ${missing.join(", ")}`);
          continue;
        }
        g.nodes = alignTo(g.nodes, op.ids, op.edge);
        geometry = true;
        break;
      }
      case "set_z": {
        const missing = op.ids.filter((id) => !nodeIds.has(id));
        if (missing.length) {
          fail(`unknown nodes ${missing.join(", ")}`);
          continue;
        }
        const zs = g.nodes.map((n) => n.zIndex ?? 0);
        let z = op.to === "front" ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
        const ids = new Set(op.ids);
        g.nodes = g.nodes.map((n) => (ids.has(n.id) ? { ...n, zIndex: op.to === "front" ? z++ : z-- } : n));
        break;
      }
      case "fit_group": {
        if (!nodeIds.has(op.id)) {
          fail(`unknown node ${op.id}`);
          continue;
        }
        if (!g.nodes.some((n) => n.parentId === op.id)) {
          fail(`${op.id} has no children`);
          continue;
        }
        g.nodes = fitGroup(g.nodes, op.id, op.padding ?? 40, true);
        geometry = true;
        break;
      }
      case "auto_layout": {
        g = autoLayout(g.nodes, g.edges, op.direction ?? "TB");
        break;
      }
      case "set_illustration": {
        const existing = g.nodes.find((n) => n.id === op.id);
        if (!existing && op.near && !nodeIds.has(op.near)) {
          fail(`unknown node ${op.near}`);
          continue;
        }
        if (existing) {
          const label = op.label ?? (existing.data as { label?: string; title?: string }).label;
          const side = Math.max(sizeOf(existing).width, sizeOf(existing).height, 80);
          g.nodes = g.nodes.map((n) =>
            n.id === op.id
              ? {
                  ...n,
                  type: "illustration",
                  width: side,
                  height: side + (label ? 20 : 0),
                  data: { label, paths: op.paths, style: (n.data as { style?: unknown }).style },
                }
              : n,
          );
        } else {
          const size = { width: 120, height: 120 + (op.label ? 20 : 0) };
          const placed = placeNear(g, op.near, "left", size);
          g.nodes = parentsFirst([
            ...g.nodes,
            {
              id: op.id,
              type: "illustration",
              position: placed.position,
              ...size,
              data: { label: op.label, paths: op.paths },
              ...(placed.parentId ? { parentId: placed.parentId } : {}),
            },
          ]);
        }
        break;
      }
    }
    applied.push(op);
  }
  // Re-pick attachment sides only for edges whose endpoints actually moved or resized.
  if (geometry) {
    const before = absoluteBoxes(graph.nodes);
    const after = absoluteBoxes(g.nodes);
    const changed = new Set(
      [...after]
        .filter(([id, b]) => {
          const a = before.get(id);
          return !a || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
        })
        .map(([id]) => id),
    );
    const touched = g.edges.filter((e) => changed.has(e.source) || changed.has(e.target));
    if (touched.length) {
      const re = new Map(rehandle(g.nodes, touched).map((e) => [e.id, e]));
      g = { ...g, edges: g.edges.map((e) => re.get(e.id) ?? e) };
    }
  }
  return { ...g, applied, errors };
}

export { REPO_SIZE };
