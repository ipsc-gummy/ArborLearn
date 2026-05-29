import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { KnowledgeTree } from "./components/KnowledgeTree";
import { LandingPage } from "./components/LandingPage";
import { NotebookDashboard } from "./components/NotebookDashboard";
import { OnboardingTour } from "./components/OnboardingTour";
import { PageTransition } from "./components/PageTransition";
import { SelectionBubble } from "./components/SelectionBubble";
import { Workspace } from "./components/Workspace";
import { AuthDialog, type AuthDialogMode, type ThemeMode } from "./components/AppMenus";
import { useArborLearnStore } from "./store/arborlearnStore";

const LAST_LOCATION_KEY = "arborlearn.lastLocation";
const THEME_MODE_KEY = "arborlearn.themeMode";
const THEME_TRANSITION_CLASS = "tl-theme-transitioning";

type AppRoute =
  | { kind: "landing" }
  | { kind: "dashboard" }
  | { kind: "workspace"; notebookId: string };

type WorkspaceView = "chat" | "diagram";

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
    };
  }
  if (segments[0] === "notebooks") return { kind: "dashboard" };
  return { kind: "landing" };
}

function routeToPath(route: AppRoute) {
  if (route.kind === "dashboard") return "/notebooks";
  if (route.kind === "workspace") return `/notebooks/${encodeURIComponent(route.notebookId)}`;
  return "/";
}

function getNotebookCreatedAt(node: ReturnType<typeof useArborLearnStore.getState>["nodes"][string]) {
  const messageTimes = node.messages
    .map((message) => new Date(message.createdAt).getTime())
    .filter((time) => Number.isFinite(time));
  const createdTime = messageTimes.length ? Math.min(...messageTimes) : new Date(node.updatedAt).getTime();
  return Number.isFinite(createdTime) ? new Date(createdTime) : new Date();
}

function formatNotebookSlugDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getNotebookSlug(node: ReturnType<typeof useArborLearnStore.getState>["nodes"][string]) {
  const titleSlug = node.title
    .trim()
    .replace(/[\\/#?&%:]+/g, "")
    .replace(/\s+/g, "")
    .slice(0, 40);
  return `${titleSlug || "notebook"}${formatNotebookSlugDate(getNotebookCreatedAt(node))}`;
}

function resolveNotebookRouteRef(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"], ref: string) {
  const directNode = nodes[ref];
  if (directNode?.parentId === null) return ref;
  return Object.values(nodes).find((node) => node.parentId === null && getNotebookSlug(node) === ref)?.id ?? null;
}

function getNotebookRootId(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"], nodeId: string) {
  let current = nodes[nodeId];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

function getStoredActiveNodeId() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "{}") as {
      screen?: string;
      activeNodeId?: string;
    };
    return saved.screen === "workspace" ? saved.activeNodeId : undefined;
  } catch {
    return undefined;
  }
}

