import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { applyOps } from "@/lib/ops";
import { outline } from "@/lib/outline";
import { absoluteBoxes, countOverlaps } from "@/lib/toXyflow";

const shape = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({
  id,
  type: "shape",
  position: { x, y },
  width: 160,
  height: 60,
  data: { label: id, shape: "rectangle" },
  ...extra,
});

// A cut-down version of the Illinois org chart: a cropped figure that landed beside the title.
const orgChart = (): { nodes: Node[]; edges: Edge[] } => ({
  nodes: [
    shape("title", 400, 0),
    {
      id: "figure-illinois",
      type: "image",
      position: { x: 300, y: 0 },
      width: 60,
      height: 90,
      data: { src: "", label: "Illinois" },
    },
    shape("legislative", 100, 200),
    shape("executive", 400, 200),
    shape("judicial", 700, 200),
    {
      id: "lane",
      type: "shape",
      position: { x: 0, y: 400 },
      width: 500,
      height: 200,
      data: { label: "Lane", shape: "group" },
    },
    shape("governor", 40, 80, { parentId: "lane" }),
    shape("treasurer", 260, 80, { parentId: "lane" }),
  ],
  edges: [
    { id: "t-e", source: "title", target: "executive", sourceHandle: "bottom", targetHandle: "top" },
    { id: "t-l", source: "title", target: "legislative", sourceHandle: "custom-a", targetHandle: "custom-b" },
  ],
});

const abs = (g: { nodes: Node[] }, id: string) => absoluteBoxes(g.nodes).get(id)!;

describe("layout ops", () => {
  it("reproduces the chat request: Illinois outline above the Executive Branch node", () => {
    const g = orgChart();
    const r = applyOps(g, [{ op: "place_node", id: "figure-illinois", relativeTo: "executive", side: "above" }]);
    expect(r.errors).toEqual([]);
    const fig = abs(r, "figure-illinois");
    const exec = abs(r, "executive");
    expect(fig.y + fig.height).toBe(exec.y - 40);
    expect(fig.x + fig.width / 2).toBe(exec.x + exec.width / 2);
    expect(r.edges.length).toBe(g.edges.length); // no helper edges
  });

  it("place_node works across containers using absolute coordinates", () => {
    const r = applyOps(orgChart(), [
      { op: "place_node", id: "figure-illinois", relativeTo: "treasurer", side: "right", align: "start", gap: 20 },
    ]);
    const fig = abs(r, "figure-illinois");
    const t = abs(r, "treasurer");
    expect(fig).toMatchObject({ x: t.x + t.width + 20, y: t.y });
  });

  it("move_node takes absolute x/y or deltas, even for children", () => {
    let r = applyOps(orgChart(), [{ op: "move_node", id: "governor", x: 100, y: 500 }]);
    expect(abs(r, "governor")).toMatchObject({ x: 100, y: 500 });
    expect(r.nodes.find((n) => n.id === "governor")!.position).toEqual({ x: 100, y: 100 }); // relative to lane at (0,400)
    r = applyOps(r, [{ op: "move_node", id: "governor", dx: -20, dy: 10 }]);
    expect(abs(r, "governor")).toMatchObject({ x: 80, y: 510 });
    expect(applyOps(r, [{ op: "move_node", id: "governor" }]).errors).toHaveLength(1);
  });

  it("set_parent keeps canvas position, grows the container, and refuses cycles", () => {
    const g = orgChart();
    const before = abs(g, "executive");
    const r = applyOps(g, [{ op: "set_parent", id: "executive", parentId: "lane" }]);
    expect(r.errors).toEqual([]);
    expect(r.nodes.find((n) => n.id === "executive")!.parentId).toBe("lane");
    expect(abs(r, "executive")).toMatchObject({ x: before.x, y: before.y });
    const lane = abs(r, "lane");
    expect(lane.y).toBeLessThanOrEqual(before.y - 56);
    expect(lane.x + lane.width).toBeGreaterThanOrEqual(before.x + before.width + 40);
    // Children keep their canvas positions when the lane's origin moves.
    expect(abs(r, "governor")).toEqual(abs(g, "governor"));
    // Cycle: the lane cannot go inside its own child.
    expect(applyOps(r, [{ op: "set_parent", id: "lane", parentId: "governor" }]).errors[0]).toMatch(/descendants/);
    // Back to top level, still in place.
    const out = applyOps(r, [{ op: "set_parent", id: "executive", parentId: null }]);
    expect(out.nodes.find((n) => n.id === "executive")!.parentId).toBeUndefined();
    expect(abs(out, "executive")).toMatchObject({ x: before.x, y: before.y });
  });

  it("update_node parentId no longer makes the node jump", () => {
    const g = orgChart();
    const before = abs(g, "governor");
    const r = applyOps(g, [{ op: "update_node", id: "governor", parentId: null }]);
    expect(abs(r, "governor")).toMatchObject({ x: before.x, y: before.y });
  });

  it("arrange_nodes puts nodes in the given order", () => {
    const r = applyOps(orgChart(), [
      { op: "arrange_nodes", ids: ["judicial", "executive", "legislative"], direction: "row", gap: 30 },
    ]);
    const [j, e, l] = ["judicial", "executive", "legislative"].map((id) => abs(r, id));
    expect(j.x).toBe(700);
    expect(e.x).toBe(j.x + j.width + 30);
    expect(l.x).toBe(e.x + e.width + 30);
    expect(new Set([j.y, e.y, l.y]).size).toBe(1);
    const col = applyOps(orgChart(), [
      { op: "arrange_nodes", ids: ["legislative", "executive"], direction: "column", x: 0, y: 0 },
    ]);
    expect(abs(col, "executive")).toMatchObject({ x: 0, y: 100 });
  });

  it("align_nodes lines nodes up on the first node", () => {
    const r = applyOps(orgChart(), [{ op: "align_nodes", ids: ["executive", "figure-illinois"], edge: "center" }]);
    expect(abs(r, "figure-illinois").x + 30).toBe(abs(r, "executive").x + 80);
  });

  it("resize, set_z, fit_group and auto_layout", () => {
    let r = applyOps(orgChart(), [
      { op: "resize_node", id: "title", width: 300 },
      { op: "set_z", ids: ["figure-illinois"], to: "front" },
      { op: "fit_group", id: "lane", padding: 20 },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.nodes.find((n) => n.id === "title")).toMatchObject({ width: 300, height: 60 });
    expect(r.nodes.find((n) => n.id === "figure-illinois")!.zIndex).toBe(1);
    expect(abs(r, "lane")).toMatchObject({ x: 20, y: 480 - 56, width: 160 + 220 + 40, height: 56 + 60 + 20 });
    r = applyOps(r, [{ op: "move_node", id: "judicial", x: 400, y: 200 }, { op: "auto_layout" }]);
    expect(countOverlaps(r.nodes)).toBe(0);
  });

  it("re-picks edge handles only for edges whose endpoints moved", () => {
    const r = applyOps(orgChart(), [{ op: "move_node", id: "executive", x: 900, y: 0 }]);
    expect(r.edges.find((e) => e.id === "t-e")).toMatchObject({ sourceHandle: "right", targetHandle: "left" });
    expect(r.edges.find((e) => e.id === "t-l")).toMatchObject({ sourceHandle: "custom-a", targetHandle: "custom-b" });
  });

  it("outline gives absolute geometry the model can reason about", () => {
    const text = outline(orgChart().nodes, []);
    expect(text).toContain("executive | rectangle | executive | @400,200 160x60");
    expect(text).toContain("governor | rectangle | governor | @40,480 160x60 | in:lane");
  });
});
