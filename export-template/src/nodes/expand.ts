import type { Node } from "@xyflow/react";

type Expandable = {
  expanded?: boolean;
  collapsedSize?: { width: number; height: number };
  expandedSize?: { width: number; height: number };
};

export function childrenOf(nodes: Node[], id: string) {
  return nodes.filter((n) => n.parentId === id);
}

export function hasChildren(nodes: Node[], id: string) {
  return nodes.some((n) => n.parentId === id);
}

/**
 * Expand or collapse a node. Collapsing hides every descendant and restores the node's collapsed size.
 * Expanding shows direct children and, recursively, the children of descendants that are themselves expanded.
 */
export function setExpanded(nodes: Node[], id: string, expanded: boolean): Node[] {
  const byParent = new Map<string, Node[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const visibility = new Map<string, boolean>();
  const walk = (parentId: string, visible: boolean) => {
    for (const c of byParent.get(parentId) ?? []) {
      visibility.set(c.id, visible);
      const cExpanded = !!(c.data as Expandable).expanded;
      walk(c.id, visible && cExpanded);
    }
  };
  walk(id, expanded);

  return nodes.map((n) => {
    if (n.id === id) {
      const d = n.data as Expandable;
      const current = { width: n.width ?? 0, height: n.height ?? 0 };
      if (expanded) {
        const size = d.expandedSize ?? current;
        return { ...n, width: size.width, height: size.height, data: { ...n.data, expanded: true } };
      }
      const size = d.collapsedSize ?? current;
      return {
        ...n,
        width: size.width,
        height: size.height,
        data: { ...n.data, expanded: false, expandedSize: current },
      };
    }
    return visibility.has(n.id) ? { ...n, hidden: !visibility.get(n.id) } : n;
  });
}
