import { ArrowLeft, ChevronDown, Github, GitBranch, GitFork, Menu, Star, X } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import guideMarkdown from "../content/arborlearn-guide.md?raw";
import { SettingsMenu, type ThemeMode } from "./AppMenus";

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

const GITHUB_REPO_URL = "https://github.com/ipsc-gummy/ArborLearn";
const GITHUB_REPO_API_URL = "https://api.github.com/repos/ipsc-gummy/ArborLearn";
const GITHUB_STARS_BADGE_URL = "https://img.shields.io/github/stars/ipsc-gummy/ArborLearn?style=flat&label=stars";
const GITHUB_FORKS_BADGE_URL = "https://img.shields.io/github/forks/ipsc-gummy/ArborLearn?style=flat&label=forks";

interface GithubRepoStats {
  stars: string;
  forks: string;
}

function headingText(children: ReactNode) {
  return Array.isArray(children) ? children.join("") : String(children);
}

async function fetchBadgeValue(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Badge service returned ${response.status}`);
  const document = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
  const labels = Array.from(document.querySelectorAll("text:not([aria-hidden])"));
  const value = labels[labels.length - 1]?.textContent;
  if (!value) throw new Error("Badge service returned an invalid SVG");
  return value;
}

export function ProductGuidePage({ themeMode, onThemeChange, onHome }: ProductGuidePageProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [githubRepoStats, setGithubRepoStats] = useState<GithubRepoStats | null>(null);

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

  useEffect(() => {
    const controller = new AbortController();

    fetch(GITHUB_REPO_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
        return response.json() as Promise<{ stargazers_count: number; forks_count: number }>;
      })
      .then(({ stargazers_count, forks_count }) => {
        setGithubRepoStats({ stars: String(stargazers_count), forks: String(forks_count) });
      })
      .catch(async (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        try {
          const [stars, forks] = await Promise.all([
            fetchBadgeValue(GITHUB_STARS_BADGE_URL, controller.signal),
            fetchBadgeValue(GITHUB_FORKS_BADGE_URL, controller.signal),
          ]);
          setGithubRepoStats({ stars, forks });
        } catch (fallbackError: unknown) {
          if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") return;
          setGithubRepoStats(null);
        }
      });

    return () => controller.abort();
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
            <a
              className="tl-guide-repo-card flex items-center gap-2 rounded-xl border px-2.5 py-1.5"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Open ArborLearn GitHub repository"
            >
              <Github className="h-5 w-5 shrink-0" />
              <span className="min-w-0">
                <span className="tl-guide-repo-name block truncate text-xs font-semibold">ArborLearn</span>
                <span className="tl-guide-repo-stats mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {githubRepoStats?.stars ?? "--"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <GitFork className="h-3 w-3" />
                    {githubRepoStats?.forks ?? "--"}
                  </span>
                </span>
              </span>
            </a>
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
