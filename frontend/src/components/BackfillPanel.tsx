import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, RotateCcw, Sparkles, Undo2, X, XCircle } from "lucide-react";
import {
  archiveBackfillPatch,
  createBackfillDraft,
  createBackfillPatch,
  decideBackfillRange,
  reviewBackfillReplacement,
} from "../lib/api";
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
  { id: "reframe", label: "重构" },
  { id: "expand", label: "补充" },
  { id: "correct", label: "修改" },
  { id: "compress", label: "压缩" },
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

const previewInlineMarkdownWrappers: Array<[string, string]> = [
  ["**", "**"],
  ["__", "__"],
  ["~~", "~~"],
  ["`", "`"],
  ["*", "*"],
  ["_", "_"],
];

function renderMarkdownSelectionPreview(source: KnowledgeNode["sourceMetadata"]) {
  if (!source) return null;
  const selectedStart = source.selectedRangeStart ?? source.anchorRangeStart;
  const selectedEnd = source.selectedRangeEnd ?? source.anchorRangeEnd;
  const selectedRawText = source.selectedRawText ?? source.anchorText;
  const anchorExpanded = source.anchorRangeStart < selectedStart || selectedEnd < source.anchorRangeEnd;

  if (anchorExpanded || selectedRawText !== source.anchorText) {
    return <span className="whitespace-pre-wrap break-words">{source.anchorText}</span>;
  }

  const prefix = source.anchorPrefix ?? "";
  const suffix = source.anchorSuffix ?? "";
  const wrapper = previewInlineMarkdownWrappers.find(
    ([opener, closer]) => prefix.endsWith(opener) && suffix.includes(closer),
  );
  if (!wrapper) {
    return <span className="whitespace-pre-wrap break-words">{source.anchorText}</span>;
  }

  const [opener, closer] = wrapper;
  return (
    <span className="whitespace-pre-wrap break-words">
      <span className="select-none text-muted-foreground/45" aria-hidden="true">
        {opener}
      </span>
      <span>{source.anchorText}</span>
      <span className="select-none text-muted-foreground/45" aria-hidden="true">
        …{closer}
      </span>
    </span>
  );
}

