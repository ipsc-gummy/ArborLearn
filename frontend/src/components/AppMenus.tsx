import * as Popover from "@radix-ui/react-popover";
import { createPortal } from "react-dom";
import { useEffect, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronRight,
  CircleUserRound,
  Github,
  HelpCircle,
  KeyRound,
  LogIn,
  LogOut,
  MailCheck,
  MessageSquareWarning,
  Monitor,
  Moon,
  ShieldCheck,
  Settings,
  Star,
  Sun,
  UserPlus,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { WalletMenu } from "./WalletMenu";
import { cn } from "../lib/utils";
import {
  changePassword,
  fetchAdminSettings,
  forgotPassword,
  resetPassword,
  sendAccountVerificationEmail,
  sendVerificationEmail,
  setAuthToken,
  updateAdminSettings,
  verifyEmail,
  type AuthUser,
  type RuntimeSettings,
} from "../lib/api";

export type ThemeMode = "light" | "dark" | "system";
export type AuthDialogMode = "login" | "register";
type AuthDialogView = AuthDialogMode | "forgot-password" | "reset-password" | "verify-email";

interface SettingsMenuProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

interface AccountMenuProps {
  user: AuthUser | null;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
  triggerVariant?: "avatar" | "row";
  contentAlign?: "start" | "center" | "end";
  submenuSide?: "left" | "right";
}

interface AuthDialogProps {
  open: boolean;
  initialMode?: AuthDialogView;
  initialToken?: string | null;
  authStatus: "checking" | "authenticated" | "anonymous" | "error";
  authError: string | null;
  user: AuthUser | null;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName?: string, verificationCode?: string) => Promise<void>;
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

export function AccountMenu({
  user,
  themeMode,
  onThemeChange,
  onLogout,
  onRequestAuth,
  triggerVariant = "avatar",
  contentAlign = "end",
  submenuSide = "left",
}: AccountMenuProps) {
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<"appearance" | "help" | null>(null);
  const [accountInfoOpen, setAccountInfoOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [adminSettingsOpen, setAdminSettingsOpen] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const displayName = user?.displayName ?? "未登录";
  const displayEmail = user?.email ?? "登录后保存你的学习进度";
  const initials = user ? user.displayName.slice(0, 2).toUpperCase() : null;

  const openChange = (open: boolean) => {
    setAccountMenuOpen(open);
    if (!open) setActiveSubmenu(null);
  };

  const closeMenu = () => {
    setAccountMenuOpen(false);
    setActiveSubmenu(null);
  };

  const openGuide = () => {
    closeMenu();
    navigate(PRODUCT_GUIDE_PATH);
  };

  const openFeedback = () => {
    closeMenu();
    openExternalUrl(GITHUB_ISSUES_NEW_URL);
  };

  const openGithub = () => {
    closeMenu();
    openExternalUrl(GITHUB_REPO_URL);
  };

  const selectTheme = (mode: ThemeMode) => {
    onThemeChange(mode);
    closeMenu();
  };

  const avatarMark = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#dadce0] bg-[#f1f3f4] text-sm font-semibold text-[#3c4043] shadow-sm dark:border-transparent dark:bg-[#f1f3f4] dark:text-[#202124]">
      {initials ?? <CircleUserRound className="h-5 w-5" />}
    </span>
  );

  const avatarTrigger = (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-muted/70"
      aria-label={user ? "打开账号与设置菜单" : "打开登录与设置菜单"}
    >
      {avatarMark}
    </button>
  );

  const rowTrigger = (
    <button
      type="button"
      className="tl-hover flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left"
      aria-label={user ? "打开账号与设置菜单" : "打开登录与设置菜单"}
    >
      {avatarMark}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">{displayEmail}</span>
      </span>
    </button>
  );

  return (
    <>
      <Popover.Root open={accountMenuOpen} onOpenChange={openChange}>
        <Popover.Trigger asChild>{triggerVariant === "row" ? rowTrigger : avatarTrigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align={contentAlign}
            className="tl-panel z-50 w-80 overflow-visible rounded-xl border p-2 text-sm shadow-panel"
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            {user ? (
              <button
                type="button"
                className="tl-panel-soft mb-2 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:border-primary/25 hover:bg-primary/5"
                onClick={() => {
                  closeMenu();
                  setAccountInfoOpen(true);
                }}
              >
                {avatarMark}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">{user.displayName}</span>
                    {user.isTemporary && (
                      <span className="shrink-0 rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary">
                        临时体验
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <div className="tl-panel-soft mb-2 rounded-lg border p-3">
                <p className="font-semibold">ArborLearn 账号</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">登录后，笔记本和学习路径会保存在你的账号下。</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      closeMenu();
                      onRequestAuth("login");
                    }}
                  >
                    登录
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      closeMenu();
                      onRequestAuth("register");
                    }}
                  >
                    注册
                  </Button>
                </div>
              </div>
            )}

            {user && (
              <MenuButton
                icon={WalletIcon}
                label="钱包"
                onClick={() => {
                  closeMenu();
                  setWalletDialogOpen(true);
                }}
              />
            )}
            {user?.isTemporary && (
              <MenuButton
                icon={UserPlus}
                label="绑定正式账号"
                onClick={() => {
                  closeMenu();
                  onRequestAuth("register");
                }}
              />
            )}
            {user?.isAdmin && (
              <MenuButton
                icon={ShieldCheck}
                label="后台设置"
                onClick={() => {
                  closeMenu();
                  setAdminSettingsOpen(true);
                }}
              />
            )}
            {user && !user.isTemporary && (
              <MenuButton
                icon={KeyRound}
                label="修改密码"
                onClick={() => {
                  closeMenu();
                  setPasswordDialogOpen(true);
                }}
              />
            )}

            <div className="tl-border-soft my-2 border-t" />
            <SubmenuRow
              icon={Settings}
              label="外观"
              active={activeSubmenu === "appearance"}
              submenuSide={submenuSide}
              onActivate={() => setActiveSubmenu("appearance")}
            >
              <ThemeOption mode="light" current={themeMode} icon={Sun} label="浅色" onSelect={selectTheme} />
              <ThemeOption mode="dark" current={themeMode} icon={Moon} label="深色" onSelect={selectTheme} />
              <ThemeOption mode="system" current={themeMode} icon={Monitor} label="跟随系统" onSelect={selectTheme} />
            </SubmenuRow>
            <SubmenuRow
              icon={HelpCircle}
              label="帮助"
              active={activeSubmenu === "help"}
              submenuSide={submenuSide}
              onActivate={() => setActiveSubmenu("help")}
            >
              <MenuButton icon={HelpCircle} label="ArborLearn 帮助" onClick={openGuide} />
              <MenuButton icon={MessageSquareWarning} label="发送反馈" onClick={openFeedback} />
              <MenuButton icon={Github} label="GitHub" onClick={openGithub} />
            </SubmenuRow>

            {user && (
              <>
                <div className="tl-border-soft my-2 border-t" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    closeMenu();
                    setAccountInfoOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  退出账号
                </button>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <WalletMenu user={user} open={walletDialogOpen} onOpenChange={setWalletDialogOpen} hideTrigger />

      {user && accountInfoOpen && typeof document !== "undefined" &&
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
              {!user.isTemporary && <AccountInfoRow label="邮箱验证" value={user.emailVerified ? "已验证" : "未验证"} />}
              <AccountInfoRow label="状态" value="已登录" />
            </div>
          </div>
        </div>,
        document.body,
      )}
      {user && passwordDialogOpen && typeof document !== "undefined" &&
        createPortal(
          <ChangePasswordDialog user={user} onClose={() => setPasswordDialogOpen(false)} />,
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

function ChangePasswordDialog({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const [step, setStep] = useState<"method" | "verify" | "change">("method");
  const [verificationCode, setVerificationCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "verifying" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const normalizedVerificationCode = verificationCode.replace(/\D/g, "");
  const isBusy = status === "sending" || status === "verifying" || status === "saving";
  const canVerify = normalizedVerificationCode.length === 6 && !isBusy;
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length >= 8 && !isBusy;
  const resendDisabled = isBusy || resendCooldown > 0;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const sendIdentityCode = async (options?: { advance?: boolean }) => {
    setMessage(null);
    setStatus("sending");
    try {
      await sendAccountVerificationEmail();
      setStatus("idle");
      setMessage("验证码已发送到你的登录邮箱。");
      setResendCooldown(60);
      if (options?.advance) {
        setStep("verify");
      }
    } catch (error) {
      setStatus("error");
      const errorMessage = error instanceof Error ? error.message : "发送验证码失败";
      if (errorMessage.includes("Please wait before requesting another email")) {
        setResendCooldown(60);
        setMessage("验证码刚刚发送过，请稍后再试。");
      } else {
        setMessage(errorMessage);
      }
    }
  };

  const verifyIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setStatus("verifying");
    try {
      const response = await verifyEmail({ email: user.email, code: normalizedVerificationCode });
      if (response.token) {
        setAuthToken(response.token);
      }
      setVerificationCode("");
      setStep("change");
      setStatus("idle");
      setMessage(null);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "身份验证失败");
    }
  };

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
            <p className="text-lg font-semibold">{step === "method" || step === "verify" ? "身份验证" : "修改密码"}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {step === "method"
                ? "为了保护你的账号安全，请先验证身份。"
                : step === "verify"
                  ? `输入发送到 ${user.email} 的 6 位验证码。`
                  : "输入当前密码后设置新密码。新密码至少 8 位。"}
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="关闭修改密码窗口">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "method" ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-primary/12 text-primary">
                <ShieldCheck className="h-14 w-14" />
              </div>
            </div>
            <button
              type="button"
              className="tl-panel-soft flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20"
              onClick={() => void sendIdentityCode({ advance: true })}
              disabled={isBusy}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MailCheck className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">邮箱验证</span>
                <span className="mt-1 block truncate text-sm text-muted-foreground">
                  通过 {user.email} 接收验证码
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
            {message && (
              <p className={cn("rounded-lg px-3 py-2 text-xs", status === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/8 text-primary")}>
                {message}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose}>
                关闭
              </Button>
            </div>
          </div>
        ) : step === "verify" ? (
          <form className="space-y-3" onSubmit={verifyIdentity}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">邮箱验证码</span>
              <div className="tl-input flex h-12 w-full items-center rounded-xl border px-4 focus-within:ring-2 focus-within:ring-primary/20">
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="输入验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  className="shrink-0 px-2 text-sm font-medium text-primary transition hover:text-primary/80 disabled:text-muted-foreground"
                  onClick={() => void sendIdentityCode()}
                  disabled={resendDisabled}
                >
                  {resendCooldown > 0 ? `重新发送（${resendCooldown}）` : "重新发送"}
                </button>
              </div>
            </label>

            {message && (
              <p className={cn("rounded-lg px-3 py-2 text-xs", status === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/8 text-primary")}>
                {message}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button type="submit" variant="primary" disabled={!canVerify}>
                {status === "verifying" ? "验证中..." : "验证身份"}
              </Button>
            </div>
          </form>
        ) : (
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
        )}
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
  initialToken = null,
  authStatus,
  authError,
  user,
  onClose,
  onLogin,
  onRegister,
  onCreateDemoSession,
}: AuthDialogProps) {
  const [mode, setMode] = useState<AuthDialogView>(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [verificationCooldown, setVerificationCooldown] = useState(0);
  const [verificationCodeSent, setVerificationCodeSent] = useState(false);
  const loading = authStatus === "checking" || localLoading;
  const normalizedEmail = email.trim();
  const normalizedVerificationCode = verificationCode.replace(/\D/g, "");
  const hasRequiredCredentials = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && password.length >= 8;
  const isDemoUpgrade = Boolean(user?.isTemporary && mode === "register");
  const isOpeningDemoUpgrade = Boolean(user?.isTemporary && initialMode === "register");
  const canRequestVerificationCode =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && !loading && verificationCooldown <= 0;
  const canSubmit =
    mode === "forgot-password"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && !loading
      : mode === "reset-password"
        ? password.length >= 8 && confirmPassword.length >= 8 && !loading
        : mode === "verify-email"
          ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && normalizedVerificationCode.length === 6 && !loading
          : mode === "register" && !isDemoUpgrade
            ? hasRequiredCredentials && normalizedVerificationCode.length === 6 && !loading
            : hasRequiredCredentials && !loading;

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setLocalError(null);
    setStatusMessage(null);
    setConfirmPassword("");
    setVerificationCode("");
    setVerificationCooldown(0);
    setVerificationCodeSent(false);
  }, [initialMode, initialToken, open]);

  useEffect(() => {
    if (verificationCooldown <= 0) return;
    const timer = window.setTimeout(() => setVerificationCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [verificationCooldown]);

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
    setStatusMessage(null);
    try {
      if (mode === "forgot-password") {
        setLocalLoading(true);
        await forgotPassword({ email: normalizedEmail });
        setStatusMessage("如果该邮箱已注册，我们已发送重置密码邮件。");
      } else if (mode === "reset-password") {
        if (password !== confirmPassword) {
          setLocalError("两次输入的新密码不一致。");
          return;
        }
        if (!initialToken) {
          setLocalError("重置链接缺少 token，请重新申请。");
          return;
        }
        setLocalLoading(true);
        await resetPassword({ token: initialToken, newPassword: password });
        setPassword("");
        setConfirmPassword("");
        setStatusMessage("密码已重置，请使用新密码登录。");
        setMode("login");
      } else if (mode === "verify-email") {
        setLocalLoading(true);
        const response = await verifyEmail({ email: normalizedEmail, code: normalizedVerificationCode });
        if (response.token) {
          setAuthToken(response.token);
        }
        setVerificationCode("");
        setStatusMessage("邮箱已验证，正在进入 ArborLearn。");
        window.setTimeout(() => {
          window.location.href = "/notebooks";
        }, 500);
      } else if (mode === "register") {
        await onRegister(email, password, displayName || undefined, isDemoUpgrade ? undefined : normalizedVerificationCode);
        setPassword("");
        setVerificationCode("");
      } else {
        await onLogin(email, password);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败";
      setLocalError(message);
    } finally {
      setLocalLoading(false);
    }
  };

  const switchMode = () => {
    setLocalError(null);
    setStatusMessage(null);
    setVerificationCode("");
    setMode(mode === "login" ? "register" : "login");
  };

  const resendVerification = async () => {
    setLocalError(null);
    setStatusMessage(null);
    try {
      setLocalLoading(true);
      await sendVerificationEmail({ email: normalizedEmail });
      setStatusMessage("验证码已发送，请查收邮箱。");
      setVerificationCodeSent(true);
      setVerificationCooldown(60);
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送验证邮件失败";
      if (message.includes("Please wait before requesting another email")) {
        setVerificationCodeSent(true);
        setVerificationCooldown(60);
        setLocalError("验证码刚刚发送过，请稍后再试。");
      } else {
        setLocalError(message);
      }
    } finally {
      setLocalLoading(false);
    }
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

  const displayError = (localError || authError) === "EMAIL_VERIFICATION_REQUIRED" ? null : localError || authError;

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">
              {mode === "login"
                ? "登录 ArborLearn"
                : mode === "register"
                  ? "创建 ArborLearn 账号"
                  : mode === "forgot-password"
                    ? "找回密码"
                    : mode === "reset-password"
                      ? "重置密码"
                      : "验证邮箱"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {mode === "forgot-password"
                ? "输入注册邮箱，我们会发送重置密码链接。"
                : mode === "reset-password"
                  ? "为你的账号设置一个新密码。"
                  : mode === "verify-email"
                    ? "输入邮箱收到的 6 位验证码即可完成登录。"
                    : "登录后，笔记本、节点和聊天记录会保存在你的账号下。"}
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="关闭登录窗口">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          {(mode === "login" || mode === "register" || mode === "forgot-password" || mode === "verify-email") && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">邮箱</span>
              <input
                className="tl-input h-12 w-full rounded-xl border px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                required
              />
            </label>
          )}
          {mode === "register" && !isDemoUpgrade && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">邮箱验证码</span>
              <div className="tl-input flex h-12 w-full items-center rounded-xl border px-4 focus-within:ring-2 focus-within:ring-primary/20">
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="输入验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  className="shrink-0 px-2 text-sm font-medium text-primary transition hover:text-primary/80 disabled:text-muted-foreground"
                  onClick={resendVerification}
                  disabled={!canRequestVerificationCode}
                >
                  {verificationCodeSent
                    ? verificationCooldown > 0
                      ? `重新发送（${verificationCooldown}）`
                      : "重新发送"
                    : "发送验证码"}
                </button>
              </div>
            </label>
          )}
          {mode === "register" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">昵称</span>
              <input
                className="tl-input h-12 w-full rounded-xl border px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="输入昵称"
                autoComplete="name"
              />
            </label>
          )}
          {mode === "verify-email" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">验证码</span>
              <input
                className="tl-input h-12 w-full rounded-xl border px-4 text-center text-lg font-semibold outline-none focus:ring-2 focus:ring-primary/20"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 位数字"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
            </label>
          )}
          {(mode === "login" || mode === "register" || mode === "reset-password") && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{mode === "reset-password" ? "新密码" : "密码"}</span>
              <input
                className="tl-input h-12 w-full rounded-xl border px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                required
              />
            </label>
          )}
          {mode === "reset-password" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">确认新密码</span>
              <input
                className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入新密码"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          )}

          {displayError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {displayError}
            </p>
          )}
          {statusMessage && (
            <p className="rounded-lg bg-primary/8 px-3 py-2 text-xs text-primary">
              {statusMessage}
            </p>
          )}
          {mode === "verify-email" && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/8 px-2 py-2 text-sm font-medium text-primary transition hover:bg-primary/12"
              onClick={resendVerification}
              disabled={!canRequestVerificationCode}
            >
              <MailCheck className="h-4 w-4" />
              {verificationCooldown > 0 ? `重新发送（${verificationCooldown}）` : "重新发送"}
            </button>
          )}

          <Button
            className={cn(
              "h-12 w-full rounded-xl",
              !canSubmit &&
                "border-white/55 bg-background/35 text-muted-foreground shadow-[0_10px_30px_rgba(25,45,64,0.08),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-md hover:translate-y-0 hover:bg-background/45 hover:brightness-100 hover:shadow-[0_10px_30px_rgba(25,45,64,0.08),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:border-white/55 disabled:bg-background/35 disabled:text-muted-foreground disabled:opacity-100 dark:border-white/15 dark:bg-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/12 dark:disabled:bg-white/10",
            )}
            type="submit"
            disabled={!canSubmit}
          >
            {mode === "login" ? <LogIn className="h-4 w-4" /> : mode === "register" ? <UserPlus className="h-4 w-4" /> : mode === "verify-email" ? <MailCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            {loading
              ? "处理中..."
              : mode === "login"
                ? "登录"
                : mode === "register"
                  ? "立即注册"
                  : mode === "forgot-password"
                    ? "发送重置邮件"
                    : mode === "verify-email"
                      ? "验证并登录"
                      : "保存新密码"}
          </Button>
        </form>

        {(mode === "login" || mode === "register") && (
          <button
            className="mt-3 flex w-full items-center justify-center rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-medium text-primary transition hover:bg-primary/8 focus:outline-none focus:ring-2 focus:ring-primary/20"
            onClick={switchMode}
          >
            {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
          </button>
        )}
        {mode === "login" && (
          <button
            className="mt-1 flex w-full items-center justify-center rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
            onClick={() => {
              setLocalError(null);
              setStatusMessage(null);
              setMode("forgot-password");
            }}
          >
            忘记密码？
          </button>
        )}
        {(mode === "forgot-password" || mode === "reset-password" || mode === "verify-email") && (
          <button
            className="mt-3 flex w-full items-center justify-center rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-medium text-primary transition hover:bg-primary/8 focus:outline-none focus:ring-2 focus:ring-primary/20"
            onClick={() => {
              setLocalError(null);
              setStatusMessage(null);
              setMode("login");
            }}
          >
            返回登录
          </button>
        )}

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

function SubmenuRow({
  icon: Icon,
  label,
  active,
  submenuSide,
  onActivate,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  submenuSide: "left" | "right";
  onActivate: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative" onMouseEnter={onActivate} onFocus={onActivate}>
      <button
        type="button"
        className={cn("tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left", active && "tl-accent-soft")}
        onClick={onActivate}
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
      </button>
      {active && (
        <div
          className={cn(
            "absolute top-0 z-[70] w-52 text-sm",
            submenuSide === "right" ? "left-full pl-2" : "right-full pr-2",
          )}
        >
          <div className="tl-panel rounded-xl border p-2 shadow-panel">{children}</div>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  icon: Icon,
  label,
  trailing,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  trailing?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left" onClick={onClick}>
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
  icon: ComponentType<{ className?: string }>;
  label: string;
  onSelect: (mode: ThemeMode) => void;
}) {
  const active = mode === current;
  return (
    <button
      type="button"
      className={cn("tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left", active && "tl-accent-soft")}
      onClick={() => onSelect(mode)}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {active && <Check className="ml-auto h-4 w-4 text-primary" />}
    </button>
  );
}
