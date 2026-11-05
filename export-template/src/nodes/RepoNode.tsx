import { memo, useContext, type CSSProperties } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { ExpandContext } from "./context";
import type { RepoKind } from "./constants";
import { FourHandles } from "./handles";
import { safeColor, type NodeStyle } from "./types";

export { REPO_SIZE, type RepoKind } from "./constants";

export type Citation = { path: string; line?: number; url?: string; note?: string };

export type RepoNodeData = {
  kind: RepoKind;
  title: string;
  summary?: string;
  layer?: string;
  fileCount?: number;
  path?: string;
  line?: number;
  url?: string;
  citations?: Citation[];
  /** Files or directories this node covers (repo-relative). */
  paths?: string[];
  expandable?: boolean;
  expanded?: boolean;
  loading?: boolean;
  error?: string;
  collapsedSize?: { width: number; height: number };
  expandedSize?: { width: number; height: number };
  style?: NodeStyle;
};

export type RepoNodeType = Node<RepoNodeData, "repo">;

const ACCENT: Record<RepoKind, string> = {
  feature: "#4f46e5",
  component: "#0d9488",
  file: "#475569",
  symbol: "#b45309",
};

const safeUrl = (u?: string) => (u && /^https:\/\/github\.com\//.test(u) ? u : undefined);

function RepoNode({ id, data, selected }: NodeProps<RepoNodeType>) {
  const toggle = useContext(ExpandContext);
  const accent = safeColor(data.style?.borderColor, ACCENT[data.kind] ?? "#475569");
  const border = Math.min(Math.max(data.style?.borderWidth ?? (selected ? 2 : 1.5), 0), 12);
  const url = safeUrl(data.url);

  const box: CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: 10,
    border: `${border}px ${data.style?.borderStyle ?? "solid"} ${accent}`,
    background: data.expanded ? "rgba(248,250,252,0.6)" : safeColor(data.style?.fill, "#ffffff"),
    color: safeColor(data.style?.textColor, "#0f172a"),
    fontSize: Math.min(Math.max(data.style?.fontSize ?? 12, 8), 32),
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: data.expanded ? "none" : "0 1px 2px rgba(15,23,42,0.06)",
  };

  const button = data.expandable ? (
    <button
      className="nodrag"
      onClick={(e) => {
        e.stopPropagation();
        toggle(id);
      }}
      disabled={data.loading}
      title={data.expanded ? "Collapse" : "Expand"}
      style={{
        marginLeft: "auto",
        border: `1px solid ${accent}`,
        color: accent,
        background: "#fff",
        borderRadius: 6,
        fontSize: 11,
        padding: "1px 6px",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {data.loading ? "…" : data.expanded ? "− collapse" : "+ expand"}
    </button>
  ) : null;

  return (
    <div style={box}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderBottom: data.expanded ? `1px solid ${accent}33` : undefined,
        }}
      >
        <span
          style={{
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "#fff",
            background: accent,
            borderRadius: 4,
            padding: "1px 5px",
            flexShrink: 0,
          }}
        >
          {data.kind}
        </span>
        <strong
          style={{
            fontWeight: data.style?.fontWeight === "normal" ? 400 : 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: data.kind === "file" || data.kind === "symbol" ? "ui-monospace, Menlo, monospace" : undefined,
          }}
          title={data.title}
        >
          {data.title}
        </strong>
        {button}
      </div>
      {!data.expanded && (
        <div style={{ padding: "4px 8px 6px", display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
          {data.summary && (
            <div
              style={{
                color: "#475569",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.3,
              }}
              title={data.summary}
            >
              {data.summary}
            </div>
          )}
          <div style={{ color: "#64748b", fontSize: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.layer && <span>{data.layer}</span>}
            {typeof data.fileCount === "number" && <span>{data.fileCount} files</span>}
            {url ? (
              <a className="nodrag" href={url} target="_blank" rel="noopener noreferrer" style={{ color: accent }}>
                {data.path ? `${data.path}${data.line ? `:${data.line}` : ""}` : "source"}
              </a>
            ) : data.path ? (
              <span>{data.path}</span>
            ) : null}
          </div>
          {data.error && <div style={{ color: "#b91c1c", fontSize: 10 }}>{data.error}</div>}
        </div>
      )}
      <FourHandles />
    </div>
  );
}

export default memo(RepoNode);
