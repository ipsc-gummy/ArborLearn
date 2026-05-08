import { useEffect, useRef, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  GripVertical,
  PanelLeftClose,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

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

// 给任意节点向上追溯到根节点，确保左侧只展示当前笔记本内的树。
function getNotebookRootId(nodes: ReturnType<typeof useTreeLearnStore.getState>["nodes"], nodeId: string) {
  let current = nodes[nodeId];
  while (current?.parentId) {
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

// 统计当前笔记本内节点数量，用于左侧标题区域展示。
function countSubtreeNodes(nodes: ReturnType<typeof useTreeLearnStore.getState>["nodes"], nodeId: string): number {
  const node = nodes[nodeId];
  if (!node) return 0;
  return 1 + node.children.reduce((total, childId) => total + countSubtreeNodes(nodes, childId), 0);
}

// 树中的单个节点行：负责展开折叠、选中、重命名、置顶、删除和拖拽入口。
function TreeItem({ nodeId, depth, onRequestDelete, openMenuId, onOpenMenuChange }: TreeItemProps) {
  const node = useTreeLearnStore((state) => state.nodes[nodeId]);
  const pinnedRootIds = useTreeLearnStore((state) => state.pinnedRootIds);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const setActiveNode = useTreeLearnStore((state) => state.setActiveNode);
  const toggleNode = useTreeLearnStore((state) => state.toggleNode);
  const renameNode = useTreeLearnStore((state) => state.renameNode);
  const togglePinRoot = useTreeLearnStore((state) => state.togglePinRoot);
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
  const isRootConversation = node.parentId === null;
  const isPinned = pinnedRootIds.includes(node.id);

  const shareNode = async () => {
    // 当前分享先复制节点元信息；后续可以替换为后端分享链接或 .tree 导出。
    const payload = JSON.stringify(
      {
        id: node.id,
        title: node.title,
        summary: node.summary,
        kind: node.kind,
        contextWeight: node.contextWeight,
      },
      null,
      2,
    );
    await navigator.clipboard?.writeText(payload);
  };

  const beginRename = () => {
    setDraftTitle(node.title);
    setIsRenaming(true);
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
          "group flex min-h-9 items-center gap-1 rounded-full pr-1 text-sm transition",
          activeNodeId === node.id ? "tl-accent-soft font-medium text-foreground" : "tl-hover",
          isOver && "ring-2 ring-primary/35",
        )}
      >
        <button
          className="tl-hover flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
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
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => setActiveNode(node.id)}>
            {isPinned && isRootConversation && <Pin className="mr-1 inline h-3 w-3" />}
            {node.title}
          </button>
        )}

        <Popover.Root open={openMenuId === node.id} onOpenChange={(open) => onOpenMenuChange(node.id, open)}>
          <Popover.Trigger asChild>
            <button
              className="tl-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-70 transition hover:opacity-100"
              aria-label="打开节点菜单"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="right" align="start" className="tl-panel z-50 w-40 rounded-xl border p-1 text-sm shadow-panel">
              <button className="tl-hover flex w-full items-center gap-2 rounded px-2 py-2 text-left" onClick={shareNode}>
                <Share2 className="h-4 w-4" />
                分享
              </button>
              <button className="tl-hover flex w-full items-center gap-2 rounded px-2 py-2 text-left" onClick={beginRename}>
                <Pencil className="h-4 w-4" />
                重命名
              </button>
              {isRootConversation && (
                <button
                  className="tl-hover flex w-full items-center gap-2 rounded px-2 py-2 text-left"
                  onClick={() => togglePinRoot(node.id)}
                >
                  <Pin className="h-4 w-4" />
                  {isPinned ? "取消置顶" : "置顶聊天"}
                </button>
              )}
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

export function KnowledgeTree() {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const moveNode = useTreeLearnStore((state) => state.moveNode);
  const createChildNodeUnderActive = useTreeLearnStore((state) => state.createChildNodeUnderActive);
  const deleteNode = useTreeLearnStore((state) => state.deleteNode);
  const toggleSidebar = useTreeLearnStore((state) => state.toggleSidebar);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const notebookRootId = getNotebookRootId(nodes, activeNodeId);
  const nodeCount = countSubtreeNodes(nodes, notebookRootId);

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
    <aside className="tl-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border">
      <div className="tl-border-soft border-b p-3">
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <div>
            <p className="text-sm font-medium">Nodes</p>
            <p className="text-xs text-muted-foreground">{nodeCount} 个对话节点</p>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="收起 Nodes">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <Button className="w-full" size="sm" onClick={createChildNodeUnderActive}>
          <Plus className="h-4 w-4" />
          添加对话节点
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="space-y-1">
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

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="tl-panel w-full max-w-md rounded-xl border p-5 shadow-panel">
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
        </div>
      )}
    </aside>
  );
}
