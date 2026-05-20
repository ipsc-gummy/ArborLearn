import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Brain, Check, ChevronDown, Globe, Hammer, Paperclip, Send, Square, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { useTreeLearnStore } from "../store/treelearnStore";
import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEEPSEEK_MODELS,
  DEEPSEEK_THINKING_MODES,
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
            <ThinkingModeSelector
              selectedMode={selectedThinkingMode}
              onSelect={(thinkingMode) => setModelConfig(scopeId, { model: selectedModel, thinkingMode })}
            />
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
            <Button variant="ghost" size="sm" title="上传文件">
              <Paperclip className="h-4 w-4" />
            </Button>
            <ModelSelector
              selectedModel={selectedModel}
              onSelect={(modelName) => setModelConfig(scopeId, { model: modelName, thinkingMode: selectedThinkingMode })}
            />
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

const thinkingModeIcons = {
  fast: Zap,
  deep: Brain,
  challenge: Hammer,
} satisfies Record<DeepSeekThinkingModeId, React.ComponentType<{ className?: string }>>;

function ThinkingModeSelector({
  selectedMode,
  onSelect,
}: {
  selectedMode: DeepSeekThinkingModeId;
  onSelect: (thinkingMode: DeepSeekThinkingModeId) => void;
}) {
  const activeMode = DEEPSEEK_THINKING_MODES.find((mode) => mode.id === selectedMode) ?? DEEPSEEK_THINKING_MODES[0];
  const ActiveIcon = thinkingModeIcons[activeMode.id];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-full bg-foreground/5 px-3 text-sm font-medium text-foreground transition hover:bg-foreground/10 focus:outline-none focus:ring-2 focus:ring-primary/25 dark:bg-white/10 dark:hover:bg-white/15"
          aria-label="选择思考模式"
          title="选择思考模式"
        >
          <ActiveIcon className="h-4 w-4 text-muted-foreground" />
          <span>{activeMode.label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={10}
          className="tl-panel z-50 w-[20rem] rounded-2xl border p-2 text-sm shadow-panel outline-none"
        >
          <div className="px-3 pb-2 pt-1">
            <p className="text-base font-semibold leading-6">思考模式</p>
            <p className="text-xs text-muted-foreground">控制 DeepSeek 的推理强度</p>
          </div>

          <div className="overflow-hidden rounded-xl">
            {DEEPSEEK_THINKING_MODES.map((mode) => {
              const active = selectedMode === mode.id;
              const Icon = thinkingModeIcons[mode.id];
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn(
                    "flex min-h-[4.25rem] w-full items-center gap-3 px-4 py-3 text-left transition",
                    active
                      ? "bg-primary/10 ring-1 ring-inset ring-primary/45"
                      : "hover:bg-foreground/5 dark:hover:bg-white/10",
                  )}
                  onClick={() => onSelect(mode.id)}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground dark:bg-white/10">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-lg font-semibold leading-6">{mode.label}</span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">{mode.description}</span>
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
