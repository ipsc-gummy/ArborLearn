import { useEffect, useRef, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { KnowledgeTree } from "./components/KnowledgeTree";
import { NotebookDashboard } from "./components/NotebookDashboard";
import { SelectionBubble } from "./components/SelectionBubble";
import { TopBar } from "./components/TopBar";
import { Workspace } from "./components/Workspace";
import { AuthDialog, type AuthDialogMode, type ThemeMode } from "./components/AppMenus";
import { useTreeLearnStore } from "./store/treelearnStore";

const LAST_LOCATION_KEY = "arborlearn.lastLocation";
const THEME_MODE_KEY = "arborlearn.themeMode";
type AppScreen = "restoring" | "dashboard" | "workspace";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function themeKeyForUser(userId: string) {
  return `${THEME_MODE_KEY}.${userId}`;
}

function getStoredThemeMode(userId?: string): ThemeMode {
  try {
    const saved = localStorage.getItem(userId ? themeKeyForUser(userId) : THEME_MODE_KEY);
    return isThemeMode(saved) ? saved : "light";
  } catch {
    return "light";
  }
}

function saveThemeMode(mode: ThemeMode, userId?: string) {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
    if (userId) {
      localStorage.setItem(themeKeyForUser(userId), mode);
    }
  } catch {
    // Ignore storage failures; the visual theme has already been applied in memory.
  }
}

function getInitialScreen(): AppScreen {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "{}") as { screen?: string };
    return saved.screen === "workspace" ? "restoring" : "dashboard";
  } catch {
    return "dashboard";
  }
}

// 应用入口组件：负责在「笔记本首页」和「树形对话工作区」之间切换。
export default function App() {
  // 侧边栏开关和当前节点归 Zustand 管理，保证多个组件读取到同一份学习树状态。
  const sidebarOpen = useTreeLearnStore((state) => state.sidebarOpen);
  const toggleSidebar = useTreeLearnStore((state) => state.toggleSidebar);
  const setActiveNode = useTreeLearnStore((state) => state.setActiveNode);
  const initializeAuth = useTreeLearnStore((state) => state.initializeAuth);
  const nodes = useTreeLearnStore((state) => state.nodes);
  const activeNodeId = useTreeLearnStore((state) => state.activeNodeId);
  const apiStatus = useTreeLearnStore((state) => state.apiStatus);
  const user = useTreeLearnStore((state) => state.user);
  const authStatus = useTreeLearnStore((state) => state.authStatus);
  const authError = useTreeLearnStore((state) => state.authError);
  const login = useTreeLearnStore((state) => state.login);
  const register = useTreeLearnStore((state) => state.register);
  const logout = useTreeLearnStore((state) => state.logout);
  const [screen, setScreen] = useState<AppScreen>(getInitialScreen);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");
  const restoredLocationRef = useRef(false);

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

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

  useEffect(() => {
    if (restoredLocationRef.current) return;
    if (authStatus === "anonymous" || authStatus === "error") {
      restoredLocationRef.current = true;
      setScreen("dashboard");
      return;
    }
    if (authStatus === "authenticated" && apiStatus === "error") {
      restoredLocationRef.current = true;
      setScreen("dashboard");
      return;
    }
    if (authStatus !== "authenticated" || apiStatus !== "ready") return;

    restoredLocationRef.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "{}") as {
        screen?: "dashboard" | "workspace";
        activeNodeId?: string;
      };
      if (saved.screen === "workspace" && saved.activeNodeId && nodes[saved.activeNodeId]) {
        setActiveNode(saved.activeNodeId);
        setScreen("workspace");
      } else {
        setScreen("dashboard");
      }
    } catch {
      setScreen("dashboard");
    }
  }, [apiStatus, authStatus, nodes, setActiveNode]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;
    setThemeModeState(getStoredThemeMode(user.id));
  }, [authStatus, user]);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    saveThemeMode(mode, user?.id);
  };

  const registerWithDefaultTheme = async (email: string, password: string, displayName?: string) => {
    await register(email, password, displayName);
    const createdUser = useTreeLearnStore.getState().user;
    setThemeModeState("light");
    saveThemeMode("light", createdUser?.id);
  };

  useEffect(() => {
    if (screen !== "workspace" || !activeNodeId) return;
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({
        screen,
        activeNodeId,
      }),
    );
  }, [activeNodeId, screen]);

  const requestAuth = (mode: AuthDialogMode = "login") => {
    setAuthDialogMode(mode);
    setAuthDialogOpen(true);
  };

  const goHome = () => {
    setScreen("dashboard");
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ screen: "dashboard" }));
  };

  // 打开笔记本时，先把目标根节点设为活动节点，再进入工作区。
  const openNotebook = (nodeId: string) => {
    setActiveNode(nodeId);
    setScreen("workspace");
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ screen: "workspace", activeNodeId: nodeId }));
  };

  // 顶部菜单在首页和工作区共用，统一从这里传递登录态与主题配置。
  const menuProps = {
    themeMode,
    onThemeChange: setThemeMode,
    user,
    authStatus,
    authError,
    onLogin: login,
    onRegister: registerWithDefaultTheme,
    onLogout: () => {
      logout();
      goHome();
    },
    onRequestAuth: requestAuth,
  };

  const content =
    screen === "restoring" ? (
      <div className="tl-app-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        正在恢复工作区...
      </div>
    ) : screen === "dashboard" ? (
      <NotebookDashboard onOpenNotebook={openNotebook} {...menuProps} />
    ) : (
    <div className="tl-app-bg flex h-screen min-h-0 flex-col overflow-hidden">
      <TopBar onHome={goHome} {...menuProps} />
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

  return (
    <>
      {content}
      <AuthDialog
        open={authDialogOpen}
        initialMode={authDialogMode}
        authStatus={authStatus}
        authError={authError}
        onClose={() => setAuthDialogOpen(false)}
        onLogin={login}
        onRegister={register}
      />
    </>
  );
}
