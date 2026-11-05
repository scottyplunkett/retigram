import type { Edge, Node } from "@xyflow/react";
import { parentsFirst, type Graph } from "./ops";
import { cleanEdges, cleanNodes } from "./serialize";

const PLACEHOLDER = /^<image:(.*)>$/;

/** Pretty JSON for the config panel. Image pixels become "<image:{id}>". */
export function graphToText(g: Graph): string {
  const nodes = cleanNodes(g.nodes).map((n) => {
    const src = (n.data as { src?: unknown } | undefined)?.src;
    return n.type === "image" && typeof src === "string" && src
      ? { ...n, data: { ...n.data, src: `<image:${n.id}>` } }
      : n;
  });
  return JSON.stringify({ nodes, edges: cleanEdges(g.edges) }, null, 2);
}

export type ParseResult = { graph: Graph } | { errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate panel text against the current graph. Never throws. */
export function parseConfig(text: string, current: Graph): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { errors: [`Not valid JSON: ${(err as Error).message}`] };
  }
  if (!isObj(json) || !Array.isArray(json.nodes) || !Array.isArray(json.edges)) {
    return { errors: ['Expected an object like { "nodes": [], "edges": [] }.'] };
  }
  const errors: string[] = [];
  const currentById = new Map(current.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  const nodes: Node[] = [];

  json.nodes.forEach((raw: unknown, i: number) => {
    if (!isObj(raw)) return void errors.push(`Node ${i + 1} must be an object.`);
    const id = raw.id;
    if (typeof id !== "string" || !id) return void errors.push(`Node ${i + 1} needs a text id.`);
    if (ids.has(id)) return void errors.push(`Duplicate node id "${id}".`);
    ids.add(id);
    const pos = raw.position;
    if (!isObj(pos) || !isNum(pos.x) || !isNum(pos.y))
      errors.push(`Node "${id}" needs a position with numeric x and y.`);
    if (!isObj(raw.data)) errors.push(`Node "${id}" needs a data object.`);
    if (raw.parentId !== undefined && typeof raw.parentId !== "string")
      errors.push(`Node "${id}" has a parentId that is not text.`);
    for (const k of ["width", "height"] as const)
      if (raw[k] !== undefined && !isNum(raw[k])) errors.push(`Node "${id}" has a ${k} that is not a number.`);
    nodes.push(raw as unknown as Node);
  });

  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  json.edges.forEach((raw: unknown, i: number) => {
    if (!isObj(raw)) return void errors.push(`Edge ${i + 1} must be an object.`);
    const id = raw.id;
    if (typeof id !== "string" || !id) return void errors.push(`Edge ${i + 1} needs a text id.`);
    if (edgeIds.has(id)) return void errors.push(`Duplicate edge id "${id}".`);
    edgeIds.add(id);
    for (const k of ["source", "target"] as const) {
      const v = raw[k];
      if (typeof v !== "string" || !ids.has(v)) errors.push(`Edge "${id}" has an unknown ${k} "${String(v)}".`);
    }
    edges.push(raw as unknown as Edge);
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (typeof n.parentId !== "string") continue;
    if (!byId.has(n.parentId)) {
      errors.push(`Node "${n.id}" has an unknown parent "${n.parentId}".`);
      continue;
    }
    const seen = new Set([n.id]);
    for (let p: string | undefined = n.parentId; p; p = byId.get(p)?.parentId) {
      if (seen.has(p)) {
        errors.push(`Node "${n.id}" is in a parent cycle.`);
        break;
      }
      seen.add(p);
    }
  }

  const restored = nodes.map((n) => {
    const src = (n.data as { src?: unknown } | undefined)?.src;
    const m = typeof src === "string" ? PLACEHOLDER.exec(src) : null;
    if (!m) return n;
    const prev = currentById.get(m[1]);
    const prevSrc = (prev?.data as { src?: string } | undefined)?.src;
    if (!prev || !prevSrc) {
      errors.push(`Image placeholder "${src}" does not match an image on the canvas.`);
      return n;
    }
    return { ...n, data: { ...n.data, src: prevSrc } };
  });

  if (errors.length) return { errors };
  return { graph: { nodes: parentsFirst(restored), edges } };
}

export type GraphDiff = {
  moved: number;
  resized: number;
  edited: number;
  added: number;
  removed: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesEdited: number;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nearly = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : Math.abs(a - b) < 0.5;

/** What changed going from `from` (default) to `to` (live). */
export function diffGraphs(from: Graph, to: Graph): GraphDiff {
  const d: GraphDiff = {
    moved: 0,
    resized: 0,
    edited: 0,
    added: 0,
    removed: 0,
    edgesAdded: 0,
    edgesRemoved: 0,
    edgesEdited: 0,
  };
  const a = new Map(cleanNodes(from.nodes).map((n) => [n.id, n]));
  const b = new Map(cleanNodes(to.nodes).map((n) => [n.id, n]));
  for (const [id, n] of b) {
    const o = a.get(id);
    if (!o) {
      d.added++;
      continue;
    }
    if (!nearly(o.position.x, n.position.x) || !nearly(o.position.y, n.position.y)) d.moved++;
    if (!nearly(o.width, n.width) || !nearly(o.height, n.height)) d.resized++;
    const rest = (x: Node) => ({ ...x, position: 0, width: 0, height: 0 });
    if (!same(rest(o), rest(n))) d.edited++;
  }
  for (const id of a.keys()) if (!b.has(id)) d.removed++;
  const ea = new Map(cleanEdges(from.edges).map((e) => [e.id, e]));
  const eb = new Map(cleanEdges(to.edges).map((e) => [e.id, e]));
  for (const [id, e] of eb) {
    const o = ea.get(id);
    if (!o) d.edgesAdded++;
    else if (!same(o, e)) d.edgesEdited++;
  }
  for (const id of ea.keys()) if (!eb.has(id)) d.edgesRemoved++;
  return d;
}

export const isEmptyDiff = (d: GraphDiff) => Object.values(d).every((v) => v === 0);

/** "2 moved · 1 resized · 1 edge added", or "Matches default". */
export function summarizeDiff(d: GraphDiff): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts = [
    d.moved && `${d.moved} moved`,
    d.resized && `${d.resized} resized`,
    d.edited && `${d.edited} edited`,
    d.added && `${plural(d.added, "node")} added`,
    d.removed && `${plural(d.removed, "node")} removed`,
    d.edgesAdded && `${plural(d.edgesAdded, "edge")} added`,
    d.edgesRemoved && `${plural(d.edgesRemoved, "edge")} removed`,
    d.edgesEdited && `${plural(d.edgesEdited, "edge")} edited`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Matches default";
}
