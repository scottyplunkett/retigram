import type { Edge, Node } from "@xyflow/react";

export const initialNodes: Node[] = [
  {
    id: "start",
    type: "shape",
    position: { x: 0, y: 0 },
    width: 150,
    height: 70,
    data: { label: "Start", shape: "ellipse" },
  },
  {
    id: "check",
    type: "shape",
    position: { x: 5, y: 130 },
    width: 140,
    height: 100,
    data: { label: "Ready?", shape: "diamond" },
  },
  {
    id: "go",
    type: "shape",
    position: { x: -5, y: 290 },
    width: 160,
    height: 60,
    data: { label: "Ship it", shape: "rounded" },
  },
  {
    id: "wait",
    type: "shape",
    position: { x: 240, y: 150 },
    width: 160,
    height: 60,
    data: { label: "Fix issues", shape: "rectangle" },
  },
];

export const initialEdges: Edge[] = [
  {
    id: "start-check",
    source: "start",
    target: "check",
    sourceHandle: "bottom",
    targetHandle: "top",
    type: "smoothstep",
    markerEnd: { type: "arrowclosed" },
  },
  {
    id: "check-go",
    source: "check",
    target: "go",
    sourceHandle: "bottom",
    targetHandle: "top",
    type: "smoothstep",
    label: "yes",
    markerEnd: { type: "arrowclosed" },
  },
  {
    id: "check-wait",
    source: "check",
    target: "wait",
    sourceHandle: "right",
    targetHandle: "left",
    type: "smoothstep",
    label: "no",
    markerEnd: { type: "arrowclosed" },
  },
];
