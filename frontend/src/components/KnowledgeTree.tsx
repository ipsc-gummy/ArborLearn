import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  ArrowLeft,
  Download,
  GitBranch,
  GripVertical,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useArborLearnStore } from "../store/arborlearnStore";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { SettingsMenu, type ThemeMode } from "./AppMenus";

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
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}

type WorkspaceView = "chat" | "diagram";

// 给任意节点向上追溯到根节点，确保左侧只展示当前笔记本内的树。
function getNotebookRootId(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"], nodeId: string) {
  let current = nodes[nodeId];
  while (current?.parentId) {
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

// 统计当前笔记本内节点数量，用于左侧标题区域展示。
function countSubtreeNodes(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"], nodeId: string): number {
  const node = nodes[nodeId];
  if (!node) return 0;
  return 1 + node.children.reduce((total, childId) => total + countSubtreeNodes(nodes, childId), 0);
}

// 树中的单个节点行：负责展开折叠、选中、重命名、置顶、删除和拖拽入口。
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // 进入重命名状态后自动聚焦并全选标题，减少用户编辑成本。
    if (!isRenaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  if (!node) return null;
  const hasChildren = node.children.length > 0;

  const beginRename = () => {
    setDraftTitle(node.title);
    setIsRenaming(true);
  };

  const shareNode = async () => {
    const shareUrl = window.location.href;
    const shareData = {
      title: node.title,
      text: node.summary || node.title,
      url: shareUrl,
    };
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard?.writeText(shareUrl);
  };

  const commitRename = () => {
    // 空标题不提交，标题没变化也不触发 store 更新。
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

  return (
    <div ref={setDropRef}>
      <div
        ref={setDragRef}
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
                分享
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
    </div>
  );
}

export function KnowledgeTree({ themeMode, onThemeChange, onHome, view, onViewChange }: KnowledgeTreeProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const activeNodeId = useArborLearnStore((state) => state.activeNodeId);
  const moveNode = useArborLearnStore((state) => state.moveNode);
  const createChildNodeUnderActive = useArborLearnStore((state) => state.createChildNodeUnderActive);
  const deleteNode = useArborLearnStore((state) => state.deleteNode);
  const toggleSidebar = useArborLearnStore((state) => state.toggleSidebar);
  const user = useArborLearnStore((state) => state.user);
  const logout = useArborLearnStore((state) => state.logout);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const notebookRootId = getNotebookRootId(nodes, activeNodeId);
  const nodeCount = countSubtreeNodes(nodes, notebookRootId);
  const notebookTitle = nodes[notebookRootId]?.title ?? "ArborLearn";
  const userInitial = (user?.displayName || user?.email || "U").slice(0, 1).toUpperCase();

  const handleDragEnd = (event: DragEndEvent) => {
    // dnd-kit 的 over 是拖拽释放时命中的节点，把 active 节点移动到 over 节点下面。
    if (!event.over || event.active.id === event.over.id) return;
    moveNode(String(event.active.id), String(event.over.id));
  };

  const confirmDelete = () => {
    // 真正删除前先经过确认弹窗，避免误删整棵子树。
    if (!deleteTarget) return;
    deleteNode(deleteTarget.id);
    setDeleteTarget(null);
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
          <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="收起 Nodes">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          <div className="tl-sidebar-view-switch">
            <button
              type="button"
              className={cn("tl-sidebar-action", view === "chat" && "is-active")}
              onClick={() => onViewChange("chat")}
            >
              <MessageSquareText className="h-4 w-4" />
              对话
            </button>
            <button
              type="button"
              className={cn("tl-sidebar-action", view === "diagram" && "is-active")}
              onClick={() => onViewChange("diagram")}
            >
              <GitBranch className="h-4 w-4" />
              思维导图
            </button>
          </div>
          <Button className="tl-sidebar-action w-full justify-start" variant="ghost" size="sm" title="导出 .tree">
            <Download className="h-4 w-4" />
            导出
          </Button>
          <Button className="tl-sidebar-action w-full justify-start" variant="ghost" size="sm" onClick={createChildNodeUnderActive}>
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

      <div className="tl-sidebar-account border-t border-border/60 p-3">
        <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
            {userInitial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.displayName || "用户"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email || ""}</p>
          </div>
          <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
          <button className="tl-gpt-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full" onClick={logout} title="退出账号" aria-label="退出账号">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
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
