"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { nodeTypes } from "@nodes";

export default function FlowViewer({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setEdges,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  setEdges: (fn: (eds: Edge[]) => Edge[]) => void;
}) {
  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, type: "smoothstep" }, eds)),
    [setEdges],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      connectionMode={ConnectionMode.Loose}
      fitView
      deleteKeyCode={["Backspace", "Delete"]}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
