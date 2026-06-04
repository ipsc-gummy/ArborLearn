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
import { changePassword, fetchAdminSettings, updateAdminSettings, type AuthUser, type RuntimeSettings } from "../lib/api";

export type ThemeMode = "light" | "dark" | "system";
export type AuthDialogMode = "login" | "register";

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
        <Button variant="ghost" size="icon" aria-label="鎵撳紑璁剧疆">
          <Settings className="h-4 w-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" className="tl-panel z-50 w-72 rounded-xl border p-2 text-sm shadow-panel">
          <MenuButton icon={HelpCircle} label="ArborLearn 甯姪" onClick={() => navigate(PRODUCT_GUIDE_PATH)} />
          <MenuButton icon={MessageSquareWarning} label="鍙戦€佸弽棣? onClick={() => openExternalUrl(GITHUB_ISSUES_NEW_URL)} />
          <div className="tl-border-soft my-2 border-t" />
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">澶栬</p>
          <ThemeOption mode="light" current={themeMode} icon={Sun} label="娴呰壊" onSelect={onThemeChange} />
          <ThemeOption mode="dark" current={themeMode} icon={Moon} label="娣辫壊" onSelect={onThemeChange} />
          <ThemeOption mode="system" current={themeMode} icon={Monitor} label="璺熼殢绯荤粺" onSelect={onThemeChange} />
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
  const displayName = user?.displayName ?? "鏈櫥褰?;
  const displayEmail = user?.email ?? "鐧诲綍鍚庝繚瀛樹綘鐨勫涔犺繘搴?;
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
      aria-label={user ? "鎵撳紑璐﹀彿涓庤缃彍鍗? : "鎵撳紑鐧诲綍涓庤缃彍鍗?}
    >
      {avatarMark}
    </button>
  );

  const rowTrigger = (
    <button
      type="button"
      className="tl-hover flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left"
      aria-label={user ? "鎵撳紑璐﹀彿涓庤缃彍鍗? : "鎵撳紑鐧诲綍涓庤缃彍鍗?}
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
                        涓存椂浣撻獙
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <div className="tl-panel-soft mb-2 rounded-lg border p-3">
                <p className="font-semibold">ArborLearn 璐﹀彿</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">鐧诲綍鍚庯紝绗旇鏈拰瀛︿範璺緞浼氫繚瀛樺湪浣犵殑璐﹀彿涓嬨€?/p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      closeMenu();
                      onRequestAuth("login");
                    }}
                  >
                    鐧诲綍
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      closeMenu();
                      onRequestAuth("register");
                    }}
                  >
                    娉ㄥ唽
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
            {user?.isTemporary && (<MenuButton
                icon={UserPlus}
                label="缁戝畾姝ｅ紡璐﹀彿"
                onClick={() => {
                  closeMenu();
                  onRequestAuth("register");
                }}
              />
            )}
            {user?.isAdmin && (
              <MenuButton
                icon={ShieldCheck}
                label="鍚庡彴璁剧疆"
                onClick={() => {
                  closeMenu();
                  setAdminSettingsOpen(true);
                }}
              />
            )}
            {user && !user.isTemporary && (
              <MenuButton
                icon={KeyRound}
                label="淇敼瀵嗙爜"
                onClick={() => {
                  closeMenu();
                  setPasswordDialogOpen(true);
                }}
              />
            )}

            <div className="tl-border-soft my-2 border-t" />
            <SubmenuRow
              icon={Settings}
              label="澶栬"
              active={activeSubmenu === "appearance"}
              submenuSide={submenuSide}
              onActivate={() => setActiveSubmenu("appearance")}
            >
              <ThemeOption mode="light" current={themeMode} icon={Sun} label="娴呰壊" onSelect={selectTheme} />
              <ThemeOption mode="dark" current={themeMode} icon={Moon} label="娣辫壊" onSelect={selectTheme} />
              <ThemeOption mode="system" current={themeMode} icon={Monitor} label="璺熼殢绯荤粺" onSelect={selectTheme} />
            </SubmenuRow>
            <SubmenuRow
              icon={HelpCircle}
              label="甯姪"
              active={activeSubmenu === "help"}
              submenuSide={submenuSide}
              onActivate={() => setActiveSubmenu("help")}
            >
              <MenuButton icon={HelpCircle} label="ArborLearn 甯姪" onClick={openGuide} />
              <MenuButton icon={MessageSquareWarning} label="鍙戦€佸弽棣? onClick={openFeedback} />
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
                  閫€鍑鸿处鍙?
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
                <p className="text-lg font-semibold">璐﹀彿淇℃伅</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">褰撳墠鐧诲綍璐﹀彿鐨勫熀纭€淇℃伅銆?/p>
              </div>
              <button className="tl-hover rounded-full p-2" onClick={() => setAccountInfoOpen(false)} aria-label="鍏抽棴璐﹀彿淇℃伅">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-4 flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-xl font-semibold text-background">
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <AccountInfoRow label="鏄电О" value={user.displayName} />
              <AccountInfoRow label="閭" value={user.email} />
              <AccountInfoRow label="鐘舵€? value="宸茬櫥褰? />
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
      setMessage("涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷淬€?);
      return;
    }
    if (currentPassword === newPassword) {
      setStatus("error");
      setMessage("鏂板瘑鐮佷笉鑳藉拰褰撳墠瀵嗙爜鐩稿悓銆?);
      return;
    }
    setStatus("saving");
    try {
      await changePassword({ currentPassword, newPassword });
      setStatus("success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("瀵嗙爜宸叉洿鏂帮紝涓嬫鐧诲綍璇蜂娇鐢ㄦ柊瀵嗙爜銆?);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "淇敼瀵嗙爜澶辫触");
    }
  };

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">淇敼瀵嗙爜</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              杈撳叆褰撳墠瀵嗙爜鍚庤缃柊瀵嗙爜銆傛柊瀵嗙爜鑷冲皯 8 浣嶃€?
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="鍏抽棴淇敼瀵嗙爜绐楀彛">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">褰撳墠瀵嗙爜</span>
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
            <span className="mb-1 block text-xs font-medium text-muted-foreground">鏂板瘑鐮?/span>
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
            <span className="mb-1 block text-xs font-medium text-muted-foreground">纭鏂板瘑鐮?/span>
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
              鍏抽棴
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {status === "saving" ? "淇濆瓨涓?.." : "淇濆瓨鏂板瘑鐮?}
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
        setMessage(error instanceof Error ? error.message : "鏃犳硶鍔犺浇鍚庡彴璁剧疆");
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
      setMessage("璁剧疆宸蹭繚瀛橈紝鐢ㄦ埛鍒锋柊椤甸潰鍚庣敓鏁堛€?);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "淇濆瓨澶辫触");
    }
  };

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel max-h-[86vh] w-full max-w-2xl overflow-auto rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">鍚庡彴璁剧疆</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              璋冩暣婕旂ず璐﹀彿鎻愮ず闃堝€煎拰淇濈暀绛栫暐銆傚缓璁皬姝ヤ慨鏀癸紝瑙傚療杞寲鍜屼娇鐢ㄤ綋楠屽悗鍐嶇户缁皟銆?
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="鍏抽棴鍚庡彴璁剧疆">
            <X className="h-4 w-4" />
          </button>
        </div>

        {status === "loading" && <p className="text-sm text-muted-foreground">姝ｅ湪鍔犺浇璁剧疆...</p>}
        {settings && (
          <div className="grid gap-3">
            {Object.entries(settings).map(([key, setting]) => (
              <label key={key} className="rounded-xl border border-border bg-muted/25 p-3">
                <span className="block text-sm font-semibold">{setting.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  鑼冨洿 {setting.min} - {setting.max}锛岄粯璁?{setting.default}
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
            鍏抽棴
          </Button>
          <Button variant="primary" onClick={save} disabled={!settings || status === "saving" || status === "loading"}>
            {status === "saving" ? "淇濆瓨涓?.." : "淇濆瓨璁剧疆"}
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
      setLocalError(error instanceof Error ? error.message : "鎿嶄綔澶辫触");
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
      setLocalError(error instanceof Error ? error.message : "杩涘叆婕旂ず澶辫触");
    }
  };

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="tl-modal-panel tl-panel w-full max-w-md rounded-2xl border p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{mode === "login" ? "鐧诲綍 ArborLearn" : "鍒涘缓 ArborLearn 璐﹀彿"}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              鐧诲綍鍚庯紝绗旇鏈€佽妭鐐瑰拰鑱婂ぉ璁板綍浼氫繚瀛樺湪浣犵殑璐﹀彿涓嬨€?
            </p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="鍏抽棴鐧诲綍绐楀彛">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          {mode === "register" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">鏄电О</span>
              <input
                className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="鍙€?
                autoComplete="name"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">閭</span>
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
            <span className="mb-1 block text-xs font-medium text-muted-foreground">瀵嗙爜</span>
            <input
              className="tl-input h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="鑷冲皯 8 浣?
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
            {loading ? "澶勭悊涓?.." : mode === "login" ? "鐧诲綍" : "娉ㄥ唽骞剁櫥褰?}
          </Button>
        </form>

        <button
          className="mt-3 flex w-full items-center justify-center rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-medium text-primary transition hover:bg-primary/8 focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={switchMode}
        >
          {mode === "login" ? "娌℃湁璐﹀彿锛熸敞鍐? : "宸叉湁璐﹀彿锛熺櫥褰?}
        </button>

        {mode === "register" && (
          <button
            type="button"
            className="tl-panel-soft group mt-4 w-full rounded-xl border p-3 text-left text-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/25"
            onClick={startDemoSession}
            disabled={loading}
            aria-label="杩涘叆鐙珛婕旂ず浣撻獙"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">鐙珛婕旂ず浣撻獙</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  鑷姩鎵撳紑 Transformer 绀轰緥锛屼笉鍐欏叆闀挎湡璐﹀彿锛屼篃涓嶅拰鍏朵粬璁块棶鑰呭叡浜褰曘€?
                </p>
              </div>
              <span className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-background/70 px-3 text-xs font-medium text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                浣撻獙绀轰緥
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
