import { Check, Copy, GitBranch, RotateCcw, Undo2, Volume2, VolumeX } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import type { ChatMessage } from "../types/treelearn";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { archiveBackfillPatch } from "../lib/api";

interface MessageBlockProps {
  nodeId: string;
  message: ChatMessage;
}

const COMPLEX_MARKDOWN_RE = /```|`|\[[^\]]+\]\([^)]+\)|^\s{0,3}#{1,6}\s|^\s{0,3}>\s|^\s*([-*+]\s|\d+\.\s)|\|/m;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function findPlainParagraphSelection(rawContent: string, selectedText: string) {
  const first = rawContent.indexOf(selectedText);
  if (first < 0 || rawContent.indexOf(selectedText, first + selectedText.length) >= 0) return null;
  const paragraphStart = rawContent.lastIndexOf("\n\n", first) + 2;
  const nextBreak = rawContent.indexOf("\n\n", first + selectedText.length);
  const paragraphEnd = nextBreak >= 0 ? nextBreak : rawContent.length;
  const paragraph = rawContent.slice(paragraphStart, paragraphEnd);
  if (COMPLEX_MARKDOWN_RE.test(paragraph)) return null;
  return {
    start: first,
    end: first + selectedText.length,
    beforeContext: rawContent.slice(paragraphStart, first),
    afterContext: rawContent.slice(first + selectedText.length, paragraphEnd),
    prefix: rawContent.slice(Math.max(0, first - 80), first),
    suffix: rawContent.slice(first + selectedText.length, first + selectedText.length + 80),
  };
}

