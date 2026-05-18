import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Check, ChevronDown, Globe, Paperclip, Send, Square } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import { DEFAULT_DEEPSEEK_MODEL_ID, DEEPSEEK_MODELS, type DeepSeekModelId } from "../lib/models";
import { cn } from "../lib/utils";

interface ComposerProps {
  nodeId: string;
}

export function Composer({ nodeId }: ComposerProps) {
  const [value, setValue] = useState("");
  const appendMessage = useTreeLearnStore((state) => state.appendMessage);
  const stopMessage = useTreeLearnStore((state) => state.stopMessage);
  const selectedModel = useTreeLearnStore((state) => state.selectedModel);
  const setSelectedModel = useTreeLearnStore((state) => state.setSelectedModel);
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
    <div className="shrink-0 border-t border-border/70 px-3 py-3 backdrop-blur-xl" style={{ background: "color-mix(in srgb, var(--tl-panel-muted) 78%, transparent)" }}>
      <div className="tl-panel tl-focus-ring mx-auto max-w-3xl rounded-[1.15rem] border p-2 ring-1 ring-white/35 transition duration-200 dark:ring-white/5">
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
            <Button variant="ghost" size="sm" title="联网搜索">
              <Globe className="h-4 w-4" />
              搜索
            </Button>
            <Button variant="ghost" size="sm" title="上传文件">
              <Paperclip className="h-4 w-4" />
            </Button>
            <ModelSelector selectedModel={selectedModel} onSelect={setSelectedModel} />
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

function ModelSelector({
  selectedModel,
  onSelect,
}: {
  selectedModel: DeepSeekModelId;
  onSelect: (modelName: DeepSeekModelId) => void;
}) {
  const activeModel = DEEPSEEK_MODELS.find((model) => model.id === selectedModel) ?? DEEPSEEK_MODELS[0];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-full bg-foreground/5 px-3 text-sm font-medium text-foreground transition hover:bg-foreground/10 focus:outline-none focus:ring-2 focus:ring-primary/25 dark:bg-white/10 dark:hover:bg-white/15"
          aria-label="选择 DeepSeek 模型"
          title="选择 DeepSeek 模型"
        >
          <span>{activeModel.label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={10}
          className="tl-panel z-50 w-[21rem] rounded-2xl border p-2 text-sm shadow-panel outline-none"
        >
          <div className="px-3 pb-2 pt-1">
            <p className="text-base font-semibold leading-6">DeepSeek</p>
            <p className="text-xs text-muted-foreground">选择本次对话使用的模型</p>
          </div>

          <div className="overflow-hidden rounded-xl">
            {DEEPSEEK_MODELS.map((model) => {
              const active = selectedModel === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn(
                    "flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-3 text-left transition",
                    active
                      ? "bg-primary/10 ring-1 ring-inset ring-primary/45"
                      : "hover:bg-foreground/5 dark:hover:bg-white/10",
                  )}
                  onClick={() => onSelect(model.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-lg font-semibold leading-6">{model.label}</span>
                      <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {model.badge}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">{model.description}</span>
                  </span>
                  {active && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 rounded-xl bg-foreground/5 px-4 py-3 text-xs leading-5 text-muted-foreground dark:bg-white/10">
            默认使用 {DEEPSEEK_MODELS.find((model) => model.id === DEFAULT_DEEPSEEK_MODEL_ID)?.label ?? "快速"}。
            切换后会保存到本机，下次发送自动沿用。
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
