import type { Node } from "@xyflow/react";
import type { Figure } from "./schema";
import { absoluteBoxes } from "./toXyflow";

const MAX_EDGE = 480;

/** Crop a normalized box out of an image into a PNG data URL. Browser-only. */
export async function cropFigure(image: Blob, box: Figure["box"]) {
  const bitmap = await createImageBitmap(image);
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  const x = clamp(box.x) * bitmap.width;
  const y = clamp(box.y) * bitmap.height;
  const w = Math.max(1, clamp(box.w) * bitmap.width);
  const h = Math.max(1, clamp(box.h) * bitmap.height);
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/**
 * Image nodes for cropped figures. A figure attached to a node sits to that node's left at a
 * comparable height; unattached figures go above the diagram.
 */
export function figureNodes(
  nodes: Node[],
  figures: Array<Figure & { crop: { src: string; width: number; height: number } }>,
): Node[] {
  const boxes = absoluteBoxes(nodes);
  const minY = Math.min(0, ...[...boxes.values()].map((b) => b.y));
  let freeX = 0;
  return figures.map((f) => {
    const aspect = f.crop.width / f.crop.height;
    const target = f.attachTo ? nodes.find((n) => n.id === f.attachTo) : undefined;
    const height = Math.min(Math.max(target ? (target.height ?? 60) * 1.4 : 120, 60), 220);
    const width = Math.round(height * aspect);
    let position;
    let parentId: string | undefined;
    if (target) {
      parentId = target.parentId;
      position = { x: target.position.x - width - 30, y: target.position.y + ((target.height ?? 60) - height) / 2 };
    } else {
      position = { x: freeX, y: minY - height - 40 };
      freeX += width + 30;
    }
    return {
      id: `figure-${f.id}`,
      type: "image",
      position,
      width,
      height,
      data: { src: f.crop.src, label: f.description },
      ...(parentId ? { parentId } : {}),
    };
  });
}
