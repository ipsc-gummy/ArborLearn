import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Check, ChevronDown, Globe, Paperclip, Send, SlidersHorizontal, Square } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import {
  DEEPSEEK_MODELS,
  type DeepSeekModelId,
  type DeepSeekThinkingModeId,
} from "../lib/models";
import { getModelScopeId, type ModelScope } from "../lib/modelScope";
import { cn } from "../lib/utils";

interface ComposerProps {
  nodeId: string;
  notebookId?: string;
  panelId?: string;
  threadId?: string;
}

export function Composer({ nodeId, notebookId, panelId, threadId }: ComposerProps) {
  const [value, setValue] = useState("");
  const appendMessage = useTreeLearnStore((state) => state.appendMessage);
  const stopMessage = useTreeLearnStore((state) => state.stopMessage);
  const scope: ModelScope = { panelId, threadId: threadId ?? nodeId, nodeId, notebookId };
  const scopeId = getModelScopeId(scope);
  const selectedModel = useTreeLearnStore((state) => state.getModelConfig(scope).model);
  const setModelConfig = useTreeLearnStore((state) => state.setModelConfig);
  const selectedThinkingMode = useTreeLearnStore((state) => state.getModelConfig(scope).thinkingMode);
  const webSearchEnabled = useTreeLearnStore((state) => state.webSearchEnabled);
  const setWebSearchEnabled = useTreeLearnStore((state) => state.setWebSearchEnabled);
  const chatRunStatus = useTreeLearnStore((state) => state.chatRunStatusByNode[nodeId]);
  const isThinking = chatRunStatus === "thinking";
  const isStreaming = chatRunStatus === "streaming";

  const submit = () => {
    if (isStreaming) {
      stopMessage(nodeId);
      return;
    }
    if (!value.trim() || isThinking) return;
    appendMessage(nodeId, value.trim(), scope);
    setValue("");
  };

  return (
    <div className="shrink-0 border-t border-border/70 px-3 py-3 backdrop-blur-xl" style={{ background: "color-mix(in srgb, var(--tl-panel-muted) 78%, transparent)" }}>
      <div className="tl-panel tl-focus-ring group/composer mx-auto max-w-3xl rounded-[1.65rem] border px-3 py-2 ring-1 ring-white/35 transition duration-200 hover:shadow-[0_18px_46px_rgba(25,45,64,0.14)] dark:ring-white/5">
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
          className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 pt-1 text-sm leading-6 outline-none"
          placeholder="围绕当前节点继续追问..."
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant={webSearchEnabled ? "secondary" : "ghost"}
              size="sm"
              title={webSearchEnabled ? "已开启联网搜索" : "开启联网搜索"}
              aria-pressed={webSearchEnabled}
              onClick={() => setWebSearchEnabled(!webSearchEnabled)}
              className={cn(
                "transition",
                webSearchEnabled && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15",
              )}
            >
              <Globe className="h-4 w-4" />
              搜索
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="上传文件"
              className="h-9 w-9 text-muted-foreground shadow-none hover:bg-foreground/5 hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <ModelSelector
              selectedModel={selectedModel}
              onSelect={(modelName) => setModelConfig(scopeId, { model: modelName, thinkingMode: selectedThinkingMode })}
            />
            <ThinkingModeSelector
              selectedMode={selectedThinkingMode}
              onSelect={(thinkingMode) => setModelConfig(scopeId, { model: selectedModel, thinkingMode })}
            />
            <Button
              size="icon"
              variant={isStreaming ? "danger" : "primary"}
              onClick={submit}
              disabled={isThinking || (!isStreaming && !value.trim())}
              aria-label={isStreaming ? "停止回复" : "发送"}
              title={isStreaming ? "停止回复" : isThinking ? "正在思考" : "发送"}
              className="h-10 w-10 shrink-0 shadow-sm"
            >
              {isStreaming ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const thinkingModeCopy = {
  fast: {
    trigger: "Instant",
    title: "Instant",
  },
  deep: {
    trigger: "Thinking",
    title: "Thinking",
  },
  challenge: {
    trigger: "进阶",
    title: "进阶",
  },
} satisfies Record<DeepSeekThinkingModeId, { trigger: string; title: string }>;

const thinkingStrengthCopy = {
  deep: "标准",
  challenge: "进阶",
} satisfies Record<Exclude<DeepSeekThinkingModeId, "fast">, string>;

function ThinkingModeSelector({
  selectedMode,
  onSelect,
}: {
  selectedMode: DeepSeekThinkingModeId;
  onSelect: (thinkingMode: DeepSeekThinkingModeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [thinkingOptionsOpen, setThinkingOptionsOpen] = useState(false);
  const activeCopy = thinkingModeCopy[selectedMode] ?? thinkingModeCopy.fast;
  const thinkingRowSuffix = selectedMode === "challenge" ? thinkingModeCopy.challenge.title : "";
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setThinkingOptionsOpen(false);
    }
  };
  const selectMode = (thinkingMode: DeepSeekThinkingModeId) => {
    onSelect(thinkingMode);
    setOpen(false);
    setThinkingOptionsOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-full bg-transparent px-3 text-sm font-medium text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground hover:shadow-[0_10px_26px_rgba(25,45,64,0.13)] focus:outline-none focus:ring-2 focus:ring-primary/25 dark:hover:bg-white/10"
          aria-label="选择模型"
          title="选择模型"
        >
          <span>{activeCopy.trigger}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="tl-panel z-50 w-56 overflow-visible rounded-[1.35rem] border p-2.5 text-sm shadow-panel outline-none"
        >
          <div className="px-3 pb-2 pt-1">
            <p className="text-base font-medium leading-6 text-muted-foreground">DeepSeek</p>
          </div>

          <div className="overflow-visible rounded-xl">
            <button
              type="button"
              role="radio"
              aria-checked={selectedMode === "fast"}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                selectedMode === "fast" ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
              )}
              onClick={() => selectMode("fast")}
            >
              <span className="min-w-0 flex-1">
                <span className="text-base font-semibold leading-6">{thinkingModeCopy.fast.title}</span>
              </span>
              {selectedMode === "fast" && <Check className="h-4 w-4 shrink-0 text-foreground" />}
            </button>

            <div className="group relative overflow-visible">
              <div
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-xl transition",
                  selectedMode !== "fast" ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedMode !== "fast"}
                  className="flex min-h-11 min-w-0 flex-1 items-center px-3 py-2 text-left"
                  onClick={() => selectMode("deep")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-base font-semibold leading-6">Thinking</span>
                    {thinkingRowSuffix && (
                      <span className="ml-2 align-baseline text-sm text-muted-foreground">
                        · {thinkingRowSuffix}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="调整 Thinking 强度"
                  title="调整 Thinking 强度"
                  className={cn(
                    "mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10 opacity-0 transition group-hover:opacity-100 hover:bg-foreground/15 hover:shadow-[0_10px_22px_rgba(25,45,64,0.18)] focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/25",
                    thinkingOptionsOpen && "opacity-100 shadow-[0_10px_22px_rgba(25,45,64,0.18)]",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    setThinkingOptionsOpen((current) => !current);
                  }}
                >
                  <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              {thinkingOptionsOpen && (
                <div className="tl-panel absolute right-[calc(100%-0.15rem)] top-0 z-50 w-36 rounded-[1.25rem] border p-2.5 shadow-panel">
                  {(["deep", "challenge"] as const).map((mode) => {
                    const active = selectedMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                          active ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
                        )}
                        onClick={() => selectMode(mode)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-base font-semibold leading-6">{thinkingStrengthCopy[mode]}</span>
                        </span>
                        {active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mx-3 my-1.5 h-px bg-border" />
            <button
              type="button"
              className="flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-base font-semibold transition hover:bg-foreground/5 dark:hover:bg-white/10"
            >
              配置...
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelSelector({
  selectedModel,
  onSelect,
}: {
  selectedModel: DeepSeekModelId;
  onSelect: (modelName: DeepSeekModelId) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeModel = DEEPSEEK_MODELS.find((model) => model.id === selectedModel) ?? DEEPSEEK_MODELS[0];
  const selectModel = (modelName: DeepSeekModelId) => {
    onSelect(modelName);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="hidden h-9 items-center gap-1.5 rounded-full bg-transparent px-3 text-sm font-medium text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground hover:shadow-[0_10px_26px_rgba(25,45,64,0.13)] focus:outline-none focus:ring-2 focus:ring-primary/25 dark:hover:bg-white/10 sm:flex"
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
          <div className="px-4 pb-3 pt-2">
            <p className="text-lg font-semibold leading-7">DeepSeek 模型</p>
            <p className="mt-0.5 text-sm leading-5 text-muted-foreground">选择本次对话使用的底层模型</p>
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
                  onClick={() => selectModel(model.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-lg font-semibold leading-6">{model.label}</span>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
