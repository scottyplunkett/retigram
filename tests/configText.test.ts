import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { diffGraphs, graphToText, isEmptyDiff, parseConfig, summarizeDiff } from "@/lib/configText";
import { cleanEdges, cleanNodes } from "@/lib/serialize";
import { parentsFirst, type Graph } from "@/lib/ops";

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
const SRC = "data:image/png;base64,AAAA";
const g: Graph = {
  nodes: [
    node("grp", 0, 0, { width: 400, height: 300 }),
    node("a", 10, 10, { parentId: "grp" }),
    node("img", 500, 0, { type: "image", data: { src: SRC } }),
  ],
  edges: [edge("e1", "grp", "a")],
};
const errs = (text: string) => {
  const r = parseConfig(text, g);
  if (!("errors" in r)) throw new Error("expected errors");
  return r.errors.join("\n");
};
const withNodes = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ nodes, edges });

describe("graphToText / parseConfig", () => {
  it("replaces image data with a placeholder", () => {
    const text = graphToText(g);
    expect(text).not.toContain(SRC);
    expect(text).toContain("<image:img>");
  });

  it("round trips, restoring image src", () => {
    const r = parseConfig(graphToText(g), g);
    if ("errors" in r) throw new Error(r.errors.join());
    expect(cleanNodes(r.graph.nodes)).toEqual(cleanNodes(parentsFirst(g.nodes)));
    expect(cleanEdges(r.graph.edges)).toEqual(cleanEdges(g.edges));
  });

  it("orders parents first", () => {
    const r = parseConfig(withNodes([node("a", 0, 0, { parentId: "grp" }), node("grp")]), g);
    if ("errors" in r) throw new Error();
    expect(r.graph.nodes.map((n) => n.id)).toEqual(["grp", "a"]);
  });

  it("rejects bad JSON and wrong shape", () => {
    expect(errs("{nope")).toMatch(/Not valid JSON/);
    expect(errs("[]")).toMatch(/nodes/);
  });

  it("rejects duplicate ids", () => {
    expect(errs(withNodes([node("a"), node("a")]))).toMatch(/Duplicate node id "a"/);
  });

  it("rejects missing positions and data", () => {
    expect(errs(withNodes([{ id: "a", data: {} }]))).toMatch(/position/);
    expect(errs(withNodes([{ id: "a", position: { x: 0, y: 0 } }]))).toMatch(/data/);
  });

  it("rejects unknown parents and parent cycles", () => {
    expect(errs(withNodes([node("a", 0, 0, { parentId: "zzz" })]))).toMatch(/unknown parent "zzz"/);
    expect(errs(withNodes([node("a", 0, 0, { parentId: "b" }), node("b", 0, 0, { parentId: "a" })]))).toMatch(/cycle/);
    expect(errs(withNodes([node("a", 0, 0, { parentId: "a" })]))).toMatch(/cycle/);
  });

  it("rejects dangling edges and duplicate edge ids", () => {
    expect(errs(withNodes([node("a")], [edge("e", "a", "gone")]))).toMatch(/unknown target "gone"/);
    expect(errs(withNodes([node("a")], [edge("e", "a", "a"), edge("e", "a", "a")]))).toMatch(/Duplicate edge id/);
  });

  it("rejects image placeholders for unknown images", () => {
    expect(errs(withNodes([node("x", 0, 0, { type: "image", data: { src: "<image:nope>" } })]))).toMatch(/placeholder/);
  });
});

describe("diffGraphs", () => {
  it("is empty for identical graphs", () => {
    const d = diffGraphs(g, {
      nodes: g.nodes.map((n) => ({ ...n, selected: true, measured: { width: 1, height: 1 } })),
      edges: g.edges,
    });
    expect(isEmptyDiff(d)).toBe(true);
    expect(summarizeDiff(d)).toBe("Matches default");
  });

  it("counts each kind of change", () => {
    const live: Graph = {
      nodes: [
        { ...g.nodes[0], width: 500 },
        { ...g.nodes[1], position: { x: 99, y: 10 } },
        { ...g.nodes[2], data: { src: SRC, alt: "new" } },
        node("added"),
      ],
      edges: [edge("e2", "a", "grp")],
    };
    const d = diffGraphs(g, live);
    expect(d).toEqual({
      moved: 1,
      resized: 1,
      edited: 1,
      added: 1,
      removed: 0,
      edgesAdded: 1,
      edgesRemoved: 1,
      edgesEdited: 0,
    });
    expect(summarizeDiff(d)).toBe("1 moved · 1 resized · 1 edited · 1 node added · 1 edge added · 1 edge removed");
  });

  it("counts removed nodes and edited edges", () => {
    const d = diffGraphs(g, { nodes: g.nodes.slice(0, 2), edges: [{ ...g.edges[0], label: "x" }] });
    expect(d).toMatchObject({ removed: 1, edgesEdited: 1 });
  });
});
