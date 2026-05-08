import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { KnowledgeTree } from "./components/KnowledgeTree";
import { NotebookDashboard } from "./components/NotebookDashboard";
import { SelectionBubble } from "./components/SelectionBubble";
import { TopBar } from "./components/TopBar";
import { Workspace } from "./components/Workspace";
import type { ThemeMode } from "./components/AppMenus";
import { useTreeLearnStore } from "./store/treelearnStore";

// 应用入口组件：负责在「笔记本首页」和「树形对话工作区」之间切换。
export default function App() {
  // 侧边栏开关和当前节点归 Zustand 管理，保证多个组件读取到同一份学习树状态。
  const sidebarOpen = useTreeLearnStore((state) => state.sidebarOpen);
  const toggleSidebar = useTreeLearnStore((state) => state.toggleSidebar);
  const setActiveNode = useTreeLearnStore((state) => state.setActiveNode);
  const hydrateFromBackend = useTreeLearnStore((state) => state.hydrateFromBackend);
  const [screen, setScreen] = useState<"dashboard" | "workspace">("dashboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    void hydrateFromBackend();
  }, [hydrateFromBackend]);

  useEffect(() => {
    // 主题只通过 html 根节点上的 class/data 属性下发，避免各组件重复处理明暗色。
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const shouldUseDark = themeMode === "dark" || (themeMode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", shouldUseDark);
      document.documentElement.dataset.theme = shouldUseDark ? "dark" : "light";
      document.documentElement.dataset.themeMode = themeMode;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  // 打开笔记本时，先把目标根节点设为活动节点，再进入工作区。
  const openNotebook = (nodeId: string) => {
    setActiveNode(nodeId);
    setScreen("workspace");
  };

  // 顶部菜单在首页和工作区共用，统一从这里传递登录态与主题配置。
  const menuProps = {
    themeMode,
    onThemeChange: setThemeMode,
    isLoggedIn,
    onLogin: () => setIsLoggedIn(true),
    onLogout: () => setIsLoggedIn(false),
  };

  if (screen === "dashboard") {
    return <NotebookDashboard onOpenNotebook={openNotebook} {...menuProps} />;
  }

  return (
    <div className="tl-app-bg flex h-screen min-h-0 flex-col overflow-hidden">
      <TopBar onHome={() => setScreen("dashboard")} {...menuProps} />
      <main className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2 md:px-4">
        <div
          className={
            sidebarOpen
              ? "grid h-full min-h-0 gap-3 lg:grid-cols-[304px_minmax(420px,1fr)]"
              : "grid h-full min-h-0 gap-3 lg:grid-cols-[52px_minmax(420px,1fr)]"
          }
        >
            {sidebarOpen ? (
              <KnowledgeTree />
            ) : (
              <aside className="tl-panel flex h-full min-h-0 flex-col items-center rounded-2xl border py-3">
                <button className="tl-hover flex h-9 w-9 items-center justify-center rounded-full" onClick={toggleSidebar} aria-label="展开 Nodes">
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
                <div className="mt-4 flex flex-1 items-center">
                  <span className="rotate-[-90deg] whitespace-nowrap text-xs font-semibold tracking-wide text-muted-foreground">Nodes</span>
                </div>
              </aside>
            )}
            <div className="min-h-0 overflow-hidden">
              <Workspace />
            </div>
        </div>
      </main>
      <SelectionBubble />
    </div>
  );
}
