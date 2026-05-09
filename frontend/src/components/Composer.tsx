import { useState } from "react";
import { Brain, Globe, Paperclip, Send, SlidersHorizontal, Square } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";

interface ComposerProps {
  nodeId: string;
}

export function Composer({ nodeId }: ComposerProps) {
  const [value, setValue] = useState("");
  const appendMessage = useTreeLearnStore((state) => state.appendMessage);
  const stopMessage = useTreeLearnStore((state) => state.stopMessage);
  const chatRunStatus = useTreeLearnStore((state) => state.chatRunStatusByNode[nodeId]);
  const isThinking = chatRunStatus === "thinking";
  const isStreaming = chatRunStatus === "streaming";

  const submit = () => {
    if (isStreaming) {
      stopMessage(nodeId);
      return;
    }
    if (!value.trim() || isThinking) return;
    appendMessage(nodeId, value.trim());
    setValue("");
  };

  return (
    <div className="shrink-0 border-t border-border px-3 py-3 backdrop-blur" style={{ background: "color-mix(in srgb, var(--tl-panel-muted) 84%, transparent)" }}>
      <div className="tl-panel mx-auto max-w-3xl rounded-2xl border p-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 text-sm leading-6 outline-none"
          placeholder="围绕当前节点继续追问..."
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" title="思考模式">
              <Brain className="h-4 w-4" />
              思考
            </Button>
            <Button variant="ghost" size="sm" title="联网搜索">
              <Globe className="h-4 w-4" />
              搜索
            </Button>
            <Button variant="ghost" size="sm" title="上传文件">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" title="切换模型">
              <SlidersHorizontal className="h-4 w-4" />
              DeepSeek
            </Button>
          </div>
          <Button
            size="icon"
            variant={isStreaming ? "danger" : "primary"}
            onClick={submit}
            disabled={isThinking || (!isStreaming && !value.trim())}
            aria-label={isStreaming ? "停止回复" : "发送"}
            title={isStreaming ? "停止回复" : isThinking ? "正在思考" : "发送"}
          >
            {isStreaming ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
