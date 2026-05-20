import * as Popover from "@radix-ui/react-popover";
import { CheckCircle2, ClipboardList, Loader2, Play, Search, Square, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cancelLongTask,
  createLongTask,
  fetchLongTask,
  fetchLongTaskStep,
  runLongTask,
  type LongTask,
  type LongTaskStep,
  type LongTaskStepDetail,
} from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { MarkdownContent } from "./MarkdownContent";
import { useTreeLearnStore } from "../store/treelearnStore";
import { type ModelScope } from "../lib/modelScope";

interface LongTaskPanelProps {
  nodeId: string;
  notebookId: string;
  nodeTitle: string;
  panelId?: string;
}

const terminalStatuses = new Set(["DONE", "FAILED", "CANCELLED"]);

function statusLabel(status: string) {
  return {
    CREATED: "已创建",
    PLANNING: "规划中",
    RUNNING: "执行中",
    SUMMARIZING: "汇总中",
    DONE: "完成",
    FAILED: "失败",
    CANCELLED: "已取消",
    PENDING: "等待",
    SKIPPED: "跳过",
  }[status] ?? status;
}

function statusTone(status: string) {
  if (status === "DONE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "FAILED") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "CANCELLED" || status === "SKIPPED") return "border-muted-foreground/25 bg-muted text-muted-foreground";
  if (status === "RUNNING" || status === "PLANNING" || status === "SUMMARIZING") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "DONE") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "FAILED") return <XCircle className="h-4 w-4" />;
  if (status === "RUNNING" || status === "PLANNING" || status === "SUMMARIZING") {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  return <ClipboardList className="h-4 w-4" />;
}

export function LongTaskPanel({ nodeId, notebookId, nodeTitle, panelId }: LongTaskPanelProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [task, setTask] = useState<LongTask | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stepDetail, setStepDetail] = useState<LongTaskStepDetail | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getModelConfig = useTreeLearnStore((state) => state.getModelConfig);
  const modelScope: ModelScope = { panelId, threadId: nodeId, nodeId, notebookId };

  const activeStep = useMemo(() => {
    if (!task?.steps?.length) return null;
    return task.steps.find((step) => step.status === "RUNNING") ?? task.steps[task.current_step_index] ?? null;
  }, [task]);

  useEffect(() => {
    if (!task || terminalStatuses.has(task.status)) return;
    const interval = window.setInterval(() => {
      void fetchLongTask(task.id)
        .then((nextTask) => {
          setTask(nextTask);
          if (selectedStepId && nextTask.steps?.some((step) => step.id === selectedStepId)) {
            void fetchLongTaskStep(nextTask.id, selectedStepId).then(setStepDetail).catch(() => undefined);
          }
        })
        .catch((pollError) => setError(pollError instanceof Error ? pollError.message : "长任务状态刷新失败"));
    }, 1600);
    return () => window.clearInterval(interval);
  }, [task?.id, task?.status, selectedStepId]);

  const startTask = async () => {
    const trimmed = question.trim();
    if (!trimmed || isStarting) return;
    setIsStarting(true);
    setError(null);
    setStepDetail(null);
    setSelectedStepId(null);
    try {
      const created = await createLongTask({
        node_id: nodeId,
        notebook_id: notebookId,
        question: trimmed,
        title: trimmed.slice(0, 32),
        ...getModelConfig(modelScope),
      });
      await runLongTask(created.id);
      const nextTask = await fetchLongTask(created.id);
      setTask(nextTask);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "长任务启动失败");
    } finally {
      setIsStarting(false);
    }
  };

  const refreshStep = async (step: LongTaskStep) => {
    setSelectedStepId(step.id);
    setError(null);
    try {
      setStepDetail(await fetchLongTaskStep(step.task_id, step.id));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "步骤详情读取失败");
    }
  };

  const cancelTask = async () => {
    if (!task || terminalStatuses.has(task.status)) return;
    setError(null);
    try {
      await cancelLongTask(task.id);
      setTask(await fetchLongTask(task.id));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消长任务失败");
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" title="长任务">
          <ClipboardList className="h-4 w-4" />
          长任务
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={10}
          className="tl-panel z-50 flex max-h-[78vh] w-[28rem] flex-col overflow-hidden rounded-2xl border p-0 text-sm shadow-panel outline-none"
        >
          <div className="border-b border-border/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">长任务执行链</p>
                <p className="truncate text-xs text-muted-foreground">{nodeTitle}</p>
              </div>
              {task && !terminalStatuses.has(task.status) && (
                <Button variant="ghost" size="sm" onClick={cancelTask} title="取消任务">
                  <Square className="h-4 w-4" />
                  取消
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
                className="min-h-20 w-full resize-none rounded-xl border border-border bg-background/80 px-3 py-2 text-sm leading-6 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                placeholder="输入一个复杂学习或科研问题..."
              />
              <Button
                variant="primary"
                size="sm"
                onClick={startTask}
                disabled={isStarting || !question.trim()}
                className="w-full"
              >
                {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                开始长任务
              </Button>
              {error && (
                <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                  {error}
                </div>
              )}
            </div>

            {task && (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-border bg-background/58 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{task.title || "长任务"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        当前步骤：{activeStep ? `${activeStep.step_index + 1}. ${activeStep.title}` : "等待规划"}
                      </p>
                    </div>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs", statusTone(task.status))}>
                      <StatusIcon status={task.status} />
                      {statusLabel(task.status)}
                    </span>
                  </div>
                  {task.plan_summary && <p className="mt-2 text-xs leading-5 text-muted-foreground">{task.plan_summary}</p>}
                </div>

                <div className="space-y-2">
                  {task.steps?.map((step) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => refreshStep(step)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left transition hover:border-primary/35 hover:bg-primary/5",
                        selectedStepId === step.id ? "border-primary/35 bg-primary/10" : "border-border bg-background/48",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {step.step_index + 1}. {step.title}
                        </span>
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", statusTone(step.status))}>
                          <StatusIcon status={step.status} />
                          {statusLabel(step.status)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {step.output_summary || step.goal}
                      </p>
                      {step.need_retrieval && (
                        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary">
                          <Search className="h-3.5 w-3.5" />
                          联网检索
                        </p>
                      )}
                    </button>
                  ))}
                </div>

                {stepDetail && (
                  <div className="rounded-xl border border-border bg-background/58 px-3 py-3">
                    <p className="font-medium">{stepDetail.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{stepDetail.goal}</p>
                    {stepDetail.outputs.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {stepDetail.outputs.map((output) => (
                          <div key={output.id} className="rounded-lg bg-muted/70 px-3 py-2">
                            <p className="text-xs font-medium text-muted-foreground">阶段输出</p>
                            <MarkdownContent content={output.summary || output.content} />
                          </div>
                        ))}
                      </div>
                    )}
                    {stepDetail.evidence.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">证据片段</p>
                        {stepDetail.evidence.slice(0, 4).map((item) => (
                          <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2">
                            <p className="line-clamp-1 text-xs font-medium">{item.title || item.url || "来源"}</p>
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-[11px] text-primary">
                                {item.url}
                              </a>
                            )}
                            <p className="mt-1 line-clamp-4 text-xs leading-5 text-muted-foreground">{item.evidence_text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {task.final_answer && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
                    <p className="mb-2 font-medium">最终答案</p>
                    <MarkdownContent content={task.final_answer} />
                  </div>
                )}

                {task.error_message && (
                  <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                    {task.error_message}
                  </div>
                )}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
