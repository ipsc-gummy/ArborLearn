import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  GitBranch,
  GripVertical,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useArborLearnStore } from "../store/arborlearnStore";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { AccountMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import type { AuthUser } from "../lib/api";
import {
  DIAGRAM_NODE_HEIGHT,
  DIAGRAM_NODE_WIDTH,
  DIAGRAM_PADDING,
  buildDiagram,
  linkPath,
} from "../lib/diagramLayout";

type WorkspaceView = "chat" | "diagram";
type ArborNodes = ReturnType<typeof useArborLearnStore.getState>["nodes"];

interface TreeItemProps {
  nodeId: string;
  depth: number;
  onRequestDelete: (nodeId: string, title: string) => void;
  openMenuId: string | null;
  onOpenMenuChange: (nodeId: string, open: boolean) => void;
}

interface DeleteTarget {
  id: string;
  title: string;
}

interface KnowledgeTreeProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onHome: () => void;
  user: AuthUser | null;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
  demoUpgradeLocked?: boolean;
  onRequireDemoUpgrade?: () => void;
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}

function getNotebookRootId(nodes: ArborNodes, nodeId: string) {
  let current = nodes[nodeId];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

function countSubtreeNodes(nodes: ArborNodes, nodeId: string): number {
  const node = nodes[nodeId];
  if (!node) return 0;
  return 1 + node.children.reduce((total, childId) => total + countSubtreeNodes(nodes, childId), 0);
}

function copyTextWithSelection(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function TreeItem({ nodeId, depth, onRequestDelete, openMenuId, onOpenMenuChange }: TreeItemProps) {
  const node = useArborLearnStore((state) => state.nodes[nodeId]);
  const activeNodeId = useArborLearnStore((state) => state.activeNodeId);
  const setActiveNode = useArborLearnStore((state) => state.setActiveNode);
  const toggleNode = useArborLearnStore((state) => state.toggleNode);
  const renameNode = useArborLearnStore((state) => state.renameNode);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: nodeId });
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({ id: nodeId });
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [shareDialogUrl, setShareDialogUrl] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shareInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isRenaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  useEffect(() => {
    if (!shareDialogUrl) return;
    window.setTimeout(() => {
      shareInputRef.current?.focus();
      shareInputRef.current?.select();
    }, 0);
  }, [shareDialogUrl]);

  useEffect(() => {
    if (!shareFeedback) return;
    const timer = window.setTimeout(() => setShareFeedback(""), 1600);
    return () => window.clearTimeout(timer);
  }, [shareFeedback]);

  if (!node) return null;
  const hasChildren = node.children.length > 0;

  const beginRename = () => {
    setDraftTitle(node.title);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== node.title) {
      renameNode(node.id, nextTitle);
    }
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setDraftTitle(node.title);
    setIsRenaming(false);
  };

  const shareNode = async () => {
    const shareUrl = window.location.href;
    const shareData = { title: node.title, text: node.summary || node.title, url: shareUrl };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setShareFeedback("链接已复制");
        return;
      } catch {
        // Fall through to the HTTP-friendly copy path.
      }
    }
    if (copyTextWithSelection(shareUrl)) {
      setShareFeedback("链接已复制");
      return;
    }
    onOpenMenuChange(node.id, false);
    setShareDialogUrl(shareUrl);
  };

  return (
    <div ref={setDropRef}>
      <div
        ref={setDragRef}
        data-tour-tree-node={node.title}
        style={{ transform: CSS.Translate.toString(transform), paddingLeft: 8 + depth * 14 }}
        className={cn(
          "tl-tree-item group relative z-10 flex min-h-9 items-center gap-1 rounded-lg pr-1 text-sm before:absolute before:left-1 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0",
          activeNodeId === node.id ? "tl-tree-item-active font-medium text-foreground before:opacity-100" : "",
          isOver && "ring-2 ring-primary/35",
        )}
      >
        <button
          className="tl-hover flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition group-hover:text-primary"
          onClick={() => (hasChildren ? toggleNode(node.id) : setActiveNode(node.id))}
          aria-label="展开或折叠节点"
        >
          {hasChildren ? (
            node.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <Circle className="h-2.5 w-2.5 fill-current" />
          )}
        </button>

        {isRenaming ? (
          <input
            ref={inputRef}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") cancelRename();
            }}
            className="tl-input min-w-0 flex-1 rounded border px-1.5 py-1 text-sm outline-none ring-2 ring-primary/15"
          />
        ) : (
          <button className="min-w-0 flex-1 truncate text-left transition group-hover:translate-x-0.5" onClick={() => setActiveNode(node.id)}>
            {node.title}
          </button>
        )}

        <Popover.Root open={openMenuId === node.id} onOpenChange={(open) => onOpenMenuChange(node.id, open)}>
          <Popover.Trigger asChild>
            <button
              className="tl-hover tl-reveal-actions flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              aria-label="打开节点菜单"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="right" align="start" className="tl-panel z-50 w-40 rounded-xl border p-1 text-sm shadow-panel">
              <button className="tl-hover flex w-full items-center gap-2 rounded px-2 py-2 text-left" onClick={beginRename}>
                <Pencil className="h-4 w-4" />
                重命名
              </button>
              <button className="tl-hover flex w-full items-center gap-2 rounded px-2 py-2 text-left" onClick={() => void shareNode()}>
                <Share2 className="h-4 w-4" />
                <span>分享</span>
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                onClick={() => {
                  onOpenMenuChange(node.id, false);
                  onRequestDelete(node.id, node.title);
                }}
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <button
          className="hidden h-7 w-5 shrink-0 items-center justify-center opacity-0 transition group-hover:flex group-hover:opacity-100"
          aria-label="拖拽节点"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {node.expanded && (
        <div className="mt-1 space-y-1">
          {node.children.map((childId) => (
            <TreeItem
              key={childId}
              nodeId={childId}
              depth={depth + 1}
              onRequestDelete={onRequestDelete}
              openMenuId={openMenuId}
              onOpenMenuChange={onOpenMenuChange}
            />
          ))}
        </div>
      )}

      {shareDialogUrl && typeof document !== "undefined" &&
        createPortal(
          <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold">分享链接</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    当前浏览器不支持自动复制，请手动复制下面的链接。
                  </p>
                </div>
                <button className="tl-hover rounded-full p-2" onClick={() => setShareDialogUrl(null)} aria-label="关闭分享链接">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                ref={shareInputRef}
                className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={shareDialogUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => shareInputRef.current?.select()}>
                  选中链接
                </Button>
                <Button size="sm" onClick={() => setShareDialogUrl(null)}>
                  完成
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {shareFeedback && typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[120] flex justify-center px-4">
            <div className="tl-panel rounded-full border px-4 py-2 text-sm font-medium shadow-panel">
              {shareFeedback}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function MiniKnowledgeMap({
  nodes,
  rootId,
  activeNodeId,
  compareNodeId,
}: {
  nodes: ArborNodes;
  rootId: string;
  activeNodeId: string;
  compareNodeId: string | null;
}) {
  const diagram = useMemo(() => buildDiagram(nodes, rootId), [nodes, rootId]);
  const previewWidth = 300;
  const previewHeight = 132;
  const scale = Math.min(previewWidth / diagram.width, previewHeight / diagram.height);
  const offsetX = (previewWidth - diagram.width * scale) / 2;
  const offsetY = (previewHeight - diagram.height * scale) / 2;
  const highlightedIds = new Set([activeNodeId, ...(compareNodeId ? [compareNodeId] : [])]);
  const denseMap = diagram.nodes.length >= 18 || scale < 0.42;
  const safeScale = Math.max(scale, 0.01);
  const activePointRadius = denseMap ? Math.min(30, Math.max(18, 7.2 / safeScale)) : 18;
  const comparedPointRadius = denseMap ? Math.min(28, Math.max(18, 6.4 / safeScale)) : 18;
  const activeRingRadius = denseMap ? Math.min(44, Math.max(27, 12 / safeScale)) : 27;
  const comparedRingRadius = denseMap ? Math.min(40, Math.max(23, 10 / safeScale)) : 23;

  if (diagram.nodes.length === 0) return null;

  return (
    <div className="tl-mini-map mx-3 mb-3 rounded-xl border" aria-label="笔记本节点缩略图">
      <svg viewBox={`0 0 ${previewWidth} ${previewHeight}`} role="img" aria-hidden="true">
        <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
          <g className="tl-mini-map-links">
            {diagram.links.map((link) => {
              const hot = Array.from(highlightedIds).some((fromId) =>
                Array.from(highlightedIds).some((toId) => link.id === `${fromId}-${toId}` || link.id === `${toId}-${fromId}`),
              );
              return (
                <path
                  key={link.id}
                  d={linkPath({
                    ...link,
                    fromX: link.fromX + DIAGRAM_PADDING,
                    fromY: link.fromY + DIAGRAM_PADDING,
                    toX: link.toX + DIAGRAM_PADDING,
                    toY: link.toY + DIAGRAM_PADDING,
                  })}
                  fill="none"
                  className={hot ? "is-active" : undefined}
                />
              );
            })}
          </g>
          <g>
            {diagram.nodes.map((diagramNode) => {
              const active = diagramNode.id === activeNodeId;
              const compared = compareNodeId === diagramNode.id;
              const highlighted = active || compared;
              const x = DIAGRAM_PADDING + diagramNode.x + DIAGRAM_NODE_WIDTH / 2;
              const y = DIAGRAM_PADDING + diagramNode.y + DIAGRAM_NODE_HEIGHT / 2;
              return (
                <g key={diagramNode.id}>
                  {highlighted && (
                    <circle
                      cx={x}
                      cy={y}
                      r={active ? activeRingRadius : comparedRingRadius}
                      className={cn("tl-mini-map-highlight-ring", active && "is-active")}
                      vectorEffect={denseMap ? "non-scaling-stroke" : undefined}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={active ? activePointRadius : compared ? comparedPointRadius : 12}
                    fill="var(--tl-mini-map-node)"
                    className={cn("tl-mini-map-point", highlighted && "is-highlighted", active && "is-active")}
                    vectorEffect={highlighted && denseMap ? "non-scaling-stroke" : undefined}
                  />
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}

export function KnowledgeTree({
  themeMode,
  onThemeChange,
  onHome,
  user,
  onLogout,
  onRequestAuth,
  demoUpgradeLocked = false,
  onRequireDemoUpgrade,
  view,
  onViewChange,
}: KnowledgeTreeProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const activeNodeId = useArborLearnStore((state) => state.activeNodeId);
  const compareNodeId = useArborLearnStore((state) => state.compareNodeId);
  const moveNode = useArborLearnStore((state) => state.moveNode);
  const createChildNodeUnderActive = useArborLearnStore((state) => state.createChildNodeUnderActive);
  const deleteNode = useArborLearnStore((state) => state.deleteNode);
  const toggleSidebar = useArborLearnStore((state) => state.toggleSidebar);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [exportHintVisible, setExportHintVisible] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const notebookRootId = getNotebookRootId(nodes, activeNodeId);
  const nodeCount = countSubtreeNodes(nodes, notebookRootId);
  const notebookTitle = nodes[notebookRootId]?.title ?? "ArborLearn";

  const showExportHint = () => {
    setExportHintVisible(true);
    window.setTimeout(() => setExportHintVisible(false), 2400);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    moveNode(String(event.active.id), String(event.over.id));
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteNode(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleCreateChildNode = () => {
    if (demoUpgradeLocked) {
      onRequireDemoUpgrade?.();
      return;
    }
    createChildNodeUnderActive();
  };

  return (
    <>
      <aside className="tl-knowledge-tree tl-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border">
        <div className="tl-knowledge-tree-header tl-border-soft border-b bg-background/30 p-3 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="tl-gpt-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                onClick={onHome}
                title="返回笔记本列表"
                aria-label="返回笔记本列表"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{notebookTitle}</p>
                <p className="text-xs text-muted-foreground">{nodeCount} 个对话节点</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="收起节点栏">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            <div className="tl-sidebar-view-switch">
              <button
                type="button"
                data-tour-view-switch="chat"
                className={cn("tl-sidebar-action", view === "chat" && "is-active")}
                onClick={() => onViewChange("chat")}
              >
                <MessageSquareText className="h-4 w-4" />
                对话
              </button>
              <button
                type="button"
                data-tour-view-switch="diagram"
                className={cn("tl-sidebar-action", view === "diagram" && "is-active")}
                onClick={() => onViewChange("diagram")}
              >
                <GitBranch className="h-4 w-4" />
                思维导图
              </button>
            </div>
            <Button className="tl-sidebar-action w-full justify-start" variant="ghost" size="sm" title="导出 .tree" onClick={showExportHint}>
              <Download className="h-4 w-4" />
              导出
            </Button>
            {exportHintVisible && (
              <p className="rounded-lg border border-primary/20 bg-primary/8 px-3 py-2 text-xs leading-5 text-primary">
                此功能正在开发中，敬请期待！
              </p>
            )}
            <Button className="tl-sidebar-action w-full justify-start" variant="ghost" size="sm" onClick={handleCreateChildNode}>
              <Plus className="h-4 w-4" />
              添加对话节点
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="relative space-y-1 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-border/70">
              {nodes[notebookRootId] && (
                <TreeItem
                  key={notebookRootId}
                  nodeId={notebookRootId}
                  depth={0}
                  onRequestDelete={(nodeId, title) => setDeleteTarget({ id: nodeId, title })}
                  openMenuId={openMenuId}
                  onOpenMenuChange={(nodeId, open) => setOpenMenuId(open ? nodeId : null)}
                />
              )}
            </div>
          </DndContext>
        </div>

        <MiniKnowledgeMap nodes={nodes} rootId={notebookRootId} activeNodeId={activeNodeId} compareNodeId={compareNodeId} />

        <div className="tl-sidebar-account border-t border-border/60 p-3">
          <AccountMenu
            user={user}
            themeMode={themeMode}
            onThemeChange={onThemeChange}
            onLogout={onLogout}
            onRequestAuth={onRequestAuth}
            triggerVariant="row"
            contentAlign="start"
            submenuSide="right"
          />
        </div>
      </aside>

      {deleteTarget && typeof document !== "undefined" &&
        createPortal(
          <div className="tl-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">删除对话节点？</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    “{deleteTarget.title}”及其所有子对话都会被删除。此操作当前无法撤销。
                  </p>
                </div>
                <button className="rounded-full p-1 hover:bg-muted" onClick={() => setDeleteTarget(null)} aria-label="关闭">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                  取消
                </Button>
                <Button variant="danger" onClick={confirmDelete}>
                  删除
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
