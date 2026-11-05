import type { NodeTypes } from "@xyflow/react";
import ShapeNode from "./ShapeNode";
import IllustrationNode from "./IllustrationNode";
import ImageNode from "./ImageNode";
import RepoNode from "./RepoNode";

export * from "./ShapeNode";
export * from "./IllustrationNode";
export * from "./ImageNode";
export * from "./RepoNode";
export * from "./types";
export * from "./expand";
export * from "./context";
export * from "./constants";

export const nodeTypes: NodeTypes = {
  shape: ShapeNode,
  illustration: IllustrationNode,
  image: ImageNode,
  repo: RepoNode,
};
