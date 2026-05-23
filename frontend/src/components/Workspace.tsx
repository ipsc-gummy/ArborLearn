import { useState } from "react";
import { Columns2, GitBranch, MessageSquareText } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { NodePanel } from "./NodePanel";
import { NotebookDiagram } from "./NotebookDiagram";
import { LongTaskPanel } from "./LongTaskPanel";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";
import type { KnowledgeNode } from "../types/treelearn";

type WorkspaceView = "chat" | "diagram";

function getNotebookRootId(nodes: Record<string, KnowledgeNode>, nodeId: string) {
  let current: KnowledgeNode | undefined = nodes[nodeId];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

export function Workspace() {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const compareNodeId = useTreeLearnStore((state) => state.compareNodeId);
  const [view, setView] = useState<WorkspaceView>("chat");
  const activeNode = nodes[activeNodeId];
  const parentNode = compareNodeId ? nodes[compareNodeId] : null;
  const showChat = view === "chat";

  if (!activeNode) return null;
  const notebookId = getNotebookRootId(nodes, activeNodeId);
  const panelId = `${showChat ? "chat" : "diagram"}:workspace:${activeNode.id}`;

  return (
    <section className="tl-panel relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/12" />
      <div
        className="tl-border-soft flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 backdrop-blur-sm"
        style={{ background: "color-mix(in srgb, var(--tl-panel) 14%, transparent)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {showChat ? <MessageSquareText className="tl-brand h-4 w-4" /> : <GitBranch className="tl-brand h-4 w-4" />}
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{showChat ? "Chat" : "Diagram"}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {showChat ? "围绕当前 Nodes 与树形上下文提问" : "笔记本树形思维导图"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <LongTaskPanel nodeId={activeNode.id} notebookId={notebookId} nodeTitle={activeNode.title} panelId={panelId} />
          <div
            className="flex rounded-full border p-0.5 shadow-sm"
            style={{ borderColor: "var(--tl-border-soft)", background: "var(--tl-panel-soft)" }}
          >
            {(["chat", "diagram"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition",
                  view === item ? "bg-foreground/10 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <Columns2 className="h-4 w-4" />
            {parentNode ? "主对话 / 子对话" : "当前主线"}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-transparent">
        {!showChat ? (
          <NotebookDiagram onOpenChat={() => setView("chat")} />
        ) : parentNode ? (
          <PanelGroup
            key={`${parentNode.id}-${activeNode.id}`}
            direction="horizontal"
            className="tl-child-conversation-layout h-full min-h-0 overflow-hidden"
          >
            <Panel defaultSize={30} minSize={22}>
              <div className="tl-child-parent-panel tl-border-soft h-full min-h-0 overflow-hidden border-r">
                <NodePanel node={parentNode} compact />
              </div>
            </Panel>
            <PanelResizeHandle
              className="tl-child-resize-handle w-1 transition hover:bg-primary/40"
              style={{ background: "var(--tl-border-soft)" }}
            />
            <Panel defaultSize={70} minSize={38}>
              <div className="tl-child-active-panel h-full min-h-0 overflow-hidden">
                <NodePanel node={activeNode} showCloseChild />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <NodePanel node={activeNode} />
        )}
      </div>
    </section>
  );
}
