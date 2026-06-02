import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Globe,
  Lightbulb,
  MessageSquareText,
  Paperclip,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { useArborLearnStore } from "../store/arborlearnStore";
import {
  DEEPSEEK_MODELS,
  type DeepSeekModelId,
  type DeepSeekThinkingModeId,
} from "../lib/models";
import { getModelScopeId, type ModelConfig, type ModelScope } from "../lib/modelScope";
import { cn } from "../lib/utils";

interface ComposerProps {
  nodeId: string;
  notebookId?: string;
  panelId?: string;
  threadId?: string;
}

const branchQuickPrompts = [
  {
    label: "解释这段",
    message: "请解释我选中的这段内容。",
    icon: MessageSquareText,
  },
  {
    label: "举个例子",
    message: "请用一个简单例子说明我选中的这段内容。",
    icon: Lightbulb,
  },
  {
    label: "为什么重要",
    message: "请说明我选中的这段内容为什么重要。",
    icon: CircleHelp,
  },
];
const EMPTY_FILES: { id: string; filename: string; fileSize: number; extractionStatus: "pending" | "ready" | "failed"; errorMessage?: string | null }[] = [];
const UPLOAD_ACCEPT = ".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.bmp,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*";
const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

export function Composer({ nodeId, notebookId, panelId, threadId }: ComposerProps) {
  const [value, setValue] = useState("");
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string>("");
  const node = useArborLearnStore((state) => state.nodes[nodeId]);
  const appendMessage = useArborLearnStore((state) => state.appendMessage);
  const stopMessage = useArborLearnStore((state) => state.stopMessage);
  const files = useArborLearnStore((state) => state.filesByNode[nodeId] ?? EMPTY_FILES);
  const loadNodeFiles = useArborLearnStore((state) => state.loadNodeFiles);
  const uploadFile = useArborLearnStore((state) => state.uploadFile);
  const deleteFile = useArborLearnStore((state) => state.deleteFile);
  const isUploading = useArborLearnStore((state) => state.fileUploadStatusByNode[nodeId] === "uploading");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scope: ModelScope = { panelId, threadId: threadId ?? nodeId, nodeId, notebookId };
  const scopeId = getModelScopeId(scope);
  const selectedModel = useArborLearnStore((state) => state.getModelConfig(scope).model);
  const setModelConfig = useArborLearnStore((state) => state.setModelConfig);
  const selectedThinkingMode = useArborLearnStore((state) => state.getModelConfig(scope).thinkingMode);
  const webSearchEnabled = useArborLearnStore((state) => state.webSearchEnabledByNode[nodeId] ?? false);
  const setWebSearchEnabled = useArborLearnStore((state) => state.setWebSearchEnabled);
  const chatRunStatus = useArborLearnStore((state) => state.chatRunStatusByNode[nodeId]);
  const isThinking = chatRunStatus === "thinking";
  const isStreaming = chatRunStatus === "streaming";
  const hasUserQuestion = node?.messages.some((message) => message.role === "user") ?? false;
  const showBranchQuickPrompts = Boolean(node?.selectedText && !hasUserQuestion && !value.trim() && !isThinking && !isStreaming);
  const visibleFiles = files.filter((file) => !lastSubmittedAt || file.createdAt > lastSubmittedAt);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    void loadNodeFiles(nodeId);
  }, [loadNodeFiles, nodeId]);

  useEffect(() => {
    setLastSubmittedAt("");
  }, [nodeId]);

  const send = (content: string) => {
    if (!content.trim()) return;
    appendMessage(
      nodeId,
      content.trim(),
      scope,
      visibleFiles.map((file) => ({
        id: file.id,
        filename: file.filename,
        fileSize: file.fileSize,
        extractionStatus: file.extractionStatus,
        errorMessage: file.errorMessage,
      })),
    );
    setLastSubmittedAt(new Date().toISOString());
    setValue("");
  };

  const submit = () => {
    if (isThinking || isStreaming) {
      stopMessage(nodeId);
      return;
    }
    if (!value.trim()) return;
    send(value);
  };

  const uploadFiles = async (selectedFiles: File[]) => {
    if (isUploading || selectedFiles.length === 0) return;
    for (const selectedFile of selectedFiles) {
      try {
        await uploadFile(nodeId, selectedFile);
      } catch {
        // The store exposes the backend error in apiError; keep later files uploadable.
      }
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(selectedFiles);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pastedFiles = collectTransferFiles(event.clipboardData, "paste");
    if (pastedFiles.length === 0) return;
    event.preventDefault();
    void uploadFiles(pastedFiles);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    void uploadFiles(collectTransferFiles(event.dataTransfer, "drop"));
  };

  return (
    <div className="tl-composer-dock shrink-0 border-t border-border/55 px-3 py-3 backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--tl-panel-muted) 34%, transparent)" }}>
      <div
        className={cn(
          "tl-composer-shell tl-panel group/composer relative mx-auto max-w-3xl rounded-[1.65rem] border px-3 py-2",
          isDragActive && "tl-composer-shell--drag-active",
        )}
        onPaste={handlePaste}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          multiple
          onChange={handleFileChange}
        />
        {isDragActive && (
          <div className="tl-composer-drop-overlay" aria-hidden="true">
            <Paperclip className="h-5 w-5" />
            <span>松开上传</span>
          </div>
        )}
        {showBranchQuickPrompts && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
            {branchQuickPrompts.map((prompt) => {
              const Icon = prompt.icon;
              return (
                <button
                  key={prompt.label}
                  type="button"
                  data-tour-quick-prompt={prompt.label}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-background/55 px-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-primary/8 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                  onClick={() => send(prompt.message)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {prompt.label}
                </button>
              );
            })}
          </div>
        )}
        {visibleFiles.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
            {visibleFiles.map((file) => (
              <span
                key={file.id}
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/55 px-2 text-xs text-muted-foreground"
                title={file.errorMessage ?? file.filename}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-40 truncate">{file.filename}</span>
                <span className="text-muted-foreground/70">{formatFileSize(file.fileSize)}</span>
                {file.extractionStatus === "failed" && <span className="text-destructive">failed</span>}
                <button
                  type="button"
                  className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground"
                  title="删除附件"
                  aria-label={`删除附件 ${file.filename}`}
                  onClick={() => void deleteFile(file.id, nodeId)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
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
          className="tl-composer-input max-h-32 min-h-12 w-full resize-none bg-transparent px-2 pt-1 text-sm leading-6 outline-none"
          placeholder="围绕当前节点继续追问..."
        />
          <div className="flex items-center justify-between gap-2 pt-1" data-tour-composer-node-id={nodeId}>
          <div className="flex flex-wrap items-center gap-1" data-tour-composer-tools={nodeId}>
            <Button
              variant="ghost"
              size="sm"
              data-tour-composer-tool="search"
              data-tour-composer-tool-node-id={nodeId}
              title={webSearchEnabled ? "已开启联网搜索" : "开启联网搜索"}
              aria-pressed={webSearchEnabled}
              onClick={() => setWebSearchEnabled(nodeId, !webSearchEnabled)}
              className={cn(
                "border-transparent transition focus:ring-0 focus:ring-offset-0 hover:border-transparent",
                webSearchEnabled && "border-primary/30 bg-primary/10 text-primary hover:border-primary/30 hover:bg-primary/15",
              )}
            >
              <Globe className="h-4 w-4" />
              搜索
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-tour-composer-tool="upload"
              data-tour-composer-tool-node-id={nodeId}
              title="上传文件"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="h-9 w-9 border-transparent text-muted-foreground shadow-none focus:ring-0 focus:ring-offset-0 hover:border-transparent hover:bg-foreground/5 hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <ModelModeSelector
              nodeId={nodeId}
              selectedModel={selectedModel}
              selectedMode={selectedThinkingMode}
              onChange={(config) => setModelConfig(scopeId, config)}
            />
            <Button
              size="icon"
              variant={isThinking || isStreaming ? "danger" : "primary"}
              onClick={submit}
              disabled={!isThinking && !isStreaming && !value.trim()}
              aria-label={isThinking || isStreaming ? "停止回复" : "发送"}
              title={isThinking || isStreaming ? "停止回复" : "发送"}
              className="h-10 w-10 shrink-0 shadow-sm"
            >
              {isThinking || isStreaming ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function transferHasFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files");
}

function collectTransferFiles(dataTransfer: DataTransfer, source: "drop" | "paste") {
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const files = itemFiles.length > 0 ? itemFiles : Array.from(dataTransfer.files ?? []);
  if (source === "drop") return files;
  return files.map((file, index) => normalizeClipboardFile(file, index));
}

function normalizeClipboardFile(file: File, index: number) {
  const hasUsefulName = Boolean(file.name && file.name !== "image.png" && file.name !== "blob");
  if (hasUsefulName) return file;
  const extension = CLIPBOARD_IMAGE_EXTENSIONS[file.type] ?? (file.type.startsWith("image/") ? ".png" : ".txt");
  return new File([file], `clipboard-${Date.now()}-${index + 1}${extension}`, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now(),
  });
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

function ModelModeSelector({
  nodeId,
  selectedModel,
  selectedMode,
  onChange,
}: {
  nodeId: string;
  selectedModel: DeepSeekModelId;
  selectedMode: DeepSeekThinkingModeId;
  onChange: (config: ModelConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [thinkingOptionsOpen, setThinkingOptionsOpen] = useState(false);
  const [modelOptionsOpen, setModelOptionsOpen] = useState(false);
  const activeModel = DEEPSEEK_MODELS.find((model) => model.id === selectedModel) ?? DEEPSEEK_MODELS[0];
  const modelMenuOptions = [...DEEPSEEK_MODELS].reverse();
  const activeCopy = thinkingModeCopy[selectedMode] ?? thinkingModeCopy.fast;
  const thinkingRowSuffix = selectedMode === "challenge" ? thinkingModeCopy.challenge.title : "";
  const activeModelLabel = `DeepSeek ${activeModel.label}`;
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setThinkingOptionsOpen(false);
      setModelOptionsOpen(false);
    }
  };
  const selectModel = (model: DeepSeekModelId) => {
    onChange({ model, thinkingMode: selectedMode });
    setModelOptionsOpen(false);
  };
  const selectMode = (thinkingMode: DeepSeekThinkingModeId) => {
    onChange({ model: selectedModel, thinkingMode });
    setOpen(false);
    setThinkingOptionsOpen(false);
    setModelOptionsOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-tour-composer-tool="model"
          data-tour-composer-tool-node-id={nodeId}
          className="flex h-8 items-center gap-1 rounded-full bg-transparent px-2.5 text-[13px] font-medium text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground hover:shadow-[0_8px_20px_rgba(25,45,64,0.13)] focus:outline-none focus:ring-2 focus:ring-primary/25 dark:hover:bg-white/10"
          aria-label="选择模型"
          title="选择模型"
        >
          <span>{activeModel.label}</span>
          <span className="text-muted-foreground/60">·</span>
          <span>{activeCopy.trigger}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          className="tl-panel z-50 w-44 overflow-visible rounded-2xl border p-1.5 text-sm shadow-panel outline-none"
        >
          <div className="px-2.5 pb-1 pt-1">
            <p className="text-sm font-semibold leading-5">思考强度</p>
          </div>

          <div className="overflow-visible rounded-lg">
            <button
              type="button"
              role="radio"
              aria-checked={selectedMode === "fast"}
              className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition",
                selectedMode === "fast" ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
              )}
              onClick={() => selectMode("fast")}
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm font-semibold leading-5">{thinkingModeCopy.fast.title}</span>
              </span>
              {selectedMode === "fast" && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
            </button>

            <div className="group relative overflow-visible">
              <div
                className={cn(
                  "flex min-h-9 w-full items-center gap-1 rounded-lg transition",
                  selectedMode !== "fast" ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedMode !== "fast"}
                  className="flex min-h-9 min-w-0 flex-1 items-center px-2 py-1 text-left"
                  onClick={() => selectMode("deep")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold leading-5">Thinking</span>
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
                    "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/10 opacity-0 transition group-hover:opacity-100 hover:bg-foreground/15 hover:shadow-[0_8px_18px_rgba(25,45,64,0.16)] focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/25",
                    thinkingOptionsOpen && "opacity-100 shadow-[0_10px_22px_rgba(25,45,64,0.18)]",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    setThinkingOptionsOpen((current) => !current);
                  }}
                >
                  <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>

              {thinkingOptionsOpen && (
                <div className="tl-panel absolute left-[calc(100%-0.1rem)] top-0 z-50 w-24 rounded-2xl border p-1.5 shadow-panel">
                  {(["deep", "challenge"] as const).map((mode) => {
                    const active = selectedMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={cn(
                          "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition",
                          active ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
                        )}
                        onClick={() => selectMode(mode)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-semibold leading-5">{thinkingStrengthCopy[mode]}</span>
                        </span>
                        {active && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mx-2 my-1 h-px bg-border" />
            <div className="group/model relative overflow-visible">
              <button
                type="button"
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm font-semibold transition hover:bg-foreground/5 dark:hover:bg-white/10",
                  modelOptionsOpen && "bg-foreground/10",
                )}
                aria-haspopup="menu"
                aria-expanded={modelOptionsOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setThinkingOptionsOpen(false);
                  setModelOptionsOpen((current) => !current);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{activeModelLabel}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>

              {modelOptionsOpen && (
                <div className="tl-panel absolute right-[calc(100%-0.1rem)] bottom-0 z-50 w-40 rounded-2xl border p-1.5 shadow-panel">
                  {modelMenuOptions.map((model) => {
                    const active = selectedModel === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={cn(
                          "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition",
                          active ? "bg-foreground/10" : "hover:bg-foreground/5 dark:hover:bg-white/10",
                        )}
                        onClick={() => selectModel(model.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold leading-5">DeepSeek {model.label}</span>
                        </span>
                        {active && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
