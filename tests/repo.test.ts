import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyze, type SourceEntry } from "@/lib/repo/analyze";
import { buildDigest } from "@/lib/repo/digest";
import { filesUnder, groupEdges } from "@/lib/repo/edges";
import { parseGithubUrl } from "@/lib/repo/url";
import { confinedPath } from "@/lib/repo/tools";
import {
  componentExpansion,
  fileExpansion,
  mergeExpansion,
  overviewGraph,
  permalink,
  symbolExpansion,
} from "@/lib/repo/nodes";
import type { RepoContext } from "@/lib/repo/schema";

const FIXTURE = path.join(__dirname, "../fixtures/repo");
function read(dir: string, rel = ""): SourceEntry[] {
  return readdirSync(path.join(dir, rel)).flatMap((name) => {
    const p = rel ? `${rel}/${name}` : name;
    return statSync(path.join(dir, p)).isDirectory()
      ? read(dir, p)
      : [{ path: p, content: readFileSync(path.join(dir, p), "utf8") }];
  });
}
const model = analyze(read(FIXTURE));
const file = (p: string) => model.files.find((f) => f.path === p)!;
const ctx: RepoContext = { owner: "acme", repo: "shop", sha: "a".repeat(40) };

describe("parseGithubUrl", () => {
  it.each([
    ["https://github.com/8thlight/repo-tutor", { owner: "8thlight", repo: "repo-tutor" }],
    ["github.com/a/b.git", { owner: "a", repo: "b" }],
    [
      "https://github.com/a/b/tree/main/packages/core",
      { owner: "a", repo: "b", ref: "main", subpath: "packages/core" },
    ],
    ["https://github.com/a/b/blob/v1.2/README.md", { owner: "a", repo: "b", ref: "v1.2", subpath: "README.md" }],
  ])("%s", (url, want) => expect(parseGithubUrl(url)).toEqual(want));

  it.each([
    "https://gitlab.com/a/b",
    "https://github.com/a",
    "not a url",
    "https://github.com/../etc",
    "https://github.com/a/b/tree/main/../../x",
  ])("rejects or sanitises %s", (url) => {
    const r = parseGithubUrl(url);
    expect(r === null || (!r.subpath?.includes("..") && !r.owner.startsWith("."))).toBe(true);
  });
});

describe("analyze", () => {
  it("resolves JS/TS relative and tsconfig-alias imports", () => {
    expect(file("web/src/index.ts").imports).toEqual(["web/src/components/Cart.tsx"]);
    expect(file("web/src/components/Cart.tsx").imports).toEqual(["web/src/lib/money.ts"]);
  });

  it("resolves Python relative, absolute and submodule imports", () => {
    expect(file("api/app/main.py").imports.sort()).toEqual(
      ["api/app/services/__init__.py", "api/app/services/billing.py", "api/app/services/orders.py"].sort(),
    );
  });

  it("resolves Go imports through a nested go.mod", () => {
    expect(file("worker/cmd/worker/main.go").imports).toEqual(["worker/internal/queue/queue.go"]);
  });

  it("finds declarations with line numbers", () => {
    expect(file("web/src/components/Cart.tsx").symbols.map((s) => [s.name, s.line])).toEqual([
      ["Cart", 3],
      ["CartView", 4],
    ]);
    expect(file("api/app/main.py").symbols.map((s) => s.name)).toEqual(["create_app", "Settings"]);
    expect(file("worker/internal/queue/queue.go").symbols.map((s) => s.name)).toEqual(["Queue", "New", "Push"]);
  });

  it("finds manifests, entry points and the README", () => {
    expect(model.manifests.map((m) => m.file).sort()).toEqual(["web/package.json", "worker/go.mod"]);
    expect(model.entryPoints).toEqual(expect.arrayContaining(["web/src/index.ts", "worker/cmd/worker/main.go"]));
    expect(model.readme?.headings).toEqual(["Shop", "Web", "API", "Worker"]);
  });

  it("builds a bounded digest", () => {
    const d = buildDigest(model, "acme/shop");
    expect(d).toContain("IMPORTS BETWEEN DIRECTORIES");
    expect(d).toContain("worker/cmd -> worker/internal (1)");
    expect(d.length).toBeLessThan(30_000);
  });
});

