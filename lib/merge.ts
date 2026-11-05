import type { Edge, Node } from "@xyflow/react";
import { parentsFirst, type Graph } from "./ops";
import { cleanEdges, cleanNodes } from "./serialize";

/** The request body only needs structure; image pixels never reach the model. */
export function slimGraph(g: Graph): Graph {
  return {
    nodes: g.nodes.map((n) => (n.type === "image" ? { ...n, data: { ...n.data, src: "" } } : n)),
    edges: g.edges,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const edgeKey = (e: Edge) => cleanEdges([e])[0];

type Group = "position" | "size" | "parentId" | "data" | "style" | "zIndex" | "hidden" | "type";
const GROUPS: Record<Group, (n: Node) => unknown> = {
  position: (n) => n.position,
  size: (n) => [n.width, n.height],
  parentId: (n) => n.parentId,
  data: (n) => cleanNodes([n])[0].data,
  style: (n) => [n.style, n.extent],
  zIndex: (n) => n.zIndex,
  hidden: (n) => n.hidden,
  type: (n) => n.type,
};

function apply(target: Node, from: Node, g: Group): Node {
  const out: Record<string, unknown> = { ...target };
  const copy = (k: keyof Node) => {
    if (from[k] === undefined) delete out[k];
    else out[k] = from[k];
  };
  switch (g) {
    case "position":
      copy("position");
      break;
    case "size":
      copy("width");
      copy("height");
      break;
    case "style":
      copy("style");
      copy("extent");
      break;
    default:
      copy(g);
  }
  return out as unknown as Node;
}

function mergeNode(base: Node, mine: Node, theirs: Node): Node {
  let out = mine;
  for (const g of Object.keys(GROUPS) as Group[]) {
    if (same(GROUPS[g](theirs), GROUPS[g](base))) continue;
    out = apply(out, theirs, g);
  }
  // The request carried src="", so the server's copy of an image has none. Keep the pixels.
  if (out.type === "image" && mine.type === "image") {
    const mineSrc = (mine.data as { src?: string }).src;
    const outSrc = (out.data as { src?: string }).src;
    if (mineSrc && !outSrc) out = { ...out, data: { ...out.data, src: mineSrc } };
  }
  return out;
}

/**
 * Three-way merge. `base` is the graph sent with the request, `mine` the live client graph now,
 * `theirs` the server snapshot. Anything the server changed wins; anything only the user changed
 * during the run is kept.
 */
export function mergeGraphs(base: Graph, mine: Graph, theirs: Graph): Graph {
  const baseN = new Map(base.nodes.map((n) => [n.id, n]));
  const mineN = new Map(mine.nodes.map((n) => [n.id, n]));
  const theirN = new Map(theirs.nodes.map((n) => [n.id, n]));

  const nodes: Node[] = [];
  for (const m of mine.nodes) {
    const b = baseN.get(m.id);
    if (!b) {
      nodes.push(m); // added by the user during the run
      continue;
    }
    const t = theirN.get(m.id);
    if (!t) continue; // deleted by the server
    nodes.push(mergeNode(b, m, t));
  }
  for (const t of theirs.nodes) {
    if (!mineN.has(t.id) && !baseN.has(t.id)) nodes.push(t); // added by the server
  }
  // Nodes the user deleted (in base, not in mine) stay deleted.

  const ids = new Set(nodes.map((n) => n.id));
  const baseE = new Map(base.edges.map((e) => [e.id, e]));
  const mineE = new Map(mine.edges.map((e) => [e.id, e]));
  const theirE = new Map(theirs.edges.map((e) => [e.id, e]));
  const edges: Edge[] = [];
  for (const m of mine.edges) {
    const b = baseE.get(m.id);
    if (!b) {
      edges.push(m);
      continue;
    }
    const t = theirE.get(m.id);
    if (!t) continue;
    edges.push(same(edgeKey(t), edgeKey(b)) ? m : t);
  }
  for (const t of theirs.edges) {
    if (!mineE.has(t.id) && !baseE.has(t.id)) edges.push(t);
  }

  return { nodes: parentsFirst(nodes), edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}
