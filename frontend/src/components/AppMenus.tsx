import * as Popover from "@radix-ui/react-popover";
import { createPortal } from "react-dom";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CircleUserRound,
  Github,
  HelpCircle,
  KeyRound,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Monitor,
  Moon,
  ShieldCheck,
  Settings,
  Star,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { changePassword, fetchAdminSettings, updateAdminSettings, type AuthUser, type RuntimeSettings } from "../lib/api";

export type ThemeMode = "light" | "dark" | "system";
export type AuthDialogMode = "login" | "register";

interface SettingsMenuProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

interface AccountMenuProps {
  user: AuthUser | null;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

interface AuthDialogProps {
  open: boolean;
  initialMode?: AuthDialogMode;
  authStatus: "checking" | "authenticated" | "anonymous" | "error";
  authError: string | null;
  user: AuthUser | null;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName?: string) => Promise<void>;
  onCreateDemoSession: () => Promise<void>;
}

const GITHUB_REPO_URL = "https://github.com/ipsc-gummy/ArborLearn";
const GITHUB_REPO_API_URL = "https://api.github.com/repos/ipsc-gummy/ArborLearn";
const GITHUB_ISSUES_NEW_URL = `${GITHUB_REPO_URL}/issues/new`;
const GITHUB_STARS_BADGE_URL = "https://img.shields.io/github/stars/ipsc-gummy/ArborLearn?style=flat&label=stars";
const PRODUCT_GUIDE_PATH = "/guide";

interface GithubRepoStats {
  stars: string;
}

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
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

