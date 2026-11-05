// Runs every file in fixtures/inputs through /api/convert and checks node/edge counts.
// Requires a running dev server (npm run dev). Each input is a real Claude API call on your key.
// Usage: node scripts/eval-convert.mjs [baseUrl]
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const base = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";
const dir = path.resolve("fixtures/inputs");
const expected = JSON.parse(await readFile(path.join(dir, "expected.json"), "utf8"));
const IMAGE = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

let failed = 0;
for (const name of (await readdir(dir)).sort()) {
  if (name === "expected.json") continue;
  const form = new FormData();
  const ext = path.extname(name).toLowerCase();
  const buf = await readFile(path.join(dir, name));
  if (IMAGE[ext]) form.set("image", new Blob([buf], { type: IMAGE[ext] }), name);
  else form.set("text", buf.toString("utf8"));

  const t0 = Date.now();
  const res = await fetch(`${base}/api/convert`, { method: "POST", body: form });
  const json = await res.json();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    failed++;
    console.log(`FAIL ${name} (${secs}s): HTTP ${res.status} ${json.error}`);
    continue;
  }
  const exp = expected[name];
  const spec = json.spec;
  const n = spec.nodes.length;
  const e = spec.edges.length;
  const ok = !exp || (n >= exp.nodes[0] && n <= exp.nodes[1] && e >= exp.edges[0] && e <= exp.edges[1]);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name} (${secs}s): ${n} nodes, ${e} edges` +
      (exp ? ` (expected ${exp.nodes.join("-")} / ${exp.edges.join("-")})` : " (no expectation)") +
      ` $${json.usage.costUsd.toFixed(4)}` +
      (spec.warnings.length ? `\n     warnings: ${spec.warnings.join(" | ")}` : ""),
  );
}
process.exit(failed ? 1 : 0);
