import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  ConnectionMode,
  useEdgesState,
  useNodesState,
  type Connection,
} from "@xyflow/react";
import { ExpandContext, nodeTypes, setExpanded } from "./nodes";
import { initialEdges, initialNodes } from "./flow";

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, type: "smoothstep" }, eds)),
    [setEdges],
  );

  // Expand/collapse levels that were loaded before export; no network needed.
  const toggle = useCallback(
    (id: string) =>
      setNodes((ns) => {
        const node = ns.find((n) => n.id === id);
        return node ? setExpanded(ns, id, !(node.data as { expanded?: boolean }).expanded) : ns;
      }),
    [setNodes],
  );

  return (
    <ExpandContext.Provider value={toggle}>
      <div style={{ width: "100vw", height: "100vh" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </ExpandContext.Provider>
  );
}
