import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CircleUserRound,
  HelpCircle,
  Languages,
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
}

export function SettingsMenu({ themeMode, onThemeChange }: SettingsMenuProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="打开设置">
          <Settings className="h-4 w-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-72 rounded-xl border p-2 text-sm shadow-panel">
          <MenuButton icon={HelpCircle} label="TreeLearn 帮助" />
          <MenuButton icon={MessageSquareWarning} label="发送反馈" />
          <MenuButton icon={Languages} label="语言" trailing="简体中文" />
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
    <Popover.Root>
      <Popover.Trigger asChild>{avatar}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-72 rounded-xl border p-2 text-sm shadow-panel">
          <div className="tl-panel-soft rounded-lg border p-3">
            <p className="font-semibold">{user.displayName}</p>
            <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
          </div>
          <MenuButton icon={CircleUserRound} label="账号信息" />
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
}: AuthDialogProps) {
  const [mode, setMode] = useState<AuthDialogMode>(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const loading = authStatus === "checking";

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
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

          <Button className="h-11 w-full" type="submit" disabled={loading}>
            {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {loading ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
          </Button>
        </form>

        <button className="tl-hover mt-3 flex w-full items-center justify-center rounded-lg px-2 py-2 text-sm text-muted-foreground" onClick={switchMode}>
          {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
        </button>
      </div>
    </div>
  );
}

function MenuButton({
  icon: Icon,
  label,
  trailing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  trailing?: string;
}) {
  return (
    <button className="tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left">
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
