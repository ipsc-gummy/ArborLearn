import type { KnowledgeNode } from "../types/treelearn";

export interface DiagramNode {
  id: string;
  title: string;
  summary: string;
  x: number;
  y: number;
}

export interface DiagramLink {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export const DIAGRAM_NODE_WIDTH = 196;
export const DIAGRAM_NODE_HEIGHT = 66;
export const DIAGRAM_X_GAP = 260;
export const DIAGRAM_Y_GAP = 108;
export const DIAGRAM_PADDING = 56;

export function getNotebookRootId(nodes: Record<string, KnowledgeNode>, nodeId: string) {
  let current = nodes[nodeId];
  while (current?.parentId) {
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

export function buildDiagram(nodes: Record<string, KnowledgeNode>, rootId: string) {
  const diagramNodes: DiagramNode[] = [];
  const links: DiagramLink[] = [];
  let leafIndex = 0;
  let maxDepth = 0;

  const placeNode = (nodeId: string, depth: number): number => {
    const node = nodes[nodeId];
    if (!node) return leafIndex * DIAGRAM_Y_GAP;

    maxDepth = Math.max(maxDepth, depth);
    const childIds = node.children.filter((childId) => nodes[childId]);
    const childYs = childIds.map((childId) => placeNode(childId, depth + 1));

    const y =
      childYs.length > 0
        ? childYs.reduce((total, childY) => total + childY, 0) / childYs.length
        : leafIndex++ * DIAGRAM_Y_GAP;
    const x = depth * DIAGRAM_X_GAP;

    diagramNodes.push({
      id: node.id,
      title: node.title,
      summary: node.summary,
      x,
      y,
    });

    childYs.forEach((childY, index) => {
      const childId = childIds[index];
      links.push({
        id: `${node.id}-${childId}`,
        fromX: x + DIAGRAM_NODE_WIDTH,
        fromY: y + DIAGRAM_NODE_HEIGHT / 2,
        toX: (depth + 1) * DIAGRAM_X_GAP,
        toY: childY + DIAGRAM_NODE_HEIGHT / 2,
      });
    });

    return y;
  };

  placeNode(rootId, 0);

  return {
    nodes: diagramNodes,
    links,
    width: Math.max(720, DIAGRAM_PADDING * 2 + maxDepth * DIAGRAM_X_GAP + DIAGRAM_NODE_WIDTH),
    height: Math.max(420, DIAGRAM_PADDING * 2 + Math.max(leafIndex - 1, 0) * DIAGRAM_Y_GAP + DIAGRAM_NODE_HEIGHT),
  };
}

export function linkPath(link: DiagramLink) {
  const midX = link.fromX + (link.toX - link.fromX) / 2;
  return `M ${link.fromX} ${link.fromY} C ${midX} ${link.fromY}, ${midX} ${link.toY}, ${link.toX} ${link.toY}`;
}
