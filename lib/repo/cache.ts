import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".retigram", "cache");

export const cacheKey = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);

/** Results keyed by repository commit, so a new commit never serves stale output (repo-tutor ADR 0070). */
function file(owner: string, repo: string, sha: string, name: string) {
  return path.join(CACHE_DIR, owner, repo, sha, `${name}.json`);
}

export async function readCache<T>(owner: string, repo: string, sha: string, name: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file(owner, repo, sha, name), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function writeCache(owner: string, repo: string, sha: string, name: string, value: unknown) {
  const f = file(owner, repo, sha, name);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, f);
}
