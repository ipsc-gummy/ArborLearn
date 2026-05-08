import { useEffect, useRef } from "react";
import { Copy, Search, SplitSquareHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";

// 用户划选聊天文本后显示的轻量操作浮层。
export function SelectionBubble() {
  const draft = useTreeLearnStore((state) => state.selectionDraft);
  const setDraft = useTreeLearnStore((state) => state.setSelectionDraft);
  const createChildConversation = useTreeLearnStore((state) => state.createChildConversation);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!draft) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (bubbleRef.current?.contains(event.target as Node)) return;
      setDraft(null);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDraft(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [draft, setDraft]);

  if (!draft) return null;

  const style = {
    left: Math.min(draft.rect.left + draft.rect.width / 2, window.innerWidth - 160),
    top: Math.max(draft.rect.top - 48, 12),
  };

  const openSearch = () => {
    const searchBaseUrl = import.meta.env.VITE_SEARCH_URL ?? "https://www.bing.com/search?q=";
    window.open(`${searchBaseUrl}${encodeURIComponent(draft.text)}`, "_blank", "noopener,noreferrer");
    setDraft(null);
  };

  return (
    <div
      ref={bubbleRef}
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
      <Button variant="ghost" size="sm" title="搜索" onClick={openSearch}>
        <Search className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        title="创建子对话"
        onClick={() => {
          createChildConversation(draft.sourceNodeId, draft.text);
          setDraft(null);
        }}
      >
        <SplitSquareHorizontal className="h-4 w-4" />
        子对话
      </Button>
    </div>
  );
}
