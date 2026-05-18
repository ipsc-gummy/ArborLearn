import { ArrowRight, GitBranch, Layers3, MessageSquareText, Network, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect } from "react";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { SettingsMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import { Button } from "./ui/button";

interface LandingPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

export function LandingPage({ themeMode, onThemeChange, onRequestAuth }: LandingPageProps) {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"));
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.dataset.revealed = "true");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.18 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="tl-app-bg relative min-h-screen overflow-x-clip text-foreground">
      <AmbientBackdrop variant="dashboard" />
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="tl-panel flex h-10 w-10 items-center justify-center rounded-full border">
            <GitBranch className="tl-brand h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">ArborLearn</p>
            <p className="text-xs text-muted-foreground">Visual knowledge workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
          <Button variant="outline" size="sm" onClick={() => onRequestAuth("login")}>
            登录
          </Button>
          <Button size="sm" onClick={() => onRequestAuth("login")}>
            Get started
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-88px)] max-w-7xl items-center gap-12 px-5 pb-16 pt-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(480px,1.08fr)]">
        <div>
          <p className="tl-accent-soft mb-5 inline-flex rounded-full border border-white/45 px-3 py-1 text-xs font-medium shadow-sm">
            AI 知识树学习平台
          </p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] md:text-7xl">
            把资料变成一棵可以探索的知识树
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
            从一篇论文、一份课件或一个问题开始，让主线、分支、上下文和复盘产物自然生长在同一个可视化画布里。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button className="h-12 px-5 text-sm" onClick={() => onRequestAuth("login")}>
              Get started
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="h-12 px-5 text-sm" onClick={() => onRequestAuth("register")}>
              创建账号
            </Button>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <LandingMetric value="Tree" label="层级知识结构" />
            <LandingMetric value="Chat" label="围绕节点追问" />
            <LandingMetric value="Map" label="可视化复盘" />
          </div>
        </div>

        <LandingCanvas />
      </section>

      <section className="tl-scroll-reveal relative z-10 mx-auto max-w-7xl px-5 pb-20" data-scroll-reveal>
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureStory
            icon={Layers3}
            eyebrow="Context first"
            title="每个节点都是独立上下文"
            description="主线保留完整学习脉络，分支承载局部追问。资料、问题和 AI 回复不会混成一团，而是自然挂在知识树上。"
          />
          <FeatureStory
            icon={MessageSquareText}
            eyebrow="Branch chat"
            title="从任意片段继续深入"
            description="选中文本就能生成子对话，把一个概念拆成新的探索路径。你可以回到父节点，也可以沿着分支继续推演。"
          />
          <FeatureStory
            icon={Network}
            eyebrow="Visual map"
            title="复盘时看到完整结构"
            description="聊天不是线性记录，而会沉淀成可查看、可缩放、可回访的 diagram，帮助你重新理解知识之间的关系。"
          />
        </div>
      </section>

      <section className="tl-scroll-reveal relative z-10 mx-auto grid max-w-7xl gap-8 px-5 pb-24 lg:grid-cols-[0.85fr_1.15fr] lg:items-center" data-reveal-delay="1" data-scroll-reveal>
        <div>
          <p className="mb-3 text-sm font-semibold text-muted-foreground">Workflow</p>
          <h2 className="max-w-2xl text-3xl font-semibold leading-tight md:text-5xl">
            从资料到复盘，保持同一棵树的上下文
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
            ArborLearn 的重点不是多一个聊天框，而是让学习过程本身有结构：导入、追问、分支、回看、复盘，都围绕同一张知识画布发生。
          </p>
        </div>
        <div className="tl-panel rounded-[1.6rem] border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <WorkflowStep index="01" title="创建知识空间" description="为一篇论文、一门课程或一个研究主题开启独立笔记本。" />
            <WorkflowStep index="02" title="围绕节点提问" description="在当前节点中保留上下文，让回答和资料始终可追溯。" />
            <WorkflowStep index="03" title="分支探索" description="把片段、概念和疑问拆成子节点，形成自然的学习路径。" />
            <WorkflowStep index="04" title="Diagram 复盘" description="用树形图回看知识结构，快速定位主线和支线。" />
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-24">
        <ProductShowcase
          eyebrow="Import to tree"
          title="资料不是被丢进聊天框，而是长成一个知识空间"
          description="每个笔记本都是独立的学习容器。资料、摘要、提问和分支都围绕根节点展开，后续回看时不会失去上下文。"
          visual="source"
        />
        <ProductShowcase
          eyebrow="Selection to branch"
          title="从一句话继续追问，让局部问题自然变成分支"
          description="在聊天内容里选中片段，直接创建子对话。主线保持干净，细节探索进入自己的分支。"
          visual="selection"
          reverse
        />
        <ProductShowcase
          eyebrow="Review with diagram"
          title="最终得到的不是记录堆，而是一张可复盘的思维导图"
          description="Diagram 视图把节点、子节点和关系压缩成可视化结构，适合复习、定位和继续学习。"
          visual="diagram"
        />
      </section>
    </main>
  );
}

function LandingMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/45 bg-white/30 px-4 py-3 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
      <p className="text-sm font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FeatureStory({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <article className="tl-panel relative overflow-hidden rounded-[1.4rem] border p-5">
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/65 to-transparent opacity-70 dark:via-white/12" />
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
      <h3 className="mt-2 text-lg font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
    </article>
  );
}

function WorkflowStep({ index, title, description }: { index: string; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-border/65 bg-background/42 p-4">
      <p className="text-xs font-semibold text-primary">{index}</p>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function ProductShowcase({
  eyebrow,
  title,
  description,
  visual,
  reverse,
}: {
  eyebrow: string;
  title: string;
  description: string;
  visual: "source" | "selection" | "diagram";
  reverse?: boolean;
}) {
  return (
    <div
      className={`tl-scroll-reveal grid gap-8 py-10 lg:grid-cols-2 lg:items-center ${reverse ? "lg:[&>div:first-child]:order-2" : ""}`}
      data-scroll-reveal
    >
      <div>
        <p className="mb-3 text-sm font-semibold text-primary">{eyebrow}</p>
        <h2 className="max-w-xl text-3xl font-semibold leading-tight md:text-5xl">{title}</h2>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
      <ShowcaseVisual type={visual} />
    </div>
  );
}

function ShowcaseVisual({ type }: { type: "source" | "selection" | "diagram" }) {
  return (
    <div className="tl-panel overflow-hidden rounded-[1.6rem] border p-4">
      <div className="relative min-h-80 overflow-hidden rounded-2xl border border-border/65 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--tl-brand)_10%,transparent),transparent_16rem),linear-gradient(color-mix(in_srgb,var(--tl-border)_30%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--tl-border)_30%,transparent)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px] p-5">
        {type === "source" && <SourceVisual />}
        {type === "selection" && <SelectionVisual />}
        {type === "diagram" && <DiagramVisual />}
      </div>
    </div>
  );
}

function SourceVisual() {
  return (
    <>
      <div className="absolute left-6 top-8 w-40 rounded-2xl border border-border/70 bg-card/86 p-4 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold text-muted-foreground">Source</p>
        <p className="mt-3 text-sm font-semibold">paper.pdf</p>
        <div className="mt-4 space-y-2">
          <span className="block h-2 rounded-full bg-muted" />
          <span className="block h-2 w-4/5 rounded-full bg-muted" />
          <span className="block h-2 w-2/3 rounded-full bg-muted" />
        </div>
      </div>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 420 300" aria-hidden="true">
        <path d="M166 102 C214 98, 224 132, 268 150" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
        <path d="M268 150 C308 174, 324 198, 354 232" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="absolute left-[55%] top-[38%] w-36 rounded-2xl border border-primary/35 bg-card/88 p-3 shadow-panel backdrop-blur">
        <p className="text-sm font-semibold">Root node</p>
        <p className="mt-1 text-xs text-muted-foreground">learning context</p>
      </div>
      <div className="absolute bottom-8 right-8 w-32 rounded-2xl border border-border/70 bg-card/82 p-3 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold">Summary</p>
        <p className="mt-1 text-xs text-muted-foreground">auto organized</p>
      </div>
    </>
  );
}

function SelectionVisual() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border/70 bg-card/84 p-5 shadow-sm backdrop-blur">
      <p className="text-xs font-semibold text-muted-foreground">Conversation</p>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        The model explains the core concept and highlights a
        <span className="mx-1 rounded bg-primary/15 px-1.5 py-0.5 font-medium text-foreground">local assumption</span>
        that deserves a focused follow-up.
      </p>
      <div className="mt-5 inline-flex rounded-full border border-border/70 bg-background/80 p-1 text-xs shadow-sm">
        <span className="rounded-full px-3 py-1 text-muted-foreground">Copy</span>
        <span className="rounded-full px-3 py-1 text-muted-foreground">Search</span>
        <span className="rounded-full bg-primary px-3 py-1 text-primary-foreground">Branch</span>
      </div>
      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/8 p-3 text-xs text-muted-foreground">
        New child node keeps the selected text as context.
      </div>
    </div>
  );
}

