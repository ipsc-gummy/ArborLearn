import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { KnowledgeTree } from "./components/KnowledgeTree";
import { LandingPage } from "./components/LandingPage";
import { NotebookDashboard } from "./components/NotebookDashboard";
import { OnboardingTour } from "./components/OnboardingTour";
import { PageTransition } from "./components/PageTransition";
import { ProductGuidePage } from "./components/ProductGuidePage";
import { SelectionBubble } from "./components/SelectionBubble";
import { Workspace } from "./components/Workspace";
import { AuthDialog, type AuthDialogMode, type ThemeMode } from "./components/AppMenus";
import { fetchAppSettings, type RuntimeSettings } from "./lib/api";
import { useArborLearnStore } from "./store/arborlearnStore";

const LAST_LOCATION_KEY = "arborlearn.lastLocation";
const THEME_MODE_KEY = "arborlearn.themeMode";
const THEME_TRANSITION_CLASS = "tl-theme-transitioning";
const DEMO_UPGRADE_NUDGE_BASELINE_KEY = "arborlearn.demoUpgradeNudgeBaseline";
const DEMO_UPGRADE_NUDGE_NOTEBOOK_BASELINE_KEY = "arborlearn.demoUpgradeNudgeNotebookBaseline";
const DEMO_UPGRADE_NUDGE_DISMISSED_KEY = "arborlearn.demoUpgradeNudgeDismissed";
const DEMO_UPGRADE_NUDGE_TRIGGER_QUESTIONS = 5;
const DEMO_UPGRADE_NUDGE_TRIGGER_NEW_NOTEBOOKS = 1;
const DEMO_UPGRADE_NUDGE_AUTO_HIDE_MS = 13000;
const DEMO_UPGRADE_LOCK_TRIGGER_QUESTIONS = 10;
const DEMO_UPGRADE_LOCK_TRIGGER_NEW_NOTEBOOKS = 3;

function settingValue(settings: RuntimeSettings | null, key: string, fallback: number) {
  return settings?.[key]?.value ?? fallback;
}

type AppRoute =
  | { kind: "landing" }
  | { kind: "guide" }
  | { kind: "dashboard" }
  | { kind: "workspace"; notebookId: string };

type WorkspaceView = "chat" | "diagram";
type AuthDialogInitialMode = AuthDialogMode | "reset-password" | "verify-email";

class AppErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null; resetKey: string }
> {
  state: { error: Error | null; resetKey: string } = {
    error: null,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; resetKey: string }) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ArborLearn render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="tl-app-bg flex min-h-screen items-center justify-center px-4 text-foreground">
        <section className="tl-panel w-full max-w-lg rounded-2xl border p-6">
          <h1 className="text-lg font-semibold">页面渲染失败</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            当前页面组件出现异常。请返回笔记本列表后重新打开，或刷新页面重试。
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
        </section>
      </div>
    );
  }
}

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
  if (segments[0] === "guide") return { kind: "guide" };
  if (segments[0] === "verify-email" || segments[0] === "reset-password") return { kind: "landing" };
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
  if (route.kind === "guide") return "/guide";
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

function getNodeInNotebook(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"], notebookId: string, nodeId?: string) {
  if (!nodeId || !nodes[nodeId]) return null;
  return getNotebookRootId(nodes, nodeId) === notebookId ? nodeId : null;
}

function getUserQuestionCount(nodes: ReturnType<typeof useArborLearnStore.getState>["nodes"]) {
  return Object.values(nodes).reduce(
    (count, node) => count + node.messages.filter((message) => message.role === "user").length,
    0,
  );
}

