import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { KnowledgeTree } from "./components/KnowledgeTree";
import { AmbientBackdrop } from "./components/AmbientBackdrop";
import { LandingPage } from "./components/LandingPage";
import { NotebookDashboard } from "./components/NotebookDashboard";
import { PageTransition } from "./components/PageTransition";
import { SelectionBubble } from "./components/SelectionBubble";
import { TopBar } from "./components/TopBar";
import { Workspace } from "./components/Workspace";
import { AuthDialog, type AuthDialogMode, type ThemeMode } from "./components/AppMenus";
import { useTreeLearnStore } from "./store/treelearnStore";

const LAST_LOCATION_KEY = "arborlearn.lastLocation";
const THEME_MODE_KEY = "arborlearn.themeMode";

type AppRoute =
  | { kind: "landing" }
  | { kind: "dashboard" }
  | { kind: "workspace"; notebookId: string; nodeId?: string };

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

function parseRoute(pathname: string): AppRoute {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] === "notebooks" && segments[1]) {
    return {
      kind: "workspace",
      notebookId: segments[1],
      nodeId: segments[2] === "nodes" ? segments[3] : undefined,
    };
  }
  if (segments[0] === "notebooks") return { kind: "dashboard" };
  return { kind: "landing" };
}

function routeToPath(route: AppRoute) {
  if (route.kind === "dashboard") return "/notebooks";
  if (route.kind === "workspace") {
    const notebookPath = `/notebooks/${encodeURIComponent(route.notebookId)}`;
    return route.nodeId ? `${notebookPath}/nodes/${encodeURIComponent(route.nodeId)}` : notebookPath;
  }
  return "/";
}

function getNotebookRootId(nodes: ReturnType<typeof useTreeLearnStore.getState>["nodes"], nodeId: string) {
  let current = nodes[nodeId];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const route = parseRoute(location.pathname);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
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
    if (authStatus === "authenticated" && route.kind === "landing") {
      const nextRoute: AppRoute = { kind: "dashboard" };
      navigate(routeToPath(nextRoute), { replace: true });
    }
    if ((authStatus === "anonymous" || authStatus === "error") && route.kind !== "landing") {
      const nextRoute: AppRoute = { kind: "landing" };
      navigate(routeToPath(nextRoute), { replace: true });
    }
  }, [authStatus, navigate, route.kind]);

  useEffect(() => {
    if (authStatus !== "authenticated" || apiStatus !== "ready" || route.kind !== "workspace") return;

    const targetNodeId = route.nodeId && nodes[route.nodeId] ? route.nodeId : route.notebookId;
    const targetNode = nodes[targetNodeId];
    if (!targetNode) {
      const nextRoute: AppRoute = { kind: "dashboard" };
      navigate(routeToPath(nextRoute), { replace: true });
      return;
    }

    const rootId = getNotebookRootId(nodes, targetNodeId);
    if (rootId !== route.notebookId) {
      const nextRoute: AppRoute = { kind: "workspace", notebookId: rootId, nodeId: targetNodeId };
      navigate(routeToPath(nextRoute), { replace: true });
      return;
    }

    if (activeNodeId !== targetNodeId) {
      setActiveNode(targetNodeId);
    }
  }, [activeNodeId, apiStatus, authStatus, navigate, nodes, route, setActiveNode]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;
    setThemeModeState(getStoredThemeMode(user.id));
  }, [authStatus, user]);

  useEffect(() => {
    if (route.kind !== "workspace" || !activeNodeId) return;
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({
        screen: "workspace",
        activeNodeId,
      }),
    );
  }, [activeNodeId, route.kind]);

  useEffect(() => {
    if (authStatus !== "authenticated" || apiStatus !== "ready" || route.kind !== "workspace" || !activeNodeId || !nodes[activeNodeId]) return;

    const rootId = getNotebookRootId(nodes, activeNodeId);
    const nextRoute: AppRoute = {
      kind: "workspace",
      notebookId: rootId,
      nodeId: activeNodeId === rootId ? undefined : activeNodeId,
    };
    if (routeToPath(route) !== routeToPath(nextRoute)) {
      navigate(routeToPath(nextRoute), { replace: true });
    }
  }, [activeNodeId, apiStatus, authStatus, navigate, nodes, route]);

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

  const requestAuth = (mode: AuthDialogMode = "login") => {
    setAuthDialogMode(mode);
    setAuthDialogOpen(true);
  };

  const goHome = () => {
    const nextRoute: AppRoute = authStatus === "authenticated" ? { kind: "dashboard" } : { kind: "landing" };
    navigate(routeToPath(nextRoute));
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ screen: "dashboard" }));
  };

  const openNotebook = (nodeId: string) => {
    setActiveNode(nodeId);
    const rootId = getNotebookRootId(nodes, nodeId);
    const nextRoute: AppRoute = { kind: "workspace", notebookId: rootId, nodeId: nodeId === rootId ? undefined : nodeId };
    navigate(routeToPath(nextRoute));
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ screen: "workspace", activeNodeId: nodeId }));
  };

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

  const isRestoring = authStatus === "checking" || (authStatus === "authenticated" && apiStatus === "loading");
  const pageVariant = isRestoring
    ? "restoring"
    : route.kind === "workspace"
      ? "workspace"
      : route.kind === "landing" || authStatus !== "authenticated"
        ? "landing"
        : "dashboard";
  const pageTransitionKey = `${pageVariant}-${routeToPath(route)}`;

  const content = isRestoring ? (
    <div className="tl-app-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      正在恢复工作区...
    </div>
  ) : route.kind === "landing" || authStatus !== "authenticated" ? (
    <LandingPage themeMode={themeMode} onThemeChange={setThemeMode} onRequestAuth={requestAuth} />
  ) : route.kind === "dashboard" ? (
    <NotebookDashboard onOpenNotebook={openNotebook} {...menuProps} />
  ) : (
    <div className="tl-app-bg relative flex h-screen min-h-0 flex-col overflow-hidden">
      <AmbientBackdrop variant="workspace" />
      <div className="tl-workspace-stagger tl-workspace-stagger-topbar">
        <TopBar onHome={goHome} {...menuProps} />
      </div>
      <main className="relative z-10 min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2 md:px-4">
        <div
          className={
            sidebarOpen
              ? "grid h-full min-h-0 gap-3 lg:grid-cols-[304px_minmax(420px,1fr)]"
              : "grid h-full min-h-0 gap-3 lg:grid-cols-[52px_minmax(420px,1fr)]"
          }
        >
          {sidebarOpen ? (
            <div className="tl-workspace-stagger tl-workspace-stagger-sidebar min-h-0">
              <KnowledgeTree />
            </div>
          ) : (
            <aside className="tl-panel tl-workspace-stagger tl-workspace-stagger-sidebar flex h-full min-h-0 flex-col items-center rounded-[1.25rem] border py-3">
              <button className="tl-hover flex h-9 w-9 items-center justify-center rounded-full" onClick={toggleSidebar} aria-label="展开 Nodes">
                <PanelLeftOpen className="h-4 w-4" />
              </button>
              <div className="mt-4 flex flex-1 items-center">
                <span className="rotate-[-90deg] whitespace-nowrap text-xs font-semibold tracking-wide text-muted-foreground">Nodes</span>
              </div>
            </aside>
          )}
          <div className="tl-workspace-stagger tl-workspace-stagger-main min-h-0 overflow-hidden">
            <Workspace />
          </div>
        </div>
      </main>
      <SelectionBubble />
    </div>
  );

  return (
    <>
      <PageTransition transitionKey={pageTransitionKey} variant={pageVariant}>
        {content}
      </PageTransition>
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
