// Pure repository analysis: no filesystem, network or model access.
// Import and declaration detection is regex based (like repo-tutor's non-Go analysis): it can miss
// dynamic imports, aliases it does not know about, and re-exports. Edges are a reading aid.

import path from "node:path";

export type Symbol = { name: string; kind: string; line: number };
export type RepoFile = { path: string; lang: string; lines: number; imports: string[]; symbols: Symbol[] };
export type Manifest = {
  file: string;
  name?: string;
  description?: string;
  scripts?: string[];
  deps?: string[];
  entry?: string[];
};

export type RepoModel = {
  files: RepoFile[];
  languages: Record<string, number>;
  manifests: Manifest[];
  entryPoints: string[];
  readme?: { path: string; headings: string[]; excerpt: string };
  truncated: boolean;
};

export type SourceEntry = { path: string; content: string };

const LANG: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".py": "py",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
  ".clj": "clojure",
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "css",
  ".html": "html",
  ".sql": "sql",
  ".sh": "shell",
  ".md": "md",
  ".mdx": "md",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".proto": "proto",
  ".graphql": "graphql",
};

export const langOf = (p: string) => LANG[path.posix.extname(p).toLowerCase()] ?? "other";
const CODE_LANGS = new Set([
  "ts",
  "js",
  "py",
  "go",
  "rust",
  "java",
  "kotlin",
  "ruby",
  "php",
  "csharp",
  "swift",
  "c",
  "cpp",
  "scala",
  "elixir",
  "clojure",
  "vue",
  "svelte",
]);
export const isCode = (lang: string) => CODE_LANGS.has(lang);

