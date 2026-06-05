import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  LayoutGrid,
  List,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AccountMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import { Button } from "./ui/button";
import { useArborLearnStore } from "../store/arborlearnStore";
import { cn } from "../lib/utils";
import {
  DIAGRAM_NODE_HEIGHT,
  DIAGRAM_NODE_WIDTH,
  DIAGRAM_PADDING,
  buildDiagram,
  linkPath,
} from "../lib/diagramLayout";
import type { AuthUser } from "../lib/api";
import type { KnowledgeNode } from "../types/arborlearn";

interface NotebookDashboardProps {
  onOpenNotebook: (nodeId: string) => void;
  onOpenMonitoring?: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  user: AuthUser | null;
  authStatus: "checking" | "authenticated" | "anonymous" | "error";
  authError: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName?: string) => Promise<void>;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
  demoUpgradeLocked?: boolean;
  onRequireDemoUpgrade?: () => void;
}

interface DeleteTarget {
  id: string;
  title: string;
}

type SortMode = "recent" | "title";
type ViewMode = "grid" | "list";
const NOTEBOOK_VIEW_MODE_KEY = "arborlearn.notebookViewMode";

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-Hans-CN");
}

function formatNotebookUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近编辑时间未知";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "最近编辑 刚刚";
  if (diffMs < hour) return `最近编辑 ${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `最近编辑 ${Math.floor(diffMs / hour)} 小时前`;
  return `最近编辑 ${date.toLocaleDateString("zh-Hans-CN", {
    month: "short",
    day: "numeric",
  })}`;
}

function formatNotebookDate(value: string | undefined) {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleDateString("zh-Hans-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getNotebookCreatedAt(node: KnowledgeNode) {
  const messageTimes = node.messages
    .map((message) => message.createdAt)
    .filter((value) => !Number.isNaN(new Date(value).getTime()));
  return messageTimes[0] ?? node.updatedAt;
}

const sortModeLabel: Record<SortMode, string> = {
  recent: "最近",
  title: "标题",
};

function getStoredNotebookViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(NOTEBOOK_VIEW_MODE_KEY);
    return saved === "list" || saved === "grid" ? saved : "grid";
  } catch {
    return "grid";
  }
}

function saveNotebookViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(NOTEBOOK_VIEW_MODE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory view selection still applies.
  }
}

function collectNotebookSearchText(nodes: Record<string, KnowledgeNode>, rootId: string) {
  const visited = new Set<string>();
  const textParts: string[] = [];

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodes[nodeId];
    if (!node) return;

    textParts.push(node.title, node.summary, node.selectedText ?? "");
    node.children.forEach(visit);
  };

  visit(rootId);
  return normalizeSearchText(textParts.join(" "));
}

// 首页/笔记本仪表盘：负责创建、排序、重命名、删除和进入 ArborLearn 笔记本。
export function NotebookDashboard({
  onOpenNotebook,
  onOpenMonitoring,
  themeMode,
  onThemeChange,
  user,
  authStatus,
  authError,
  onLogin,
  onRegister,
  onLogout,
  onRequestAuth,
  demoUpgradeLocked = false,
  onRequireDemoUpgrade,
}: NotebookDashboardProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const rootIds = useArborLearnStore((state) => state.rootIds);
  const pinnedRootIds = useArborLearnStore((state) => state.pinnedRootIds);
  const createRootConversation = useArborLearnStore((state) => state.createRootConversation);
  const renameNode = useArborLearnStore((state) => state.renameNode);
  const togglePinRoot = useArborLearnStore((state) => state.togglePinRoot);
  const deleteNode = useArborLearnStore((state) => state.deleteNode);
  const isLoggedIn = Boolean(user);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [viewMode, setViewModeState] = useState<ViewMode>(getStoredNotebookViewMode);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
  const normalizedSearchKeyword = normalizeSearchText(searchKeyword);
  const filteredRootIds = normalizedSearchKeyword
    ? orderedRootIds.filter((id) => collectNotebookSearchText(nodes, id).includes(normalizedSearchKeyword))
    : orderedRootIds;
  const hasSearchKeyword = normalizedSearchKeyword.length > 0;
  const hasSearchResults = filteredRootIds.length > 0;

  useEffect(() => {
    // 开始编辑标题时自动聚焦输入框，提交逻辑由 blur/Enter 统一处理。
    if (!editingId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingId]);

  useEffect(() => {
    if (!isSearchOpen) return;
    searchInputRef.current?.focus();
  }, [isSearchOpen]);

  const handleCreateNotebook = () => {
    if (!isLoggedIn) {
      onRequestAuth("login");
      return;
    }
    if (demoUpgradeLocked) {
      onRequireDemoUpgrade?.();
      return;
    }
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

  const handleTogglePin = (id: string) => {
    setOpenMenuId(null);
    togglePinRoot(id);
  };

  const openFirstSearchResult = () => {
    if (!hasSearchKeyword || !filteredRootIds[0]) return;
    onOpenNotebook(filteredRootIds[0]);
  };

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    saveNotebookViewMode(mode);
  };

  return (
    <main className="tl-app-bg tl-notebooks-page relative min-h-screen overflow-auto text-foreground">
      <div className="tl-notebooks-forest-bg" aria-hidden="true">
        <div className="tl-notebooks-aurora tl-notebooks-aurora-main" />
        <div className="tl-notebooks-aurora tl-notebooks-aurora-soft" />
        <div className="tl-notebooks-mist" />
        <div className="tl-notebooks-plant" />
        <div className="tl-notebooks-glow tl-notebooks-glow-a" />
        <div className="tl-notebooks-glow tl-notebooks-glow-b" />
        <div className="tl-notebooks-glow tl-notebooks-glow-c" />
        <div className="tl-notebooks-glow tl-notebooks-glow-d" />
        <div className="tl-notebooks-glow tl-notebooks-glow-e" />
        <div className="tl-notebooks-glow tl-notebooks-glow-f" />
        <div className="tl-notebooks-spark-field" />
      </div>
      <header className="tl-app-bg-elevated tl-border sticky top-0 z-20 border-b px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="tl-panel flex h-10 w-10 items-center justify-center rounded-full border ring-1 ring-white/45">
              <GitBranch className="tl-brand h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-medium">ArborLearn</h1>
              <p className="text-xs text-muted-foreground">面向知识学习的树形上下文工作台</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AccountMenu
              user={user}
              themeMode={themeMode}
              onThemeChange={onThemeChange}
              onLogout={onLogout}
              onRequestAuth={onRequestAuth}
              submenuSide="left"
            />
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-8 pt-14 md:pt-20">
        <div className="hidden">
          <div className="relative overflow-visible rounded-none border-0 bg-transparent p-0">
            <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[color-mix(in_srgb,var(--tl-brand)_18%,transparent)] blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 right-10 h-24 w-48 rounded-full bg-[color-mix(in_srgb,var(--tl-brand-3)_14%,transparent)] blur-2xl" />
            <div className="mb-7 max-w-4xl">
              <p className="tl-accent-soft mb-4 inline-flex rounded-full border border-white/45 px-3 py-1 text-xs font-medium text-foreground shadow-sm">
                Nodes / Chat / Tree Diagram
              </p>
              <h2 className="max-w-5xl text-4xl font-semibold leading-[1.05] tracking-normal md:text-6xl">
                把资料变成可展开、可追问、可复盘的学习笔记本
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                先为论文、课件或技术文档创建一个独立 ArborLearn 笔记本，再进入树形对话空间管理主线、支线和上下文调度。
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <FeatureTile icon={FileText} title="导入资料" description="论文、PPT、文档与网页资料入口" />
              <FeatureTile icon={MessageSquareText} title="基于资料提问" description="围绕当前笔记本进行 grounded chat" />
              <FeatureTile icon={Sparkles} title="生成复习产物" description="同步树形思维导图便于复盘" />
            </div>

            <HeroCanvasPreview />
          </div>

          <aside className="tl-panel relative overflow-hidden rounded-[1.35rem] border p-5">
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/65 to-transparent opacity-70 dark:via-white/14" />
            <div className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-[color-mix(in_srgb,var(--tl-brand-2)_14%,transparent)] blur-2xl" />
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

        <section className="mt-0">
          <div className="mb-4 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h3 className="tl-notebooks-title">
                我的 <span>ArborLearn</span> 笔记本
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">每个笔记本都是一个放大思考的空间</p>
              <div className="tl-notebooks-title-mark" aria-hidden="true" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={cn(
                  "tl-input tl-focus-ring flex h-9 items-center overflow-hidden rounded-full border transition-all duration-200",
                  isSearchOpen ? "w-44 px-3 shadow-md sm:w-64" : "w-9 justify-center px-0",
                )}
              >
                <button
                  className="tl-hover flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  onClick={() => setIsSearchOpen(true)}
                  aria-label="搜索笔记本"
                  title="搜索笔记本"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                </button>
                {isSearchOpen && (
                  <>
                    <input
                      ref={searchInputRef}
                      value={searchKeyword}
                      onChange={(event) => setSearchKeyword(event.target.value)}
                      onBlur={() => {
                        if (!searchKeyword.trim()) {
                          setIsSearchOpen(false);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          openFirstSearchResult();
                        }
                        if (event.key === "Escape") {
                          setSearchKeyword("");
                          setIsSearchOpen(false);
                        }
                      }}
                      className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
                      placeholder="搜索笔记本..."
                    />
                    {hasSearchKeyword && (
                      <button
                        className="tl-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSearchKeyword("");
                          searchInputRef.current?.focus();
                        }}
                        aria-label="清空搜索"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </>
                )}
              </div>
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button className="tl-input tl-hover flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium text-muted-foreground">
                    排序：{sortModeLabel[sortMode]}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-32 rounded-xl border p-1 text-sm shadow-panel">
                    {(["recent", "title"] as const).map((mode) => (
                      <button
                        key={mode}
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted"
                        onClick={() => setSortMode(mode)}
                      >
                        <span className="flex h-4 w-4 items-center justify-center">
                          {sortMode === mode && <Check className="h-3.5 w-3.5" />}
                        </span>
                        {sortModeLabel[mode]}
                      </button>
                    ))}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <div className="tl-input flex items-center rounded-full border p-0.5">
                <button
                  className={cn(
                    "tl-sort-option flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition",
                    viewMode === "grid" && "is-active",
                  )}
                  onClick={() => setViewMode("grid")}
                  aria-label="网格视图"
                  title="网格视图"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  className={cn(
                    "tl-sort-option flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition",
                    viewMode === "list" && "is-active",
                  )}
                  onClick={() => setViewMode("list")}
                  aria-label="列表视图"
                  title="列表视图"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
              <Button
                variant="primary"
                onClick={handleCreateNotebook}
                className="tl-notebook-primary-action"
              >
                <Plus className="h-4 w-4" />
                新建 ArborLearn 笔记本
              </Button>
              {user?.isAdmin && onOpenMonitoring && (
                <Button
                  variant="outline"
                  onClick={onOpenMonitoring}
                  className="tl-notebook-monitoring-action"
                >
                  <BarChart3 className="h-4 w-4" />
                  监控平台
                </Button>
              )}
            </div>
          </div>
          {hasSearchKeyword && (
            <div className="mb-4 text-sm text-muted-foreground">
              已为“{searchKeyword.trim()}”找到 {filteredRootIds.length} / {orderedRootIds.length} 个笔记本
            </div>
          )}

          {viewMode === "grid" && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <button
              className={cn(
                "tl-new-notebook-dropzone min-h-40 flex-col items-center justify-center rounded-[1.1rem] border border-dashed p-5 text-center",
                hasSearchKeyword ? "hidden" : "flex",
              )}
              onClick={handleCreateNotebook}
            >
              <div className="tl-new-notebook-plus mb-3 flex h-11 w-11 items-center justify-center rounded-full">
                <Plus className="h-5 w-5" />
              </div>
              <span className="font-medium">新建笔记本</span>
              <span className="mt-1 text-sm text-muted-foreground">
                {isLoggedIn ? "开始一段新的树形学习" : "请先登录或注册账号"}
              </span>
            </button>

            {filteredRootIds.map((id) => {
              const node = nodes[id];
              if (!node) return null;
              const isPinned = pinnedRootIds.includes(id);
              const isEditing = editingId === id;
              return (
                <div
                  key={id}
                  data-tour-notebook-title={node.title}
                  className="tl-notebook-page-card group relative min-h-[18.5rem] overflow-hidden rounded-[1.1rem] border p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-panel"
                >
                  {!isEditing && (
                    <button className="absolute inset-0 z-10 rounded-[1.2rem]" aria-label={`打开 ${node.title}`} onClick={() => onOpenNotebook(id)} />
                  )}
                  <div className="tl-notebook-page-rule" aria-hidden="true" />
                  <div className="relative z-20 flex items-start justify-between gap-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-semibold",
                        isPinned
                          ? "border-primary/24 bg-primary/10 text-primary"
                          : "border-border/70 bg-background/70 text-muted-foreground",
                      )}
                    >
                      {isPinned ? "已置顶" : `${node.children.length} 分支`}
                    </span>
                    <Popover.Root open={openMenuId === id} onOpenChange={(open) => setOpenMenuId(open ? id : null)}>
                      <Popover.Trigger asChild>
                        <button
                          className="tl-hover relative z-30 flex h-8 w-8 items-center justify-center rounded-full"
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
                            onClick={() => handleTogglePin(id)}
                          >
                            <Pin className="h-4 w-4" />
                            {isPinned ? "取消置顶" : "置顶"}
                          </button>
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
                  </div>
                  <p className="tl-notebook-page-summary pointer-events-none mt-4 line-clamp-3">
                    {node.summary || "从这个笔记本继续展开树形学习。"}
                  </p>
                  <NotebookCardThumbnail nodes={nodes} rootId={node.id} />
                  <div className="relative z-20 mt-4 min-w-0">
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
                        className="tl-input relative z-30 w-full rounded-md border px-2 py-1 text-base font-semibold leading-tight outline-none ring-2 ring-primary/15"
                      />
                    ) : (
                      <h4 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
                        {node.title}
                      </h4>
                    )}
                    <p className="tl-notebook-updated mt-1 text-xs font-medium">
                      {formatNotebookUpdatedAt(node.updatedAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          )}
          {viewMode === "list" && (
            <div className="overflow-hidden">
              <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_3rem] gap-4 border-b border-border/70 px-4 py-3 text-sm font-semibold text-foreground md:grid">
                <span>笔记本</span>
                <span>创建日期</span>
                <span>最近修改</span>
                <span className="sr-only">菜单</span>
              </div>
              <div className="divide-y divide-border/60">
                {filteredRootIds.map((id) => {
                  const node = nodes[id];
                  if (!node) return null;
                  const isPinned = pinnedRootIds.includes(id);
                  const isEditing = editingId === id;
                  const createdAt = getNotebookCreatedAt(node);
                  return (
                    <div
                      key={id}
                      className={cn(
                        "group relative grid min-h-16 grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5 md:grid-cols-[minmax(0,1fr)_9rem_9rem_3rem] md:gap-4",
                        !isEditing && "cursor-pointer",
                      )}
                      onClick={() => {
                        if (!isEditing) onOpenNotebook(id);
                      }}
                    >
                      <div className="relative z-10 flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary">
                          <BookOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          {isEditing ? (
                            <input
                              ref={editInputRef}
                              value={editingTitle}
                              onChange={(event) => setEditingTitle(event.target.value)}
                              onBlur={commitRename}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") commitRename();
                                if (event.key === "Escape") cancelRename();
                              }}
                              className="tl-input relative z-20 w-full rounded-md border px-2 py-1 text-sm font-semibold outline-none ring-2 ring-primary/15"
                            />
                          ) : (
                            <p className="truncate text-sm font-semibold">{node.title}</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground md:hidden">
                            创建 {formatNotebookDate(createdAt)} · 修改 {formatNotebookDate(node.updatedAt)}
                          </p>
                        </div>
                      </div>
                      <span className="relative z-10 hidden text-sm text-muted-foreground md:block">{formatNotebookDate(createdAt)}</span>
                      <span className="relative z-10 hidden text-sm text-muted-foreground md:block">{formatNotebookDate(node.updatedAt)}</span>
                      <Popover.Root open={openMenuId === id} onOpenChange={(open) => setOpenMenuId(open ? id : null)}>
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            className="tl-hover relative z-20 flex h-9 w-9 items-center justify-center rounded-full"
                            aria-label="打开笔记本菜单"
                            onClick={(event) => event.stopPropagation()}
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
                              onClick={(event) => {
                                event.stopPropagation();
                                handleTogglePin(id);
                              }}
                            >
                              <Pin className="h-4 w-4" />
                              {isPinned ? "取消置顶" : "置顶"}
                            </button>
                            <button
                              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted"
                              onClick={(event) => {
                                event.stopPropagation();
                                beginRename(id, node.title);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                              修改标题
                            </button>
                            <button
                              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                              onClick={(event) => {
                                event.stopPropagation();
                                beginDelete(id, node.title);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              删除
                            </button>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {hasSearchKeyword && !hasSearchResults && (
            <div className="tl-panel mt-4 rounded-2xl border border-dashed p-8 text-center">
              <p className="font-medium">没有匹配的笔记本</p>
              <p className="mt-2 text-sm text-muted-foreground">
                换个关键词试试，或清空搜索查看全部笔记本。
              </p>
              <Button variant="outline" className="mt-4" onClick={() => setSearchKeyword("")}>
                清空搜索
              </Button>
            </div>
          )}
        </section>
      </section>

      {deleteTarget && typeof document !== "undefined" &&
        createPortal(
        <div className="tl-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">删除笔记本？</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  “{deleteTarget.title}”及其所有子对话都会被删除。此操作当前无法撤销。
                </p>
              </div>
              <button className="tl-hover rounded-full p-2" onClick={() => setDeleteTarget(null)} aria-label="关闭">
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
    </main>
  );
}

function HeroCanvasPreview() {
  return (
    <div className="mt-9 overflow-hidden rounded-[1.4rem] border border-white/45 bg-white/34 p-3 shadow-panel backdrop-blur-md dark:border-white/10 dark:bg-white/5">
      <div className="relative h-72 overflow-hidden rounded-2xl border border-border/60 bg-[radial-gradient(circle_at_24%_18%,color-mix(in_srgb,var(--tl-brand)_10%,transparent),transparent_18rem),linear-gradient(color-mix(in_srgb,var(--tl-border)_38%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--tl-border)_38%,transparent)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 360 220" aria-hidden="true">
          <path d="M76 72 C132 44, 176 54, 218 94" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
          <path d="M218 94 C252 112, 274 132, 302 164" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
          <path d="M218 94 C172 132, 146 150, 108 168" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <PreviewNode className="left-6 top-10" title="Source" meta="paper.pdf" />
        <PreviewNode className="left-[46%] top-[35%]" title="Core idea" meta="context" active />
        <PreviewNode className="bottom-8 left-16" title="Follow-up" meta="branch" />
        <PreviewNode className="bottom-6 right-6" title="Review" meta="diagram" />
      </div>
    </div>
  );
}

function PreviewNode({ className, title, meta, active }: { className: string; title: string; meta: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "absolute w-28 rounded-xl border bg-card/82 px-3 py-2 text-left shadow-sm backdrop-blur-md",
        active ? "border-primary/45 ring-4 ring-primary/10" : "border-border/70",
        className,
      )}
    >
      <p className="truncate text-xs font-semibold">{title}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{meta}</p>
    </div>
  );
}

function splitThumbnailTitle(title: string) {
  const normalized = title.trim() || "Untitled";
  const maxLineLength = 8;
  const firstLine = normalized.slice(0, maxLineLength);
  const secondLine = normalized.slice(maxLineLength, maxLineLength * 2);
  return secondLine ? [firstLine, secondLine] : [firstLine];
}

function NotebookCardThumbnail({ nodes, rootId }: { nodes: Record<string, KnowledgeNode>; rootId: string }) {
  const diagram = buildDiagram(nodes, rootId);
  const previewWidth = 300;
  const previewHeight = 132;
  const scale = Math.min(previewWidth / diagram.width, previewHeight / diagram.height);
  const offsetX = (previewWidth - diagram.width * scale) / 2;
  const offsetY = (previewHeight - diagram.height * scale) / 2;

  return (
    <div className="tl-notebook-thumbnail pointer-events-none relative z-20 h-28 overflow-hidden rounded-xl border">
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${previewWidth} ${previewHeight}`} aria-hidden="true">
        <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
          {diagram.links.map((link) => (
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
              stroke="var(--tl-notebook-thumb-link)"
              strokeLinecap="round"
              strokeWidth="7"
            />
          ))}
          {diagram.nodes.map((diagramNode) => {
            const x = DIAGRAM_PADDING + diagramNode.x;
            const y = DIAGRAM_PADDING + diagramNode.y;
            const titleLines = splitThumbnailTitle(diagramNode.title);
            return (
              <g key={diagramNode.id}>
                <rect
                  x={x}
                  y={y}
                  width={DIAGRAM_NODE_WIDTH}
                  height={DIAGRAM_NODE_HEIGHT}
                  rx="16"
                  fill={diagramNode.id === rootId ? "var(--tl-notebook-thumb-node-active)" : "var(--tl-notebook-thumb-node)"}
                  stroke={diagramNode.id === rootId ? "var(--tl-notebook-thumb-node-active-stroke)" : "var(--tl-notebook-thumb-node-stroke)"}
                  strokeWidth={diagramNode.id === rootId ? "4" : "3"}
                />
                <text
                  x={x + DIAGRAM_NODE_WIDTH / 2}
                  y={y + (titleLines.length === 1 ? 36 : 28)}
                  fill="var(--tl-notebook-thumb-ink)"
                  fontSize="22"
                  fontWeight="650"
                  dominantBaseline="middle"
                  textAnchor="middle"
                >
                  {titleLines.map((line, index) => (
                    <tspan key={`${diagramNode.id}-${index}`} x={x + DIAGRAM_NODE_WIDTH / 2} dy={index === 0 ? 0 : 23}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="tl-notebook-thumbnail-count absolute bottom-2 left-2 rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur">
        {diagram.nodes.length} 节点
      </div>
    </div>
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
    <div className="tl-panel-soft rounded-xl border p-4 shadow-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--tl-brand)_12%,transparent)]">
        <Icon className="tl-brand h-5 w-5" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function QuickAction({ title, description }: { title: string; description: string }) {
  // 快速开始步骤用于引导当前 mock 阶段的产品路径。
  return (
    <div className="tl-panel-soft relative overflow-hidden rounded-xl border p-3 shadow-sm">
      <div className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-[color-mix(in_srgb,var(--tl-brand)_36%,transparent)]" />
      <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent opacity-60 dark:via-white/10" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
