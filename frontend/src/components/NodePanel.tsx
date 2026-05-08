import { useEffect, useMemo, useRef } from "react";
import { GitPullRequest, Route, X } from "lucide-react";
import { Composer } from "./Composer";
import { MessageBlock } from "./MessageBlock";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import type { KnowledgeNode } from "../types/treelearn";

interface NodePanelProps {
  node: KnowledgeNode;
  compact?: boolean;
  showCloseChild?: boolean;
}

// 单个知识节点的聊天面板：展示路径、摘要、消息列表和底部输入框。
export function NodePanel({ node, compact = false, showCloseChild = false }: NodePanelProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const setSelectionDraft = useTreeLearnStore((state) => state.setSelectionDraft);
  const closeChildConversation = useTreeLearnStore((state) => state.closeChildConversation);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const path = useMemo(() => {
    const items: KnowledgeNode[] = [];
    let cursor: KnowledgeNode | undefined = node;
    while (cursor) {
      items.unshift(cursor);
      cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
    }
    return items;
  }, [node, nodes]);

  useEffect(() => {
    // 新消息出现时，只滚动中间消息区到底部；底部输入框不会被消息内容挤走。
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [node.id, node.messages.length]);

  const handleMouseUp = () => {
    // 使用浏览器 Selection API 读取用户在聊天内容区选中的文本。
    // 这里不直接创建子对话，而是先把选区文本和屏幕坐标写入 Zustand，
    // 由 SelectionBubble 负责展示“复制 / 搜索 / 子对话”等悬浮操作。
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || text.length < 2) return;
    const range = selection.getRangeAt(0);
    setSelectionDraft({ text, rect: range.getBoundingClientRect(), sourceNodeId: node.id });
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden" style={{ background: "var(--tl-panel-muted)" }}>
      <div className="border-b border-border px-5 py-4" style={{ background: "var(--tl-panel)" }}>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Route className="h-4 w-4" />
          <span className="truncate">{path.map((item) => item.title).join(" / ")}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={compact ? "truncate text-base font-medium" : "text-xl font-medium"}>
              {node.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{node.summary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {showCloseChild && (
              <Button variant="ghost" size="icon" onClick={closeChildConversation} aria-label="关闭子对话">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 overflow-y-auto px-3 py-6" onMouseUp={handleMouseUp}>
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {node.selectedText && (
            <div className="mx-auto w-full max-w-3xl rounded-xl border border-primary/20 bg-accent/55 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 font-medium text-accent-foreground">
                <GitPullRequest className="h-4 w-4" />
                局部追问片段
              </div>
              <p className="text-muted-foreground">{node.selectedText}</p>
            </div>
          )}
          {node.messages.map((message) => (
            <MessageBlock key={message.id} nodeId={node.id} message={message} />
          ))}
        </div>
      </div>

      <Composer nodeId={node.id} />
    </section>
  );
}
