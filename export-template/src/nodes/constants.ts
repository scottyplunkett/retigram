// React-free constants shared by node components and server code.

export const SHAPES = [
  "rectangle",
  "rounded",
  "diamond",
  "ellipse",
  "parallelogram",
  "cylinder",
  "document",
  "text",
  "group",
] as const;

export type Shape = (typeof SHAPES)[number];

export const DEFAULT_SIZE: Record<Shape, { width: number; height: number }> = {
  rectangle: { width: 160, height: 60 },
  rounded: { width: 160, height: 60 },
  diamond: { width: 150, height: 100 },
  ellipse: { width: 150, height: 70 },
  parallelogram: { width: 170, height: 60 },
  cylinder: { width: 120, height: 90 },
  document: { width: 160, height: 80 },
  text: { width: 160, height: 40 },
  group: { width: 400, height: 260 },
};

export type RepoKind = "feature" | "component" | "file" | "symbol";

export const REPO_SIZE: Record<RepoKind, { width: number; height: number }> = {
  feature: { width: 240, height: 120 },
  component: { width: 220, height: 104 },
  file: { width: 220, height: 56 },
  symbol: { width: 200, height: 44 },
};
