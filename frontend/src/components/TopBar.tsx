import { ArrowLeft, Download, Share2 } from "lucide-react";
import { AccountMenu, SettingsMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import { Button } from "./ui/button";
import type { AuthUser } from "../lib/api";

interface TopBarProps {
  onHome: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  user: AuthUser | null;
  authStatus: "checking" | "authenticated" | "anonymous" | "error";
  authError: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName?: string) => Promise<void>;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

// 工作区顶部栏：只保留页面级操作，具体节点操作放在左侧树和聊天面板中。
export function TopBar({ onHome, themeMode, onThemeChange, user, onLogout, onRequestAuth }: TopBarProps) {
  return (
    <header className="tl-app-bg-elevated flex h-16 shrink-0 items-center justify-between border-b tl-border px-3 backdrop-blur md:px-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onHome} aria-label="返回首页">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-medium leading-tight">TreeLearn Notebook</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">Nodes · Chat · Diagram</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" title="导出 .tree">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">导出</span>
        </Button>
        <Button variant="secondary" size="sm" title="分享学习树">
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">分享</span>
        </Button>
        <SettingsMenu themeMode={themeMode} onThemeChange={onThemeChange} />
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
        />
      </div>
    </header>
  );
}
