import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SHAPES } from "@nodes";
import { FlowSpec, SHAPE_VALUES } from "@/lib/schema";
import { absoluteBoxes, countOverlaps, toXyflow } from "@/lib/toXyflow";
import { autoLayout } from "@/lib/layout";
import { serializeFlow } from "@/lib/serialize";

const spec = FlowSpec.parse(JSON.parse(readFileSync(path.join(__dirname, "../fixtures/swimlane.spec.json"), "utf8")));

describe("schema", () => {
  it("shape enum matches the node component", () => {
    expect([...SHAPE_VALUES]).toEqual([...SHAPES]);
  });
});

describe("toXyflow", () => {
  const { nodes, edges } = toXyflow(spec);

  it("orders parents before children", () => {
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    for (const n of nodes) if (n.parentId) expect(index.get(n.parentId)!).toBeLessThan(index.get(n.id)!);
  });

  it("converts child positions to parent-relative and back", () => {
    const ship = nodes.find((n) => n.id === "ship")!;
    expect(ship.parentId).toBe("lane-ops");
    expect(ship.position).toEqual({ x: 260, y: 70 });
    expect(absoluteBoxes(nodes).get("ship")).toMatchObject({ x: 260, y: 310 });
  });

  it("applies default sizes and colours", () => {
    const d = nodes.find((n) => n.id === "in-stock")!;
    expect([d.width, d.height]).toEqual([150, 100]);
    expect(nodes.find((n) => n.id === "ship")!.data.color).toBe("#dcfce7");
  });

  it("drops edges to unknown nodes and maps markers and dashes", () => {
    expect(edges.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    const e1 = edges.find((e) => e.id === "e1")!;
    expect(e1.markerEnd).toMatchObject({ type: "arrowclosed" });
    expect(e1.markerStart).toBeUndefined();
    expect([e1.sourceHandle, e1.targetHandle]).toEqual(["right", "left"]);
    const e4 = edges.find((e) => e.id === "e4")!;
    expect(e4.markerStart).toBeDefined();
    expect(e4.style).toEqual({ strokeDasharray: "6 4" });
    expect(edges.find((e) => e.id === "e2")!.sourceHandle).toBe("bottom");
  });

  it("has no overlaps for a well-placed spec", () => {
    expect(countOverlaps(nodes)).toBe(0);
  });
});

describe("autoLayout", () => {
  it("separates fully overlapping nodes and keeps children inside groups", () => {
    const { nodes, edges } = toXyflow({
      ...spec,
      nodes: spec.nodes.map((n) => ({ ...n, x: 0, y: 0 })),
    });
    expect(countOverlaps(nodes)).toBeGreaterThan(0);
    const out = autoLayout(nodes, edges, "LR");
    expect(countOverlaps(out.nodes)).toBe(0);
    const boxes = absoluteBoxes(out.nodes);
    for (const n of out.nodes) {
      if (!n.parentId) continue;
      const c = boxes.get(n.id)!;
      const p = boxes.get(n.parentId)!;
      expect(c.x).toBeGreaterThanOrEqual(p.x);
      expect(c.y).toBeGreaterThanOrEqual(p.y);
      expect(c.x + c.width).toBeLessThanOrEqual(p.x + p.width + 0.5);
      expect(c.y + c.height).toBeLessThanOrEqual(p.y + p.height + 0.5);
    }
  });
});

describe("serializeFlow", () => {
  it("strips runtime fields and produces a module that typechecks against @xyflow/react", () => {
    const { nodes, edges } = toXyflow(spec);
    const dirty = nodes.map((n) => ({ ...n, selected: true, dragging: false, measured: { width: 1, height: 1 } }));
    const src = serializeFlow(dirty, edges);
    expect(src).not.toMatch(/"selected"|"measured"|"dragging"/);
    expect(src).toContain("export const initialNodes: Node[]");

    const dir = mkdtempSync(path.join(tmpdir(), "retigram-serialize-"));
    writeFileSync(path.join(dir, "flow.ts"), src);
    symlinkSync(path.resolve(__dirname, "../node_modules"), path.join(dir, "node_modules"));
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "ESNext",
          moduleResolution: "bundler",
          skipLibCheck: true,
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          jsx: "react-jsx",
        },
        files: ["flow.ts"],
      }),
    );
    const tsc = path.resolve(__dirname, "../node_modules/typescript/bin/tsc");
    expect(() => execFileSync(process.execPath, [tsc, "-p", dir], { stdio: "pipe" })).not.toThrow();
  }, 60_000);
});