function ThinkingIndicator({ label = "正在思考" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="animate-pulse">{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.24s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.12s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      </span>
    </div>
  );
}

// 单条聊天消息：根据角色切换左右布局，并把已创建子对话的选中文本渲染为可点击链接。
export function MessageBlock({ nodeId, message }: MessageBlockProps) {
  const nodes = useTreeLearnStore((state) => state.nodes);
  const setActiveNode = useTreeLearnStore((state) => state.setActiveNode);
  const setSelectionDraft = useTreeLearnStore((state) => state.setSelectionDraft);
  const retryAssistantMessage = useTreeLearnStore((state) => state.retryAssistantMessage);
  const hydrateFromBackend = useTreeLearnStore((state) => state.hydrateFromBackend);
  const isNodeRunning = Boolean(useTreeLearnStore((state) => state.chatRunStatusByNode[nodeId]));
  const children = Object.values(nodes).filter((node) => node.parentId === nodeId && node.selectedText);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isThinking =
    !isUser &&
    (message.content === "正在思考..." ||
      message.content === "正在联网检索..." ||
      message.content === "正在重新生成...");
  const thinkingLabel = message.content === "正在联网检索..." ? "正在联网检索" : "正在思考";
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const patches = message.patches ?? [];
  const hasAppliedPatches = patches.some((patch) => patch.status === "applied");

  const writeToClipboard = async (content: string) => {
    await navigator.clipboard?.writeText(content);
  };

  const handleCopy = async () => {
    await writeToClipboard(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleSpeak = () => {
    if (!("speechSynthesis" in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.lang = /[\u4e00-\u9fff]/.test(message.content) ? "zh-CN" : "en-US";
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleRetry = () => {
    if (hasAppliedPatches) {
      const confirmed = window.confirm(
        "重新生成会替换这条回复，并使这条回复上的所有回填失效。原回填记录会被归档，后续上下文不再使用它们。",
      );
      if (!confirmed) return;
    }
    retryAssistantMessage(nodeId, message.id);
  };

  const handleMouseUp = async () => {
    if (isSystem || hasAppliedPatches) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || text.length < 2 || selection.rangeCount === 0) return;
    const rawContent = message.originalContent || message.content;
    const located = findPlainParagraphSelection(rawContent, text);
    if (!located) return;
    const range = selection.getRangeAt(0);
    setSelectionDraft({
      text,
      rect: range.getBoundingClientRect(),
      sourceNodeId: nodeId,
      sourceMetadata: {
        type: "backfill_anchor",
        parentNodeId: nodeId,
        targetMessageId: message.id,
        targetMessageRole: message.role,
        targetMessageCreatedAt: message.createdAt,
        baseMessageContentHash: await sha256(rawContent),
        baseContentLength: rawContent.length,
        coordinateSpace: "raw_markdown",
        selectorStrategy: "dom_to_raw_exact",
        anchorRangeStart: located.start,
        anchorRangeEnd: located.end,
        anchorText: text,
        anchorPrefix: located.prefix,
        anchorSuffix: located.suffix,
        beforeContext: located.beforeContext,
        afterContext: located.afterContext,
      },
    });
  };

  const archivePatch = async (patchId: string) => {
    await archiveBackfillPatch(patchId);
    await hydrateFromBackend();
  };

  const renderLinkedContent = () => {
    // 逐个查找当前节点下由 selectedText 创建的子节点，把原文片段替换为链接按钮。
    let content: Array<string | ReactElement> = [message.content];

    children.forEach((child) => {
      const childSummary = child.summary.trim() || "摘要将在子对话更新后生成。";
      content = content.flatMap((part) => {
        // ReactElement 不再继续切分；没有匹配片段时保持原样。
        if (typeof part !== "string" || !child.selectedText || !part.includes(child.selectedText)) return [part];

        const [before, ...rest] = part.split(child.selectedText);

        return [
          before,
          <span key={`${message.id}-${child.id}`} className="relative inline-flex">
            <button className="tree-link peer" onClick={() => setActiveNode(child.id)}>
              {child.selectedText}
            </button>
            {/* 使用 peer-hover 限定触发区域：只有鼠标真正悬停在超链接按钮上时才显示预览。 */}
            <span className="tl-panel pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-72 rounded-md border bg-card/92 p-3 text-left text-sm leading-6 shadow-panel backdrop-blur-md peer-hover:block peer-focus:block">
              <span className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <GitBranch className="tl-brand h-4 w-4" />
                {child.title}
              </span>
              <span className="line-clamp-3 block text-muted-foreground">{childSummary}</span>
            </span>
          </span>,
          rest.join(child.selectedText),
        ];
      });
    });

    return content;
  };

  if (isSystem) {
    // system 消息作为时间线提示展示，不进入左右气泡对话样式。
    return (
      <div className="flex justify-center px-2">
        <div className="max-w-[78%] rounded-full border border-border bg-muted px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
          {renderLinkedContent()}
        </div>
      </div>
    );
  }

  return (
    <article className={cn("flex w-full px-2", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "group max-w-[82%] rounded-[1.15rem] px-4 py-3 text-sm leading-7 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md md:max-w-[72%]",
          isUser
            ? "rounded-br-md border"
            : "tl-panel rounded-bl-md border text-card-foreground",
        )}
        style={
          isUser
            ? {
                background: "var(--tl-user-bubble)",
                borderColor: "var(--tl-user-bubble-border)",
                color: "var(--tl-user-bubble-fg)",
              }
            : undefined
        }
        onMouseUp={handleMouseUp}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className={cn("text-xs font-semibold", isUser ? "opacity-70" : "text-muted-foreground")}>
            {isUser ? "用户" : "TreeLearn AI"}
          </span>
          <div className="flex items-center gap-2">
            {message.stale && (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                回填前生成
              </span>
            )}
            {hasAppliedPatches && (
              <button
                className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowOriginal((current) => !current);
                }}
              >
                {showOriginal ? "查看回填" : "包含回填"}
              </button>
            )}
          </div>
        </div>
        {showOriginal && message.originalContent && (
          <div className="mb-3 rounded-lg border border-dashed border-border bg-muted/45 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">原文</p>
            <p className="whitespace-pre-wrap">{message.originalContent}</p>
          </div>
        )}
        {isThinking ? (
          <ThinkingIndicator label={thinkingLabel} />
        ) : isUser ? (
          <p className="whitespace-pre-wrap break-words">{renderLinkedContent()}</p>
        ) : (
          <>
            <MarkdownContent
              content={message.content}
              treeLinks={children
                .filter((child) => child.selectedText)
                .map((child) => ({
                  id: child.id,
                  text: child.selectedText ?? "",
                  title: child.title,
                  summary: child.summary,
                }))}
              onTreeLinkClick={setActiveNode}
            />
            <div className="tl-reveal-actions mt-3 flex items-center gap-1 border-t border-border/60 pt-2 text-muted-foreground">
              <MessageActionButton title="复制" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </MessageActionButton>
              <MessageActionButton title={isSpeaking ? "停止朗读" : "朗读"} onClick={handleSpeak}>
                {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </MessageActionButton>
              <MessageActionButton
                title="重试"
                onClick={handleRetry}
                disabled={isNodeRunning}
              >
                <RotateCcw className="h-4 w-4" />
              </MessageActionButton>
              {patches.map((patch) => (
                <MessageActionButton
                  key={patch.id}
                  title="撤回回填"
                  onClick={() => void archivePatch(patch.id)}
                  disabled={isNodeRunning}
                >
                  <Undo2 className="h-4 w-4" />
                </MessageActionButton>
              ))}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function MessageActionButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
