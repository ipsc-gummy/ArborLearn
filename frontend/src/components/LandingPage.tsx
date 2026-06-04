import { ArrowRight, ArrowUpRight, BookOpenText, Check, ChevronDown, ExternalLink, FileText, GitBranch, Github, MessageSquareText, Network, Sparkles } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect } from "react";
import { GithubRepoCard, SettingsMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import { SiteFiling } from "./SiteFiling";
import { Button } from "./ui/button";

interface LandingPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

interface FooterBrandLink extends FooterLink {
  icon?: ComponentType<{ className?: string }>;
}

interface FooterSection {
  title: string;
  links: FooterLink[];
}

const proofItems = ["层级知识结构", "主对话与子对话分离", "Diagram 可视化复盘"];

const faqItems = [
  {
    question: "ArborLearn 和普通 AI 聊天工具有什么不同？",
    answer:
      "普通聊天通常把所有问题堆在一条时间线上。ArborLearn 用树状结构组织学习过程：主对话保留核心脉络，局部追问进入独立分支，方便持续探索和回顾。",
  },
  {
    question: "Notebook 是什么？",
    answer:
      "每个 Notebook 都是一个独立的学习空间，对应一门课程、一个研究主题或一项长期任务。相关对话、分支和知识结构都会沉淀在同一个 Notebook 中。",
  },
  {
    question: "如何创建子对话？",
    answer:
      "在 AI 回复中选中希望深入理解的片段，即可从该位置发起子对话。新的追问会进入独立节点，不会打断主线内容。",
  },
  {
    question: "子对话会继承哪些上下文？",
    answer:
      "子对话会沿着当前树路径继承必要上下文，让 AI 理解问题来源，同时避免无关分支干扰当前讨论。",
  },
  {
    question: "什么是子对话回填？",
    answer:
      "当局部探索形成结论后，可以将整理后的内容写回父对话对应位置。这样既保留探索过程，也让主线笔记持续完善。",
  },
  {
    question: "Diagram 视图有什么作用？",
    answer:
      "Diagram 会把主线、子节点和分支关系呈现为结构图，帮助你快速定位概念、回到历史分支，并复盘完整学习路径。",
  },
];

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
      <LowerPageAtmosphere />
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="tl-panel flex h-10 w-10 items-center justify-center rounded-full border">
            <GitBranch className="tl-brand h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">ArborLearn</p>
            <p className="text-xs text-muted-foreground">树状学习工作台</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GithubRepoCard variant="blend" />
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

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-88px)] max-w-7xl flex-col items-center justify-center px-5 pb-16 pt-10 text-center">
        <p className="tl-landing-pill mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
          AI 知识树学习平台
        </p>
        <h1 className="tl-landing-title mx-auto max-w-5xl text-5xl font-semibold leading-[1.02] md:text-7xl">
          把学习过程变成一棵可以探索、复盘的知识树
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">
          ArborLearn 把线性聊天变成可探索的知识画布。用笔记本承载主题，用主/子对话拆解问题，用 Diagram 回看整个学习路径。
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
      </div>

      <ProductShowcase
        eyebrow="01 / Notebook dashboard"
        title="从“我的 ArborLearn 笔记本”开始管理每个学习主题"
        description="每个笔记本都是一个独立的学习空间。你可以按最近更新或标题整理主题，搜索已有内容，也可以从这里创建新的知识树。"
        softTop
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

      <FaqSection />

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-24">
        <div className="tl-final-cta overflow-hidden rounded-[2rem] border px-6 py-10 text-center md:px-10 md:py-14">
          <h2 className="mx-auto max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
            让每一次学习，都留下可继续生长的结构
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
            加入ArborLearn，让每一次学习都成为一次深入探索
          </p>
          <div className="mt-8 flex justify-center">
            <Button className="h-12 px-5 text-sm" onClick={() => onRequestAuth("register")}>
              开始使用
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}