const SYMBOL_RULES: Record<string, Array<[RegExp, string]>> = {
  ts: [
    [/^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
    [/^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
    [/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "const"],
    [/^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/, "type"],
    [/^export\s+enum\s+([A-Za-z_$][\w$]*)/, "enum"],
    [/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
    [/^class\s+([A-Za-z_$][\w$]*)/, "class"],
  ],
  py: [
    [/^(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function"],
    [/^class\s+([A-Za-z_]\w*)/, "class"],
  ],
  go: [
    [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "func"],
    [/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, "type"],
  ],
  rust: [[/^pub(?:\([^)]*\))?\s+(?:async\s+)?(fn|struct|enum|trait)\s+([A-Za-z_]\w*)/, "$1"]],
  java: [[/^\s*(?:public\s+)?(?:abstract\s+|final\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/, "$1"]],
  kotlin: [[/^\s*(?:data\s+|sealed\s+|open\s+)*(class|interface|object|fun)\s+([A-Za-z_]\w*)/, "$1"]],
  ruby: [[/^\s*(class|module|def)\s+([A-Za-z_][\w.:?!]*)/, "$1"]],
};
SYMBOL_RULES.js = SYMBOL_RULES.ts;

export function extractSymbols(lang: string, content: string, max = 40): Symbol[] {
  const rules = SYMBOL_RULES[lang];
  if (!rules) return [];
  const out: Symbol[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i];
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (!m) continue;
      // Rules with two groups capture (kind, name); others capture (name).
      const name = m[2] ?? m[1];
      out.push({ name, kind: kind.startsWith("$") ? m[1] : kind, line: i + 1 });
      break;
    }
  }
  return out;
}

const JS_IMPORT =
  /(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"\n]+)['"]|require\(\s*['"]([^'"\n]+)['"]\s*\)|import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const PY_FROM = /^\s*from\s+([.\w]+)\s+import\s+([\w*, ()]+)/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;
const GO_IMPORT_BLOCK = /import\s*\(([\s\S]*?)\)/g;
const GO_IMPORT_ONE = /import\s+(?:\w+\s+)?"([^"]+)"/g;

export function extractImportSpecs(lang: string, content: string): string[] {
  const out: string[] = [];
  if (lang === "ts" || lang === "js" || lang === "vue" || lang === "svelte") {
    for (const m of content.matchAll(JS_IMPORT)) out.push(m[1] ?? m[2] ?? m[3]);
  } else if (lang === "py") {
    for (const m of content.matchAll(PY_FROM)) {
      const mod = m[1];
      out.push(mod);
      // `from pkg import a, b` may name submodules (pkg/a.py); unresolvable candidates are dropped later.
      for (const raw of m[2].replace(/[()]/g, "").split(",")) {
        const n = raw.trim().split(/\s+/)[0];
        if (!n || n === "*") continue;
        out.push(/^\.+$/.test(mod) ? mod + n : `${mod}.${n}`);
      }
    }
    for (const m of content.matchAll(PY_IMPORT)) for (const s of m[1].split(",")) out.push(s.trim());
  } else if (lang === "go") {
    for (const m of content.matchAll(GO_IMPORT_BLOCK)) for (const q of m[1].matchAll(/"([^"]+)"/g)) out.push(q[1]);
    for (const m of content.matchAll(GO_IMPORT_ONE)) out.push(m[1]);
  }
  return out.filter(Boolean);
}

type Resolver = {
  files: Set<string>;
  dirFiles: Map<string, string[]>;
  aliases: Array<{ prefix: string; target: string }>;
  goModules: Array<{ module: string; dir: string }>;
};

const JS_EXTS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

function resolveJs(r: Resolver, from: string, spec: string): string | undefined {
  let base: string | undefined;
  if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else {
    const alias = r.aliases.find((a) => spec === a.prefix.replace(/\/$/, "") || spec.startsWith(a.prefix));
    if (alias) base = path.posix.join(alias.target, spec.slice(alias.prefix.length));
  }
  if (base === undefined) return undefined;
  base = base.replace(/\.js$/, (m) => (r.files.has(base!) ? m : "")); // TS ESM imports name .js for .ts files
  for (const ext of JS_EXTS) if (r.files.has(base + ext)) return base + ext;
  return undefined;
}

function resolvePy(r: Resolver, from: string, spec: string): string | undefined {
  const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
  const rest = spec.slice(dots).replace(/\./g, "/");
  // Absolute imports: try the repo root, src/, and every ancestor of the importing file
  // (packages often live under a subfolder such as api/).
  const ancestors: string[] = [];
  for (let d = path.posix.dirname(from); d && d !== "."; d = path.posix.dirname(d)) ancestors.push(d);
  const roots = dots
    ? [path.posix.join(path.posix.dirname(from), ...Array(dots - 1).fill(".."))]
    : ["", "src", ...ancestors];
  for (const root of roots) {
    const b = path.posix.join(root, rest);
    for (const c of [`${b}.py`, `${b}/__init__.py`]) if (r.files.has(c)) return c;
  }
  return undefined;
}

function resolveGo(r: Resolver, spec: string): string | undefined {
  const mod = r.goModules.find((m) => spec === m.module || spec.startsWith(`${m.module}/`));
  if (!mod) return undefined;
  const dir = path.posix.join(mod.dir, spec.slice(mod.module.length).replace(/^\//, ""));
  return r.dirFiles.get(dir === "." ? "" : dir)?.find((f) => f.endsWith(".go") && !f.endsWith("_test.go"));
}

function stripJsonComments(s: string) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
}

function parseManifests(byPath: Map<string, string>): {
  manifests: Manifest[];
  aliases: Resolver["aliases"];
  goModules: Resolver["goModules"];
  entry: string[];
} {
  const manifests: Manifest[] = [];
  const aliases: Resolver["aliases"] = [];
  const entry: string[] = [];
  const goModules: Resolver["goModules"] = [];

  for (const [p, content] of byPath) {
    const name = path.posix.basename(p);
    const depth = p.split("/").length;
    if (depth > 3) continue;
    try {
      if (name === "package.json") {
        const j = JSON.parse(content);
        const bins = typeof j.bin === "string" ? [j.bin] : Object.values(j.bin ?? {});
        const mains = [j.main, j.module, ...bins].filter((v): v is string => typeof v === "string");
        manifests.push({
          file: p,
          name: j.name,
          description: j.description,
          scripts: Object.keys(j.scripts ?? {}).slice(0, 15),
          deps: Object.keys({ ...(j.dependencies ?? {}) }).slice(0, 25),
          entry: mains,
        });
        for (const m of mains) entry.push(path.posix.normalize(path.posix.join(path.posix.dirname(p), m)));
      } else if ((name === "tsconfig.json" || name === "jsconfig.json") && depth <= 2) {
        const j = JSON.parse(stripJsonComments(content));
        const opts = j.compilerOptions ?? {};
        const baseUrl = path.posix.join(path.posix.dirname(p), opts.baseUrl ?? ".");
        for (const [k, v] of Object.entries<string[]>(opts.paths ?? {})) {
          if (!Array.isArray(v) || !v[0]) continue;
          aliases.push({ prefix: k.replace(/\*$/, ""), target: path.posix.join(baseUrl, v[0].replace(/\*$/, "")) });
        }
      } else if (name === "go.mod") {
        const goModule = /^module\s+(\S+)/m.exec(content)?.[1];
        if (goModule)
          goModules.push({ module: goModule, dir: path.posix.dirname(p) === "." ? "" : path.posix.dirname(p) });
        manifests.push({ file: p, name: goModule });
      } else if (name === "pyproject.toml") {
        manifests.push({
          file: p,
          name: /^name\s*=\s*"([^"]+)"/m.exec(content)?.[1],
          description: /^description\s*=\s*"([^"]+)"/m.exec(content)?.[1],
          deps: [...content.matchAll(/^\s*"([A-Za-z0-9_.-]+)/gm)].map((m) => m[1]).slice(0, 25),
        });
      } else if (name === "requirements.txt") {
        manifests.push({
          file: p,
          deps: content
            .split("\n")
            .map((l) => l.split(/[=<>~;\s[]/)[0].trim())
            .filter(Boolean)
            .slice(0, 25),
        });
      } else if (name === "Cargo.toml") {
        manifests.push({ file: p, name: /^name\s*=\s*"([^"]+)"/m.exec(content)?.[1] });
      } else if (
        name === "Gemfile" ||
        name === "pom.xml" ||
        name === "build.gradle" ||
        name === "build.gradle.kts" ||
        name === "composer.json"
      ) {
        manifests.push({ file: p });
      }
    } catch {
      manifests.push({ file: p });
    }
  }
  // Common default when no tsconfig paths are declared.
  if (!aliases.length)
    aliases.push({ prefix: "@/", target: byPath.has("src") ? "src" : "" }, { prefix: "~/", target: "" });
  return { manifests, aliases, goModules, entry };
}

const ENTRY_NAMES =
  /^(main\.(go|py|rs|ts|js)|__main__\.py|app\.(py|ts|js)|manage\.py|server\.(ts|js|py)|index\.(ts|tsx|js)|cli\.(ts|js|py)|Program\.cs|Dockerfile)$/;

function findEntryPoints(paths: string[], fromManifests: string[]): string[] {
  const set = new Set<string>(fromManifests.filter((p) => paths.includes(p)));
  for (const p of paths) {
    const parts = p.split("/");
    const name = parts[parts.length - 1];
    const shallow = parts.length <= 2 || (parts.length === 3 && ["src", "cmd", "app", "bin"].includes(parts[0]));
    if (shallow && ENTRY_NAMES.test(name)) set.add(p);
    if (/(^|\/)cmd\/[^/]+\/main\.go$/.test(p)) set.add(p);
    if (/(^|\/)app\/(layout|page)\.(tsx|jsx|ts|js)$/.test(p) && parts.length <= 3) set.add(p);
  }
  return [...set].slice(0, 30);
}

function readme(byPath: Map<string, string>) {
  const p = [...byPath.keys()].find((k) => /^readme(\.md|\.rst|\.txt)?$/i.test(k));
  if (!p) return undefined;
  const content = byPath.get(p)!;
  const headings = [...content.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 30);
  const excerpt = content
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .filter((l) => l.trim() && !/^!\[|^\[!\[/.test(l.trim()))
    .slice(0, 40)
    .join("\n")
    .slice(0, 3000);
  return { path: p, headings, excerpt };
}

export function analyze(entries: SourceEntry[], truncated = false): RepoModel {
  const byPath = new Map(entries.map((e) => [e.path, e.content]));
  const files = new Set(byPath.keys());
  const dirFiles = new Map<string, string[]>();
  for (const p of files) {
    const d = path.posix.dirname(p) === "." ? "" : path.posix.dirname(p);
    const list = dirFiles.get(d) ?? [];
    list.push(p);
    dirFiles.set(d, list);
  }
  const { manifests, aliases, goModules, entry } = parseManifests(byPath);
  const r: Resolver = { files, dirFiles, aliases, goModules };

  const languages: Record<string, number> = {};
  const out: RepoFile[] = [];
  for (const [p, content] of byPath) {
    const lang = langOf(p);
    languages[lang] = (languages[lang] ?? 0) + 1;
    const imports = new Set<string>();
    if (isCode(lang)) {
      for (const spec of extractImportSpecs(lang, content)) {
        const target =
          lang === "py" ? resolvePy(r, p, spec) : lang === "go" ? resolveGo(r, spec) : resolveJs(r, p, spec);
        if (target && target !== p) imports.add(target);
      }
    }
    out.push({
      path: p,
      lang,
      lines: content ? content.split("\n").length : 0,
      imports: [...imports],
      symbols: isCode(lang) ? extractSymbols(lang, content) : [],
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: out,
    languages,
    manifests,
    entryPoints: findEntryPoints(
      out.map((f) => f.path),
      entry,
    ),
    readme: readme(byPath),
    truncated,
  };
}
