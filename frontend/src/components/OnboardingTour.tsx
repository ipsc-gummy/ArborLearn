import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Hand, MousePointerClick, X } from "lucide-react";
import { Button } from "./ui/button";
import { useArborLearnStore } from "../store/arborlearnStore";

type RouteKind = "landing" | "dashboard" | "workspace";
type WorkspaceView = "chat" | "diagram";

interface OnboardingTourProps {
  choiceOpen: boolean;
  onChoiceOpenChange: (open: boolean) => void;
  onComplete: () => void;
  routeKind: RouteKind;
  workspaceView: WorkspaceView;
}

interface TargetBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const TUTORIAL_NOTEBOOK_TITLE = "TreeLearn入门笔记";
const TOUR_STEP_COUNT = 18;
const ACTION_STEPS = new Set([0, 1, 2, 3, 4, 7, 9, 10, 11, 12, 13, 14, 16]);
const CLICK_ADVANCE_STEPS = new Set([9, 10, 11, 12, 14]);

function findByData(name: string, value?: string) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour-${name}]`));
  if (!value) return elements.find((element) => element.offsetParent !== null) ?? elements[0] ?? null;
  return (
    elements.find((element) => element.getAttribute(`data-tour-${name}`) === value && element.offsetParent !== null) ??
    elements.find((element) => element.getAttribute(`data-tour-${name}`) === value) ??
    null
  );
}

function findByDataAttr(name: string, attr: string, value: string | null | undefined) {
  if (!value) return null;
  const selector = `[data-tour-${name}-${attr}="${CSS.escape(value)}"]`;
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return elements.find((element) => element.offsetParent !== null) ?? elements[0] ?? null;
}

function findRightmostByData(name: string, value?: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour-${name}]`))
    .filter((element) => {
      if (value && element.getAttribute(`data-tour-${name}`) !== value) return false;
      const rect = element.getBoundingClientRect();
      return element.offsetParent !== null && rect.width > 0 && rect.height > 0;
    })
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] ?? null;
}

function findAssistantMessageContaining(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tour-message-role="assistant"]'))
    .find((element) => element.innerText.includes(text)) ?? null;
}

function findAssistantMessagesContaining(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tour-message-role="assistant"]'))
    .filter((element) => element.innerText.includes(text));
}

function findRightmostAssistantMessageContaining(text: string) {
  return findAssistantMessagesContaining(text)
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] ?? null;
}

function findTextRangeBox(root: HTMLElement | null, text: string): TargetBox | null {
  if (!root) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const value = current.textContent ?? "";
    const index = value.indexOf(text);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(current, index);
      range.setEnd(current, index + text.length);
      const rect = range.getBoundingClientRect();
      range.detach();
      if (rect.width && rect.height) {
        return {
          left: Math.max(8, rect.left - 8),
          top: Math.max(8, rect.top - 8),
          width: rect.width + 16,
          height: rect.height + 16,
        };
      }
    }
    current = walker.nextNode();
  }
  return null;
}

function measure(element: HTMLElement | null): TargetBox | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    left: Math.max(8, rect.left - 8),
    top: Math.max(8, rect.top - 8),
    width: rect.width + 16,
    height: rect.height + 16,
  };
}

