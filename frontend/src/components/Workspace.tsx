import { useState } from "react";
import { Columns2, GitBranch, MessageSquareText } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { NodePanel } from "./NodePanel";
import { NotebookDiagram } from "./NotebookDiagram";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";

type WorkspaceView = "chat" | "diagram";

// 工作区容器：在聊天视图和树形思维导图视图之间切换。
export function Workspace() {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const compareNodeId = useTreeLearnStore((state) => state.compareNodeId);
  const [view, setView] = useState<WorkspaceView>("chat");
  const activeNode = nodes[activeNodeId];
  const parentNode = compareNodeId ? nodes[compareNodeId] : null;
  const showChat = view === "chat";

  // 节点被删除后可能短暂找不到 activeNode，直接返回空界面避免渲染报错。
  if (!activeNode) return null;

  return (
    <section className="tl-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border">
      <div className="tl-border-soft flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
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
          <div
            className="flex rounded-lg border p-0.5"
            style={{ borderColor: "var(--tl-border-soft)", background: "var(--tl-panel-soft)" }}
          >
            {(["chat", "diagram"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                  view === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
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

      <div className="min-h-0 flex-1 overflow-hidden" style={{ background: "var(--tl-panel-muted)" }}>
        {!showChat ? (
          <NotebookDiagram onOpenChat={() => setView("chat")} />
        ) : parentNode ? (
          // 子对话模式：左侧保留父节点上下文，右侧展示当前支线，比例约为 3:7。
          <PanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
            <Panel defaultSize={30} minSize={22}>
              <div className="tl-border-soft h-full min-h-0 overflow-hidden border-r">
                <NodePanel node={parentNode} compact />
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 transition hover:bg-primary/40" style={{ background: "var(--tl-border-soft)" }} />
            <Panel defaultSize={70} minSize={38}>
              <div className="h-full min-h-0 overflow-hidden">
                <NodePanel node={activeNode} showCloseChild />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          // 主线模式：没有父节点时只展示当前节点聊天。
          <NodePanel node={activeNode} />
        )}
      </div>
    </section>
  );
}
