import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GitPullRequest, Route, X } from "lucide-react";
import { Composer } from "./Composer";
import { MessageBlock } from "./MessageBlock";
import { Button } from "./ui/button";
import { useArborLearnStore } from "../store/arborlearnStore";
import { cn } from "../lib/utils";
import type { KnowledgeNode } from "../types/arborlearn";
import { BackfillPanel } from "./BackfillPanel";

interface NodePanelProps {
  node: KnowledgeNode;
  compact?: boolean;
  showCloseChild?: boolean;
  demoUpgradeLocked?: boolean;
  onRequireDemoUpgrade?: () => void;
}

export function NodePanel({
  node,
  compact = false,
  showCloseChild = false,
  demoUpgradeLocked = false,
  onRequireDemoUpgrade,
}: NodePanelProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const setActiveNode = useArborLearnStore((state) => state.setActiveNode);
  const closeChildConversation = useArborLearnStore((state) => state.closeChildConversation);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(node.messages.length);
  const previousNodeIdRef = useRef(node.id);
  const shouldFollowScrollRef = useRef(true);
  const [nodeInfoOpen, setNodeInfoOpen] = useState(false);

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
  const nodeInfoPanelId = `${panelId}:node-info`;
  const nodeInfoToggleLabel = nodeInfoOpen ? "收回节点标题和概要" : "展开节点标题和概要";

  useEffect(() => {
    const isNodeChange = previousNodeIdRef.current !== node.id;
    previousNodeIdRef.current = node.id;
    if (isNodeChange) {
      shouldFollowScrollRef.current = true;
      setNodeInfoOpen(false);
    }

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
    <section
      className="tl-node-panel relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-transparent"
      data-tour-node-id={node.id}
      data-tour-node-panel={node.title}
    >
      <div
        className="tl-node-info-strip tl-border-soft relative z-20 h-5 shrink-0 border-b"
        style={{ background: "color-mix(in srgb, var(--tl-panel) 10%, transparent)" }}
      >
        <div className="absolute left-3 right-3 top-full z-30 mx-auto max-w-4xl">
          <div
            id={nodeInfoPanelId}
            className={cn(
              "tl-node-info-panel grid overflow-hidden rounded-b-2xl border-x border-b border-border/55 shadow-sm backdrop-blur-xl transition-[grid-template-rows] duration-300 ease-out",
              nodeInfoOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
            style={{ background: "color-mix(in srgb, var(--tl-panel-solid) 88%, transparent)" }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="relative px-5 py-4">
                <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/65 to-transparent dark:via-white/10" />
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Route className="h-4 w-4 shrink-0" />
                  <span className="truncate">{path.map((item) => item.title).join(" / ")}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className={compact ? "truncate text-base font-semibold" : "text-xl font-semibold"}>{node.title}</h2>
                    {node.summary && <p className="mt-1 text-sm leading-6 text-muted-foreground">{node.summary}</p>}
                    {node.summaryStale && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        摘要可能基于回填前内容生成
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!compact && <BackfillPanel node={node} />}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            data-tour-node-info-toggle
            data-tour-node-info-toggle-id={node.id}
            data-tour-node-info-toggle-title={node.title}
            onClick={() => setNodeInfoOpen((open) => !open)}
            className="tl-node-info-toggle mx-auto flex h-5 w-14 items-center justify-center rounded-b-full border-x border-b border-border/55 bg-background/75 text-muted-foreground shadow-sm backdrop-blur-md transition-colors duration-200 hover:bg-background/90 hover:text-foreground"
            aria-expanded={nodeInfoOpen}
            aria-controls={nodeInfoPanelId}
            aria-label={nodeInfoToggleLabel}
            title={nodeInfoToggleLabel}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", nodeInfoOpen && "rotate-180")} />
          </button>
        </div>
      </div>

      {showCloseChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={closeChildConversation}
          aria-label="关闭子对话"
          title="关闭子对话"
          className="absolute right-4 top-4 z-20 h-9 w-9 rounded-full border border-border/55 bg-background/35 shadow-sm backdrop-blur-sm hover:bg-background/55"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      <div
        ref={scrollRef}
        className="tl-message-scroll min-h-0 overflow-y-auto px-3 pb-5 pt-7"
        onScroll={handleScroll}
      >
        <div className="tl-message-stack mx-auto flex max-w-4xl flex-col gap-4">
          {node.selectedText && (
            <div className="mx-auto w-full max-w-3xl rounded-xl border border-primary/20 bg-accent/55 p-3 text-sm shadow-sm backdrop-blur transition duration-200 hover:border-primary/35 hover:shadow-md">
              <div className="mb-1 flex items-center gap-2 font-medium text-accent-foreground">
                <GitPullRequest className="h-4 w-4" />
                局部追问片段
              </div>
              <p className="text-muted-foreground">{node.selectedText}</p>
            </div>
          )}
          {backfillChildren.length > 0 && (
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

      <Composer
        nodeId={node.id}
        notebookId={notebookId}
        threadId={node.id}
        panelId={panelId}
        demoUpgradeLocked={demoUpgradeLocked}
        onRequireDemoUpgrade={onRequireDemoUpgrade}
      />
    </section>
  );
}