function getNodeInNotebook(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"], notebookId: string, nodeId?: string) {
  if (!nodeId || !nodes[nodeId]) return null;
  return getNotebookRootId(nodes, nodeId) === notebookId ? nodeId : null;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarOpen = useArborLearnStore((state) => state.sidebarOpen);
  const toggleSidebar = useArborLearnStore((state) => state.toggleSidebar);
  const setActiveNode = useArborLearnStore((state) => state.setActiveNode);
  const initializeAuth = useArborLearnStore((state) => state.initializeAuth);
  const nodes = useArborLearnStore((state) => state.nodes);
  const activeNodeId = useArborLearnStore((state) => state.activeNodeId);
  const apiStatus = useArborLearnStore((state) => state.apiStatus);
  const user = useArborLearnStore((state) => state.user);
  const authStatus = useArborLearnStore((state) => state.authStatus);
  const authError = useArborLearnStore((state) => state.authError);
  const login = useArborLearnStore((state) => state.login);
  const register = useArborLearnStore((state) => state.register);
  const createDemoSession = useArborLearnStore((state) => state.createDemoSession);
  const logout = useArborLearnStore((state) => state.logout);
  const route = parseRoute(location.pathname);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const [onboardingChoiceOpen, setOnboardingChoiceOpen] = useState(false);
  const [newlyRegisteredUserId, setNewlyRegisteredUserId] = useState<string | null>(null);

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

    const activeNotebookId = nodes[activeNodeId] ? getNotebookRootId(nodes, activeNodeId) : null;
    const notebookId = resolveNotebookRouteRef(nodes, route.notebookId) ?? activeNotebookId;
    const notebookRoot = notebookId ? nodes[notebookId] : null;
    if (!notebookId || !notebookRoot || notebookRoot.parentId !== null) {
      const nextRoute: AppRoute = { kind: "dashboard" };
      navigate(routeToPath(nextRoute), { replace: true });
      return;
    }

    const canonicalPath = routeToPath({ kind: "workspace", notebookId: getNotebookSlug(notebookRoot) });
    if (canonicalPath !== location.pathname) {
      const nextRoute: AppRoute = { kind: "workspace", notebookId: getNotebookSlug(notebookRoot) };
      navigate(routeToPath(nextRoute), { replace: true });
      return;
    }

    const targetNodeId =
      getNodeInNotebook(nodes, notebookId, activeNodeId) ??
      getNodeInNotebook(nodes, notebookId, getStoredActiveNodeId()) ??
      notebookId;

    if (activeNodeId !== targetNodeId) {
      setActiveNode(targetNodeId);
    }
  }, [activeNodeId, apiStatus, authStatus, location.pathname, navigate, nodes, route, setActiveNode]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;
    setThemeModeState(getStoredThemeMode(user.id));
  }, [authStatus, user]);

  useEffect(() => {
    if (
      !newlyRegisteredUserId ||
      authStatus !== "authenticated" ||
      apiStatus !== "ready" ||
      route.kind !== "dashboard" ||
      authDialogOpen ||
      user?.id !== newlyRegisteredUserId
    ) {
      return;
    }
    setOnboardingChoiceOpen(true);
    setNewlyRegisteredUserId(null);
  }, [apiStatus, authDialogOpen, authStatus, newlyRegisteredUserId, route.kind, user]);

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

  const setThemeMode = (mode: ThemeMode) => {
    document.documentElement.classList.add(THEME_TRANSITION_CLASS);
    window.setTimeout(() => {
      document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
    }, 520);
    setThemeModeState(mode);
    saveThemeMode(mode, user?.id);
  };

  const registerWithDefaultTheme = async (email: string, password: string, displayName?: string) => {
    await register(email, password, displayName);
    const createdUser = useArborLearnStore.getState().user;
    setThemeModeState("light");
    saveThemeMode("light", createdUser?.id);
    if (createdUser?.id) {
      setNewlyRegisteredUserId(createdUser.id);
    }
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
    const rootNode = nodes[rootId];
    const nextRoute: AppRoute = { kind: "workspace", notebookId: rootNode ? getNotebookSlug(rootNode) : rootId };
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
    onCreateDemoSession: createDemoSession,
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
    <LandingPage
      themeMode={themeMode}
      onThemeChange={setThemeMode}
      onRequestAuth={requestAuth}
    />
  ) : route.kind === "dashboard" ? (
    <NotebookDashboard
      onOpenNotebook={openNotebook}
      onOpenOnboarding={() => setOnboardingChoiceOpen(true)}
      {...menuProps}
    />
  ) : (
    <div className="tl-app-bg tl-workspace-page relative flex h-screen min-h-0 flex-col overflow-hidden">
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
              <KnowledgeTree
                themeMode={themeMode}
                onThemeChange={setThemeMode}
                onHome={goHome}
                view={workspaceView}
                onViewChange={setWorkspaceView}
              />
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
            <Workspace view={workspaceView} onViewChange={setWorkspaceView} />
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
      {authStatus === "authenticated" && (
        <OnboardingTour
          choiceOpen={onboardingChoiceOpen}
          onChoiceOpenChange={setOnboardingChoiceOpen}
          onComplete={goHome}
          routeKind={route.kind}
          workspaceView={workspaceView}
        />
      )}
      <AuthDialog
        open={authDialogOpen}
        initialMode={authDialogMode}
        authStatus={authStatus}
        authError={authError}
        onClose={() => setAuthDialogOpen(false)}
        onLogin={login}
        onRegister={registerWithDefaultTheme}
        onCreateDemoSession={createDemoSession}
      />
    </>
  );
}