function ProductShowcase({
  eyebrow,
  title,
  description,
  children,
  softTop = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  softTop?: boolean;
}) {
  return (
    <section
      className={`tl-product-showcase tl-scroll-reveal relative z-10 mx-auto max-w-7xl px-5 pb-24 text-center${softTop ? " tl-product-showcase-soft-top" : ""}`}
      data-scroll-reveal
    >
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

function LowerPageAtmosphere() {
  return (
    <div className="tl-landing-lower-atmosphere" aria-hidden="true">
      <div className="tl-lower-mist tl-lower-mist-a" />
      <div className="tl-lower-mist tl-lower-mist-b" />
      <div className="tl-lower-aurora tl-lower-aurora-a" />
      <div className="tl-lower-aurora tl-lower-aurora-b" />
      {Array.from({ length: 70 }).map((_, index) => (
        <span key={index} className={`tl-lower-particle tl-lower-particle-${index + 1}`} />
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
        alt="浅色模式下的我的 ArborLearn 笔记本页面"
      />
      <img
        className="tl-showcase-image tl-showcase-image-dark"
        src="/showcase/notebooks-dark.png"
        alt="深色模式下的我的 ArborLearn 笔记本页面"
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
        alt="浅色模式下的 ArborLearn 主对话和子对话页面"
      />
      <img
        className="tl-showcase-image tl-showcase-image-dark"
        src="/showcase/conversation-dark.png"
        alt="深色模式下的 ArborLearn 主对话和子对话页面"
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
        alt="浅色模式下的 ArborLearn Diagram 页面"
      />
      <img
        className="tl-showcase-image tl-showcase-image-dark"
        src="/showcase/diagram-dark.png"
        alt="深色模式下的 ArborLearn Diagram 页面"
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

function FaqSection() {
  return (
    <section className="tl-faq-section relative z-10 mx-auto max-w-4xl px-5 pb-24">
      <div className="tl-scroll-reveal text-center" data-scroll-reveal>
        <p className="mb-3 text-sm font-semibold text-primary">FAQ</p>
        <h2 className="text-3xl font-semibold leading-tight md:text-5xl">常见问题</h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
          关于 ArborLearn 的使用方式与核心设计，这里整理了一些常见问题。
        </p>
      </div>

      <div className="mt-10 grid gap-3">
        {faqItems.map((item) => (
          <details key={item.question} className="tl-scroll-reveal tl-faq-item group" data-scroll-reveal>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold leading-6 marker:content-none md:text-[15px]">
              <span>{item.question}</span>
              <ChevronDown className="tl-faq-chevron h-4 w-4 shrink-0" aria-hidden="true" />
            </summary>
            <div className="px-5 pb-4">
              <p className="tl-faq-answer border-t pt-4 pb-1 text-sm leading-7 text-muted-foreground">{item.answer}</p>
            </div>
          </details>
        ))}
      </div>

      <div className="tl-scroll-reveal tl-faq-contact mx-auto mt-7 flex w-fit flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-full border px-4 py-2.5 text-center text-sm text-muted-foreground" data-scroll-reveal>
        <span>仍有疑问？欢迎前往</span>
        <a
          className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
          href="https://github.com/ipsc-gummy/ArborLearn/issues/new"
          target="_blank"
          rel="noreferrer"
        >
          GitHub Issues
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <span>提问。</span>
      </div>
    </section>
  );
}

const footerBrandLinks: FooterBrandLink[] = [
  { href: "https://github.com/ipsc-gummy/ArborLearn", label: "GitHub", icon: Github },
];

const footerSiteMapSections: FooterSection[] = [
  {
    title: "产品",
    links: [
      { href: "/guide#intro", label: "介绍" },
      { href: "/guide#why", label: "Why ArborLearn" },
      { href: "/guide#technology", label: "方法与技术" },
      { href: "/guide#features", label: "核心功能" },
      { href: "/guide#workflow", label: "使用流程" },
    ],
  },
  {
    title: "文档",
    links: [
      { href: "/guide", label: "完整文档" },
      { href: "https://github.com/ipsc-gummy/ArborLearn/blob/main/docs/API.md", label: "API 文档", external: true },
      { href: "https://github.com/ipsc-gummy/ArborLearn/blob/main/docs/ARCHITECTURE.md", label: "系统架构", external: true },
      { href: "https://github.com/ipsc-gummy/ArborLearn/blob/main/docs/FEATURE_MATRIX.md", label: "功能矩阵", external: true },
      { href: "https://github.com/ipsc-gummy/ArborLearn/blob/main/docs/PROJECT_MATURITY_ROADMAP.md", label: "Roadmap", external: true },
    ],
  },
  {
    title: "支持",
    links: [
      { href: "https://github.com/ipsc-gummy/ArborLearn/issues/new", label: "GitHub Issues", external: true },
      { href: "/guide", label: "FAQ" },
      { href: "https://github.com/ipsc-gummy/ArborLearn/issues/new", label: "项目反馈", external: true },
    ],
  },
  {
    title: "法律",
    links: [
      { href: "https://github.com/ipsc-gummy/ArborLearn/blob/main/LICENSE", label: "MIT License", external: true },
      { href: "https://beian.miit.gov.cn/", label: "备案信息", external: true },
    ],
  },
];

function LandingFooter() {
  return (
    <footer className="tl-landing-footer relative z-10 overflow-hidden border-t">
      <div className="tl-landing-footer-glow" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-5 py-14 md:py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(260px,1.1fr)_minmax(0,1.9fr)] lg:gap-16">
          <div className="max-w-md">
            <p className="tl-landing-footer-wordmark text-4xl font-semibold">ArborLearn</p>
            <p className="tl-landing-footer-tagline mt-4 max-w-sm text-sm leading-7">
              让每一次追问，都沉淀为可继续生长的知识结构。
            </p>
            <div className="mt-7 grid gap-2">
              {footerBrandLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    className="tl-landing-footer-brand-link inline-flex w-fit items-center gap-2 text-sm font-semibold transition"
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {Icon && <Icon className="h-4 w-4" />}
                    {item.label}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                );
              })}
            </div>
          </div>

          <div className="tl-landing-footer-sitemap grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {footerSiteMapSections.map((section) => (
              <nav key={section.title} aria-label={section.title}>
                <p className="tl-landing-footer-heading text-sm font-semibold">{section.title}</p>
                <div className="mt-4 grid gap-3">
                  {section.links.map((item) => (
                    <a
                      key={`${section.title}-${item.label}`}
                      className="tl-landing-footer-sitemap-link text-sm leading-6 transition"
                      href={item.href}
                      data-external={item.external ? "true" : undefined}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noreferrer" : undefined}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </nav>
            ))}
          </div>
        </div>

        <div className="tl-landing-footer-bottom mt-12 border-t pt-6">
          <SiteFiling className="tl-landing-footer-filing text-xs leading-6" linkClassName="transition hover:underline" />
        </div>
      </div>
    </footer>
  );
}
