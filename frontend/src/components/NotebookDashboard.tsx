import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { AccountMenu, SettingsMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import { DIAGRAM_NODE_HEIGHT, DIAGRAM_NODE_WIDTH, DIAGRAM_PADDING, buildDiagram, linkPath } from "../lib/diagramLayout";
import { cn } from "../lib/utils";
import type { AuthUser } from "../lib/api";
import type { KnowledgeNode } from "../types/treelearn";

interface NotebookDashboardProps {
  onOpenNotebook: (nodeId: string) => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  user: AuthUser | null;
  authStatus: "checking" | "authenticated" | "anonymous" | "error";
  authError: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName?: string) => Promise<void>;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

interface DeleteTarget {
  id: string;
  title: string;
}

type SortMode = "recent" | "title";

const notebookCoverPalettes = [
  {
    lightCover: "#b8d4ce",
    lightSpine: "#7eb1aa",
    darkCover: "#102324",
    darkSpine: "#16484d",
    accent: "#25c6bd",
    paper: "#f4ead1",
  },
  {
    lightCover: "#c9bea2",
    lightSpine: "#9f8f68",
    darkCover: "#191f20",
    darkSpine: "#3e5352",
    accent: "#7fb8a8",
    paper: "#f1e5ca",
  },
  {
    lightCover: "#b5cad2",
    lightSpine: "#7fa1ae",
    darkCover: "#142123",
    darkSpine: "#23585e",
    accent: "#42bac7",
    paper: "#efe3c7",
  },
  {
    lightCover: "#c0caa8",
    lightSpine: "#90a36e",
    darkCover: "#1e211f",
    darkSpine: "#4b574b",
    accent: "#93b977",
    paper: "#f5ecd4",
  },
  {
    lightCover: "#c4bfd0",
    lightSpine: "#968dad",
    darkCover: "#171b20",
    darkSpine: "#3c5265",
    accent: "#76b9d6",
    paper: "#eee4ca",
  },
];

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

// 首页/笔记本仪表盘：负责创建、排序、重命名、删除和进入 TreeLearn 笔记本。
export function NotebookDashboard({
  onOpenNotebook,
  themeMode,
  onThemeChange,
  user,
  authStatus,
  authError,
  onLogin,
  onRegister,
  onLogout,
  onRequestAuth,
}: NotebookDashboardProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const rootIds = useTreeLearnStore((state) => state.rootIds);
  const pinnedRootIds = useTreeLearnStore((state) => state.pinnedRootIds);
  const createRootConversation = useTreeLearnStore((state) => state.createRootConversation);
  const renameNode = useTreeLearnStore((state) => state.renameNode);
  const deleteNode = useTreeLearnStore((state) => state.deleteNode);
  const isLoggedIn = Boolean(user);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
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

  const openFirstSearchResult = () => {
    if (!hasSearchKeyword || !filteredRootIds[0]) return;
    onOpenNotebook(filteredRootIds[0]);
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
              <h1 className="text-base font-medium">TreeLearn</h1>
              <p className="text-xs text-muted-foreground">面向知识学习的树形上下文工作台</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
            <AccountMenu
              user={user}
              onLogout={onLogout}
              onRequestAuth={onRequestAuth}
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
                先为论文、课件或技术文档创建一个独立 TreeLearn 笔记本，再进入树形对话空间管理主线、支线和上下文调度。
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
                我的 <span>TreeLearn</span> 笔记本
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
              <div className="tl-input hidden items-center rounded-full border p-0.5 text-xs sm:flex">
                <button
                  className={cn(
                    "tl-sort-option h-8 rounded-full px-3 font-medium text-muted-foreground transition",
                    sortMode === "recent" && "is-active",
                  )}
                  onClick={() => setSortMode("recent")}
                >
                  最近
                </button>
                <button
                  className={cn(
                    "tl-sort-option h-8 rounded-full px-3 font-medium text-muted-foreground transition",
                    sortMode === "title" && "is-active",
                  )}
                  onClick={() => setSortMode("title")}
                >
                  标题
                </button>
              </div>
              <Button
                variant="primary"
                onClick={handleCreateNotebook}
                className="tl-notebook-primary-action"
              >
                <Plus className="h-4 w-4" />
                新建 TreeLearn 笔记本
              </Button>
            </div>
          </div>
          {hasSearchKeyword && (
            <div className="mb-4 text-sm text-muted-foreground">
              已为“{searchKeyword.trim()}”找到 {filteredRootIds.length} / {orderedRootIds.length} 个笔记本
            </div>
          )}

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

            {filteredRootIds.map((id, index) => {
              const node = nodes[id];
              if (!node) return null;
              const isPinned = pinnedRootIds.includes(id);
              const isEditing = editingId === id;
              const coverPalette = notebookCoverPalettes[index % notebookCoverPalettes.length];
              return (
                <div
                  key={id}
                  className="tl-notebook-book group relative min-h-[18.5rem] text-left"
                  style={{
                    "--tl-notebook-cover-light": coverPalette.lightCover,
                    "--tl-notebook-spine-light": coverPalette.lightSpine,
                    "--tl-notebook-cover-dark": coverPalette.darkCover,
                    "--tl-notebook-spine-dark": coverPalette.darkSpine,
                    "--tl-notebook-accent": coverPalette.accent,
                    "--tl-notebook-paper": coverPalette.paper,
                  } as React.CSSProperties}
                >
                  {!isEditing && (
                    <button className="absolute inset-0 z-10 rounded-[1.2rem]" aria-label={`打开 ${node.title}`} onClick={() => onOpenNotebook(id)} />
                  )}
                  <div className="tl-notebook-pages" aria-hidden="true" />
                  <div className="tl-notebook-paper">
                    <div className="tl-notebook-paper-rule" aria-hidden="true" />
                    <p className="tl-notebook-summary pointer-events-none line-clamp-4">{node.summary}</p>
                    <NotebookHoverDiagram nodes={nodes} rootId={node.id} />
                  </div>
                  <div className="tl-notebook-cover">
                    <div className="tl-notebook-spine" />
                    <div className="tl-notebook-elastic" />
                    <div className="tl-notebook-cover-content">
                      <div className="tl-notebook-cover-top pointer-events-none">
                        <div className="tl-notebook-badge flex items-center justify-center rounded-full">
                          <BookOpen className="h-4 w-4" />
                        </div>
                        <span className={cn("tl-notebook-status", isPinned && "is-pinned")}>
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
                          className="tl-input relative z-20 ml-5 w-[calc(100%-3.25rem)] rounded-md border px-2 py-1 text-sm font-semibold outline-none ring-2 ring-primary/15"
                        />
                      ) : (
                        <div className="tl-notebook-title-block pointer-events-none">
                          <h4 className="line-clamp-2 text-[color:var(--tl-notebook-ink)]">
                            {node.title}
                          </h4>
                          <p className="text-[color:var(--tl-notebook-muted)]">
                            {formatNotebookUpdatedAt(node.updatedAt)}
                          </p>
                        </div>
                      )}
                    </div>
                    <GitBranch className="tl-notebook-emboss" aria-hidden="true" />
                  </div>
                  <Popover.Root open={openMenuId === id} onOpenChange={(open) => setOpenMenuId(open ? id : null)}>
                    <Popover.Trigger asChild>
                      <button
                        className="tl-notebook-menu-button absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full"
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
                </div>
              );
            })}
          </div>
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

function splitPreviewTitle(title: string) {
  const normalized = title.trim() || "Untitled";
  const maxLineLength = 10;
  const firstLine = normalized.slice(0, maxLineLength);
  const secondLine = normalized.slice(maxLineLength, maxLineLength * 2);
  return secondLine ? [firstLine, secondLine] : [firstLine];
}

function NotebookHoverDiagram({ nodes, rootId }: { nodes: Record<string, KnowledgeNode>; rootId: string }) {
  const diagram = buildDiagram(nodes, rootId);
  const previewWidth = 260;
  const previewHeight = 140;
  const scale = Math.min(previewWidth / diagram.width, previewHeight / diagram.height);
  const offsetX = (previewWidth - diagram.width * scale) / 2;
  const offsetY = (previewHeight - diagram.height * scale) / 2;

  return (
    <div className="tl-notebook-diagram pointer-events-none max-h-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:mt-4 group-hover:max-h-32 group-hover:opacity-100">
      <div className="relative h-32 overflow-hidden rounded-xl border border-border/55 bg-[radial-gradient(circle_at_24%_20%,color-mix(in_srgb,var(--tl-brand)_10%,transparent),transparent_11rem),linear-gradient(color-mix(in_srgb,var(--tl-border)_34%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--tl-border)_34%,transparent)_1px,transparent_1px)] bg-[size:auto,22px_22px,22px_22px]">
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
              stroke="var(--tl-border)"
              strokeWidth="6"
              strokeLinecap="round"
            />
          ))}
            {diagram.nodes.map((node) => {
              const x = DIAGRAM_PADDING + node.x;
              const y = DIAGRAM_PADDING + node.y;
              const titleLines = splitPreviewTitle(node.title);
              return (
                <g key={node.id}>
                  <rect
                    x={x}
                    y={y}
                    width={DIAGRAM_NODE_WIDTH}
                    height={DIAGRAM_NODE_HEIGHT}
                    rx="16"
                    fill="var(--tl-panel-solid)"
                    stroke={node.id === rootId ? "color-mix(in srgb, var(--tl-brand) 44%, var(--tl-border))" : "var(--tl-border)"}
                    strokeWidth={node.id === rootId ? "4" : "3"}
                  />
                  <text
                    x={x + DIAGRAM_NODE_WIDTH / 2}
                    y={y + (titleLines.length === 1 ? 36 : 29)}
                    fill="currentColor"
                    fontSize="24"
                    fontWeight="650"
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {titleLines.map((line, index) => (
                      <tspan key={`${node.id}-${index}`} x={x + DIAGRAM_NODE_WIDTH / 2} dy={index === 0 ? 0 : 24}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="tl-notebook-node-count absolute bottom-2 left-3 rounded-full border px-2.5 py-1">
          {diagram.nodes.length} nodes
        </div>
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
