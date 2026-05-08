import { Copy, Search, SplitSquareHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";

// 文本选区悬浮条：用户在消息区划选文本后，可以复制、搜索或创建子对话。
export function SelectionBubble() {
  const draft = useTreeLearnStore((state) => state.selectionDraft);
  const setDraft = useTreeLearnStore((state) => state.setSelectionDraft);
  const createChildConversation = useTreeLearnStore((state) => state.createChildConversation);

  if (!draft) return null;

  // 悬浮条定位在选区上方，并限制最大 left，避免靠近右侧屏幕边缘时溢出。
  const style = {
    left: Math.min(draft.rect.left + draft.rect.width / 2, window.innerWidth - 160),
    top: Math.max(draft.rect.top - 48, 12),
  };

  return (
    <div
      className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-card p-1 shadow-panel"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost"
        size="sm"
        title="复制"
        onClick={() => {
          navigator.clipboard?.writeText(draft.text);
          setDraft(null);
        }}
      >
        <Copy className="h-4 w-4" />
      </Button>
      {/* 搜索按钮先保留入口，后续可以接入联网搜索或站内关键词检索。 */}
      <Button variant="ghost" size="sm" title="搜索">
        <Search className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        title="创建子对话"
        onClick={() => createChildConversation(draft.sourceNodeId, draft.text)}
      >
        <SplitSquareHorizontal className="h-4 w-4" />
        子对话
      </Button>
    </div>
  );
}
