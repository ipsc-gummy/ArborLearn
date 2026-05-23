import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Undo2 } from "lucide-react";
import { createBackfillPatch } from "../lib/api";
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
  const [open, setOpen] = useState(false);
  const [editType, setEditType] = useState<EditType>("expand");
  const [replacementText, setReplacementText] = useState(node.sourceMetadata?.anchorText ?? "");
  const [isApplying, setIsApplying] = useState(false);
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
              第一版只回填普通段落中的原始 Markdown 精确选区。
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
                  editType === option.id
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setEditType(option.id)}
              >
                {option.label}
              </button>
            ))}
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
