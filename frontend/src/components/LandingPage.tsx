import { ArrowRight, BookOpenText, Check, FileText, GitBranch, MessageSquareText, Network, Sparkles } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect } from "react";
import { SettingsMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import { Button } from "./ui/button";

interface LandingPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

const proofItems = ["层级知识结构", "主对话与子对话分离", "Diagram 可视化复盘"];

export function LandingPage({ themeMode, onThemeChange, onRequestAuth }: LandingPageProps) {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"));
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => {
        element.dataset.revealed = "true";
      });
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
    <main className="tl-app-bg tl-landing-page relative min-h-screen overflow-x-clip text-foreground">
      <LandingAtmosphere />
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="tl-panel flex h-10 w-10 items-center justify-center rounded-full border">
            <GitBranch className="tl-brand h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">TreeLearn</p>
            <p className="text-xs text-muted-foreground">树状学习工作台</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
          <Button variant="outline" size="sm" onClick={() => onRequestAuth("login")}>
            登录
          </Button>
          <Button size="sm" onClick={() => onRequestAuth("register")}>
            开始使用
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-88px)] max-w-7xl flex-col items-center justify-center px-5 pb-16 pt-10 text-center">
        <p className="tl-landing-pill mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
          AI 知识树学习平台
        </p>
        <h1 className="tl-landing-title mx-auto max-w-5xl text-5xl font-semibold leading-[1.02] md:text-7xl">
          把学习过程变成一棵可以探索、复盘的知识树
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">
          TreeLearn 把线性聊天变成可探索的知识画布。用笔记本承载主题，用主/子对话拆解问题，用 Diagram 回看整个学习路径。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button className="h-12 px-5 text-sm" onClick={() => onRequestAuth("register")}>
            创建我的知识树
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" className="h-12 px-5 text-sm" onClick={() => onRequestAuth("login")}>
            登录继续学习
          </Button>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {proofItems.map((item) => (
            <span key={item} className="tl-landing-check inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
              <Check className="h-3.5 w-3.5" />
              {item}
            </span>
          ))}
        </div>
      </section>

      <ProductShowcase
        eyebrow="01 / Notebook dashboard"
        title="从“我的 TreeLearn 笔记本”开始管理每个学习主题"
        description="每个笔记本都是一个独立的学习空间。你可以按最近更新或标题整理主题，搜索已有内容，也可以从这里创建新的知识树。"
      >
        <NotebookDashboardMock />
      </ProductShowcase>

      <ProductShowcase
        eyebrow="02 / Main and child chats"
        title="进入笔记本后，用主对话和子对话拆开复杂问题"
        description="主对话保留完整学习脉络，选中片段即可生成子对话。局部追问不会污染主线，上下文仍然能回到原始位置。"
      >
        <ConversationShot />
      </ProductShowcase>

      <ProductShowcase
        eyebrow="03 / Diagram review"
        title="最后用 Diagram 看见完整的知识结构"
        description="Diagram 页面把主线、子节点和分支关系压缩成可复盘的结构图，帮助你快速定位概念、回到分支并继续学习。"
      >
        <DiagramShot />
      </ProductShowcase>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-24">
        <div className="mb-8 max-w-3xl">
          <p className="mb-3 text-sm font-semibold text-primary">Capabilities</p>
          <h2 className="text-3xl font-semibold leading-tight md:text-5xl">不是另一个聊天框，而是一个会生长的学习空间</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FeatureStory icon={FileText} title="资料进入树" description="论文、课件和问题先进入独立笔记本，形成稳定的根上下文。" />
          <FeatureStory icon={MessageSquareText} title="选中即分支" description="从任意片段继续追问，让细节探索进入自己的子节点。" />
          <FeatureStory icon={Network} title="结构化复盘" description="Diagram 视图把主线、分支和关系压缩成可回看的学习地图。" />
          <FeatureStory icon={BookOpenText} title="长期主题沉淀" description="每个笔记本都是一个持续生长的研究空间，而不是一次性问答。" />
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-24">
        <div className="tl-final-cta overflow-hidden rounded-[2rem] border px-6 py-10 text-center md:px-10 md:py-14">
          <h2 className="mx-auto max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
            让每一次学习，都留下可继续生长的结构
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
            加入TreeLearn，让每一次学习都成为一次深入探索
          </p>
          <div className="mt-8 flex justify-center">
            <Button className="h-12 px-5 text-sm" onClick={() => onRequestAuth("register")}>
              开始使用
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProductShowcase({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="tl-product-showcase tl-scroll-reveal relative z-10 mx-auto max-w-7xl px-5 pb-24 text-center" data-scroll-reveal>
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-sm font-semibold text-primary">{eyebrow}</p>
        <h2 className="text-3xl font-semibold leading-tight md:text-5xl">{title}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
      <div className="tl-showcase-visual mt-10">{children}</div>
    </section>
  );
}

function LandingAtmosphere() {
  return (
    <div className="tl-landing-atmosphere" aria-hidden="true">
      <div className="tl-landing-aurora tl-landing-aurora-a" />
      <div className="tl-landing-aurora tl-landing-aurora-b" />
      <div className="tl-landing-aurora tl-landing-aurora-c" />
      <div className="tl-landing-grid" />
      <div className="tl-landing-orbit tl-landing-orbit-a" />
      <div className="tl-landing-orbit tl-landing-orbit-b" />
      {Array.from({ length: 28 }).map((_, index) => (
        <span key={index} className={`tl-landing-particle tl-landing-particle-${index + 1}`} />
      ))}
    </div>
  );
}

function NotebookDashboardMock() {
  return (
    <div className="tl-product-shot tl-product-shot-image">
      <img
        className="tl-showcase-image tl-showcase-image-light"
        src="/showcase/notebooks-light.png"
        alt="浅色模式下的我的 TreeLearn 笔记本页面"
      />
      <img
        className="tl-showcase-image tl-showcase-image-dark"
        src="/showcase/notebooks-dark.png"
        alt="深色模式下的我的 TreeLearn 笔记本页面"
      />
    </div>
  );
}

function ConversationShot() {
  return (
    <div className="tl-product-shot tl-product-shot-image">
      <img
        className="tl-showcase-image tl-showcase-image-light"
        src="/showcase/conversation-light.png"
        alt="浅色模式下的 TreeLearn 主对话和子对话页面"
      />
      <img
        className="tl-showcase-image tl-showcase-image-dark"
        src="/showcase/conversation-dark.png"
        alt="深色模式下的 TreeLearn 主对话和子对话页面"
      />
    </div>
  );
}

function DiagramShot() {
  return (
    <div className="tl-product-shot tl-product-shot-image">
      <img
        className="tl-showcase-image tl-showcase-image-light"
        src="/showcase/diagram-light.png"
        alt="浅色模式下的 TreeLearn Diagram 页面"
      />
      <img
        className="tl-showcase-image tl-showcase-image-dark"
        src="/showcase/diagram-dark.png"
        alt="深色模式下的 TreeLearn Diagram 页面"
      />
    </div>
  );
}

function FeatureStory({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <article className="tl-scroll-reveal tl-feature-tile relative overflow-hidden rounded-[1.4rem] border p-5" data-scroll-reveal>
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
    </article>
  );
}