describe("edges and nodes", () => {
  it("filesUnder expands directories and ignores unknown paths", () => {
    expect(
      filesUnder(
        model.files.map((f) => f.path),
        ["web/src/lib", "./api/app/main.py", "nope/"],
      ).sort(),
    ).toEqual(["api/app/main.py", "web/src/lib/money.ts"]);
  });

  it("groupEdges counts imports between groups", () => {
    const e = groupEdges(model.files, [
      { id: "ui", files: ["web/src/index.ts", "web/src/components/Cart.tsx"] },
      { id: "lib", files: ["web/src/lib/money.ts"] },
    ]);
    expect(e).toEqual([{ source: "ui", target: "lib", count: 1 }]);
  });

  it("overview graph puts features in layers with import edges", () => {
    const g = overviewGraph(ctx, model.files, {
      title: "Shop",
      summary: "",
      layers: [
        { id: "ui", name: "UI" },
        { id: "domain", name: "Domain" },
      ],
      features: [
        { id: "cart", name: "Cart", summary: "", layer: "ui", paths: ["web/src/components", "web/src/index.ts"] },
        { id: "money", name: "Money", summary: "", layer: "domain", paths: ["web/src/lib"] },
      ],
      suggestions: [],
    });
    expect(g.nodes.find((n) => n.id === "f:cart")).toMatchObject({
      parentId: "layer:ui",
      data: { fileCount: 2, expandable: true },
    });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: "f:cart", target: "f:money", label: "1 import" });
  });

  it("component expansion keeps files inside the feature and collects the rest", () => {
    const featureFiles = ["api/app/main.py", "api/app/services/orders.py", "api/app/services/billing.py"];
    const exp = componentExpansion(
      ctx,
      model.files,
      "f:api",
      featureFiles,
      {
        components: [
          {
            id: "entry",
            name: "Entry",
            summary: "",
            files: ["api/app/main.py", "web/src/index.ts"],
            citations: [{ path: "api/app/main.py", line: 6, note: "" }],
          },
        ],
      },
      false,
    );
    expect(exp.nodes.map((n) => n.id)).toEqual(["f:api/c:entry", "f:api/c:other"]);
    expect(exp.nodes[0].data).toMatchObject({ paths: ["api/app/main.py"], url: permalink(ctx, "api/app/main.py", 6) });
    expect(exp.nodes[1].data).toMatchObject({ fileCount: 2 });
  });

  it("file and symbol levels come from the scan with permalinks", () => {
    const files = fileExpansion(ctx, model.files, "c", ["worker/internal/queue/queue.go", "worker/cmd/worker/main.go"]);
    expect(files.nodes[0].data).toMatchObject({ kind: "file", path: "worker/internal/queue/queue.go" });
    const syms = symbolExpansion(ctx, model.files, files.nodes[0].id, "worker/internal/queue/queue.go");
    expect(syms.nodes.map((n) => (n.data as { url: string }).url)).toContain(
      `https://github.com/acme/shop/blob/${"a".repeat(40)}/worker/internal/queue/queue.go#L5`,
    );
  });

  it("mergeExpansion replaces old children and expands the parent", () => {
    const parent = {
      id: "p",
      type: "repo",
      position: { x: 0, y: 0 },
      width: 240,
      height: 120,
      data: { kind: "feature", title: "P" },
    };
    const old = { id: "p/old", parentId: "p", position: { x: 0, y: 0 }, data: {} };
    const g = mergeExpansion(
      { nodes: [parent, old], edges: [] },
      {
        parentId: "p",
        nodes: [{ id: "p/new", parentId: "p", position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        cached: true,
      },
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["p", "p/new"]);
    expect(g.nodes[0].data).toMatchObject({ expanded: true, collapsedSize: { width: 240, height: 120 } });
  });
});

describe("confinedPath", () => {
  it("allows files inside the snapshot and refuses traversal and symlinks out", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "retigram-snap-"));
    const outside = mkdtempSync(path.join(tmpdir(), "retigram-out-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/a.ts"), "x");
    writeFileSync(path.join(outside, "secret"), "s");
    symlinkSync(path.join(outside, "secret"), path.join(root, "src/link"));
    expect(await confinedPath(root, "src/a.ts")).toBeTruthy();
    expect(await confinedPath(root, "../" + path.basename(outside) + "/secret")).toBeNull();
    expect(await confinedPath(root, path.join(outside, "secret"))).toBeNull();
    expect(await confinedPath(root, "src/link")).toBeNull();
  });
});