function unionBoxes(boxes: TargetBox[]) {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function OnboardingTour({
  choiceOpen,
  onChoiceOpenChange,
  onComplete,
  routeKind,
  workspaceView,
}: OnboardingTourProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const activeNodeId = useArborLearnStore((state) => state.activeNodeId);
  const selectionDraft = useArborLearnStore((state) => state.selectionDraft);
  const chatRunStatusByNode = useArborLearnStore((state) => state.chatRunStatusByNode);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const [hintBox, setHintBox] = useState<TargetBox | null>(null);
  const [toolBoxes, setToolBoxes] = useState<TargetBox[]>([]);
  const [waitingNodeId, setWaitingNodeId] = useState<string | null>(null);
  const [waitingForBackfillDraft, setWaitingForBackfillDraft] = useState(false);
  const requiresUserAction = ACTION_STEPS.has(step);

  const activeNode = nodes[activeNodeId];
  const activeParent = activeNode?.parentId ? nodes[activeNode.parentId] : null;
  const hasAppliedPrefixPatch = Boolean(
    activeNode?.title === "前缀码" &&
      activeNode.sourceMetadata &&
      nodes[activeNode.sourceMetadata.parentNodeId]?.messages.some((message) =>
        message.patches?.some((patch) => patch.sourceChildNodeId === activeNode.id && patch.status === "applied"),
      ),
  );

  const startTour = () => {
    onChoiceOpenChange(false);
    setRunning(true);
    setStep(0);
  };

  const stopTour = () => {
    setRunning(false);
    setStep(0);
    setWaitingNodeId(null);
    setWaitingForBackfillDraft(false);
    onChoiceOpenChange(false);
  };

  const completeTour = () => {
    stopTour();
    onComplete();
  };

  const current = useMemo(() => {
    const titleByStep = [
      "从示例笔记本开始",
      "进入最小生成树节点",
      "手动划取 Prim 算法",
      "创建局部子对话",
      "让 AI 解释选区",
      "等待回答完成",
      "底部工具栏",
      "切到前缀码节点",
      "查看原文选区",
      "展开节点操作区",
      "打开手动回填",
      "选择补充类型",
      "生成回填草稿",
      "应用回填",
      "回到前缀码节点",
      "查看回填效果",
      "切换思维导图",
      "完成",
    ];
    return titleByStep[step] ?? "";
  }, [step]);

  const resolveTarget = () => {
    if (step === 0) return findByData("notebook-title", TUTORIAL_NOTEBOOK_TITLE);
    if (step === 1) return findByData("tree-node", "最小生成树");
    if (step === 2) return findByData("node-panel", "最小生成树");
    if (step === 3) return findByData("selection-create") ?? findAssistantMessageContaining("Kruskal 算法 和 Prim 算法");
    if (step === 4) return findByData("quick-prompt", "解释这段");
    if (step === 5) return waitingNodeId ? findByData("node-id", waitingNodeId) : activeNodeId ? findByData("node-id", activeNodeId) : null;
    if (step === 6) return findByData("composer-tools", waitingNodeId ?? activeNodeId);
    if (step === 7) return findByData("tree-node", "前缀码");
    if (step === 8) return findByData("tree-link", "前缀码") ?? findAssistantMessageContaining("最优前缀码");
    if (step === 9) return findRightmostByData("node-info-toggle") ?? findByDataAttr("node-info-toggle", "id", activeNodeId) ?? findByData("node-info-toggle");
    if (step === 10) return findRightmostByData("backfill-open") ?? findByDataAttr("backfill-open", "id", activeNodeId) ?? findByData("backfill-open");
    if (step === 11) return findByData("backfill-option", "expand");
    if (step === 12) return findByData("backfill-generate");
    if (step === 13) return findByData("backfill-apply");
    if (step === 14) return findByData("tree-node", "前缀码");
    if (step === 15) return findByData("tree-link", "前缀码") ?? findAssistantMessageContaining("最优前缀码");
    if (step === 16) return findByData("view-switch", "diagram");
    if (step === 17) return findByData("diagram");
    return null;
  };

  const resolveTargetBox = () => {
    return measure(resolveTarget());
  };

  const resolveHintBox = () => {
    if (step === 2) {
      return findTextRangeBox(findByData("node-panel", "最小生成树"), "Prim 算法");
    }
    return null;
  };

  const resolveToolBoxes = () => {
    if (step !== 6) return [];
    const nodeId = waitingNodeId ?? activeNodeId;
    return ["search", "upload", "model"]
      .map((tool) =>
        measure(
          document.querySelector<HTMLElement>(
            `[data-tour-composer-tool="${tool}"][data-tour-composer-tool-node-id="${nodeId}"]`,
          ),
        ),
      )
      .filter((box): box is TargetBox => Boolean(box));
  };

  const isInsideCurrentTarget = (eventTarget: EventTarget | null) => {
    if (step === 2) {
      const target = findByData("node-panel", "最小生成树");
      return Boolean(target && eventTarget instanceof Node && target.contains(eventTarget));
    }
    const target = resolveTarget();
    return Boolean(target && eventTarget instanceof Node && target.contains(eventTarget));
  };

  useEffect(() => {
    if (!running) return;
    const update = () => {
      const nextToolBoxes = resolveToolBoxes();
      setToolBoxes(nextToolBoxes);
      setTargetBox(step === 6 && nextToolBoxes.length ? unionBoxes(nextToolBoxes) : resolveTargetBox());
      setHintBox(resolveHintBox());
    };
    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [running, step, routeKind, activeNodeId, workspaceView]);

  useEffect(() => {
    if (!running || !requiresUserAction) return;
    const blockOutsideTarget = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (document.querySelector("[data-tour-panel]")?.contains(target) || isInsideCurrentTarget(target))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const blockScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (document.querySelector("[data-tour-panel]")?.contains(target) || isInsideCurrentTarget(target))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const blockScrollKeys = (event: KeyboardEvent) => {
      if ([" ", "PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp"].includes(event.key)) {
        blockScroll(event);
      }
    };

    document.addEventListener("pointerdown", blockOutsideTarget, true);
    document.addEventListener("click", blockOutsideTarget, true);
    document.addEventListener("wheel", blockScroll, { capture: true, passive: false });
    document.addEventListener("touchmove", blockScroll, { capture: true, passive: false });
    document.addEventListener("keydown", blockScrollKeys, true);
    return () => {
      document.removeEventListener("pointerdown", blockOutsideTarget, true);
      document.removeEventListener("click", blockOutsideTarget, true);
      document.removeEventListener("wheel", blockScroll, true);
      document.removeEventListener("touchmove", blockScroll, true);
      document.removeEventListener("keydown", blockScrollKeys, true);
    };
  }, [running, requiresUserAction, step, targetBox]);

  useEffect(() => {
    if (!running || !CLICK_ADVANCE_STEPS.has(step)) return;
    const advanceAfterTargetClick = (event: MouseEvent) => {
      const target = resolveTarget();
      if (!target || !(event.target instanceof Node) || !target.contains(event.target)) return;
      if (step === 12) {
        setWaitingForBackfillDraft(true);
        return;
      }
      window.setTimeout(() => setStep((value) => (value === step ? value + 1 : value)), 0);
    };
    document.addEventListener("click", advanceAfterTargetClick);
    return () => document.removeEventListener("click", advanceAfterTargetClick);
  }, [running, step, activeNodeId]);

  useEffect(() => {
    if (!running) return;
    if (step === 0 && routeKind === "workspace" && activeNode?.title === TUTORIAL_NOTEBOOK_TITLE) setStep(1);
    if (step === 1 && activeNode?.title === "最小生成树") setStep(2);
    if (step === 2 && selectionDraft?.text.includes("Prim")) setStep(3);
    if (step === 3 && activeNode?.selectedText?.includes("Prim")) setStep(4);
    if (step === 4 && activeNode?.selectedText?.includes("Prim") && activeNode.messages.some((message) => message.role === "user")) {
      setWaitingNodeId(activeNode.id);
      setStep(5);
    }
    const waitingNode = waitingNodeId ? nodes[waitingNodeId] : activeNode;
    if (
      step === 5 &&
      waitingNode?.selectedText?.includes("Prim") &&
      !chatRunStatusByNode[waitingNode.id] &&
      waitingNode.messages.some(
        (message) =>
          message.role === "assistant" &&
          !message.content.includes("正在") &&
          !message.content.includes("姝ｅ湪") &&
          !message.content.includes("..."),
      )
    ) {
      setStep(6);
    }
    if (step === 7 && activeNode?.title === "前缀码") setStep(8);
    if (step === 13 && hasAppliedPrefixPatch) setStep(14);
    if (step === 16 && workspaceView === "diagram") setStep(17);
  }, [activeNode, activeNodeId, chatRunStatusByNode, hasAppliedPrefixPatch, nodes, routeKind, running, selectionDraft, step, waitingNodeId, workspaceView]);

  useEffect(() => {
    if (!running || step !== 12 || !waitingForBackfillDraft) return;
    const timer = window.setInterval(() => {
      const generateButton = findByData("backfill-generate") as HTMLButtonElement | null;
      const applyButton = findByData("backfill-apply") as HTMLButtonElement | null;
      if (generateButton && applyButton && !generateButton.disabled && !applyButton.disabled) {
        setWaitingForBackfillDraft(false);
        setStep(13);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [running, step, waitingForBackfillDraft]);

  if (typeof document === "undefined") return null;

  const bubbleWidth = Math.min(340, window.innerWidth - 32);
  const placeBelowTarget = step === 2 && hintBox;
  const bubbleAnchorBox = step === 2 ? hintBox ?? targetBox : targetBox;
  const bubbleLeft = targetBox
    ? step === 5
      ? clamp(targetBox.left - bubbleWidth - 18, 16, window.innerWidth - bubbleWidth - 16)
      : step === 10
      ? clamp(targetBox.left + targetBox.width - bubbleWidth, 16, window.innerWidth - bubbleWidth - 16)
      : step === 12
      ? clamp(targetBox.left - bubbleWidth - 18, 16, window.innerWidth - bubbleWidth - 16)
      : step === 4
      ? clamp(targetBox.left + targetBox.width / 2 - bubbleWidth / 2, 16, window.innerWidth - bubbleWidth - 16)
      : placeBelowTarget
      ? clamp((bubbleAnchorBox?.left ?? 0) + (bubbleAnchorBox?.width ?? 0) / 2 - bubbleWidth / 2, 16, window.innerWidth - bubbleWidth - 16)
      : clamp((bubbleAnchorBox?.left ?? targetBox.left) + (bubbleAnchorBox?.width ?? targetBox.width) + 18, 16, window.innerWidth - bubbleWidth - 16)
    : window.innerWidth / 2 - bubbleWidth / 2;
  const bubbleTop = targetBox
    ? step === 5
      ? clamp(targetBox.top + 24, 16, window.innerHeight - 230)
      : step === 10
      ? clamp(targetBox.top + targetBox.height + 14, 16, window.innerHeight - 230)
      : step === 12
      ? clamp(targetBox.top - 18, 16, window.innerHeight - 230)
      : step === 4
      ? clamp(targetBox.top - 178, 16, window.innerHeight - 230)
      : placeBelowTarget
      ? clamp((bubbleAnchorBox?.top ?? 0) + (bubbleAnchorBox?.height ?? 0) + 52, 16, window.innerHeight - 230)
      : clamp(bubbleAnchorBox?.top ?? targetBox.top, 16, window.innerHeight - 260)
    : window.innerHeight / 2 - 110;

  return createPortal(
    <>
      {choiceOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="tl-tour-panel tl-panel w-full max-w-lg rounded-2xl border p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-primary">TreeLearn 快速上手</p>
                <h2 className="mt-1 text-xl font-semibold">你想如何开始？</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  新用户教程会用“TreeLearn入门笔记”带你实际体验子对话、手动回填和思维导图。
                </p>
              </div>
              <button className="tl-hover rounded-full p-2" onClick={() => onChoiceOpenChange(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button className="rounded-xl border border-primary/35 bg-primary/10 p-4 text-left transition hover:bg-primary/15" onClick={startTour}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <MousePointerClick className="h-4 w-4" />
                </span>
                <span className="mt-3 block font-semibold">TreeLearn 新用户</span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">开启新手引导，跟着示例完成核心流程。</span>
              </button>
              <button className="rounded-xl border border-border p-4 text-left transition hover:bg-muted" onClick={stopTour}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Check className="h-4 w-4" />
                </span>
                <span className="mt-3 block font-semibold">TreeLearn 老用户</span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">暂不开启教程，直接进入自己的学习空间。</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {running && (
        <div className="pointer-events-none fixed inset-0 z-[1100]">
          {!targetBox && <div className="absolute inset-0 bg-black/55" />}
          {targetBox && (
            <>
              <div className="absolute left-0 right-0 top-0 bg-black/55" style={{ height: targetBox.top }} />
              <div
                className="absolute left-0 bg-black/55"
                style={{ top: targetBox.top, width: targetBox.left, height: targetBox.height }}
              />
              <div
                className="absolute right-0 bg-black/55"
                style={{
                  top: targetBox.top,
                  left: targetBox.left + targetBox.width,
                  height: targetBox.height,
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-black/55"
                style={{ top: targetBox.top + targetBox.height }}
              />
              <div
                className="absolute rounded-xl border-2 border-primary/80 bg-transparent"
                style={targetBox}
              />
              {step === 2 && hintBox && (
                <>
                  <div
                    className="tl-tour-select-hint absolute rounded-md border border-primary/50 bg-primary/15"
                    style={{
                      left: hintBox.left,
                      top: hintBox.top,
                      width: hintBox.width,
                      height: hintBox.height,
                    }}
                  />
                  <div
                    className="tl-tour-hand-swipe absolute flex h-9 w-9 items-center justify-center rounded-full border border-primary/45 bg-background/90 text-primary shadow-lg"
                    style={{
                      left: hintBox.left,
                      top: hintBox.top + hintBox.height + 4,
                    }}
                  >
                    <Hand className="h-5 w-5" />
                  </div>
                </>
              )}
            </>
          )}
          <div
            data-tour-panel
            className="tl-tour-panel tl-panel pointer-events-auto absolute w-[min(21rem,calc(100vw-2rem))] rounded-2xl border p-4 shadow-2xl"
            style={{ left: bubbleLeft, top: bubbleTop, width: bubbleWidth }}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-primary">步骤 {Math.min(step + 1, TOUR_STEP_COUNT)} / {TOUR_STEP_COUNT}</p>
                <h3 className="mt-1 font-semibold">{current}</h3>
              </div>
              <button className="tl-hover rounded-full p-1.5" onClick={stopTour} aria-label="结束引导">
                <X className="h-4 w-4" />
              </button>
            </div>
            <TourCopy step={step} />
            <div className="mt-4 flex justify-end gap-2">
              {[6, 8, 15].includes(step) && (
                <Button size="sm" onClick={() => setStep((value) => value + 1)}>
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              {step === 17 && (
                <Button size="sm" onClick={completeTour}>
                  开启 TreeLearn 学习之旅
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

function TourCopy({ step }: { step: number }) {
  const copy = [
    "这是为你准备的可控示例笔记本。点击它进入工作区，我们会在真实内容里完成一次学习流程。",
    "左侧是树形对话结构。先点“最小生成树”，我们会从一个局部概念发起追问。",
    "请用鼠标拖选句子里的“Prim 算法”。选区动作用来告诉 TreeLearn：我只想围绕这几个字展开。",
    "点击浮层里的“子对话”按钮。TreeLearn 会保留原文位置，并把局部问题放进独立分支。",
    "点击底部的“解释这段”。子对话会带着父节点上下文提问，但不会把局部问题直接搅进主线。",
    "等 AI 输出结束后，我们继续看输入框底部的常用工具。",
    "这里有联网搜索、上传文件入口，以及模型和思考强度切换。它们是辅助工具，核心仍是树形上下文。",
    "接下来点“前缀码”节点，我们演示把子对话结论回填到原文。",
    "左侧父对话里这段对前缀码讲得偏短。回填功能可以在你确认后，把更好的解释写回原位置。",
    "先点节点顶部的小下拉，展开这个节点的操作区。",
    "点击“手动回填”。这里会展示原选区、编辑类型和草稿生成入口。",
    "选择“补充”。这表示我们不是改错，而是在原位置扩充解释。",
    "点击“生成草稿”，让 AI 根据子对话和原文位置生成一版可审核内容。",
    "草稿满意后点击“应用回填”。TreeLearn 会保留来源关系，并把内容写回父对话。",
    "先点击左侧边栏的“前缀码”对话节点，回到包含原选区的父子对话视图。",
    "看这里，原来的前缀码位置已经更新成回填后的内容，并且仍然能追溯到对应子节点。",
    "最后切到思维导图。它把当前笔记本的主线、分支和局部追问组织成可复盘结构。",
    "核心流程完成了：局部选区、子对话、审核回填、思维导图。现在可以开始自己的 TreeLearn 学习之旅。",
  ];
  return <p className="text-sm leading-6 text-muted-foreground">{copy[step] ?? ""}</p>;
}
