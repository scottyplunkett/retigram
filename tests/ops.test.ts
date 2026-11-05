import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PATH_D, setExpanded } from "@nodes";
import { applyOps, OpSchema } from "@/lib/ops";
import { outline } from "@/lib/outline";
import { FlowSpec } from "@/lib/schema";
import { toXyflow } from "@/lib/toXyflow";
import { cleanNodes } from "@/lib/serialize";

const spec = FlowSpec.parse(JSON.parse(readFileSync(path.join(__dirname, "../fixtures/swimlane.spec.json"), "utf8")));
const base = toXyflow(spec);

describe("applyOps", () => {
  it("adds a node next to another, connects it, and reports generated ids", () => {
    const r = applyOps(base, [
      { op: "add_node", label: "Notify customer", near: "ship", side: "right" },
      { op: "add_edge", source: "ship", target: "notify-customer", label: "then" },
    ]);
    expect(r.errors).toEqual([]);
    const n = r.nodes.find((x) => x.id === "notify-customer")!;
    expect(n.parentId).toBe("lane-ops");
    expect(n.position.x).toBeGreaterThan(base.nodes.find((x) => x.id === "ship")!.position.x);
    expect(r.edges.find((e) => e.source === "ship" && e.target === "notify-customer")?.markerEnd).toBeDefined();
    expect(r.applied[0]).toMatchObject({ op: "add_node", id: "notify-customer" });
  });

  it("styles nodes and clears fields with null", () => {
    let r = applyOps(base, [
      { op: "set_style", ids: ["start", "ship"], style: { borderWidth: 4, fontWeight: "bold", fill: "#fef3c7" } },
    ]);
    expect(r.nodes.find((n) => n.id === "start")!.data.style).toEqual({
      borderWidth: 4,
      fontWeight: "bold",
      fill: "#fef3c7",
    });
    r = applyOps(r, [{ op: "set_style", ids: ["start"], style: { fill: null } }]);
    expect(r.nodes.find((n) => n.id === "start")!.data.style).toEqual({ borderWidth: 4, fontWeight: "bold" });
  });

  it("rejects unknown references and invalid values without applying them", () => {
    const r = applyOps(base, [
      { op: "add_edge", source: "nope", target: "ship" },
      { op: "set_style", ids: ["ship"], style: { fill: "red; background:url(x)" } },
      { op: "update_node", id: "ghost", label: "x" },
      { op: "bogus" },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.errors).toHaveLength(4);
    expect(r.nodes).toEqual(base.nodes);
  });

  it("removing a group keeps its children at the same absolute position", () => {
    const before = base.nodes.find((n) => n.id === "ship")!;
    const lane = base.nodes.find((n) => n.id === "lane-ops")!;
    const r = applyOps(base, [{ op: "remove_node", id: "lane-ops" }]);
    const after = r.nodes.find((n) => n.id === "ship")!;
    expect(after.parentId).toBeUndefined();
    expect(after.position).toEqual({ x: before.position.x + lane.position.x, y: before.position.y + lane.position.y });
  });

  it("removing a node drops its edges", () => {
    const r = applyOps(base, [{ op: "remove_node", id: "in-stock" }]);
    expect(r.edges.some((e) => e.source === "in-stock" || e.target === "in-stock")).toBe(false);
  });

  it("turns a node into an illustration only with path data", () => {
    const ok = applyOps(base, [
      { op: "set_illustration", id: "start", paths: [{ d: "M10 10 L90 10 L50 90 Z", fill: "#334155" }] },
    ]);
    expect(ok.nodes.find((n) => n.id === "start")!.type).toBe("illustration");
    const bad = applyOps(base, [
      { op: "set_illustration", id: "start", paths: [{ d: '"/><script>alert(1)</script>' }] },
    ]);
    expect(bad.applied).toEqual([]);
  });

  it("op schema converts to JSON schema for MCP tools", async () => {
    const { z } = await import("zod");
    expect(() => z.toJSONSchema(z.array(OpSchema))).not.toThrow();
  });
});

describe("SVG path guard", () => {
  it.each([
    ["M0 0L10 10Z", true],
    ["m1.5,2e-3 c1 2 3 4 5 6", true],
    ["<path/>", false],
    ["M0 0 url(javascript:alert(1))", false],
    ['M0 0" onload="x', false],
  ])("%s -> %s", (d, ok) => expect(PATH_D.test(d)).toBe(ok));
});

describe("outline", () => {
  it("is much smaller than the JSON graph and lists every node and edge", () => {
    const text = outline(base.nodes, base.edges);
    const json = JSON.stringify(base);
    expect(text.length * 3).toBeLessThan(json.length);
    for (const n of base.nodes) expect(text).toContain(`${n.id} |`);
    for (const e of base.edges) expect(text).toContain(`${e.id}:`);
  });
});

describe("expand/collapse", () => {
  const nodes = [
    {
      id: "f",
      position: { x: 0, y: 0 },
      width: 400,
      height: 300,
      data: { expanded: true, collapsedSize: { width: 240, height: 120 } },
    },
    { id: "c1", parentId: "f", position: { x: 0, y: 0 }, data: { expanded: true } },
    { id: "c2", parentId: "f", position: { x: 0, y: 0 }, data: { expanded: false } },
    { id: "p1", parentId: "c1", position: { x: 0, y: 0 }, data: {} },
    { id: "p2", parentId: "c2", position: { x: 0, y: 0 }, hidden: true, data: {} },
  ];

  it("collapsing hides all descendants and restores the collapsed size", () => {
    const out = setExpanded(nodes, "f", false);
    expect(
      out
        .filter((n) => n.hidden)
        .map((n) => n.id)
        .sort(),
    ).toEqual(["c1", "c2", "p1", "p2"]);
    expect(out[0]).toMatchObject({
      width: 240,
      height: 120,
      data: { expanded: false, expandedSize: { width: 400, height: 300 } },
    });
  });

  it("expanding shows children and only the subtrees that were expanded", () => {
    const out = setExpanded(setExpanded(nodes, "f", false), "f", true);
    const hidden = out.filter((n) => n.hidden).map((n) => n.id);
    expect(hidden).toEqual(["p2"]);
    expect(out[0]).toMatchObject({ width: 400, height: 300 });
  });

  it("export marks repo nodes without loaded children as not expandable", () => {
    const node = {
      id: "a",
      type: "repo",
      position: { x: 0, y: 0 },
      data: { kind: "feature", title: "A", expandable: true, loading: true },
    };
    expect(cleanNodes([node], { forExport: true })[0].data).toEqual({ kind: "feature", title: "A", expandable: false });
    // The live config panel keeps unloaded levels expandable.
    expect(cleanNodes([node])[0].data).toEqual({ kind: "feature", title: "A", expandable: true });
  });
});
