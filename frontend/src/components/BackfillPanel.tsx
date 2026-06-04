import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, RotateCcw, Sparkles, Undo2, X } from "lucide-react";
import { archiveBackfillPatch, createBackfillDraft, createBackfillPatch } from "../lib/api";
import { useArborLearnStore } from "../store/arborlearnStore";
import type { EditType, KnowledgeNode } from "../types/arborlearn";
import { Button } from "./ui/button";

interface BackfillPanelProps {
  node: KnowledgeNode;
}

interface CustomBackfillPrompt {
  id: string;
  label: string;
  prompt: string;
}

const CUSTOM_BACKFILL_PROMPTS_KEY = "arborlearn.customBackfillPrompts";
const CUSTOM_BACKFILL_PROMPTS_EVENT = "arborlearn-custom-backfill-prompts";

const editTypeOptions: Array<{ id: EditType; label: string }> = [
  { id: "correct", label: "修改" },
  { id: "expand", label: "补充" },
  { id: "compress", label: "压缩" },
  { id: "reframe", label: "重构" },
];

function loadCustomBackfillPrompts(): CustomBackfillPrompt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_BACKFILL_PROMPTS_KEY) ?? "[]") as CustomBackfillPrompt[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.id && item.label?.trim() && item.prompt?.trim())
      : [];
  } catch {
    return [];
  }
}

