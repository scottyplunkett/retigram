import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { analyze, langOf, type RepoModel, type SourceEntry } from "./analyze";
import { SKIP_DIRS } from "./github";

const MAX_FILE_BYTES = 400 * 1024;
const MAX_FILES = 20_000;
const BINARY =
  /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|o|a|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|ogg|wav|flac|psd|sketch|fig|lock|min\.js|map)$/i;

/** Read text files under `root` (already confined to the snapshot), then analyze them. */
export async function scanSnapshot(root: string): Promise<RepoModel> {
  const entries: SourceEntry[] = [];
  let truncated = false;
  async function walk(rel: string) {
    if (entries.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    const dirents = await fs.readdir(/*turbopackIgnore: true*/ path.join(root, rel), { withFileTypes: true });
    for (const d of dirents) {
      if (d.name === ".retigram-complete") continue;
      const p = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) await walk(p);
      } else if (d.isFile() && !BINARY.test(d.name)) {
        const abs = path.join(root, p);
        const stat = await fs.stat(/*turbopackIgnore: true*/ abs);
        if (stat.size > MAX_FILE_BYTES) {
          entries.push({ path: p, content: "" });
          continue;
        }
        const buf = await fs.readFile(/*turbopackIgnore: true*/ abs);
        if (buf.subarray(0, 8000).includes(0)) continue; // binary
        entries.push({ path: p, content: langOf(p) === "other" && stat.size > 100_000 ? "" : buf.toString("utf8") });
      }
    }
  }
  await walk("");
  return analyze(entries, truncated);
}
