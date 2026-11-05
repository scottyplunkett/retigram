export type RepoRef = { owner: string; repo: string; ref?: string; subpath?: string };

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse a GitHub repository URL: github.com/owner/repo, optionally with /tree/<ref>/<subpath>
 * or /blob/<ref>/<path>. A ref containing slashes is ambiguous; the first segment is used as the ref.
 */
export function parseGithubUrl(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^(www\.)?github\.com\//i.test(s)) s = `https://${s}`;
    else return null;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(repo) || owner.startsWith(".") || repo.startsWith(".")) return null;
  const out: RepoRef = { owner, repo };
  if ((parts[2] === "tree" || parts[2] === "blob") && parts[3]) {
    out.ref = parts[3];
    const sub = parts.slice(4).join("/");
    if (sub && !sub.split("/").some((p) => p === ".." || p === ".")) out.subpath = sub;
  }
  return out;
}

export const isGithubUrl = (s: string) => parseGithubUrl(s) !== null;
