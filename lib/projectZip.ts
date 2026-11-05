import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { Edge, Node } from "@xyflow/react";
import { serializeFlow } from "./serialize";

const TEMPLATE_DIR = path.join(process.cwd(), "export-template");
const SKIP = new Set(["node_modules", "dist", "package-lock.json", ".DS_Store"]);

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)));
    else out.push(r);
  }
  return out;
}

export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "flow-diagram"
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function buildProjectZip(title: string, nodes: Node[], edges: Edge[]) {
  const slug = slugify(title);
  const zip = new JSZip();
  const root = zip.folder(slug)!;

  for (const rel of await listFiles(TEMPLATE_DIR)) {
    const abs = path.join(TEMPLATE_DIR, rel);
    if (rel === "src/flow.ts") {
      root.file(rel, serializeFlow(nodes, edges));
      continue;
    }
    let content = await fs.readFile(abs, "utf8");
    if (rel === "index.html") content = content.replaceAll("__TITLE__", escapeHtml(title));
    if (rel === "README.md") content = content.replaceAll("__TITLE__", title.replace(/[\r\n]+/g, " "));
    if (rel === "package.json") {
      const pkg = JSON.parse(content);
      pkg.name = slug;
      content = JSON.stringify(pkg, null, 2) + "\n";
    }
    root.file(rel, content);
  }

  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { filename: `${slug}.zip`, buffer };
}
