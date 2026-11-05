import { Handle, Position } from "@xyflow/react";

const style = { width: 8, height: 8, background: "#334155", opacity: 0.5 };

/** Source handles on all four sides; the flow uses ConnectionMode.Loose so any side can be a target. */
export function FourHandles() {
  return (
    <>
      <Handle id="top" type="source" position={Position.Top} style={style} />
      <Handle id="right" type="source" position={Position.Right} style={style} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={style} />
      <Handle id="left" type="source" position={Position.Left} style={style} />
    </>
  );
}
