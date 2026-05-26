import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { NodePanel } from "./NodePanel";
import { NotebookDiagram } from "./NotebookDiagram";
import { useTreeLearnStore } from "../store/treelearnStore";

export type WorkspaceView = "chat" | "diagram";

interface WorkspaceProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}

export function Workspace({ view, onViewChange }: WorkspaceProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const compareNodeId = useTreeLearnStore((state) => state.compareNodeId);
  const activeNode = nodes[activeNodeId];
  const parentNode = compareNodeId ? nodes[compareNodeId] : null;
  const showChat = view === "chat";

  if (!activeNode) return null;

  return (
    <section className="tl-workspace-shell tl-panel relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border">
      <div className="min-h-0 flex-1 overflow-hidden bg-transparent">
        {!showChat ? (
          <NotebookDiagram onOpenChat={() => onViewChange("chat")} />
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