function WorkspaceUnavailable({ onHome }: { onHome: () => void }) {
  return (
    <div className="tl-app-bg flex min-h-screen items-center justify-center px-4 text-foreground">
      <section className="tl-panel flex w-full max-w-md flex-col gap-4 rounded-[1.25rem] border p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">无法打开这个笔记本</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            这个笔记本不在当前登录账号下。请切换到拥有它的账号后再打开此链接。
          </p>
        </div>
        <button
          className="tl-hover inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
          onClick={onHome}
        >
          返回笔记本
        </button>
      </section>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarOpen = useArborLearnStore((state) => state.sidebarOpen);
  const toggleSidebar = useArborLearnStore((state) => state.toggleSidebar);
  const setActiveNode = useArborLearnStore((state) => state.setActiveNode);
  const initializeAuth = useArborLearnStore((state) => state.initializeAuth);
  const nodes = useArborLearnStore((state) => state.nodes);
  const rootIds = useArborLearnStore((state) => state.rootIds);
  const activeNodeId = useArborLearnStore((state) => state.activeNodeId);
  const apiStatus = useArborLearnStore((state) => state.apiStatus);
  const user = useArborLearnStore((state) => state.user);
  const authStatus = useArborLearnStore((state) => state.authStatus);
  const authError = useArborLearnStore((state) => state.authError);
  const login = useArborLearnStore((state) => state.login);
  const register = useArborLearnStore((state) => state.register);
  const createDemoSession = useArborLearnStore((state) => state.createDemoSession);
  const resumeDemoNotebook = useArborLearnStore((state) => state.resumeDemoNotebook);
  const logout = useArborLearnStore((state) => state.logout);
  const route = parseRoute(location.pathname);
  const routeKind = route.kind;
  const routeNotebookId = route.kind === "workspace" ? route.notebookId : null;
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogInitialMode>("login");
  const [authDialogToken, setAuthDialogToken] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const [onboardingChoiceOpen, setOnboardingChoiceOpen] = useState(false);
  const [newlyRegisteredUserId, setNewlyRegisteredUserId] = useState<string | null>(null);
  const [missingNotebookRef, setMissingNotebookRef] = useState<string | null>(null);
  const [demoUpgradeNudgeVisible, setDemoUpgradeNudgeVisible] = useState(false);
  const [demoUpgradeGateOpen, setDemoUpgradeGateOpen] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const attemptedDemoResumeRef = useRef<string | null>(null);
  const demoUserQuestionCount = getUserQuestionCount(nodes);
  const demoNudgeQuestionTrigger = settingValue(runtimeSettings, "demo_nudge_question_trigger", DEMO_UPGRADE_NUDGE_TRIGGER_QUESTIONS);
  const demoNudgeNotebookTrigger = settingValue(runtimeSettings, "demo_nudge_notebook_trigger", DEMO_UPGRADE_NUDGE_TRIGGER_NEW_NOTEBOOKS);
  const demoNudgeAutoHideMs = settingValue(runtimeSettings, "demo_nudge_auto_hide_ms", DEMO_UPGRADE_NUDGE_AUTO_HIDE_MS);
  const demoLockQuestionTrigger = settingValue(runtimeSettings, "demo_lock_question_trigger", DEMO_UPGRADE_LOCK_TRIGGER_QUESTIONS);
  const demoLockNotebookTrigger = settingValue(runtimeSettings, "demo_lock_notebook_trigger", DEMO_UPGRADE_LOCK_TRIGGER_NEW_NOTEBOOKS);
  const demoUpgradeProgress = (() => {
    if (!user?.isTemporary || apiStatus !== "ready") {
      return { newQuestions: 0, newNotebooks: 0, locked: false };
    }
    const storedBaseline = sessionStorage.getItem(`${DEMO_UPGRADE_NUDGE_BASELINE_KEY}.${user.id}`);
    const storedNotebookBaseline = sessionStorage.getItem(`${DEMO_UPGRADE_NUDGE_NOTEBOOK_BASELINE_KEY}.${user.id}`);
    const baseline = storedBaseline === null ? demoUserQuestionCount : Number(storedBaseline);
    const notebookBaseline = storedNotebookBaseline === null ? rootIds.length : Number(storedNotebookBaseline);
    const newQuestions = demoUserQuestionCount - (Number.isFinite(baseline) ? baseline : demoUserQuestionCount);
    const newNotebooks = rootIds.length - (Number.isFinite(notebookBaseline) ? notebookBaseline : rootIds.length);
    return {
      newQuestions,
      newNotebooks,
      locked:
        newQuestions >= demoLockQuestionTrigger ||
        newNotebooks >= demoLockNotebookTrigger,
    };
  })();

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    if (location.pathname === "/verify-email" && token) {
      setAuthDialogMode("verify-email");
      setAuthDialogToken(token);
      setAuthDialogOpen(true);
    }
    if (location.pathname === "/reset-password" && token) {
      setAuthDialogMode("reset-password");
      setAuthDialogToken(token);
      setAuthDialogOpen(true);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    void fetchAppSettings()
      .then((response) => setRuntimeSettings(response.settings))
      .catch(() => {
        setRuntimeSettings(null);
      });
  }, []);

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
    if (authStatus === "authenticated" && routeKind === "landing") {
      const nextRoute: AppRoute = { kind: "dashboard" };
      navigate(routeToPath(nextRoute), { replace: true });
    }
    if ((authStatus === "anonymous" || authStatus === "error") && routeKind === "workspace" && routeNotebookId) {
      void resumeDemoNotebook(routeNotebookId).catch(() => {
        const nextRoute: AppRoute = { kind: "landing" };
        navigate(routeToPath(nextRoute), { replace: true });
      });
      return;
    }
    if ((authStatus === "anonymous" || authStatus === "error") && routeKind !== "landing" && routeKind !== "guide") {
      const nextRoute: AppRoute = { kind: "landing" };
      navigate(routeToPath(nextRoute), { replace: true });
    }
  }, [authStatus, navigate, resumeDemoNotebook, routeKind, routeNotebookId]);

  useEffect(() => {
    if (authStatus !== "authenticated" || apiStatus !== "ready" || routeKind !== "workspace" || !routeNotebookId) return;

    const notebookId = resolveNotebookRouteRef(nodes, routeNotebookId);
    const notebookRoot = notebookId ? nodes[notebookId] : null;
    if (!notebookId || !notebookRoot || notebookRoot.parentId !== null) {
      if (attemptedDemoResumeRef.current !== routeNotebookId) {
        attemptedDemoResumeRef.current = routeNotebookId;
        void resumeDemoNotebook(routeNotebookId).catch(() => {
          setMissingNotebookRef(routeNotebookId);
        });
        return;
      }
      setMissingNotebookRef(routeNotebookId);
      return;
    }
    attemptedDemoResumeRef.current = null;
    setMissingNotebookRef(null);

    const canonicalPath = routeToPath({ kind: "workspace", notebookId });
    if (canonicalPath !== location.pathname) {
      const nextRoute: AppRoute = { kind: "workspace", notebookId };
      navigate(routeToPath(nextRoute), { replace: true });
      return;
    }

    const targetNodeId = getNodeInNotebook(nodes, notebookId, activeNodeId) ?? notebookId;

    if (activeNodeId !== targetNodeId) {
      setActiveNode(targetNodeId);
    }
  }, [activeNodeId, apiStatus, authStatus, location.pathname, navigate, nodes, resumeDemoNotebook, routeKind, routeNotebookId, setActiveNode]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;
    setThemeModeState(getStoredThemeMode(user.id));
  }, [authStatus, user]);

  useEffect(() => {
    if (routeKind !== "workspace" || !missingNotebookRef || routeNotebookId === missingNotebookRef) return;
    attemptedDemoResumeRef.current = null;
    setMissingNotebookRef(null);
  }, [missingNotebookRef, routeKind, routeNotebookId]);

  useEffect(() => {
    if (
      !newlyRegisteredUserId ||
      authStatus !== "authenticated" ||
      apiStatus !== "ready" ||
      routeKind !== "dashboard" ||
      authDialogOpen ||
      user?.id !== newlyRegisteredUserId
    ) {
      return;
    }
    setOnboardingChoiceOpen(true);
    setNewlyRegisteredUserId(null);
  }, [apiStatus, authDialogOpen, authStatus, newlyRegisteredUserId, routeKind, user]);

  useEffect(() => {
    if (routeKind !== "workspace" || !activeNodeId) return;
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({
        screen: "workspace",
        activeNodeId,
      }),
    );
  }, [activeNodeId, routeKind]);

  useEffect(() => {
    if (!user?.isTemporary) {
      setDemoUpgradeNudgeVisible(false);
      setDemoUpgradeGateOpen(false);
      return;
    }
    if (apiStatus !== "ready") return;

    const baselineKey = `${DEMO_UPGRADE_NUDGE_BASELINE_KEY}.${user.id}`;
    const notebookBaselineKey = `${DEMO_UPGRADE_NUDGE_NOTEBOOK_BASELINE_KEY}.${user.id}`;
    const dismissedKey = `${DEMO_UPGRADE_NUDGE_DISMISSED_KEY}.${user.id}`;
    if (sessionStorage.getItem(dismissedKey) === "1") return;

    const storedBaseline = sessionStorage.getItem(baselineKey);
    const storedNotebookBaseline = sessionStorage.getItem(notebookBaselineKey);
    if (storedBaseline === null) {
      sessionStorage.setItem(baselineKey, String(demoUserQuestionCount));
    }
    if (storedNotebookBaseline === null) {
      sessionStorage.setItem(notebookBaselineKey, String(rootIds.length));
    }
    if (storedBaseline === null || storedNotebookBaseline === null) {
      return;
    }

    const baseline = Number(storedBaseline);
    const notebookBaseline = Number(storedNotebookBaseline);
    const newQuestionCount = demoUserQuestionCount - (Number.isFinite(baseline) ? baseline : demoUserQuestionCount);
    const newNotebookCount = rootIds.length - (Number.isFinite(notebookBaseline) ? notebookBaseline : rootIds.length);
    if (
      newQuestionCount >= demoNudgeQuestionTrigger ||
      newNotebookCount >= demoNudgeNotebookTrigger
    ) {
      setDemoUpgradeNudgeVisible(true);
    }
  }, [apiStatus, demoNudgeNotebookTrigger, demoNudgeQuestionTrigger, demoUserQuestionCount, rootIds.length, user]);

  useEffect(() => {
    if (!demoUpgradeNudgeVisible || !user?.isTemporary) return;
    const timer = window.setTimeout(() => {
      setDemoUpgradeNudgeVisible(false);
    }, demoNudgeAutoHideMs);
    return () => window.clearTimeout(timer);
  }, [demoNudgeAutoHideMs, demoUpgradeNudgeVisible, user]);

  const dismissDemoUpgradeNudge = () => {
    if (user?.id) {
      sessionStorage.setItem(`${DEMO_UPGRADE_NUDGE_DISMISSED_KEY}.${user.id}`, "1");
    }
    setDemoUpgradeNudgeVisible(false);
  };

  const requestDemoUpgradeGate = () => {
    setDemoUpgradeNudgeVisible(false);
    setDemoUpgradeGateOpen(true);
  };

  const setThemeMode = (mode: ThemeMode) => {
    document.documentElement.classList.add(THEME_TRANSITION_CLASS);
    window.setTimeout(() => {
      document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
    }, 520);
    setThemeModeState(mode);
    saveThemeMode(mode, user?.id);
  };

  const registerWithDefaultTheme = async (email: string, password: string, displayName?: string, verificationCode?: string) => {
    await register(email, password, displayName, verificationCode);
    const createdUser = useArborLearnStore.getState().user;
    setThemeModeState("light");
    saveThemeMode("light", createdUser?.id);
    if (createdUser?.id) {
      setNewlyRegisteredUserId(createdUser.id);
    }
  };

  const requestAuth = (mode: AuthDialogMode = "login") => {
    setAuthDialogMode(mode);
    setAuthDialogToken(null);
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
    const nextRoute: AppRoute = { kind: "workspace", notebookId: rootId };
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
      setAuthDialogOpen(false);
      setOnboardingChoiceOpen(false);
      setMissingNotebookRef(null);
      attemptedDemoResumeRef.current = null;
      localStorage.removeItem(LAST_LOCATION_KEY);
      navigate(routeToPath({ kind: "landing" }), { replace: true });
    },
    onRequestAuth: requestAuth,
    demoUpgradeLocked: demoUpgradeProgress.locked,
    onRequireDemoUpgrade: requestDemoUpgradeGate,
  };

  const isRestoring = authStatus === "checking" || (authStatus === "authenticated" && apiStatus === "loading");
  const pageVariant = isRestoring
    ? "restoring"
    : routeKind === "workspace"
      ? "workspace"
      : routeKind === "landing" || routeKind === "guide" || authStatus !== "authenticated"
        ? "landing"
        : "dashboard";
  const pageTransitionKey = `${pageVariant}-${routeToPath(route)}`;

  const content = isRestoring ? (
    <div className="tl-app-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      正在恢复工作区...
    </div>
  ) : routeKind === "guide" ? (
    <ProductGuidePage themeMode={themeMode} onThemeChange={setThemeMode} onHome={goHome} />
  ) : routeKind === "landing" || authStatus !== "authenticated" ? (
    <LandingPage
      themeMode={themeMode}
      onThemeChange={setThemeMode}
      onRequestAuth={requestAuth}
    />
  ) : routeKind === "dashboard" ? (
    <NotebookDashboard
      onOpenNotebook={openNotebook}
      {...menuProps}
    />
  ) : missingNotebookRef === routeNotebookId ? (
    <WorkspaceUnavailable onHome={goHome} />
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
                user={user}
                onLogout={menuProps.onLogout}
                onRequestAuth={requestAuth}
                demoUpgradeLocked={demoUpgradeProgress.locked}
                onRequireDemoUpgrade={requestDemoUpgradeGate}
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
            <Workspace
              view={workspaceView}
              onViewChange={setWorkspaceView}
              demoUpgradeLocked={demoUpgradeProgress.locked}
              onRequireDemoUpgrade={requestDemoUpgradeGate}
            />
          </div>
        </div>
      </main>
      <SelectionBubble />
    </div>
  );

  return (
    <>
      <PageTransition transitionKey={pageTransitionKey} variant={pageVariant}>
        <AppErrorBoundary resetKey={pageTransitionKey}>
          {content}
        </AppErrorBoundary>
      </PageTransition>
      {authStatus === "authenticated" && route.kind !== "guide" && (
        <OnboardingTour
          choiceOpen={onboardingChoiceOpen}
          onChoiceOpenChange={setOnboardingChoiceOpen}
          onComplete={goHome}
          routeKind={route.kind}
          workspaceView={workspaceView}
        />
      )}
      {demoUpgradeNudgeVisible && user?.isTemporary && (
        <div className="pointer-events-none fixed inset-x-0 top-5 z-[80] flex justify-center px-4">
          <div className="tl-demo-upgrade-nudge tl-panel pointer-events-auto flex w-[min(54rem,calc(100vw-2rem))] items-start gap-4 rounded-2xl border px-5 py-4 shadow-panel backdrop-blur-xl">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">觉得还不错？想把这次学习进度留下来吗？</p>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                绑定一个正式账号后，这些笔记、对话和上传内容会保留到云端，异地登录也能接着用~
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-1">
              <button
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-105"
                onClick={() => {
                  dismissDemoUpgradeNudge();
                  requestAuth("register");
                }}
              >
                绑定账号
              </button>
              <button
                className="tl-hover rounded-full px-3 py-2 text-sm font-medium text-muted-foreground"
                onClick={dismissDemoUpgradeNudge}
              >
                稍后
              </button>
            </div>
          </div>
        </div>
      )}
      {demoUpgradeGateOpen && user?.isTemporary && (
        <div className="tl-demo-upgrade-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4">
          <section className="tl-demo-upgrade-gate w-full max-w-lg rounded-3xl border p-6 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Demo limit</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-normal">继续使用前，先绑定一个正式账号吧</h2>
              </div>
              <button
                className="tl-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
                onClick={() => setDemoUpgradeGateOpen(false)}
                aria-label="关闭"
                title="关闭"
              >
                ×
              </button>
            </div>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              演示体验已经足够了解核心功能啦。绑定账号后，可以继续向 Agent 提问、上传资料、新建笔记本和对话节点，
              当前这些笔记、对话和上传内容也会保留到云端。
            </p>
            <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm leading-6 text-foreground">
              你仍然可以关闭这个提示继续查看已有内容；但新的提问和创建操作，需要注册后才能继续。
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="tl-hover rounded-full px-4 py-2 text-sm font-medium text-muted-foreground"
                onClick={() => setDemoUpgradeGateOpen(false)}
              >
                先查看
              </button>
              <button
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-105"
                onClick={() => {
                  setDemoUpgradeGateOpen(false);
                  requestAuth("register");
                }}
              >
                绑定账号继续
              </button>
            </div>
          </section>
        </div>
      )}
      <AuthDialog
        open={authDialogOpen}
        initialMode={authDialogMode}
        initialToken={authDialogToken}
        authStatus={authStatus}
        authError={authError}
        user={user}
        onClose={() => {
          setAuthDialogOpen(false);
          if (location.pathname === "/verify-email" || location.pathname === "/reset-password") {
            navigate(routeToPath({ kind: "landing" }), { replace: true });
          }
        }}
        onLogin={login}
        onRegister={registerWithDefaultTheme}
        onCreateDemoSession={createDemoSession}
      />
    </>
  );
}
