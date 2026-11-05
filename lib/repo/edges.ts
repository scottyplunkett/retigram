import type { RepoFile } from "./analyze";

export type Group = { id: string; files: string[] };

/**
 * Edges between groups of files, computed from the import graph: an edge A -> B means files in A
 * import files in B, weighted by the number of import statements. Files are assigned to the first
 * group that lists them.
 */
export function groupEdges(
  files: RepoFile[],
  groups: Group[],
): Array<{ source: string; target: string; count: number }> {
  const owner = new Map<string, string>();
  for (const g of groups) for (const f of g.files) if (!owner.has(f)) owner.set(f, g.id);
  const counts = new Map<string, number>();
  for (const f of files) {
    const a = owner.get(f.path);
    if (!a) continue;
    for (const t of f.imports) {
      const b = owner.get(t);
      if (!b || a === b) continue;
      const k = `${a}\u0000${b}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([k, count]) => {
    const [source, target] = k.split("\u0000");
    return { source, target, count };
  });
}

/** Expand a list of files/directories (as the model names them) to the repo files they cover. */
export function filesUnder(all: string[], paths: string[]): string[] {
  const out = new Set<string>();
  for (const raw of paths) {
    const p = raw.replace(/^\.?\/+/, "").replace(/\/+$/, "");
    if (!p) continue;
    for (const f of all) if (f === p || f.startsWith(`${p}/`)) out.add(f);
  }
  return [...out];
}