function saveCustomBackfillPrompts(prompts: CustomBackfillPrompt[]) {
  localStorage.setItem(CUSTOM_BACKFILL_PROMPTS_KEY, JSON.stringify(prompts));
  window.dispatchEvent(new CustomEvent(CUSTOM_BACKFILL_PROMPTS_EVENT, { detail: prompts }));
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function formatApplyError(error: unknown) {
  if (!(error instanceof Error)) return "应用回填失败";
  try {
    const detail = JSON.parse(error.message) as {
      code?: string;
      message?: string;
      conflictPatch?: { anchorText?: string; sourceChildNodeId?: string };
    };
    if (detail.message) {
      if (detail.code === "BACKFILL_RANGE_OVERLAP") {
        const text = detail.conflictPatch?.anchorText ? `：${detail.conflictPatch.anchorText}` : "";
        return `${detail.message}${text}`;
      }
      return detail.message;
    }
    if (detail.code === "BACKFILL_RANGE_OVERLAP") {
      const text = detail.conflictPatch?.anchorText ? `：${detail.conflictPatch.anchorText}` : "";
      return `${detail.message ?? "回填范围与其他子对话冲突"}${text}`;
    }
  } catch {
    // Fall through to the plain error message.
  }
  return error.message;
}

export function BackfillPanel({ node }: BackfillPanelProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const hydrateFromBackend = useArborLearnStore((state) => state.hydrateFromBackend);
  const selectedModel = useArborLearnStore((state) => state.selectedModel);
  const selectedThinkingMode = useArborLearnStore((state) => state.selectedThinkingMode);
  const [open, setOpen] = useState(false);
  const [editType, setEditType] = useState<EditType>("expand");
  const [draftPromptTag, setDraftPromptTag] = useState<EditType | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [replacementText, setReplacementText] = useState(node.sourceMetadata?.anchorText ?? "");
  const [replacementHistory, setReplacementHistory] = useState<string[]>([]);
  const [customPrompts, setCustomPrompts] = useState<CustomBackfillPrompt[]>(() => loadCustomBackfillPrompts());
  const [activeCustomPromptIds, setActiveCustomPromptIds] = useState<string[]>([]);
  const [customPromptOpen, setCustomPromptOpen] = useState(false);
  const [customPromptStep, setCustomPromptStep] = useState<1 | 2>(1);
  const [customPromptName, setCustomPromptName] = useState("");
  const [customPromptRequirement, setCustomPromptRequirement] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = node.sourceMetadata;

  const existingPatch = useMemo(() => {
    if (!source) return null;
    const parent = nodes[source.parentNodeId];
    const targetMessage = parent?.messages.find((message) => message.id === source.targetMessageId);
    return (
      targetMessage?.patches?.find(
        (patch) => patch.status === "applied" && patch.sourceChildNodeId === node.id,
      ) ?? null
    );
  }, [node.id, nodes, source]);

  const conflictingPatch = useMemo(() => {
    if (!source) return null;
    const parent = nodes[source.parentNodeId];
    const targetMessage = parent?.messages.find((message) => message.id === source.targetMessageId);
    return (
      targetMessage?.patches?.find(
        (patch) =>
          patch.status === "applied" &&
          patch.sourceChildNodeId !== node.id &&
          rangesOverlap(source.anchorRangeStart, source.anchorRangeEnd, patch.targetRangeStart, patch.targetRangeEnd),
      ) ?? null
    );
  }, [node.id, nodes, source]);

  const targetText = useMemo(() => {
    if (!source) return "";
    return source.anchorText;
  }, [source]);

  const activeCustomPrompts = useMemo(
    () => customPrompts.filter((prompt) => activeCustomPromptIds.includes(prompt.id)),
    [activeCustomPromptIds, customPrompts],
  );

  useEffect(() => {
    if (!open) return;
    setReplacementText(existingPatch?.replacementText ?? source?.anchorText ?? "");
    setEditType(existingPatch?.editType ?? "expand");
    setDraftPromptTag(null);
    setDraftPrompt("");
    setReplacementHistory([]);
    setActiveCustomPromptIds([]);
    setCustomPromptOpen(false);
    setCustomPromptStep(1);
    setCustomPromptName("");
    setCustomPromptRequirement("");
    setError(null);
  }, [existingPatch?.editType, existingPatch?.replacementText, open, source?.anchorText]);

  useEffect(() => {
    const syncCustomPrompts = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setCustomPrompts(Array.isArray(detail) ? detail : loadCustomBackfillPrompts());
    };
    window.addEventListener(CUSTOM_BACKFILL_PROMPTS_EVENT, syncCustomPrompts);
    window.addEventListener("storage", syncCustomPrompts);
    return () => {
      window.removeEventListener(CUSTOM_BACKFILL_PROMPTS_EVENT, syncCustomPrompts);
      window.removeEventListener("storage", syncCustomPrompts);
    };
  }, []);

  if (!source) return null;

  const buildUserInstruction = () => {
    const tagLabel = editTypeOptions.find((option) => option.id === draftPromptTag)?.label;
    const customInstructions = activeCustomPrompts.map((prompt) => `#${prompt.label} ${prompt.prompt}`);
    return [tagLabel ? `#${tagLabel}` : "", ...customInstructions, draftPrompt.trim()].filter(Boolean).join(" ");
  };

  const setReplacementWithHistory = (nextText: string) => {
    if (nextText === replacementText) return;
    setReplacementHistory((current) => [...current, replacementText].slice(-80));
    setReplacementText(nextText);
  };

  const undoReplacementEdit = () => {
    setReplacementHistory((current) => {
      if (current.length === 0) return current;
      const previousText = current[current.length - 1];
      setReplacementText(previousText);
      return current.slice(0, -1);
    });
  };

  const applyPatch = async () => {
    const replacement = replacementText.trim();
    if (!replacement || isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      await createBackfillPatch({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        targetRangeStart: source.anchorRangeStart,
        targetRangeEnd: source.anchorRangeEnd,
        replacementText: replacement,
      });
      await hydrateFromBackend();
      setOpen(false);
    } catch (applyError) {
      setError(formatApplyError(applyError));
    } finally {
      setIsApplying(false);
    }
  };

  const archiveExistingPatch = async () => {
    if (!existingPatch || isArchiving) return;
    setIsArchiving(true);
    setError(null);
    try {
      await archiveBackfillPatch(existingPatch.id);
      await hydrateFromBackend();
      setOpen(false);
    } catch (archiveError) {
      setError(formatApplyError(archiveError));
    } finally {
      setIsArchiving(false);
    }
  };

  const generateDraft = async () => {
    if (!source || isGenerating || conflictingPatch) return;
    setIsGenerating(true);
    setError(null);
    const userInstruction = buildUserInstruction();
    try {
      const response = await createBackfillDraft({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        userInstruction,
        modelName: selectedModel,
        thinkingMode: selectedThinkingMode,
      });
      setReplacementWithHistory(response.draft.replacementText);
    } catch (draftError) {
      setError(formatApplyError(draftError));
    } finally {
      setIsGenerating(false);
    }
  };

  const selectDraftTag = (option: { id: EditType; label: string }) => {
    setEditType(option.id);
    setDraftPromptTag((current) => (current === option.id ? null : option.id));
  };

  const toggleCustomPrompt = (promptId: string) => {
    setActiveCustomPromptIds((current) =>
      current.includes(promptId) ? current.filter((id) => id !== promptId) : [...current, promptId],
    );
  };

  const startCustomPromptCreation = () => {
    setCustomPromptOpen(true);
    setCustomPromptStep(1);
    setCustomPromptName("");
    setCustomPromptRequirement("");
  };

  const cancelCustomPromptCreation = () => {
    setCustomPromptOpen(false);
    setCustomPromptStep(1);
    setCustomPromptName("");
    setCustomPromptRequirement("");
  };

  const finishCustomPromptCreation = () => {
    const label = customPromptName.trim();
    const prompt = customPromptRequirement.trim();
    if (!label || !prompt) return;
    const nextPrompt: CustomBackfillPrompt = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.slice(0, 16),
      prompt,
    };
    const nextPrompts = [...customPrompts, nextPrompt];
    setCustomPrompts(nextPrompts);
    setActiveCustomPromptIds((current) => [...current, nextPrompt.id]);
    saveCustomBackfillPrompts(nextPrompts);
    cancelCustomPromptCreation();
  };

  const deleteCustomPrompt = (promptId: string) => {
    const nextPrompts = customPrompts.filter((prompt) => prompt.id !== promptId);
    setCustomPrompts(nextPrompts);
    setActiveCustomPromptIds((current) => current.filter((id) => id !== promptId));
    saveCustomBackfillPrompts(nextPrompts);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        data-tour-backfill-open
        data-tour-backfill-open-id={node.id}
        data-tour-backfill-open-title={node.title}
        title="基于选中文本生成可编辑回填内容"
      >
        <Undo2 className="h-4 w-4" />
        {existingPatch ? "编辑回填" : "回填"}
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[1000] pointer-events-none">
            <div className="pointer-events-auto fixed bottom-4 right-4 top-20 flex w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card text-sm shadow-2xl">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">回填</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                修改选中的文本，生成可自由编辑的回填内容，确认后写回父对话。
              </p>
            </div>
            <button
              type="button"
              aria-label="关闭回填面板"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-3 rounded-xl border border-border bg-muted/45 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">原选区</p>
            <p className="whitespace-pre-wrap leading-6">{targetText}</p>
          </div>
          {conflictingPatch && (
            <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              该选区与另一个子对话的回填范围有交集：{conflictingPatch.anchorText}
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-2">
            {editTypeOptions.map((option) => (
              <button
                key={option.id}
                data-tour-backfill-option={option.id}
                className={`rounded-full border px-3 py-1.5 text-xs transition duration-150 hover:scale-105 hover:shadow-md ${
                  draftPromptTag === option.id
                    ? "border-violet-500 bg-violet-600 text-white"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => selectDraftTag(option)}
              >
                {option.label}
              </button>
            ))}
            {customPrompts.map((customPrompt) => {
              const active = activeCustomPromptIds.includes(customPrompt.id);
              return (
                <span
                  key={customPrompt.id}
                  className={`group relative inline-flex items-center rounded-full border text-xs transition duration-150 hover:scale-105 hover:shadow-md ${
                    active
                      ? "border-violet-500 bg-violet-600 text-white"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <button
                    type="button"
                    className="px-3 py-1.5"
                    title={customPrompt.prompt}
                    onClick={() => toggleCustomPrompt(customPrompt.id)}
                  >
                    {customPrompt.label}
                  </button>
                  <button
                    type="button"
                    className="absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 scale-75 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition duration-150 hover:scale-110 hover:bg-destructive hover:text-destructive-foreground group-hover:scale-100 group-hover:opacity-100"
                    title="删除自定义回填功能"
                    aria-label="删除自定义回填功能"
                    onClick={() => deleteCustomPrompt(customPrompt.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition duration-150 hover:scale-105 hover:bg-muted hover:text-foreground hover:shadow-md"
              title="新增自定义回填功能"
              aria-label="新增自定义回填功能"
              onClick={startCustomPromptCreation}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {customPromptOpen && (
            <div className="mb-3 rounded-xl border border-border bg-background px-3 py-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">自定义回填功能</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {customPromptStep === 1 ? "第一步：命名" : "第二步：具体要求"}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="关闭自定义回填功能创建"
                  onClick={cancelCustomPromptCreation}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {customPromptStep === 1 ? (
                <div className="space-y-3">
                  <input
                    value={customPromptName}
                    onChange={(event) => setCustomPromptName(event.target.value)}
                    placeholder="例如：更学术、保留口吻、考试笔记"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={cancelCustomPromptCreation}>
                      取消
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setCustomPromptStep(2)}
                      disabled={!customPromptName.trim()}
                    >
                      下一步
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={customPromptRequirement}
                    onChange={(event) => setCustomPromptRequirement(event.target.value)}
                    placeholder="写清楚这个功能要追加给 AI 的具体要求"
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCustomPromptStep(1)}>
                      上一步
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={finishCustomPromptCreation}
                      disabled={!customPromptRequirement.trim()}
                    >
                      创建
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mb-3 rounded-xl border border-border bg-background px-3 py-2 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
            <div className="flex items-start gap-2">
              {draftPromptTag && (
                <span className="mt-0.5 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white">
                  #{editTypeOptions.find((option) => option.id === draftPromptTag)?.label}
                </span>
              )}
              {activeCustomPrompts.map((customPrompt) => (
                <span
                  key={customPrompt.id}
                  className="mt-0.5 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white"
                  title={customPrompt.prompt}
                >
                  #{customPrompt.label}
                </span>
              ))}
              <textarea
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                rows={2}
                placeholder="给 AI 生成草稿的额外要求，例如：更口语一点、保留原句节奏、只补充结论。"
                className="min-h-12 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                data-tour-backfill-generate
                onClick={generateDraft}
                disabled={isGenerating || Boolean(conflictingPatch)}
              >
                <Sparkles className="h-4 w-4" />
                {isGenerating ? "生成中" : "生成草稿"}
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">草稿内容</p>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                title="撤回文本编辑"
                aria-label="撤回文本编辑"
                disabled={replacementHistory.length === 0}
                onClick={undoReplacementEdit}
              >
                <Undo2 className="h-3.5 w-3.5" />
                撤回
              </button>
            </div>
            <div className="relative">
              <textarea
                data-tour-backfill-draft
                value={replacementText}
                onChange={(event) => setReplacementWithHistory(event.target.value)}
                rows={6}
                className="relative z-0 min-h-32 w-full resize-y rounded-xl border border-border bg-background px-3 pb-8 pt-2 text-sm leading-6 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
              <p className="pointer-events-none absolute bottom-2 left-3 z-20 rounded bg-background/85 px-1 text-xs leading-5 text-muted-foreground/85">
                草稿内容可继续手动编辑。
              </p>
            </div>
          </div>
          {error && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card p-4">
            {existingPatch && (
              <Button variant="outline" size="sm" onClick={archiveExistingPatch} disabled={isArchiving || isApplying}>
                <RotateCcw className="h-4 w-4" />
                {isArchiving ? "撤回中" : "撤回回填"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-tour-backfill-apply
              onClick={applyPatch}
              disabled={isApplying || !replacementText.trim() || Boolean(conflictingPatch)}
            >
              <Check className="h-4 w-4" />
              {existingPatch ? "更新回填" : "应用回填"}
            </Button>
          </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
