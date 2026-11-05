import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { mergeGraphs, slimGraph } from "@/lib/merge";
import type { Graph } from "@/lib/ops";

const node = (id: string, x = 0, y = 0, extra: Partial<Node> = {}): Node => ({
  id,
  type: "shape",
  position: { x, y },
  width: 100,
  height: 40,
  data: { label: id },
  ...extra,
});
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target });

const base: Graph = { nodes: [node("a", 0, 0), node("b", 200, 0), node("c", 0, 200)], edges: [edge("e1", "a", "b")] };
const find = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!;

describe("mergeGraphs", () => {
  it("takes the server's move when the user did not touch the node", () => {
    const theirs = { ...base, nodes: [node("a", 50, 50), base.nodes[1], base.nodes[2]] };
    expect(find(mergeGraphs(base, base, theirs), "a").position).toEqual({ x: 50, y: 50 });
  });

  it("keeps a user drag during the run when the server left the node alone", () => {
    const mine = { ...base, nodes: [base.nodes[0], node("b", 300, 10), base.nodes[2]] };
    expect(find(mergeGraphs(base, mine, base), "b").position).toEqual({ x: 300, y: 10 });
  });

  it("prefers the server when both changed the same field", () => {
    const mine = { ...base, nodes: [node("a", 9, 9), base.nodes[1], base.nodes[2]] };
    const theirs = { ...base, nodes: [node("a", 50, 50), base.nodes[1], base.nodes[2]] };
    expect(find(mergeGraphs(base, mine, theirs), "a").position).toEqual({ x: 50, y: 50 });
  });

  it("merges different field groups of the same node", () => {
    const mine = { ...base, nodes: [node("a", 9, 9), base.nodes[1], base.nodes[2]] };
    const theirs = { ...base, nodes: [node("a", 0, 0, { data: { label: "renamed" } }), base.nodes[1], base.nodes[2]] };
    const a = find(mergeGraphs(base, mine, theirs), "a");
    expect(a.position).toEqual({ x: 9, y: 9 });
    expect(a.data.label).toBe("renamed");
  });

  it("removes nodes the server deleted, with their edges", () => {
    const theirs = { nodes: [base.nodes[0], base.nodes[2]], edges: [] };
    const g = mergeGraphs(base, base, theirs);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(g.edges).toEqual([]);
  });

  it("keeps nodes and edges the user added, and adds the server's", () => {
    const mine = { nodes: [...base.nodes, node("mine")], edges: [...base.edges, edge("em", "a", "mine")] };
    const theirs = { nodes: [...base.nodes, node("theirs")], edges: [...base.edges, edge("et", "a", "theirs")] };
    const g = mergeGraphs(base, mine, theirs);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "mine", "theirs"]);
    expect(g.edges.map((e) => e.id).sort()).toEqual(["e1", "em", "et"]);
  });

  it("keeps the user's deletion of an untouched node", () => {
    const mine = { nodes: [base.nodes[0], base.nodes[1]], edges: base.edges };
    expect(mergeGraphs(base, mine, base).nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("preserves image src that the request slimmed away", () => {
    const img = node("img", 0, 0, { type: "image", data: { src: "data:image/png;base64,AAA", alt: "x" } });
    const live: Graph = { nodes: [img], edges: [] };
    const sent = slimGraph(live);
    expect((sent.nodes[0].data as { src: string }).src).toBe("");
    const moved = { nodes: [{ ...sent.nodes[0], position: { x: 40, y: 40 } }], edges: [] };
    const g = mergeGraphs(sent, live, moved);
    expect(g.nodes[0].position).toEqual({ x: 40, y: 40 });
    expect((g.nodes[0].data as { src: string }).src).toBe("data:image/png;base64,AAA");
    const edited = { nodes: [{ ...sent.nodes[0], data: { src: "", alt: "new" } }], edges: [] };
    const g2 = mergeGraphs(sent, live, edited);
    expect(g2.nodes[0].data).toEqual({ src: "data:image/png;base64,AAA", alt: "new" });
  });

  it("orders parents before children", () => {
    const theirs = { ...base, nodes: [node("kid", 5, 5, { parentId: "grp" }), ...base.nodes, node("grp")] };
    const ids = mergeGraphs(base, base, theirs).nodes.map((n) => n.id);
    expect(ids.indexOf("grp")).toBeLessThan(ids.indexOf("kid"));
  });
});
