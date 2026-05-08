import { useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";
import type { KnowledgeNode } from "../types/treelearn";

interface NotebookDiagramProps {
  onOpenChat: () => void;
}

interface DiagramNode {
  id: string;
  title: string;
  summary: string;
  x: number;
  y: number;
}

interface DiagramLink {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const NODE_WIDTH = 196;
const NODE_HEIGHT = 66;
const X_GAP = 260;
const Y_GAP = 108;
const PADDING = 56;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.8;

// 将缩放比例限制在可读范围内，避免用户滚轮过度缩放导致画布不可用。
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// 思维导图只渲染当前笔记本，因此先从活动节点向上找到根节点。
function getNotebookRootId(nodes: Record<string, KnowledgeNode>, nodeId: string) {
  let current = nodes[nodeId];
  while (current?.parentId) {
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

// 根据树结构计算每个节点的坐标：父节点放在所有子节点纵向中心，叶子节点等距排列。
function buildDiagram(nodes: Record<string, KnowledgeNode>, rootId: string) {
  const diagramNodes: DiagramNode[] = [];
  const links: DiagramLink[] = [];
  let leafIndex = 0;
  let maxDepth = 0;

  const placeNode = (nodeId: string, depth: number): number => {
    // 深度决定横坐标；叶子序号决定纵坐标。
    const node = nodes[nodeId];
    if (!node) return leafIndex * Y_GAP;

    maxDepth = Math.max(maxDepth, depth);
    const childYs = node.children
      .filter((childId) => nodes[childId])
      .map((childId) => placeNode(childId, depth + 1));

    const y =
      childYs.length > 0
        ? childYs.reduce((total, childY) => total + childY, 0) / childYs.length
        : leafIndex++ * Y_GAP;
    const x = depth * X_GAP;

    diagramNodes.push({
      id: node.id,
      title: node.title,
      summary: node.summary,
      x,
      y,
    });

    childYs.forEach((childY, index) => {
      const childId = node.children.filter((id) => nodes[id])[index];
      links.push({
        id: `${node.id}-${childId}`,
        fromX: x + NODE_WIDTH,
        fromY: y + NODE_HEIGHT / 2,
        toX: (depth + 1) * X_GAP,
        toY: childY + NODE_HEIGHT / 2,
      });
    });

    return y;
  };

  placeNode(rootId, 0);

  return {
    nodes: diagramNodes,
    links,
    width: Math.max(720, PADDING * 2 + maxDepth * X_GAP + NODE_WIDTH),
    height: Math.max(420, PADDING * 2 + Math.max(leafIndex - 1, 0) * Y_GAP + NODE_HEIGHT),
  };
}

function linkPath(link: DiagramLink) {
  // 用三次贝塞尔曲线连接父子节点，比直线更容易看出层级关系。
  const midX = link.fromX + (link.toX - link.fromX) / 2;
  return `M ${link.fromX} ${link.fromY} C ${midX} ${link.fromY}, ${midX} ${link.toY}, ${link.toX} ${link.toY}`;
}

export function NotebookDiagram({ onOpenChat }: NotebookDiagramProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const setActiveNode = useTreeLearnStore((state) => state.setActiveNode);
  const rootId = getNotebookRootId(nodes, activeNodeId);
  const diagram = useMemo(() => buildDiagram(nodes, rootId), [nodes, rootId]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const openNode = (nodeId: string) => {
    // 点击导图节点后切回聊天视图，保持“导图定位、聊天编辑”的操作流。
    setActiveNode(nodeId);
    onOpenChat();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 左键按下开始拖动画布；按钮内部会阻止冒泡，避免点击节点时误触拖动。
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setView((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // 以鼠标位置为缩放中心，缩放时尽量保持用户正在查看的内容不跳走。
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;

    setView((current) => {
      const nextScale = clamp(current.scale * zoomFactor, MIN_ZOOM, MAX_ZOOM);
      const contentX = (pointerX - current.x) / current.scale;
      const contentY = (pointerY - current.y) / current.scale;

      return {
        x: pointerX - contentX * nextScale,
        y: pointerY - contentY * nextScale,
        scale: nextScale,
      };
    });
  };

  return (
    <div
      className="h-full min-h-0 cursor-grab overflow-hidden active:cursor-grabbing"
      style={{ background: "var(--tl-panel-muted)" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onWheel={handleWheel}
    >
      <div
        className="relative"
        style={{
          width: diagram.width,
          height: diagram.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={diagram.width}
          height={diagram.height}
          aria-hidden="true"
        >
          <defs>
            <marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--tl-border)" />
            </marker>
          </defs>
          {diagram.links.map((link) => (
            <path
              key={link.id}
              d={linkPath({
                ...link,
                fromX: link.fromX + PADDING,
                fromY: link.fromY + PADDING,
                toX: link.toX + PADDING,
                toY: link.toY + PADDING,
              })}
              fill="none"
              stroke="var(--tl-border)"
              strokeWidth="2"
              markerEnd="url(#diagram-arrow)"
            />
          ))}
        </svg>

        {diagram.nodes.map((node) => {
          const isActive = node.id === activeNodeId;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => openNode(node.id)}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                "group absolute flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30",
                isActive ? "border-primary/45 bg-primary/10" : "tl-panel hover:bg-accent/45",
              )}
              style={{
                left: PADDING + node.x,
                top: PADDING + node.y,
                width: NODE_WIDTH,
                minHeight: NODE_HEIGHT,
              }}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  isActive ? "bg-primary text-primary-foreground" : "tl-brand-soft-bg tl-brand",
                )}
              >
                <MessageSquareText className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm font-medium leading-5">{node.title}</span>
              </span>
              <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 hidden w-64 -translate-y-1/2 rounded-lg border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-lg group-hover:block group-focus:block">
                {node.summary || "No summary yet."}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
