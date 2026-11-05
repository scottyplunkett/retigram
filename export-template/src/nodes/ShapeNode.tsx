import { memo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { safeColor, type NodeStyle } from "./types";
import { Handle, NodeResizer, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";

export { SHAPES, DEFAULT_SIZE, type Shape } from "./constants";
import { type Shape } from "./constants";

export type ShapeNodeData = {
  label: string;
  shape: Shape;
  color?: string | null;
  style?: NodeStyle;
};

export type ShapeNodeType = Node<ShapeNodeData, "shape">;

const STROKE = "#334155";
const FILL = "#ffffff";

function ShapeSvg({ shape, fill, style }: { shape: Shape; fill: string; style?: NodeStyle }) {
  const dash = style?.borderStyle === "dashed" ? "6 4" : style?.borderStyle === "dotted" ? "2 3" : undefined;
  const common = {
    fill,
    stroke: safeColor(style?.borderColor, STROKE),
    strokeWidth: Math.min(Math.max(style?.borderWidth ?? 1.5, 0), 12),
    strokeDasharray: dash,
    vectorEffect: "non-scaling-stroke" as const,
  };
  let body: React.ReactNode;
  switch (shape) {
    case "rectangle":
      body = <rect x={1} y={1} width={98} height={98} {...common} />;
      break;
    case "rounded":
      body = <rect x={1} y={1} width={98} height={98} rx={14} ry={20} {...common} />;
      break;
    case "diamond":
      body = <polygon points="50,1 99,50 50,99 1,50" {...common} />;
      break;
    case "ellipse":
      body = <ellipse cx={50} cy={50} rx={49} ry={49} {...common} />;
      break;
    case "parallelogram":
      body = <polygon points="15,1 99,1 85,99 1,99" {...common} />;
      break;
    case "cylinder":
      body = (
        <>
          <path d="M1,12 L1,88 A49,11 0 0 0 99,88 L99,12" {...common} />
          <ellipse cx={50} cy={12} rx={49} ry={11} {...common} />
        </>
      );
      break;
    case "document":
      body = <path d="M1,1 L99,1 L99,85 Q75,70 50,85 T1,85 Z" {...common} />;
      break;
    case "group":
      body = (
        <rect
          x={0.5}
          y={0.5}
          width={99}
          height={99}
          rx={2}
          {...common}
          fill={fill === FILL ? "rgba(148,163,184,0.08)" : fill}
          strokeDasharray={dash ?? "6 4"}
        />
      );
      break;
    case "text":
      body = null;
      break;
  }
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
      aria-hidden
    >
      {body}
    </svg>
  );
}

const handleStyle: CSSProperties = { width: 8, height: 8, background: STROKE, opacity: 0.5 };

function ShapeNode({ id, data, selected }: NodeProps<ShapeNodeType>) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const isGroup = data.shape === "group";

  const commit = () => {
    setEditing(false);
    if (draft !== data.label) updateNodeData(id, { label: draft });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setDraft(data.label);
      setEditing(false);
    }
  };

  const labelStyle: CSSProperties = {
    position: "relative",
    fontSize: Math.min(Math.max(data.style?.fontSize ?? 13, 8), 48),
    fontWeight: data.style?.fontWeight === "bold" ? 700 : 400,
    lineHeight: 1.25,
    color: safeColor(data.style?.textColor, "#0f172a"),
    textAlign: "center",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: data.shape === "diamond" ? "0 18%" : data.shape === "parallelogram" ? "0 12%" : "0 8px",
  };

  return (
    <div
      onDoubleClick={() => {
        setDraft(data.label);
        setEditing(true);
      }}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: isGroup ? "flex-start" : "center",
        justifyContent: isGroup ? "flex-start" : "center",
      }}
    >
      <NodeResizer isVisible={selected} minWidth={40} minHeight={30} />
      <ShapeSvg
        shape={data.shape}
        fill={safeColor(data.style?.fill ?? data.color ?? undefined, FILL)}
        style={data.style}
      />
      {editing ? (
        <textarea
          className="nodrag"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{ ...labelStyle, width: "85%", resize: "none", border: "1px solid #94a3b8", borderRadius: 4 }}
          rows={2}
        />
      ) : (
        <div style={isGroup ? { ...labelStyle, fontWeight: 600, padding: "6px 10px", textAlign: "left" } : labelStyle}>
          {data.label}
        </div>
      )}
      <Handle id="top" type="source" position={Position.Top} style={handleStyle} />
      <Handle id="right" type="source" position={Position.Right} style={handleStyle} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={handleStyle} />
      <Handle id="left" type="source" position={Position.Left} style={handleStyle} />
    </div>
  );
}

export default memo(ShapeNode);
