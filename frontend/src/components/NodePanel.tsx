import { useEffect, useMemo, useRef } from "react";
import { GitPullRequest, Route, X } from "lucide-react";
import { Composer } from "./Composer";
import { MessageBlock } from "./MessageBlock";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import type { KnowledgeNode } from "../types/treelearn";
import { LongTaskPanel } from "./LongTaskPanel";
import { BackfillPanel } from "./BackfillPanel";

interface NodePanelProps {
  node: KnowledgeNode;
  compact?: boolean;
  showCloseChild?: boolean;
}

// 单个知识节点的聊天面板：展示路径、摘要、消息列表和底部输入框。
export function NodePanel({ node, compact = false, showCloseChild = false }: NodePanelProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const setActiveNode = useTreeLearnStore((state) => state.setActiveNode);
  const closeChildConversation = useTreeLearnStore((state) => state.closeChildConversation);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(node.messages.length);
  const previousNodeIdRef = useRef(node.id);
  const shouldFollowScrollRef = useRef(true);

  const path = useMemo(() => {
    const items: KnowledgeNode[] = [];
    let cursor: KnowledgeNode | undefined = node;
    while (cursor) {
      items.unshift(cursor);
      cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
    }
    return items;
  }, [node, nodes]);

  const latestMessageContent = node.messages[node.messages.length - 1]?.content ?? "";
  const visibleMessages = node.messages.filter((message) => message.role !== "system");
  const backfillChildren = node.children
    .map((childId) => nodes[childId])
    .filter((child): child is KnowledgeNode => Boolean(child?.sourceMetadata));
  const notebookId = path[0]?.id ?? node.id;
  const panelId = `${compact ? "compact" : "main"}:${showCloseChild ? "child" : "primary"}:${node.id}`;

  useEffect(() => {
    const isNodeChange = previousNodeIdRef.current !== node.id;
    previousNodeIdRef.current = node.id;
    if (isNodeChange) shouldFollowScrollRef.current = true;

    // 新消息出现时，只滚动中间消息区到底部；底部输入框不会被消息内容挤走。
    const scroller = scrollRef.current;
    if (!scroller) return;
    const hasNewMessage = previousMessageCountRef.current !== node.messages.length;
    previousMessageCountRef.current = node.messages.length;
    const recentUserMessage =
      node.messages[node.messages.length - 1]?.role === "user" ||
      node.messages[node.messages.length - 2]?.role === "user";
    const shouldScroll = shouldFollowScrollRef.current || (hasNewMessage && recentUserMessage);
    if (!shouldScroll) return;
    if (hasNewMessage && recentUserMessage) shouldFollowScrollRef.current = true;

    requestAnimationFrame(() => {
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: hasNewMessage ? "smooth" : "auto",
      });
    });
  }, [node.id, node.messages.length, latestMessageContent]);

  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    shouldFollowScrollRef.current = distanceToBottom < 80;
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden" style={{ background: "var(--tl-panel-muted)" }}>
      <div className="relative border-b border-border/70 px-5 py-4 backdrop-blur-xl" style={{ background: "color-mix(in srgb, var(--tl-panel) 86%, transparent)" }}>
        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/65 to-transparent dark:via-white/10" />
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Route className="h-4 w-4" />
          <span className="truncate">{path.map((item) => item.title).join(" / ")}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={compact ? "truncate text-base font-semibold" : "text-xl font-semibold"}>
              {node.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{node.summary}</p>
            {node.summaryStale && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                摘要可能基于回填前内容生成
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!compact && <BackfillPanel node={node} />}
            {!compact && <LongTaskPanel nodeId={node.id} notebookId={notebookId} nodeTitle={node.title} panelId={panelId} />}
            {showCloseChild && (
              <Button variant="ghost" size="icon" onClick={closeChildConversation} aria-label="关闭子对话">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 overflow-y-auto px-3 py-6"
        onScroll={handleScroll}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {node.selectedText && (
            <div className="mx-auto w-full max-w-3xl rounded-xl border border-primary/20 bg-accent/55 p-3 text-sm shadow-sm backdrop-blur transition duration-200 hover:border-primary/35 hover:shadow-md">
              <div className="mb-1 flex items-center gap-2 font-medium text-accent-foreground">
                <GitPullRequest className="h-4 w-4" />
                局部追问片段
              </div>
              <p className="text-muted-foreground">{node.selectedText}</p>
            </div>
          )}
          {!compact && backfillChildren.length > 0 && (
            <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-background/70 p-3 text-sm shadow-sm backdrop-blur">
              <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <GitPullRequest className="h-4 w-4" />
                回填候选
              </div>
              <div className="space-y-2">
                {backfillChildren.map((child) => (
                  <div key={child.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2">
                    <button
                      className="min-w-0 flex-1 truncate text-left text-muted-foreground transition hover:text-foreground"
                      onClick={() => setActiveNode(child.id)}
                    >
                      {child.selectedText || child.title}
                    </button>
                    <BackfillPanel node={child} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {visibleMessages.map((message) => (
            <MessageBlock key={message.id} nodeId={node.id} message={message} />
          ))}
        </div>
      </div>

      <Composer nodeId={node.id} notebookId={notebookId} threadId={node.id} panelId={panelId} />
    </section>
  );
}
