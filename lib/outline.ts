import type { Edge, Node } from "@xyflow/react";
import { absoluteBoxes } from "./toXyflow";

const clip = (s: unknown, n = 80) => {
  const t = String(s ?? "")
    .replace(/\s*\n\s*/g, " / ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function nodeKind(n: Node) {
  const d = n.data as Record<string, unknown>;
  if (n.type === "shape") return String(d.shape);
  if (n.type === "repo") return String(d.kind);
  return n.type ?? "node";
}

function nodeLabel(n: Node) {
  const d = n.data as Record<string, unknown>;
  return clip(d.label ?? d.title ?? "");
}

function styleNote(n: Node) {
  const s = (n.data as { style?: Record<string, unknown> }).style;
  if (!s || !Object.keys(s).length) return "";
  return ` {${Object.entries(s)
    .map(([k, v]) => `${k}:${v}`)
    .join(",")}}`;
}

/**
 * A compact, line-per-item description of the graph for the model. Geometry is absolute canvas
 * pixels (`@x,y wxh`, top-left, y grows downward) so the model can reason about placement;
 * hidden nodes are marked collapsed.
 */
export function outline(nodes: Node[], edges: Edge[]): string {
  const boxes = absoluteBoxes(nodes);
  const lines: string[] = ["NODES id | kind | label | @x,y wxh (absolute px, y down) | parent | style"];
  for (const n of nodes) {
    const b = boxes.get(n.id)!;
    const geo = `@${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
    lines.push(
      `${n.id} | ${nodeKind(n)} | ${nodeLabel(n)} | ${geo}${n.parentId ? ` | in:${n.parentId}` : ""}${n.zIndex ? ` | z:${n.zIndex}` : ""}${n.hidden ? " | collapsed" : ""}${styleNote(n)}`,
    );
  }
  lines.push("EDGES id: source -> target : label");
  for (const e of edges) {
    lines.push(`${e.id}: ${e.source} -> ${e.target}${e.label ? ` : ${clip(e.label, 40)}` : ""}`);
  }
  return lines.join("\n");
}
