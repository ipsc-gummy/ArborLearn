import * as Popover from "@radix-ui/react-popover";
import { createPortal } from "react-dom";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CircleUserRound,
  HelpCircle,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Monitor,
  Moon,
  Settings,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { AuthUser } from "../lib/api";

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
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName?: string) => Promise<void>;
  onCreateDemoSession: () => Promise<void>;
}

const GITHUB_REPO_URL = "https://github.com/ipsc-gummy/ArborLearn";
const GITHUB_ISSUES_NEW_URL = `${GITHUB_REPO_URL}/issues/new`;
const PRODUCT_GUIDE_PATH = "/guide";

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
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
    </>
  );
}

export function AuthDialog({
  open,
  initialMode = "login",
  authStatus,
  authError,
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

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setLocalError(null);
  }, [initialMode, open]);

  useEffect(() => {
    if (open && authStatus === "authenticated") {
      setPassword("");
      onClose();
    }
  }, [authStatus, onClose, open]);

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
