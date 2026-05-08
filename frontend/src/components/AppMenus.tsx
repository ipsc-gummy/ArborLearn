import * as Popover from "@radix-ui/react-popover";
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
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export type ThemeMode = "light" | "dark" | "system";

interface SettingsMenuProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

interface AccountMenuProps {
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

// 设置菜单：集中管理帮助、反馈、语言和主题入口；当前只有主题会改变实际状态。
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

// 账号菜单：用本地 isLoggedIn 模拟登录态，后续可替换为真实 auth/session 数据。
export function AccountMenu({ isLoggedIn, onLogin, onLogout }: AccountMenuProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#dadce0] bg-[#f1f3f4] text-sm font-semibold text-[#3c4043] shadow-sm transition hover:bg-[#e8eaed] dark:border-transparent dark:bg-[#f1f3f4] dark:text-[#202124] dark:hover:bg-white"
          aria-label="打开账号菜单"
        >
          {isLoggedIn ? "TL" : <CircleUserRound className="h-5 w-5" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-72 rounded-xl border p-2 text-sm shadow-panel">
          {isLoggedIn ? (
            <>
              <div className="tl-panel-soft rounded-lg border p-3">
                <p className="font-semibold">TreeLearn User</p>
                <p className="mt-1 text-xs text-muted-foreground">treelearn@example.com</p>
              </div>
              <MenuButton icon={CircleUserRound} label="账号信息" />
              <MenuButton icon={UserPlus} label="切换账号" />
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4" />
                退出账号
              </button>
            </>
          ) : (
            <>
              <div className="tl-panel-soft rounded-lg border p-3">
                <p className="font-semibold">尚未登录</p>
                <p className="mt-1 text-xs text-muted-foreground">登录后可同步笔记本、分享与导出记录。</p>
              </div>
              <button className="tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left" onClick={onLogin}>
                <LogIn className="h-4 w-4" />
                登录
              </button>
              <button className="tl-hover flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left" onClick={onLogin}>
                <UserPlus className="h-4 w-4" />
                注册
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  // 通用菜单行，trailing 用于展示当前语言等右侧说明。
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
  // 单个主题选项；选中项右侧展示 Check，并通过 App 下发到 html 根节点。
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
