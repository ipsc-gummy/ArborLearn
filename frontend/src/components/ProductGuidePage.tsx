import { ArrowLeft, ChevronDown, GitBranch, Menu, X } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import guideMarkdown from "../content/arborlearn-guide.md?raw";
import { GithubRepoCard, SettingsMenu, type ThemeMode } from "./AppMenus";
import { SiteFiling } from "./SiteFiling";

interface ProductGuidePageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onHome: () => void;
}

const guideNavItems = [
  { href: "#intro", label: "介绍" },
  { href: "#why", label: "Why ArborLearn" },
  { href: "#technology", label: "方法与技术" },
  { href: "#features", label: "核心功能" },
  { href: "#workflow", label: "使用流程" },
];

const headingIds: Record<string, string> = {
  介绍: "intro",
  "Why ArborLearn": "why",
  方法与技术: "technology",
  核心功能: "features",
  使用流程: "workflow",
};

function headingText(children: ReactNode) {
  return Array.isArray(children) ? children.join("") : String(children);
}

export function ProductGuidePage({ themeMode, onThemeChange, onHome }: ProductGuidePageProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const scrollToHash = () => {
      if (!window.location.hash) return;
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
    };
    const frame = window.requestAnimationFrame(scrollToHash);
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, []);

  return (
    <main className="tl-guide-page min-h-screen text-foreground">
      <header className="tl-guide-header sticky top-0 z-40 border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <button className="flex items-center gap-3 text-left" onClick={onHome}>
            <span className="tl-guide-brand-mark flex h-9 w-9 items-center justify-center rounded-full border">
              <GitBranch className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold">ArborLearn</span>
              <span className="block text-xs text-muted-foreground">Product Guide</span>
            </span>
          </button>
          <div className="flex items-center gap-1">
            <button className="tl-guide-ghost-button hidden items-center gap-2 rounded-full px-3 py-2 text-sm sm:inline-flex" onClick={onHome}>
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </button>
            <GithubRepoCard />
            <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
          </div>
        </div>
      </header>

      <div className="tl-guide-mobile-nav sticky top-[65px] z-30 border-b px-5 py-3 lg:hidden">
        <button className="flex w-full items-center justify-between gap-3 text-sm font-semibold" onClick={() => setMobileNavOpen((open) => !open)}>
          <span className="inline-flex items-center gap-2">
            <Menu className="h-4 w-4" />
            目录
          </span>
          {mobileNavOpen ? <X className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {mobileNavOpen && <GuideNav onSelect={() => setMobileNavOpen(false)} />}
      </div>

      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-14 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-20">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Contents</p>
            <GuideNav />
          </div>
        </aside>

        <article className="tl-guide-prose min-w-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1({ children }) {
                return <h1>{children}</h1>;
              },
              h2({ children }) {
                const id = headingIds[headingText(children)];
                return <h2 id={id} className="scroll-mt-28">{children}</h2>;
              },
              h3({ children }) {
                return <h3>{children}</h3>;
              },
              a({ children, href }) {
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
              table({ children }) {
                return <div className="tl-guide-table-wrap"><table>{children}</table></div>;
              },
              code({ className, children, ...props }: ComponentProps<"code">) {
                return <code className={className} {...props}>{children}</code>;
              },
            }}
          >
            {guideMarkdown}
          </ReactMarkdown>
        </article>
      </div>
      <footer className="mx-auto max-w-7xl px-5 pb-10">
        <SiteFiling className="border-t pt-6 text-center text-xs leading-6 text-muted-foreground" linkClassName="transition hover:text-foreground" />
      </footer>
    </main>
  );
}

function GuideNav({ onSelect }: { onSelect?: () => void }) {
  return (
    <nav className="tl-guide-nav grid gap-1">
      {guideNavItems.map((item) => (
        <a key={item.href} href={item.href} onClick={onSelect}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
