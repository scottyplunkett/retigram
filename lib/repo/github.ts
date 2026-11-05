import "server-only";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extract, type ReadEntry } from "tar";
import { parseGithubUrl, type RepoRef } from "./url";

export { parseGithubUrl, type RepoRef };

export const REPOS_DIR = path.join(process.cwd(), ".retigram", "repos");
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const MAX_FILES = 20_000;

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "target",
  "__pycache__",
  "coverage",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "bower_components",
  ".gradle",
  ".idea",
  ".vscode",
  "Pods",
  ".turbo",
  ".cache",
  ".yarn",
]);

export class RepoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "retigram", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(url: string, accept?: string) {
  const res = await fetch(url, { headers: { ...headers(), ...(accept ? { Accept: accept } : {}) } });
  if (res.status === 404) {
    throw new RepoError("Repository or ref not found. Private repos need GITHUB_TOKEN in .env.local.", 404);
  }
  if (res.status === 403 || res.status === 429) {
    throw new RepoError("GitHub rate limit reached. Add GITHUB_TOKEN to .env.local or try later.", 429);
  }
  if (!res.ok) throw new RepoError(`GitHub returned ${res.status}.`, 502);
  return res;
}

/** Resolve a branch, tag or SHA (or the default branch) to a commit SHA. */
export async function resolveCommit(ref: RepoRef): Promise<{ sha: string; branch: string }> {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  let branch = ref.ref;
  if (!branch) {
    const meta = (await (await gh(base)).json()) as { default_branch: string };
    branch = meta.default_branch;
  }
  const sha = (
    await (await gh(`${base}/commits/${encodeURIComponent(branch)}`, "application/vnd.github.sha")).text()
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new RepoError("Could not resolve the commit.", 502);
  return { sha, branch };
}

export function snapshotDir(ref: RepoRef, sha: string) {
  return path.join(REPOS_DIR, ref.owner, ref.repo, sha);
}

/** Download and extract a commit once; later calls reuse the snapshot on disk. */
export async function fetchSnapshot(ref: RepoRef, sha: string): Promise<string> {
  const dir = snapshotDir(ref, sha);
  const marker = path.join(dir, ".retigram-complete");
  if (existsSync(marker)) return dir;

  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(tmp, { recursive: true });
  const url = process.env.GITHUB_TOKEN
    ? `https://api.github.com/repos/${ref.owner}/${ref.repo}/tarball/${sha}`
    : `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${sha}`;
  const res = await gh(url, "application/octet-stream");
  if (!res.body) throw new RepoError("Empty download from GitHub.", 502);

  let bytes = 0;
  let files = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) cb(new RepoError("Repository archive is larger than 150 MB.", 413));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      limit,
      extract({
        cwd: tmp,
        strip: 1,
        // Regular files and directories only (no symlinks or hard links), skipping dependency/build dirs.
        filter: (p: string, entry) => {
          const type = (entry as ReadEntry).type;
          if (type !== "File" && type !== "Directory") return false;
          const parts = p.split("/").slice(1);
          if (parts.some((s) => SKIP_DIRS.has(s) || s === "..")) return false;
          if (type === "File" && ++files > MAX_FILES) return false;
          return true;
        },
      }),
    );
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err instanceof RepoError
      ? err
      : new RepoError(`Could not download the repository: ${(err as Error).message}`, 502);
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.rename(tmp, dir);
  await fs.writeFile(marker, new Date().toISOString());
  return dir;
}
