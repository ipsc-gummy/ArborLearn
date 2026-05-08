import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  BookOpen,
  FileText,
  GitBranch,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AccountMenu, SettingsMenu, type ThemeMode } from "./AppMenus";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";

interface NotebookDashboardProps {
  onOpenNotebook: (nodeId: string) => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

interface DeleteTarget {
  id: string;
  title: string;
}

type SortMode = "recent" | "title";

// 首页/笔记本仪表盘：负责创建、排序、重命名、删除和进入 TreeLearn 笔记本。
export function NotebookDashboard({
  onOpenNotebook,
  themeMode,
  onThemeChange,
  isLoggedIn,
  onLogin,
  onLogout,
}: NotebookDashboardProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const rootIds = useTreeLearnStore((state) => state.rootIds);
  const pinnedRootIds = useTreeLearnStore((state) => state.pinnedRootIds);
  const createRootConversation = useTreeLearnStore((state) => state.createRootConversation);
  const renameNode = useTreeLearnStore((state) => state.renameNode);
  const deleteNode = useTreeLearnStore((state) => state.deleteNode);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // 置顶列表和普通列表都复用同一套排序逻辑，避免置顶项被普通项打散。
  const sortRootIds = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const nodeA = nodes[a];
      const nodeB = nodes[b];
      if (!nodeA || !nodeB) return 0;
      if (sortMode === "title") {
        return nodeA.title.localeCompare(nodeB.title, "zh-Hans-CN");
      }
      return new Date(nodeB.updatedAt).getTime() - new Date(nodeA.updatedAt).getTime();
    });
  const orderedRootIds = [
    ...sortRootIds(pinnedRootIds.filter((id) => rootIds.includes(id))),
    ...sortRootIds(rootIds.filter((id) => !pinnedRootIds.includes(id))),
  ];

  useEffect(() => {
    // 开始编辑标题时自动聚焦输入框，提交逻辑由 blur/Enter 统一处理。
    if (!editingId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingId]);

  const handleCreateNotebook = () => {
    // 创建根节点后立即打开工作区，让用户从新笔记本继续学习。
    const id = createRootConversation();
    onOpenNotebook(id);
  };

  const beginRename = (id: string, title: string) => {
    setOpenMenuId(null);
    setEditingId(id);
    setEditingTitle(title);
  };

  const commitRename = () => {
    // 和左侧树保持一致：空标题不保存，未变化不写入 store。
    if (!editingId) return;
    const nextTitle = editingTitle.trim();
    if (nextTitle && nextTitle !== nodes[editingId]?.title) {
      renameNode(editingId, nextTitle);
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteNode(deleteTarget.id);
    setDeleteTarget(null);
  };

  const beginDelete = (id: string, title: string) => {
    // 先保存待删除目标，交给底部的确认弹窗执行真正删除。
    setOpenMenuId(null);
    setDeleteTarget({ id, title });
  };

  return (
    <main className="tl-app-bg min-h-screen overflow-auto text-foreground">
      <header className="tl-app-bg-elevated tl-border sticky top-0 z-20 border-b px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="tl-panel flex h-9 w-9 items-center justify-center rounded-full border">
              <GitBranch className="tl-brand h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-medium">TreeLearn</h1>
              <p className="text-xs text-muted-foreground">面向知识学习的树形上下文工作台</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
            <AccountMenu isLoggedIn={isLoggedIn} onLogin={onLogin} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="tl-panel rounded-2xl border p-7">
            <div className="mb-7 max-w-3xl">
              <p className="tl-accent-soft mb-3 inline-flex rounded-full px-3 py-1 text-xs font-medium text-foreground">
                Nodes / Chat / Tree Diagram
              </p>
              <h2 className="text-3xl font-medium leading-tight md:text-4xl">
                把资料变成可展开、可追问、可复盘的学习笔记本
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                先为论文、课件或技术文档创建一个独立 TreeLearn 笔记本，再进入树形对话空间管理主线、支线和上下文调度。
              </p>
            </div>

            <div className="tl-input flex max-w-2xl items-center gap-2 rounded-full border px-4 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                className="h-9 flex-1 bg-transparent text-sm outline-none"
                placeholder="搜索已有学习笔记本、资料主题或分支..."
              />
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <FeatureTile icon={FileText} title="导入资料" description="论文、PPT、文档与网页资料入口" />
              <FeatureTile icon={MessageSquareText} title="基于资料提问" description="围绕当前笔记本进行 grounded chat" />
              <FeatureTile icon={Sparkles} title="生成复习产物" description="同步树形思维导图便于复盘" />
            </div>
          </div>

          <aside className="tl-panel rounded-2xl border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium">快速开始</h3>
                <p className="text-xs text-muted-foreground">NotebookLM 式入口，先选项目再工作</p>
              </div>
              <BookOpen className="tl-brand h-5 w-5" />
            </div>
            <div className="space-y-3">
              <QuickAction title="1. 创建笔记本" description="为一次学习任务建立独立上下文容器。" />
              <QuickAction title="2. 添加资料或问题" description="后续可接入上传、网页、PPT 和 .tree 导入。" />
              <QuickAction title="3. 进入树形对话" description="在主线和支线间分配不同上下文范围。" />
            </div>
          </aside>
        </div>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">我的 TreeLearn 笔记本</h3>
              <p className="text-sm text-muted-foreground">每个主对话都是一个独立学习空间</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="tl-input hidden items-center rounded-full border p-0.5 text-xs sm:flex">
                <button
                  className={cn(
                    "h-8 rounded-full px-3 font-medium text-muted-foreground transition hover:bg-muted",
                    sortMode === "recent" && "bg-foreground text-background hover:bg-foreground",
                  )}
                  onClick={() => setSortMode("recent")}
                >
                  最近
                </button>
                <button
                  className={cn(
                    "h-8 rounded-full px-3 font-medium text-muted-foreground transition hover:bg-muted",
                    sortMode === "title" && "bg-foreground text-background hover:bg-foreground",
                  )}
                  onClick={() => setSortMode("title")}
                >
                  标题
                </button>
              </div>
              <Button
                variant="primary"
                onClick={handleCreateNotebook}
                className="border-[#202124] bg-[#202124] text-white hover:bg-[#3c4043] dark:border-[#f1f3f4] dark:bg-[#f1f3f4] dark:text-[#202124] dark:hover:bg-white"
              >
                <Plus className="h-4 w-4" />
                新建 TreeLearn 笔记本
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <button
              className="tl-panel tl-hover flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center transition hover:border-primary"
              onClick={handleCreateNotebook}
            >
              <div className="tl-brand-soft-bg mb-3 flex h-11 w-11 items-center justify-center rounded-full">
                <Plus className="h-5 w-5" />
              </div>
              <span className="font-medium">新建笔记本</span>
              <span className="mt-1 text-sm text-muted-foreground">开始一段新的树形学习</span>
            </button>

            {orderedRootIds.map((id) => {
              const node = nodes[id];
              if (!node) return null;
              const isPinned = pinnedRootIds.includes(id);
              const isEditing = editingId === id;
              return (
                <div
                  key={id}
                  className="tl-panel relative min-h-40 rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/45"
                >
                  {!isEditing && (
                    <button className="absolute inset-0 rounded-2xl" aria-label={`打开 ${node.title}`} onClick={() => onOpenNotebook(id)} />
                  )}
                  <Popover.Root open={openMenuId === id} onOpenChange={(open) => setOpenMenuId(open ? id : null)}>
                    <Popover.Trigger asChild>
                      <button
                        className="tl-hover absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full"
                        aria-label="打开笔记本菜单"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        side="bottom"
                        align="end"
                        className="tl-panel z-50 w-36 rounded-xl border p-1 text-sm shadow-panel"
                      >
                        <button
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted"
                          onClick={() => beginRename(id, node.title)}
                        >
                          <Pencil className="h-4 w-4" />
                          修改标题
                        </button>
                        <button
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                          onClick={() => beginDelete(id, node.title)}
                        >
                          <Trash2 className="h-4 w-4" />
                          删除
                        </button>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>

                  <div className="pointer-events-none mb-4 flex items-start justify-between gap-3 pr-8">
                    <div className="tl-brand-soft-bg flex h-10 w-10 items-center justify-center rounded-full">
                      <GitBranch className="tl-brand h-5 w-5" />
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-[11px]",
                        isPinned ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isPinned ? "已置顶" : `${node.children.length} 分支`}
                    </span>
                  </div>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") cancelRename();
                      }}
                      className="tl-input relative z-10 w-full rounded-md border px-2 py-1 text-sm font-semibold outline-none ring-2 ring-primary/15"
                    />
                  ) : (
                    <h4 className="pointer-events-none line-clamp-1 font-medium">{node.title}</h4>
                  )}
                  <p className="pointer-events-none mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{node.summary}</p>
                </div>
              );
            })}
          </div>
        </section>
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="tl-panel w-full max-w-md rounded-xl border p-5 shadow-panel">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">删除笔记本？</h3>
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
    </main>
  );
}

function FeatureTile({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  // 顶部功能卡片只做能力提示，不承载业务状态。
  return (
    <div className="tl-panel-soft rounded-xl border p-4">
      <Icon className="tl-brand mb-3 h-5 w-5" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function QuickAction({ title, description }: { title: string; description: string }) {
  // 快速开始步骤用于引导当前 mock 阶段的产品路径。
  return (
    <div className="tl-panel-soft rounded-xl border p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
