import { memo } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { FourHandles } from "./handles";

export type ImageNodeData = { src: string; label?: string };
export type ImageNodeType = Node<ImageNodeData, "image">;

const SAFE_SRC = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function ImageNode({ data, selected }: NodeProps<ImageNodeType>) {
  const ok = SAFE_SRC.test(data.src);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <NodeResizer isVisible={selected} minWidth={20} minHeight={20} keepAspectRatio />
      {ok ? (
        <img
          src={data.src}
          alt={data.label ?? ""}
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", border: "1px dashed #94a3b8" }} />
      )}
      <FourHandles />
    </div>
  );
}

export default memo(ImageNode);
