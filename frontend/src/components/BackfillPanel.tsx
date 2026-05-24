import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Sparkles, Undo2 } from "lucide-react";
import { createBackfillDraft, createBackfillPatch } from "../lib/api";
import { useTreeLearnStore } from "../store/treelearnStore";
import type { EditType, KnowledgeNode } from "../types/treelearn";
import { Button } from "./ui/button";

interface BackfillPanelProps {
  node: KnowledgeNode;
}

const editTypeOptions: Array<{ id: EditType; label: string }> = [
  { id: "correct", label: "纠错" },
  { id: "expand", label: "补充" },
  { id: "compress", label: "压缩" },
  { id: "reframe", label: "重构" },
];

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
  const nodes = useTreeLearnStore((state) => state.nodes);
  const hydrateFromBackend = useTreeLearnStore((state) => state.hydrateFromBackend);
  const selectedModel = useTreeLearnStore((state) => state.selectedModel);
  const selectedThinkingMode = useTreeLearnStore((state) => state.selectedThinkingMode);
  const [open, setOpen] = useState(false);
  const [editType, setEditType] = useState<EditType>("expand");
  const [draftPromptTag, setDraftPromptTag] = useState<EditType | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [replacementText, setReplacementText] = useState(node.sourceMetadata?.anchorText ?? "");
  const [isApplying, setIsApplying] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    setReplacementText(existingPatch?.replacementText ?? source?.anchorText ?? "");
    setEditType(existingPatch?.editType ?? "expand");
    setDraftPromptTag(null);
    setDraftPrompt("");
    setError(null);
  }, [existingPatch?.editType, existingPatch?.replacementText, open, source?.anchorText]);

  if (!source) return null;

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

  const generateDraft = async () => {
    if (!source || isGenerating || conflictingPatch) return;
    setIsGenerating(true);
    setError(null);
    const tagLabel = editTypeOptions.find((option) => option.id === draftPromptTag)?.label;
    const userInstruction = [tagLabel ? `#${tagLabel}` : "", draftPrompt.trim()].filter(Boolean).join(" ");
    try {
      const response = await createBackfillDraft({
        sourceChildNodeId: node.id,
        targetMessageId: source.targetMessageId,
        editType,
        userInstruction,
        modelName: selectedModel,
        thinkingMode: selectedThinkingMode,
      });
      setReplacementText(response.draft.replacementText);
    } catch (draftError) {
      setError(formatApplyError(draftError));
    } finally {
      setIsGenerating(false);
    }
  };

  const selectDraftTag = (option: { id: EditType; label: string }) => {
    setEditType(option.id);
    setDraftPromptTag(option.id);
  };

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((current) => !current)}>
        <Undo2 className="h-4 w-4" />
        {existingPatch ? "编辑回填" : "手动回填"}
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[1000] pointer-events-none">
            <div className="pointer-events-auto fixed right-4 top-20 w-[min(32rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 text-sm shadow-2xl">
          <div className="mb-3">
            <p className="font-semibold">手动回填</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              AI 只生成草稿，确认后才会写回父对话。
            </p>
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
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  draftPromptTag === option.id
                    ? "border-violet-500 bg-violet-600 text-white"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => selectDraftTag(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mb-3 rounded-xl border border-border bg-background px-3 py-2 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
            <div className="flex items-start gap-2">
              {draftPromptTag && (
                <span className="mt-0.5 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white">
                  #{editTypeOptions.find((option) => option.id === draftPromptTag)?.label}
                </span>
              )}
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
                onClick={generateDraft}
                disabled={isGenerating || Boolean(conflictingPatch)}
              >
                <Sparkles className="h-4 w-4" />
                {isGenerating ? "生成中" : "生成草稿"}
              </Button>
            </div>
          </div>
          <textarea
            value={replacementText}
            onChange={(event) => setReplacementText(event.target.value)}
            rows={6}
            className="min-h-32 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
          />
          {error && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
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
