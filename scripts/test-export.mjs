// End-to-end check of "Download complete project":
// POSTs a flow to /api/export, unzips it, installs and builds the project, and checks the output.
// Requires a running server (npm run dev or npm start). Usage: node scripts/test-export.mjs [baseUrl]
import { execSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

const base = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";
const title = 'E2E <Export> "Test"';
const nodes = [
  {
    id: "lane",
    type: "shape",
    position: { x: 0, y: 0 },
    width: 420,
    height: 220,
    data: { label: "Lane", shape: "group" },
  },
  {
    id: "a",
    type: "shape",
    parentId: "lane",
    position: { x: 40, y: 80 },
    width: 160,
    height: 60,
    data: { label: "Start", shape: "rounded" },
    selected: true,
    measured: { width: 160, height: 60 },
  },
  {
    id: "b",
    type: "shape",
    parentId: "lane",
    position: { x: 240, y: 60 },
    width: 150,
    height: 100,
    data: { label: "Decide?", shape: "diamond", color: "#fde68a", style: { borderWidth: 4, fontWeight: "bold" } },
  },
  {
    id: "icon",
    type: "illustration",
    position: { x: 460, y: 0 },
    width: 100,
    height: 120,
    data: { label: "Truck", paths: [{ d: "M5 30 H60 V68 H5 Z", fill: "#4a90d9" }] },
  },
  {
    id: "crop",
    type: "image",
    position: { x: 460, y: 140 },
    width: 60,
    height: 60,
    data: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      label: "Figure",
    },
  },
  {
    id: "f:core",
    type: "repo",
    position: { x: 0, y: 260 },
    width: 480,
    height: 200,
    data: {
      kind: "feature",
      title: "Core",
      expandable: true,
      expanded: true,
      collapsedSize: { width: 240, height: 120 },
      loading: true,
    },
  },
  {
    id: "f:core/c:x",
    type: "repo",
    parentId: "f:core",
    position: { x: 30, y: 50 },
    width: 220,
    height: 104,
    data: {
      kind: "component",
      title: "X",
      expandable: true,
      url: "https://github.com/a/b/blob/" + "a".repeat(40) + "/x.ts#L1",
    },
  },
];
const edges = [
  {
    id: "a-b",
    source: "a",
    target: "b",
    sourceHandle: "right",
    targetHandle: "left",
    type: "smoothstep",
    label: "go",
    markerEnd: { type: "arrowclosed" },
  },
];

const res = await fetch(`${base}/api/export`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title, nodes, edges }),
});
if (!res.ok) throw new Error(`export failed: HTTP ${res.status} ${await res.text()}`);
const disposition = res.headers.get("content-disposition");
console.log("content-disposition:", disposition);

const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
const out = await mkdtemp(path.join(tmpdir(), "retigram-export-"));
for (const [name, entry] of Object.entries(zip.files)) {
  const dest = path.join(out, name);
  if (entry.dir) await mkdir(dest, { recursive: true });
  else {
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await entry.async("nodebuffer"));
  }
}
const [project] = Object.keys(zip.files).filter((f) => f.endsWith("/") && f.split("/").length === 2);
const root = path.join(out, project);
console.log("unzipped to", root);

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log("ok -", msg);
};
const files = Object.keys(zip.files);
assert(!files.some((f) => f.includes("node_modules")), "zip has no node_modules");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert(pkg.scripts.start.startsWith("npm install"), "npm start installs dependencies first");
const html = await readFile(path.join(root, "index.html"), "utf8");
assert(html.includes("<title>E2E &lt;Export&gt; &quot;Test&quot;</title>"), "title is injected and escaped");
const flow = await readFile(path.join(root, "src/flow.ts"), "utf8");
assert(
  flow.includes('"Decide?"') && !flow.includes("selected") && !flow.includes("measured") && !flow.includes('"loading"'),
  "flow.ts has nodes without runtime fields",
);
assert(/"id": "f:core\/c:x"[\s\S]*?"expandable": false/.test(flow), "unloaded levels are not expandable offline");
for (const f of [
  "src/nodes/RepoNode.tsx",
  "src/nodes/IllustrationNode.tsx",
  "src/nodes/ImageNode.tsx",
  "src/nodes/expand.ts",
  "src/nodes/context.ts",
  "src/nodes/constants.ts",
]) {
  assert(files.includes(`${project}${f}`), `zip includes ${f}`);
}

// Same as `npm start` minus the long-running dev server: install, typecheck, build.
execSync("npm install --no-audit --no-fund && npm run build", { cwd: root, stdio: "inherit" });
assert(existsSync(path.join(root, "dist/index.html")), "project builds to dist/index.html");
console.log("\nExport e2e passed. Project left at", root);
