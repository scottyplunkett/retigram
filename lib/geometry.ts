// Pure geometry helpers for graph edits. All coordinates here are ABSOLUTE canvas pixels
// (top-left corner, y grows downward); React Flow stores child positions relative to their parent,
// so every write goes through setAbsolute().

import type { Node } from "@xyflow/react";
import { absoluteBoxes } from "./toXyflow";

export type Box = { x: number; y: number; width: number; height: number };
export type Side = "above" | "below" | "left" | "right";
export type Align = "start" | "center" | "end";

const round = (n: number) => Math.round(n);

export function boxOf(nodes: Node[], id: string): Box | undefined {
  return absoluteBoxes(nodes).get(id);
}

/** Move a node so its absolute top-left is (x, y), keeping its parent. */
export function setAbsolute(nodes: Node[], id: string, x: number, y: number): Node[] {
  const boxes = absoluteBoxes(nodes);
  return nodes.map((n) => {
    if (n.id !== id) return n;
    const origin = n.parentId ? boxes.get(n.parentId) : undefined;
    return { ...n, position: { x: round(x - (origin?.x ?? 0)), y: round(y - (origin?.y ?? 0)) } };
  });
}

export function isDescendant(nodes: Node[], maybeChild: string, ancestor: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (
    let cur = byId.get(maybeChild)?.parentId, guard = 0;
    cur && guard < 100;
    cur = byId.get(cur)?.parentId, guard++
  ) {
    if (cur === ancestor) return true;
  }
  return false;
}

/** Top-left for `size` placed on `side` of `ref`, aligned along the other axis. */
export function placeBeside(
  ref: Box,
  size: { width: number; height: number },
  side: Side,
  align: Align = "center",
  gap = 40,
) {
  const alignX =
    align === "start" ? ref.x : align === "end" ? ref.x + ref.width - size.width : ref.x + (ref.width - size.width) / 2;
  const alignY =
    align === "start"
      ? ref.y
      : align === "end"
        ? ref.y + ref.height - size.height
        : ref.y + (ref.height - size.height) / 2;
  switch (side) {
    case "above":
      return { x: alignX, y: ref.y - gap - size.height };
    case "below":
      return { x: alignX, y: ref.y + ref.height + gap };
    case "left":
      return { x: ref.x - gap - size.width, y: alignY };
    case "right":
      return { x: ref.x + ref.width + gap, y: alignY };
  }
}

/**
 * Grow (never shrink unless `shrink`) a container so it wraps its visible children with padding.
 * If the container's top-left moves, children are shifted so they stay put on the canvas.
 */
export function fitGroup(nodes: Node[], id: string, padding = 40, shrink = false, headerPad = 56): Node[] {
  const boxes = absoluteBoxes(nodes);
  const group = boxes.get(id);
  const kids = nodes.filter((n) => n.parentId === id && !n.hidden).map((n) => boxes.get(n.id)!);
  if (!group || !kids.length) return nodes;
  const need = {
    x1: Math.min(...kids.map((k) => k.x)) - padding,
    y1: Math.min(...kids.map((k) => k.y)) - headerPad,
    x2: Math.max(...kids.map((k) => k.x + k.width)) + padding,
    y2: Math.max(...kids.map((k) => k.y + k.height)) + padding,
  };
  const x1 = shrink ? need.x1 : Math.min(group.x, need.x1);
  const y1 = shrink ? need.y1 : Math.min(group.y, need.y1);
  const x2 = shrink ? need.x2 : Math.max(group.x + group.width, need.x2);
  const y2 = shrink ? need.y2 : Math.max(group.y + group.height, need.y2);
  const dx = x1 - group.x;
  const dy = y1 - group.y;
  if (!dx && !dy && x2 - x1 === group.width && y2 - y1 === group.height) return nodes;
  return nodes.map((n) => {
    if (n.id === id) {
      return {
        ...n,
        position: { x: round(n.position.x + dx), y: round(n.position.y + dy) },
        width: round(x2 - x1),
        height: round(y2 - y1),
      };
    }
    if (n.parentId === id) return { ...n, position: { x: round(n.position.x - dx), y: round(n.position.y - dy) } };
    return n;
  });
}

/** Move a node into another container (or to the top level) without moving it on the canvas. */
export function reparent(nodes: Node[], id: string, parentId: string | null, fit = true): Node[] {
  const boxes = absoluteBoxes(nodes);
  const me = boxes.get(id)!;
  const origin = parentId ? boxes.get(parentId)! : { x: 0, y: 0 };
  let out = nodes.map((n) => {
    if (n.id !== id) return n;
    const next: Node = { ...n, position: { x: round(me.x - origin.x), y: round(me.y - origin.y) } };
    if (parentId) next.parentId = parentId;
    else delete next.parentId;
    // `extent: "parent"` would clamp a node that is being moved out; drop it.
    delete next.extent;
    return next;
  });
  if (parentId && fit) out = fitGroup(out, parentId);
  return out;
}

/** Lay nodes out in the given order as a row or column, starting where the first one is (or at `start`). */
export function arrange(
  nodes: Node[],
  ids: string[],
  direction: "row" | "column",
  gap = 40,
  align: Align = "center",
  start?: { x: number; y: number },
): Node[] {
  const boxes = absoluteBoxes(nodes);
  const items = ids.map((id) => ({ id, box: boxes.get(id)! }));
  const first = items[0].box;
  let cursor = start ? (direction === "row" ? start.x : start.y) : direction === "row" ? first.x : first.y;
  // Cross-axis reference: the first node's band.
  const band =
    direction === "row"
      ? { from: start?.y ?? first.y, size: Math.max(...items.map((i) => i.box.height)) }
      : { from: start?.x ?? first.x, size: Math.max(...items.map((i) => i.box.width)) };
  let out = nodes;
  for (const { id, box } of items) {
    const cross = direction === "row" ? box.height : box.width;
    const offset = align === "start" ? 0 : align === "end" ? band.size - cross : (band.size - cross) / 2;
    const x = direction === "row" ? cursor : band.from + offset;
    const y = direction === "row" ? band.from + offset : cursor;
    out = setAbsolute(out, id, x, y);
    cursor += (direction === "row" ? box.width : box.height) + gap;
  }
  return out;
}

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Line nodes up on one edge or centre line, using the first node as the reference. */
export function alignTo(nodes: Node[], ids: string[], edge: AlignEdge): Node[] {
  const boxes = absoluteBoxes(nodes);
  const ref = boxes.get(ids[0])!;
  let out = nodes;
  for (const id of ids.slice(1)) {
    const b = boxes.get(id)!;
    let { x, y } = b;
    if (edge === "left") x = ref.x;
    if (edge === "right") x = ref.x + ref.width - b.width;
    if (edge === "center") x = ref.x + (ref.width - b.width) / 2;
    if (edge === "top") y = ref.y;
    if (edge === "bottom") y = ref.y + ref.height - b.height;
    if (edge === "middle") y = ref.y + (ref.height - b.height) / 2;
    out = setAbsolute(out, id, x, y);
  }
  return out;
}
