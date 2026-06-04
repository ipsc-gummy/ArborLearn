import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { AlertCircle, Coins, CreditCard, RefreshCw, Wallet as WalletIcon, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import {
  getUsageEvents,
  getUsageSummary,
  getWallet,
  type UsageEvent,
  type UsageSummary,
  type Wallet,
} from "../lib/api";
import type { AuthUser } from "../lib/api";

interface WalletMenuProps {
  user: AuthUser | null;
  trigger?: ReactNode;
  side?: Popover.PopoverContentProps["side"];
  align?: Popover.PopoverContentProps["align"];
}

const MOCK_TOPUP_AMOUNTS = [3, 5, 10];

function formatCents(cents: number | null | undefined) {
  if (typeof cents !== "number" || Number.isNaN(cents)) return "--";
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatCompactCents(cents: number | null | undefined) {
  if (typeof cents !== "number" || Number.isNaN(cents)) return "--";
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function formatTokens(tokens: number | null | undefined) {
  if (typeof tokens !== "number" || Number.isNaN(tokens)) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(tokens);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventLabel(event: UsageEvent) {
  const labels: Record<string, string> = {
    chat: "聊天",
    chat_stream: "流式聊天",
    retry: "重试",
    retry_stream: "流式重试",
    backfill_draft: "回填草稿",
    plan: "长任务规划",
    step_analyze: "长任务分析",
    step_retrieve: "长任务检索",
    final_summary: "最终总结",
    title: "标题生成",
    node_summary: "节点摘要",
    branch_summary: "分支摘要",
    vision_extract: "图片理解",
  };
  return labels[event.call_type] ?? event.call_type;
}

export function WalletMenu({ user, trigger, side = "bottom", align = "end" }: WalletMenuProps) {
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockTopupCents, setMockTopupCents] = useState(0);
  const [customTopup, setCustomTopup] = useState("");
  const [mockNotice, setMockNotice] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const loadWallet = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [walletResponse, usageSummary, usageEvents] = await Promise.all([
        getWallet(),
        getUsageSummary(),
        getUsageEvents({ limit: 5 }),
      ]);
      setWallet(walletResponse.wallet);
      setSummary(usageSummary);
      setEvents(usageEvents.events);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "钱包数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void loadWallet();
    if (!user) {
      setWallet(null);
      setSummary(null);
      setEvents([]);
      setMockTopupCents(0);
    }
  }, [user?.id]);

  useEffect(() => {
    if (open) void loadWallet();
  }, [open]);

  if (!user) return null;

  const tokenPerCent = wallet && wallet.initialCents > 0 ? wallet.initialTokens / wallet.initialCents : 1000;
  const mockTopupTokens = Math.round(mockTopupCents * tokenPerCent);
  const balanceCents = (wallet?.balanceCents ?? 0) + mockTopupCents;
  const rawRemainingTokens = (wallet?.balanceTokens ?? 0) + mockTopupTokens;
  const displayRemainingTokens = Math.max(rawRemainingTokens, 0);
  const usedTokens = summary?.total.total_tokens ?? 0;
  const monthTokenQuota = Math.max(displayRemainingTokens + usedTokens, wallet?.initialTokens ?? displayRemainingTokens + usedTokens);
  const usagePercent = monthTokenQuota > 0 ? Math.min(100, Math.max(0, (usedTokens / monthTokenQuota) * 100)) : 0;
  const isLowBalance = wallet ? balanceCents <= 0 : false;
  const customAmount = Number(customTopup);
  const customInvalid = customTopup.trim() !== "" && (!Number.isFinite(customAmount) || customAmount < 0.1 || customAmount > 500);
  const tooltip = wallet
    ? `余额 ${formatCents(balanceCents)} · 剩余 ${formatTokens(displayRemainingTokens)} tokens`
    : "钱包加载中";

  const applyMockTopup = (amountYuan: number) => {
    const cents = Math.round(amountYuan * 100);
    setMockTopupCents((value) => value + cents);
    setMockNotice(`模拟充值 ${formatCents(cents)} 成功，当前仅用于演示。`);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-9 gap-1.5 px-2.5",
              isLowBalance && "border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/12",
            )}
            title={tooltip}
            aria-label="打开钱包"
          >
            <WalletIcon className="h-4 w-4" />
            <span className="hidden text-xs font-semibold sm:inline">{wallet ? formatCompactCents(balanceCents) : "--"}</span>
          </Button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={side} align={align} className="tl-panel z-50 w-[22rem] rounded-xl border p-3 text-sm shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">钱包</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className={cn("text-2xl font-semibold", isLowBalance && "text-destructive")}>{formatCents(balanceCents)}</p>
                {isLowBalance && <AlertCircle className="h-4 w-4 text-destructive" />}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void loadWallet()} disabled={loading} title="刷新钱包">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/8 p-3 text-xs leading-5 text-muted-foreground">
            token 额度和钱包余额会连续保留；本页按本月汇总展示用量，token 不会因为月份切换自动清零。
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="剩余 token" value={formatTokens(displayRemainingTokens)} />
            <Metric label="本月请求" value={formatTokens(summary?.total.request_count)} />
            <Metric label="本月花费" value={formatCents(summary?.total.cost_cents)} />
          </div>

          <div className="mt-4 rounded-lg border border-border/70 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">本月 token</span>
              <span className="text-muted-foreground">
                {formatTokens(usedTokens)} / {formatTokens(monthTokenQuota)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full bg-primary transition-all", isLowBalance && "bg-destructive")}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>已用 {formatTokens(usedTokens)}</span>
              <span className="text-right">剩余 {formatTokens(displayRemainingTokens)}</span>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold text-muted-foreground">模拟充值</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MOCK_TOPUP_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="tl-hover rounded-lg border border-border/70 px-3 py-2 text-xs font-semibold"
                  onClick={() => applyMockTopup(amount)}
                >
                  ¥{amount}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={customTopup}
                onChange={(event) => setCustomTopup(event.target.value)}
                className="tl-input h-9 min-w-0 flex-1 rounded-lg border px-3 text-xs outline-none"
                inputMode="decimal"
                placeholder="其他 0.1 ~ 500"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={customTopup.trim() === "" || customInvalid}
                onClick={() => {
                  applyMockTopup(customAmount);
                  setCustomTopup("");
                }}
              >
                <CreditCard className="h-4 w-4" />
                确认
              </Button>
            </div>
            {customInvalid && <p className="mt-1 text-xs text-destructive">请输入 0.1 到 500 之间的金额。</p>}
            {mockNotice && <p className="mt-2 text-xs text-primary">{mockNotice}</p>}
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-muted-foreground">最近用量</p>
              <button
                type="button"
                className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
                onClick={() => setDetailsOpen(true)}
              >
                更多
              </button>
            </div>
            <div className="max-h-44 space-y-2 overflow-auto">
              {events.length === 0 && <p className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">暂无用量记录。</p>}
              {events.map((event) => (
                <div key={event.id} className="rounded-lg border border-border/70 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{eventLabel(event)}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {event.model_name ?? "unknown"} · {formatTokens(event.total_tokens ?? 0)} tokens · {formatCents(event.cost_cents ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
      {detailsOpen && typeof document !== "undefined" &&
        createPortal(
          <UsageDetailsModal onClose={() => setDetailsOpen(false)} />,
          document.body,
        )}
    </Popover.Root>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 p-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

function UsageDetailsModal({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageSummary, usageEvents] = await Promise.all([
        getUsageSummary({ scope: "all" }),
        getUsageEvents({ scope: "all", limit: 50 }),
      ]);
      setSummary(usageSummary);
      setEvents(usageEvents.events);
      setNextCursor(usageEvents.nextCursor ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "用量详情加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const usageEvents = await getUsageEvents({ scope: "all", limit: 50, cursor: nextCursor });
      setEvents((current) => [...current, ...usageEvents.events]);
      setNextCursor(usageEvents.nextCursor ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "更多用量记录加载失败");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadInitial();
  }, []);

  return (
    <div className="tl-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="tl-modal-panel tl-panel flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border p-5 shadow-panel">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">全部用量</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">展示当前账户从创建以来的 token、调用次数和用量记录。</p>
          </div>
          <button className="tl-hover rounded-full p-2" onClick={onClose} aria-label="关闭全部用量">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
            <span>{error}</span>
            <button type="button" className="font-semibold underline-offset-4 hover:underline" onClick={() => void loadInitial()}>
              重试
            </button>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-4">
          <Metric label="总 token" value={formatTokens(summary?.total.total_tokens)} />
          <Metric label="总调用次数" value={formatTokens(summary?.total.request_count)} />
          <Metric label="总花费" value={formatCents(summary?.total.cost_cents)} />
          <Metric
            label="成功 / 失败"
            value={
              summary
                ? `${formatTokens(summary.total.successful_requests)} / ${formatTokens(summary.total.failed_requests)}`
                : "--"
            }
          />
        </div>

        <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-h-0 rounded-xl border border-border/70 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">模型 / 功能入口</p>
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {summary?.groups.length === 0 && <p className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">暂无聚合数据。</p>}
              {summary?.groups.map((group) => (
                <div key={`${group.model_name}-${group.call_type}`} className="rounded-lg border border-border/70 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold">{eventLabel({ call_type: group.call_type } as UsageEvent)}</p>
                    <span className="shrink-0 text-muted-foreground">{formatTokens(group.request_count)} 次</span>
                  </div>
                  <p className="mt-1 truncate text-muted-foreground">{group.model_name || "unknown"}</p>
                  <p className="mt-1 text-muted-foreground">
                    {formatTokens(group.total_tokens)} tokens · {formatCents(group.cost_cents)}
                  </p>
                </div>
              ))}
              {loading && !summary && <p className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">加载中...</p>}
            </div>
          </div>

          <div className="min-h-0 rounded-xl border border-border/70 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">所有用量记录</p>
            <div className="max-h-[28rem] space-y-2 overflow-auto pr-1">
              {events.length === 0 && !loading && <p className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">暂无用量记录。</p>}
              {events.map((event) => (
                <div key={event.id} className="rounded-lg border border-border/70 p-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{eventLabel(event)}</p>
                      <p className="mt-1 truncate text-muted-foreground">{event.model_name ?? "unknown"}</p>
                    </div>
                    <div className="shrink-0 text-right text-muted-foreground">
                      <p>{formatDateTime(event.created_at)}</p>
                      <p className={event.success ? "text-primary" : "text-destructive"}>{event.success ? "成功" : "失败"}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                    <span>Prompt {formatTokens(event.prompt_tokens ?? 0)}</span>
                    <span>Completion {formatTokens(event.completion_tokens ?? 0)}</span>
                    <span>Total {formatTokens(event.total_tokens ?? 0)}</span>
                    <span>{formatCents(event.cost_cents ?? 0)} · {event.usage_source ?? "unknown"}</span>
                  </div>
                </div>
              ))}
              {loading && <p className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">加载中...</p>}
            </div>
            {nextCursor && (
              <Button className="mt-3 w-full" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "加载中..." : "加载更多"}
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
