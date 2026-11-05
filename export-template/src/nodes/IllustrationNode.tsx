import { memo } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { FourHandles } from "./handles";
import { PATH_D, safeColor, type IllustrationPath, type NodeStyle } from "./types";

export type IllustrationNodeData = {
  label?: string;
  paths: IllustrationPath[];
  /** viewBox is always "0 0 100 100". */
  style?: NodeStyle;
};

export type IllustrationNodeType = Node<IllustrationNodeData, "illustration">;

function IllustrationNode({ data, selected }: NodeProps<IllustrationNodeType>) {
  const paths = (data.paths ?? []).filter((p) => typeof p.d === "string" && p.d.length <= 8000 && PATH_D.test(p.d));
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <NodeResizer isVisible={selected} minWidth={30} minHeight={30} keepAspectRatio />
      <svg viewBox="0 0 100 100" style={{ flex: 1, width: "100%", minHeight: 0 }} aria-label={data.label}>
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={safeColor(p.fill, "none")}
            stroke={safeColor(p.stroke, "none")}
            strokeWidth={Math.min(Math.max(p.strokeWidth ?? 1, 0), 10)}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      {data.label && (
        <div
          style={{
            fontSize: Math.min(Math.max(data.style?.fontSize ?? 12, 8), 48),
            fontWeight: data.style?.fontWeight === "bold" ? 700 : 400,
            color: safeColor(data.style?.textColor, "#0f172a"),
            textAlign: "center",
            paddingTop: 4,
          }}
        >
          {data.label}
        </div>
      )}
      <FourHandles />
    </div>
  );
}

export default memo(IllustrationNode);