export function GithubRepoCard({ variant = "card" }: { variant?: "card" | "blend" }) {
  const [githubRepoStats, setGithubRepoStats] = useState<GithubRepoStats | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(GITHUB_REPO_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
        return response.json() as Promise<{ stargazers_count: number }>;
      })
      .then(({ stargazers_count }) => {
        setGithubRepoStats({ stars: String(stargazers_count) });
      })
      .catch(async (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        try {
          const stars = await fetchBadgeValue(GITHUB_STARS_BADGE_URL, controller.signal);
          setGithubRepoStats({ stars });
        } catch (fallbackError: unknown) {
          if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") return;
          setGithubRepoStats(null);
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <a
      className={cn(
        "tl-guide-repo-card flex items-center gap-2 rounded-xl border px-2.5 py-1.5",
        variant === "blend" && "tl-landing-repo-card",
      )}
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Open ArborLearn GitHub repository"
    >
      <Github className="h-5 w-5 shrink-0" />
      <span className="tl-guide-repo-content flex min-w-0 items-center gap-2">
        <span className="tl-guide-repo-name truncate text-xs font-semibold">ArborLearn</span>
        <span className="tl-guide-repo-stars inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Star className="h-3 w-3" />
          {githubRepoStats?.stars ?? "--"}
        </span>
      </span>
    </a>
  );
}

export function SettingsMenu({ themeMode, onThemeChange }: SettingsMenuProps) {
  const navigate = useNavigate();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="打开设置">
          <Settings className="h-4 w-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-72 rounded-xl border p-2 text-sm shadow-panel">
          <MenuButton icon={HelpCircle} label="ArborLearn 帮助" onClick={() => navigate(PRODUCT_GUIDE_PATH)} />
          <MenuButton icon={MessageSquareWarning} label="发送反馈" onClick={() => openExternalUrl(GITHUB_ISSUES_NEW_URL)} />
          <div className="tl-border-soft my-2 border-t" />
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">外观</p>
          <ThemeOption mode="light" current={themeMode} icon={Sun} label="浅色" onSelect={onThemeChange} />
          <ThemeOption mode="dark" current={themeMode} icon={Moon} label="深色" onSelect={onThemeChange} />
          <ThemeOption mode="system" current={themeMode} icon={Monitor} label="跟随系统" onSelect={onThemeChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AccountMenu({ user, onLogout, onRequestAuth }: AccountMenuProps) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountInfoOpen, setAccountInfoOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [adminSettingsOpen, setAdminSettingsOpen] = useState(false);
  const avatar = (
    <button
      className="flex h-9 w-9 items-center justify-center rounded-full border border-[#dadce0] bg-[#f1f3f4] text-sm font-semibold text-[#3c4043] shadow-sm transition hover:bg-[#e8eaed] dark:border-transparent dark:bg-[#f1f3f4] dark:text-[#202124] dark:hover:bg-white"
      aria-label={user ? "打开账号菜单" : "登录或注册"}
      onClick={user ? undefined : () => onRequestAuth("login")}
    >
      {user ? user.displayName.slice(0, 2).toUpperCase() : <CircleUserRound className="h-5 w-5" />}
    </button>
  );

  if (!user) return avatar;

  return (
    <>
      <Popover.Root open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
        <Popover.Trigger asChild>{avatar}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-72 rounded-xl border p-2 text-sm shadow-panel">
            <div className="tl-panel-soft rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{user.displayName}</p>
                {user.isTemporary && (
                  <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary">
                    临时体验
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
            </div>
            <MenuButton
              icon={CircleUserRound}
              label="账号信息"
              onClick={() => {
                setAccountMenuOpen(false);
                setAccountInfoOpen(true);
              }}
            />
            {user.isTemporary && (
              <MenuButton
                icon={UserPlus}
                label="绑定正式账号"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onRequestAuth("register");
                }}
              />
            )}
            {user.isAdmin && (
              <MenuButton
                icon={ShieldCheck}
                label="后台设置"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setAdminSettingsOpen(true);
                }}
              />
            )}
            {!user.isTemporary && (
              <MenuButton
                icon={KeyRound}
                label="修改密码"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setPasswordDialogOpen(true);
                }}
              />
            )}
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-destructive hover:bg-destructive/10"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
              退出账号
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {accountInfoOpen && typeof document !== "undefined" &&
        createPortal(
        <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
          <div className="tl-modal-panel tl-panel w-full max-w-sm rounded-2xl border p-5 shadow-panel">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">账号信息</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">当前登录账号的基础信息。</p>
              </div>
              <button className="tl-hover rounded-full p-2" onClick={() => setAccountInfoOpen(false)} aria-label="关闭账号信息">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-4 flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-xl font-semibold text-background">
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <AccountInfoRow label="昵称" value={user.displayName} />
              <AccountInfoRow label="邮箱" value={user.email} />
              <AccountInfoRow label="状态" value="已登录" />
            </div>
          </div>
        </div>,
        document.body,
      )}
      {passwordDialogOpen && typeof document !== "undefined" &&
        createPortal(
          <ChangePasswordDialog onClose={() => setPasswordDialogOpen(false)} />,
          document.body,
        )}
      {adminSettingsOpen && typeof document !== "undefined" &&
        createPortal(
          <AdminSettingsDialog onClose={() => setAdminSettingsOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length >= 8 && status !== "saving";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setStatus("error");
      setMessage("两次输入的新密码不一致。");
      return;
    }
    if (currentPassword === newPassword) {
      setStatus("error");
      setMessage("新密码不能和当前密码相同。");
      return;
    }
    setStatus("saving");
    try {
      await changePassword({ currentPassword, newPassword });
      setStatus("success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("密码已更新，下次登录请使用新密码。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "修改密码失败");
    }
  };

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">修改密码</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              输入当前密码后设置新密码。新密码至少 8 位。
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="关闭修改密码窗口">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">当前密码</span>
            <input
              className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">新密码</span>
            <input
              className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">确认新密码</span>
            <input
              className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          {message && (
            <p className={cn("rounded-lg px-3 py-2 text-xs", status === "success" ? "bg-primary/8 text-primary" : "bg-destructive/10 text-destructive")}>
              {message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {status === "saving" ? "保存中..." : "保存新密码"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdminSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void fetchAdminSettings()
      .then((response) => {
        if (cancelled) return;
        setSettings(response.settings);
        setDraft(Object.fromEntries(Object.entries(response.settings).map(([key, setting]) => [key, setting.value])));
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "无法加载后台设置");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setStatus("saving");
    setMessage(null);
    try {
      const response = await updateAdminSettings(draft);
      setSettings(response.settings);
      setDraft(Object.fromEntries(Object.entries(response.settings).map(([key, setting]) => [key, setting.value])));
      setStatus("ready");
      setMessage("设置已保存，用户刷新页面后生效。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  };

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel max-h-[86vh] w-full max-w-2xl overflow-auto rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">后台设置</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              调整演示账号提示阈值和保留策略。建议小步修改，观察转化和使用体验后再继续调。
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="关闭后台设置">
            <X className="h-4 w-4" />
          </button>
        </div>

        {status === "loading" && <p className="text-sm text-muted-foreground">正在加载设置...</p>}
        {settings && (
          <div className="grid gap-3">
            {Object.entries(settings).map(([key, setting]) => (
              <label key={key} className="rounded-xl border border-border bg-muted/25 p-3">
                <span className="block text-sm font-semibold">{setting.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  范围 {setting.min} - {setting.max}，默认 {setting.default}
                </span>
                <input
                  type="number"
                  min={setting.min}
                  max={setting.max}
                  value={draft[key] ?? setting.value}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDraft((current) => ({
                      ...current,
                      [key]: Number.isFinite(nextValue) ? nextValue : setting.value,
                    }));
                  }}
                  className="tl-input mt-2 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            ))}
          </div>
        )}

        {message && (
          <p className={cn("mt-4 rounded-lg px-3 py-2 text-sm", status === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/8 text-primary")}>
            {message}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button variant="primary" onClick={save} disabled={!settings || status === "saving" || status === "loading"}>
            {status === "saving" ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AuthDialog({
  open,
  initialMode = "login",
  authStatus,
  authError,
  user,
  onClose,
  onLogin,
  onRegister,
  onCreateDemoSession,
}: AuthDialogProps) {
  const [mode, setMode] = useState<AuthDialogMode>(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const loading = authStatus === "checking";
  const normalizedEmail = email.trim();
  const hasRequiredCredentials = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && password.length >= 8;
  const canSubmit = hasRequiredCredentials && !loading;
  const isDemoUpgrade = Boolean(user?.isTemporary && mode === "register");
  const isOpeningDemoUpgrade = Boolean(user?.isTemporary && initialMode === "register");

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setLocalError(null);
  }, [initialMode, open]);

  useEffect(() => {
    if (open && authStatus === "authenticated" && !isDemoUpgrade && !isOpeningDemoUpgrade) {
      setPassword("");
      onClose();
    }
  }, [authStatus, isDemoUpgrade, isOpeningDemoUpgrade, onClose, open]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    try {
      if (mode === "register") {
        await onRegister(email, password, displayName || undefined);
      } else {
        await onLogin(email, password);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "操作失败");
    }
  };

  const switchMode = () => {
    setLocalError(null);
    setMode(mode === "login" ? "register" : "login");
  };

  const startDemoSession = async () => {
    setLocalError(null);
    try {
      await onCreateDemoSession();
      onClose();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "进入演示失败");
    }
  };

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{mode === "login" ? "登录 ArborLearn" : "创建 ArborLearn 账号"}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              登录后，笔记本、节点和聊天记录会保存在你的账号下。
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="关闭登录窗口">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          {mode === "register" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">昵称</span>
              <input
                className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="可选"
                autoComplete="name"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">邮箱</span>
            <input
              className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">密码</span>
            <input
              className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>

          {(localError || authError) && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {localError || authError}
            </p>
          )}

          <Button
            className={cn(
              "h-11 w-full",
              !hasRequiredCredentials &&
                "border-white/55 bg-background/35 text-muted-foreground shadow-[0_10px_30px_rgba(25,45,64,0.08),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-md hover:translate-y-0 hover:bg-background/45 hover:brightness-100 hover:shadow-[0_10px_30px_rgba(25,45,64,0.08),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:border-white/55 disabled:bg-background/35 disabled:text-muted-foreground disabled:opacity-100 dark:border-white/15 dark:bg-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/12 dark:disabled:bg-white/10",
            )}
            type="submit"
            disabled={!canSubmit}
          >
            {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {loading ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
          </Button>
        </form>

        <button
          className="mt-3 flex w-full items-center justify-center rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-medium text-primary transition hover:bg-primary/8 focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={switchMode}
        >
          {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
        </button>

        {mode === "register" && (
          <button
            type="button"
            className="tl-panel-soft group mt-4 w-full rounded-xl border p-3 text-left text-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/25"
            onClick={startDemoSession}
            disabled={loading}
            aria-label="进入独立演示体验"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">独立演示体验</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  自动打开 Transformer 示例，不写入长期账号，也不和其他访问者共享记录。
                </p>
              </div>
              <span className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-background/70 px-3 text-xs font-medium text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                体验示例
                <LogIn className="h-3.5 w-3.5" />
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

function AccountInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/35 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}

function MenuButton({
  icon: Icon,
  label,
  trailing,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  trailing?: string;
  onClick?: () => void;
}) {
  return (
    <button className="tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left" onClick={onClick}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {trailing && <span className="ml-auto text-xs text-muted-foreground">{trailing}</span>}
    </button>
  );
}

function ThemeOption({
  mode,
  current,
  icon: Icon,
  label,
  onSelect,
}: {
  mode: ThemeMode;
  current: ThemeMode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: (mode: ThemeMode) => void;
}) {
  const active = mode === current;
  return (
    <button
      className={cn("tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left", active && "tl-accent-soft")}
      onClick={() => onSelect(mode)}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {active && <Check className="ml-auto h-4 w-4 text-primary" />}
    </button>
  );
}