export function BackfillPanel({ node }: BackfillPanelProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const hydrateFromBackend = useArborLearnStore((state) => state.hydrateFromBackend);
  const selectedModel = useArborLearnStore((state) => state.selectedModel);
  const selectedThinkingMode = useArborLearnStore((state) => state.selectedThinkingMode);
  const [open, setOpen] = useState(false);
  const [editType, setEditType] = useState<EditType>("expand");
  const [draftPromptTag, setDraftPromptTag] = useState<EditType | null>(null);
  const [activeCustomPromptIds, setActiveCustomPromptIds] = useState<string[]>([]);
  const [customPrompts, setCustomPrompts] = useState<CustomBackfillPrompt[]>(() => loadCustomBackfillPrompts());
  const [customPromptOpen, setCustomPromptOpen] = useState(false);
  const [customPromptStep, setCustomPromptStep] = useState<1 | 2>(1);
  const [customPromptName, setCustomPromptName] = useState("");
  const [customPromptRequirement, setCustomPromptRequirement] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [replacementText, setReplacementText] = useState(node.sourceMetadata?.anchorText ?? "");
  const [replacementHistory, setReplacementHistory] = useState<string[]>([]);
  const [targetRangeStart, setTargetRangeStart] = useState(node.sourceMetadata?.anchorRangeStart ?? 0);
  const [targetRangeEnd, setTargetRangeEnd] = useState(node.sourceMetadata?.anchorRangeEnd ?? 0);
  const [originalText, setOriginalText] = useState(node.sourceMetadata?.anchorText ?? "");
  const [rangeReason, setRangeReason] = useState<string | null>(null);
  const [rangeMode, setRangeMode] = useState<"anchor" | "suggested" | null>(null);
  const [pendingRange, setPendingRange] = useState<null | {
    targetRangeStart: number;
    targetRangeEnd: number;
    originalText: string;
    reason?: string | null;
  }>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializedSourceKey, setInitializedSourceKey] = useState<string | null>(null);
  const draftAbortControllerRef = useRef<AbortController | null>(null);
  const reviewAbortControllerRef = useRef<AbortController | null>(null);
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
          rangesOverlap(targetRangeStart, targetRangeEnd, patch.targetRangeStart, patch.targetRangeEnd),
      ) ?? null
    );
  }, [node.id, nodes, source, targetRangeEnd, targetRangeStart]);

  const targetText = useMemo(() => {
    if (!source) return "";
    return source.anchorText;
  }, [source]);

  const activeCustomPrompts = useMemo(
    () => customPrompts.filter((prompt) => activeCustomPromptIds.includes(prompt.id)),
    [activeCustomPromptIds, customPrompts],
  );

  const sourceKey = source
    ? [
        node.id,
        source.parentNodeId,
        source.targetMessageId,
        source.anchorRangeStart,
        source.anchorRangeEnd,
        existingPatch?.id ?? "draft",
      ].join(":")
    : null;

  useEffect(() => {
    if (!source || !sourceKey || initializedSourceKey === sourceKey) return;
    setReplacementText(existingPatch?.replacementText ?? source?.anchorText ?? "");
    setEditType(existingPatch?.editType ?? "expand");
    setTargetRangeStart(existingPatch?.targetRangeStart ?? source?.anchorRangeStart ?? 0);
    setTargetRangeEnd(existingPatch?.targetRangeEnd ?? source?.anchorRangeEnd ?? 0);
    setOriginalText(existingPatch?.originalText ?? source?.anchorText ?? "");
    setRangeReason(null);
    setRangeMode(existingPatch && existingPatch.originalText !== source?.anchorText ? "suggested" : null);
    setPendingRange(null);
    setDraftPromptTag(null);
    setActiveCustomPromptIds([]);
    setCustomPromptOpen(false);
    setCustomPromptStep(1);
    setCustomPromptName("");
    setCustomPromptRequirement("");
    setReplacementHistory([]);
    setDraftPrompt("");
    setError(null);
    setInitializedSourceKey(sourceKey);
  }, [
    existingPatch?.editType,
    existingPatch?.id,
    existingPatch?.originalText,
    existingPatch?.replacementText,
    existingPatch?.targetRangeEnd,
    existingPatch?.targetRangeStart,
    initializedSourceKey,
    source,
    source?.anchorRangeEnd,
    source?.anchorRangeStart,
    source?.anchorText,
    sourceKey,
  ]);

  useEffect(() => {
    return () => {
      draftAbortControllerRef.current?.abort();
      reviewAbortControllerRef.current?.abort();
    };
  }, []);

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

  const resetToAnchorRange = () => {
    setTargetRangeStart(source.anchorRangeStart);
    setTargetRangeEnd(source.anchorRangeEnd);
    setOriginalText(source.anchorText);
    setRangeReason(null);
    setRangeMode("anchor");
    setPendingRange(null);
  };

  const acceptPendingRange = () => {
    if (!pendingRange) return;
    setTargetRangeStart(pendingRange.targetRangeStart);
    setTargetRangeEnd(pendingRange.targetRangeEnd);
    setOriginalText(pendingRange.originalText);
    setRangeReason(pendingRange.reason ?? null);
    setRangeMode("suggested");
    setPendingRange(null);
  };

  const applyPatch = async () => {
    const replacement = replacementText.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
    if (!replacement.trim() || isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      await createBackfillPatch({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        targetRangeStart,
        targetRangeEnd,
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
    if (isGenerating) {
      draftAbortControllerRef.current?.abort();
      return;
    }
    if (!source || conflictingPatch) return;
    const controller = new AbortController();
    draftAbortControllerRef.current = controller;
    setIsGenerating(true);
    setError(null);
    const userInstruction = buildUserInstruction();
    try {
      const rangeResponse = await decideBackfillRange({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        userInstruction,
      }, { signal: controller.signal });
      const decision = rangeResponse.decision;
      const currentIsAnchor = targetRangeStart === source.anchorRangeStart && targetRangeEnd === source.anchorRangeEnd;
      if (decision.expanded && currentIsAnchor && rangeMode !== "anchor") {
        setPendingRange({
          targetRangeStart: decision.targetRangeStart,
          targetRangeEnd: decision.targetRangeEnd,
          originalText: decision.originalText,
          reason: decision.reason,
        });
        setRangeReason(decision.reason ?? null);
        setOriginalText(decision.originalText);
        return;
      }
      const response = await createBackfillDraft({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        targetRangeStart,
        targetRangeEnd,
        userInstruction,
        modelName: selectedModel,
        thinkingMode: selectedThinkingMode,
      }, { signal: controller.signal });
      setTargetRangeStart(response.draft.targetRangeStart);
      setTargetRangeEnd(response.draft.targetRangeEnd);
      setOriginalText(response.draft.originalText);
      setRangeReason(response.draft.rangeSuggestion?.reason ?? null);
      setReplacementWithHistory(response.draft.replacementText);
    } catch (draftError) {
      if (!isAbortError(draftError)) {
        setError(formatApplyError(draftError));
      }
    } finally {
      if (draftAbortControllerRef.current === controller) {
        draftAbortControllerRef.current = null;
      }
      setIsGenerating(false);
    }
  };

  const reviewReplacement = async () => {
    if (isReviewing) {
      reviewAbortControllerRef.current?.abort();
      return;
    }
    if (!source || conflictingPatch) return;
    const replacement = replacementText.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
    if (!replacement.trim()) return;
    const controller = new AbortController();
    reviewAbortControllerRef.current = controller;
    setIsReviewing(true);
    setError(null);
    try {
      const response = await reviewBackfillReplacement({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        targetRangeStart,
        targetRangeEnd,
        replacementText: replacement,
        userInstruction: buildUserInstruction(),
        modelName: selectedModel,
        thinkingMode: selectedThinkingMode,
      }, { signal: controller.signal });
      setReplacementWithHistory(response.review.replacementText);
      setOriginalText(response.review.originalText);
      setTargetRangeStart(response.review.targetRangeStart);
      setTargetRangeEnd(response.review.targetRangeEnd);
    } catch (reviewError) {
      if (!isAbortError(reviewError)) {
        setError(formatApplyError(reviewError));
      }
    } finally {
      if (reviewAbortControllerRef.current === controller) {
        reviewAbortControllerRef.current = null;
      }
      setIsReviewing(false);
    }
  };

  const selectDraftTag = (option: { id: EditType; label: string }) => {
    if (draftPromptTag === option.id) {
      setDraftPromptTag(null);
      return;
    }
    setEditType(option.id);
    setDraftPromptTag(option.id);
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
    const promptText = customPromptRequirement.trim();
    if (!label || !promptText) return;
    const nextPrompt: CustomBackfillPrompt = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.slice(0, 16),
      prompt: promptText,
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
      >
        <Undo2 className="h-4 w-4" />
        {existingPatch ? "编辑回填" : "手动回填"}
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[1000] pointer-events-none">
            <div className="pointer-events-auto fixed bottom-4 right-4 top-20 flex w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card text-sm shadow-2xl">
          <button
            type="button"
            aria-label="关闭回填面板"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3">
            <p className="font-semibold">手动回填</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              AI 只生成草稿，确认后才会写回父对话。
            </p>
          </div>
          <div className="mb-3 rounded-xl border border-border bg-muted/45 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">原选区</p>
            <p className="leading-6">{renderMarkdownSelectionPreview(source)}</p>
          </div>
          {(rangeReason || originalText !== targetText) && (
            <div className="mb-3 rounded-xl border border-violet-400/35 bg-violet-500/10 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-violet-700 dark:text-violet-300">已扩大选中范围</p>
              <p className="mb-2 text-xs leading-5 text-violet-700 dark:text-violet-300">
                为了让回填更通顺，系统建议把相邻 Markdown 标记或上下文一起纳入编辑。
              </p>
              <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {originalText}
              </p>
              {pendingRange && (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={resetToAnchorRange}>
                    仅改原选区
                  </Button>
                  <Button variant="primary" size="sm" onClick={acceptPendingRange}>
                    采用扩大范围
                  </Button>
                </div>
              )}
            </div>
          )}
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
            <div className="flex flex-wrap items-start gap-2">
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
                className="min-h-12 min-w-48 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                data-tour-backfill-generate
                onClick={generateDraft}
                disabled={!isGenerating && Boolean(conflictingPatch)}
              >
                {isGenerating ? <XCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {isGenerating ? "终止生成" : "生成草稿"}
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">文本编辑区</p>
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
              className="min-h-32 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
            />
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
              variant="outline"
              size="sm"
              onClick={reviewReplacement}
              disabled={!isReviewing && (!replacementText.trim() || Boolean(conflictingPatch))}
            >
              {isReviewing ? <XCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {isReviewing ? "终止审核" : "审核回填"}
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
