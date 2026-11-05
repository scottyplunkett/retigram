import { z } from "zod";

// Keep in sync with SHAPES in export-template/src/nodes/ShapeNode.tsx (enforced by tests).
export const SHAPE_VALUES = [
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

export const FlowSpecNode = z.object({
  id: z.string().describe("Stable, unique, lowercase slug, e.g. 'check-inventory'"),
  label: z.string().describe("Text shown in the node, verbatim from the source where legible"),
  shape: z.enum(SHAPE_VALUES),
  parentId: z.string().nullable().describe("id of the enclosing 'group' node (swimlane, container, subgraph), or null"),
  x: z.number().describe("Absolute top-left x in pixels"),
  y: z.number().describe("Absolute top-left y in pixels"),
  width: z.number().nullable().describe("Pixels; null to use the shape default. Required for groups."),
  height: z.number().nullable().describe("Pixels; null to use the shape default. Required for groups."),
  color: z
    .string()
    .nullable()
    .describe("Fill colour as #rrggbb only when colour carries meaning in the source, else null"),
});

export const FlowSpecEdge = z.object({
  id: z.string(),
  source: z.string().describe("Node id"),
  target: z.string().describe("Node id"),
  label: z.string().nullable(),
  directed: z.boolean().describe("true if there is an arrowhead at the target"),
  bidirectional: z.boolean().describe("true if there are arrowheads at both ends"),
  style: z.enum(["solid", "dashed", "dotted"]),
});

export const Figure = z.object({
  id: z.string(),
  description: z.string().describe("What the picture shows, e.g. 'silhouette of the state of Illinois'"),
  attachTo: z.string().nullable().describe("id of the node this figure belongs to or sits next to, or null"),
  box: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .describe("Bounding box as fractions (0..1) of the source image width and height; x,y is the top-left"),
});

export const Suggestion = z.object({
  label: z.string().describe("Short button text, under 40 characters"),
  prompt: z.string().describe("The instruction to run if the user picks it"),
});

export const FlowSpec = z.object({
  title: z.string().describe("Short title for the diagram"),
  direction: z.enum(["TB", "LR", "BT", "RL"]).describe("Dominant flow direction"),
  nodes: z.array(FlowSpecNode),
  edges: z.array(FlowSpecEdge),
  figures: z
    .array(Figure)
    .describe("Pictures in the source that are not nodes (logos, maps, icons, photos). Empty if none."),
  suggestions: z
    .array(Suggestion)
    .describe("2 to 4 optional enhancements the user may want next, e.g. styling or replacing a figure"),
  warnings: z.array(z.string()).describe("Anything illegible, ambiguous or guessed. Empty if none."),
});

export type FlowSpec = z.infer<typeof FlowSpec>;
export type FlowSpecNode = z.infer<typeof FlowSpecNode>;
export type FlowSpecEdge = z.infer<typeof FlowSpecEdge>;

export type Figure = z.infer<typeof Figure>;
export type Suggestion = z.infer<typeof Suggestion>;
