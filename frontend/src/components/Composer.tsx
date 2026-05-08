import { useState } from "react";
import { Brain, Globe, Paperclip, Send, SlidersHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";

interface ComposerProps {
  nodeId: string;
}

// 底部输入框：负责收集用户输入，并把消息追加到当前节点。
export function Composer({ nodeId }: ComposerProps) {
  const [value, setValue] = useState("");
  const appendMessage = useTreeLearnStore((state) => state.appendMessage);

  const submit = () => {
    // 防止空消息进入对话记录；真实后端接入时这里也适合做禁用/加载态。
    if (!value.trim()) return;
    // 当前版本先写入 mock 回复；后端联调时 appendMessage 内部会替换为真实流式接口。
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
          <Button size="icon" onClick={submit} aria-label="发送">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
