import { Check, Copy, GitBranch, RotateCcw, Share2, Volume2, VolumeX } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import type { ChatMessage } from "../types/treelearn";
import { useTreeLearnStore } from "../store/treelearnStore";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";

interface MessageBlockProps {
  nodeId: string;
  message: ChatMessage;
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="animate-pulse">正在思考</span>
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
  const retryAssistantMessage = useTreeLearnStore((state) => state.retryAssistantMessage);
  const isNodeRunning = Boolean(useTreeLearnStore((state) => state.chatRunStatusByNode[nodeId]));
  const children = Object.values(nodes).filter((node) => node.parentId === nodeId && node.selectedText);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isThinking = !isUser && (message.content === "正在思考..." || message.content === "正在重新生成...");
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

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

  const handleShare = async () => {
    const shareData = { title: "TreeLearn AI 回复", text: message.content };
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return;
    }
    await writeToClipboard(message.content);
    setShared(true);
    window.setTimeout(() => setShared(false), 1600);
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
          "group max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 md:max-w-[72%]",
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
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className={cn("text-xs font-semibold", isUser ? "opacity-70" : "text-muted-foreground")}>
            {isUser ? "用户" : "TreeLearn AI"}
          </span>
        </div>
        {isThinking ? (
          <ThinkingIndicator />
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
            <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-2 text-muted-foreground">
              <MessageActionButton title="复制" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </MessageActionButton>
              <MessageActionButton title={isSpeaking ? "停止朗读" : "朗读"} onClick={handleSpeak}>
                {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </MessageActionButton>
              <MessageActionButton title={shared ? "已复制分享内容" : "分享"} onClick={handleShare}>
                {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              </MessageActionButton>
              <MessageActionButton
                title="重试"
                onClick={() => retryAssistantMessage(nodeId, message.id)}
                disabled={isNodeRunning}
              >
                <RotateCcw className="h-4 w-4" />
              </MessageActionButton>
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