function DiagramVisual() {
  return (
    <>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 420 300" aria-hidden="true">
        <path d="M78 140 C140 80, 220 92, 276 140" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
        <path d="M276 140 C316 160, 346 190, 374 230" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
        <path d="M276 140 C228 198, 164 214, 110 238" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <CanvasNode className="left-8 top-28" icon={Layers3} title="Root" subtitle="main line" />
      <CanvasNode className="left-[52%] top-[36%]" icon={Network} title="Concept" subtitle="active" active />
      <CanvasNode className="bottom-8 left-16" icon={MessageSquareText} title="Question" subtitle="branch" />
      <CanvasNode className="bottom-8 right-8" icon={Sparkles} title="Review" subtitle="output" />
    </>
  );
}

function LandingCanvas() {
  return (
    <div className="relative">
      <div className="absolute -inset-10 rounded-[3rem] bg-[radial-gradient(circle_at_50%_30%,color-mix(in_srgb,var(--tl-brand)_18%,transparent),transparent_34rem)]" />
      <div className="tl-panel relative overflow-hidden rounded-[2rem] border p-4 shadow-panel">
        <div className="flex items-center justify-between border-b border-border/60 px-2 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f6c85f]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#5cc98b]" />
          </div>
          <span className="rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground">Knowledge canvas</span>
        </div>
        <div className="grid min-h-[460px] gap-3 pt-3 lg:grid-cols-[160px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-border/65 bg-background/45 p-3">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">Nodes</p>
            <CanvasOutline label="资料导入" active />
            <CanvasOutline label="核心概念" />
            <CanvasOutline label="分支追问" />
            <CanvasOutline label="复盘输出" />
          </aside>
          <div className="relative overflow-hidden rounded-2xl border border-border/65 bg-[radial-gradient(circle_at_28%_18%,color-mix(in_srgb,var(--tl-brand)_10%,transparent),transparent_18rem),linear-gradient(color-mix(in_srgb,var(--tl-border)_34%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--tl-border)_34%,transparent)_1px,transparent_1px)] bg-[size:auto,30px_30px,30px_30px]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 480 360" aria-hidden="true">
              <path d="M92 112 C160 70, 238 88, 286 150" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
              <path d="M286 150 C342 174, 378 206, 414 262" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
              <path d="M286 150 C224 210, 170 234, 112 278" fill="none" stroke="var(--tl-border)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <CanvasNode className="left-8 top-20" icon={Layers3} title="Source" subtitle="paper.pdf" />
            <CanvasNode className="left-[45%] top-[35%]" icon={Network} title="Core idea" subtitle="context node" active />
            <CanvasNode className="bottom-12 left-12" icon={MessageSquareText} title="Follow-up" subtitle="branch chat" />
            <CanvasNode className="bottom-14 right-8" icon={Sparkles} title="Review" subtitle="diagram notes" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CanvasOutline({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`mb-2 rounded-lg px-2 py-2 text-xs ${active ? "bg-primary/10 text-foreground" : "text-muted-foreground"}`}>
      {label}
    </div>
  );
}

function CanvasNode({
  className,
  icon: Icon,
  title,
  subtitle,
  active,
}: {
  className: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  active?: boolean;
}) {
  return (
    <div
      className={`absolute w-36 rounded-2xl border bg-card/84 p-3 shadow-sm backdrop-blur-md ${
        active ? "border-primary/45 ring-4 ring-primary/10" : "border-border/70"
      } ${className}`}
    >
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
