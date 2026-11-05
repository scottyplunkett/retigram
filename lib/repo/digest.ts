import path from "node:path";
import { isCode, type RepoModel } from "./analyze";

const DIGEST_CHAR_CAP = 28_000; // about 7k tokens

function dirOf(p: string, depth: number) {
  const parts = p.split("/");
  return parts.length <= depth ? path.posix.dirname(p) : parts.slice(0, depth).join("/");
}

/** Aggregate file counts and line totals per directory up to `maxDepth`. */
export function dirSummary(model: RepoModel, maxDepth = 3) {
  const stats = new Map<string, { files: number; lines: number; langs: Map<string, number> }>();
  for (const f of model.files) {
    const parts = f.path.split("/");
    for (let d = 1; d <= Math.min(maxDepth, parts.length - 1); d++) {
      const dir = parts.slice(0, d).join("/");
      const s = stats.get(dir) ?? { files: 0, lines: 0, langs: new Map() };
      s.files++;
      s.lines += f.lines;
      s.langs.set(f.lang, (s.langs.get(f.lang) ?? 0) + 1);
      stats.set(dir, s);
    }
  }
  return stats;
}

/** Import counts between directories at `depth`, strongest first. */
export function dirEdges(model: RepoModel, depth = 2) {
  const counts = new Map<string, number>();
  for (const f of model.files) {
    const a = dirOf(f.path, depth);
    for (const t of f.imports) {
      const b = dirOf(t, depth);
      if (a === b) continue;
      const k = `${a} -> ${b}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]);
}

/**
 * A bounded plain-text summary of the repository for the overview agent. Built from the scan only,
 * so it costs no tokens to produce and is the same for every model.
 */
export function buildDigest(model: RepoModel, label: string): string {
  const out: string[] = [];
  const push = (s: string) => out.push(s);
  const code = model.files.filter((f) => isCode(f.lang));
  push(`REPOSITORY ${label}`);
  push(`files: ${model.files.length} (${code.length} code)${model.truncated ? " [truncated]" : ""}`);
  push(
    `languages: ${Object.entries(model.languages)
      .filter(([l]) => l !== "other")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([l, n]) => `${l} ${n}`)
      .join(", ")}`,
  );
  if (model.manifests.length) {
    push("\nMANIFESTS");
    for (const m of model.manifests.slice(0, 8)) {
      push(
        `${m.file}${m.name ? ` name=${m.name}` : ""}${m.description ? ` desc="${m.description.slice(0, 120)}"` : ""}` +
          `${m.scripts?.length ? ` scripts=[${m.scripts.join(",")}]` : ""}${m.deps?.length ? ` deps=[${m.deps.join(",")}]` : ""}`,
      );
    }
  }
  if (model.entryPoints.length) push(`\nENTRY POINTS\n${model.entryPoints.join("\n")}`);

  push("\nDIRECTORIES (files, lines, main language)");
  const stats = dirSummary(model, 3);
  const dirs = [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 220);
  for (const [dir, s] of dirs) {
    const lang = [...s.langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    push(`${"  ".repeat(dir.split("/").length - 1)}${dir}/ ${s.files}f ${s.lines}l ${lang}`);
  }
  const rootFiles = model.files.filter((f) => !f.path.includes("/")).map((f) => f.path);
  if (rootFiles.length) push(`(root files) ${rootFiles.slice(0, 40).join(", ")}`);

  const edges = dirEdges(model, 2).slice(0, 50);
  if (edges.length) {
    push("\nIMPORTS BETWEEN DIRECTORIES (count)");
    for (const [k, n] of edges) push(`${k} (${n})`);
  }

  push("\nKEY SYMBOLS BY DIRECTORY");
  const byDir = new Map<string, string[]>();
  for (const f of code) {
    const d = dirOf(f.path, 2);
    const list = byDir.get(d) ?? [];
    for (const s of f.symbols) if (list.length < 12) list.push(s.name);
    byDir.set(d, list);
  }
  for (const [d, names] of [...byDir.entries()].slice(0, 60)) if (names.length) push(`${d}: ${names.join(", ")}`);

  if (model.readme) {
    push(`\nREADME (${model.readme.path}) headings: ${model.readme.headings.join(" | ")}`);
    push(model.readme.excerpt);
  }
  let text = out.join("\n");
  if (text.length > DIGEST_CHAR_CAP) text = `${text.slice(0, DIGEST_CHAR_CAP)}\n[digest truncated]`;
  return text;
}
