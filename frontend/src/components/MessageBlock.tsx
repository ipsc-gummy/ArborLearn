import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";
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
  const children = Object.values(nodes).filter((node) => node.parentId === nodeId && node.selectedText);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const renderLinkedContent = () => {
    // 逐个查找当前节点下由 selectedText 创建的子节点，把原文片段替换为链接按钮。
    let content: Array<string | ReactElement> = [message.content];

    children.forEach((child) => {
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
            <span className="tl-panel pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-72 rounded-md border p-3 text-left text-sm leading-6 shadow-panel peer-hover:block peer-focus:block">
              <span className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <GitBranch className="tl-brand h-4 w-4" />
                {child.title}
              </span>
              <span className="block text-muted-foreground">{child.summary}</span>
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
        {!isUser && message.content === "正在思考..." ? (
          <ThinkingIndicator />
        ) : isUser ? (
          <p className="whitespace-pre-wrap break-words">{renderLinkedContent()}</p>
        ) : (
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
        )}
      </div>
    </article>
  );
}
