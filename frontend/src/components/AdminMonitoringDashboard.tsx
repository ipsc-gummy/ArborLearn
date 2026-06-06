import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ChevronDown,
  Clock,
  Database,
  FileText,
  Gauge,
  Loader2,
  MessageSquareText,
  NotebookTabs,
  Search,
  Shield,
  UserRound,
  WalletCards,
} from "lucide-react";
import {
  fetchAdminMonitoring,
  fetchAdminMonitoringUser,
  type AdminMonitoringEvent,
  type AdminMonitoringModel,
  type AdminMonitoringOverview,
  type AdminMonitoringSeriesPoint,
  type AdminMonitoringUser,
  type AdminMonitoringUserDetail,
} from "../lib/api";
import { cn } from "../lib/utils";
import { AccountMenu, type AuthDialogMode, type ThemeMode } from "./AppMenus";
import type { AuthUser } from "../lib/api";

type RangeMode = string;
type SeriesMetricKey = "request_count" | "total_tokens" | "prompt_tokens" | "cache_hit_tokens" | "cache_miss_tokens" | "completion_tokens" | "cost_micro_cents";

const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
const DEEPSEEK_MODEL_IDS = [DEEPSEEK_FLASH_MODEL, DEEPSEEK_PRO_MODEL];
const QWEN_MODEL_IDS = ["Qwen/Qwen2.5-VL-7B-Instruct", "qwen2.5-vl-7b-instruct"];
const MODEL_BUCKET_EXCLUDED_IDS = [...DEEPSEEK_MODEL_IDS, ...QWEN_MODEL_IDS];
const FLASH_DISPLAY_NAME = "Flash";
const PRO_DISPLAY_NAME = "Pro";
const QWEN_DISPLAY_NAME = "Qwen Vision";
const ELSE_DISPLAY_NAME = "Else";

interface AdminMonitoringDashboardProps {
  onBack: () => void;
  targetUserId?: string | null;
  onOpenUser?: (userId: string) => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  user: AuthUser | null;
  onLogout: () => void;
  onRequestAuth: (mode?: AuthDialogMode) => void;
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRangeOptions(count = 12) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return {
      value,
      label: `${date.getFullYear()} - ${date.getMonth() + 1}月`,
    };
  });
}

function rangeParams(mode: RangeMode) {
  const [year, month] = mode.split("-").map(Number);
  if (!year || !month) {
    const current = currentMonthValue();
    return rangeParams(current);
  }
  return {
    from: new Date(year, month - 1, 1).toISOString(),
    to: new Date(year, month, 1).toISOString(),
  };
}

function monthDateKeys(mode: RangeMode) {
  const [year, month] = mode.split("-").map(Number);
  if (!year || !month) return [];
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${year}-${String(month).padStart(2, "0")}-${day}`;
  });
}

function tooltipPlacement(index: number | null, length: number) {
  if (index === null || length <= 1) return "left-1/2 -translate-x-1/2";
  const ratio = index / (length - 1);
  if (ratio < 0.25) return "left-0";
  if (ratio > 0.75) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

function axisLabel(date: string, index: number, length: number) {
  if (index === 0 || index === length - 1) return date.slice(5);
  return "";
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(Number(value || 0)));
}

function formatCnyFromMicroCents(value: number | null | undefined) {
  return `¥${(Number(value || 0) / 1_000_000 / 100).toFixed(2)} CNY`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function modelAccent(model: string) {
  const normalized = model.toLowerCase();
  if (isQwenModel(model) || normalized.includes("qwen")) return "bg-rose-500";
  if (normalized.includes("pro")) return "bg-sky-500";
  if (normalized.includes("flash")) return "bg-emerald-500";
  return "bg-amber-500";
}

function isQwenModel(model: string | null | undefined) {
  const normalized = String(model || "").toLowerCase();
  return QWEN_MODEL_IDS.some((item) => item.toLowerCase() === normalized);
}

function sumSeriesMetric(item: AdminMonitoringSeriesPoint, modelNames: string[], key: SeriesMetricKey) {
  return modelNames.reduce((sum, modelName) => sum + Number(item.models[modelName]?.[key] ?? 0), 0);
}

function aggregateModelByIds(models: AdminMonitoringModel[], modelNames: string[], displayName: string): AdminMonitoringModel | undefined {
  const matched = models.filter((model) => modelNames.some((modelName) => modelName.toLowerCase() === model.model_name.toLowerCase()));
  if (matched.length === 0) return undefined;
  return aggregateModels(matched, displayName);
}

function aggregateOtherModels(models: AdminMonitoringModel[]) {
  const excluded = MODEL_BUCKET_EXCLUDED_IDS.map((modelName) => modelName.toLowerCase());
  const matched = models.filter((model) => !excluded.includes(model.model_name.toLowerCase()));
  if (matched.length === 0) return undefined;
  return aggregateModels(matched, ELSE_DISPLAY_NAME);
}

function emptyModelBucket(displayName: string): AdminMonitoringModel {
  return {
    model_name: displayName,
    request_count: 0,
    total_tokens: 0,
    prompt_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    completion_tokens: 0,
    cost_cents: 0,
    cost_micro_cents: 0,
    failed_requests: 0,
    avg_latency_ms: 0,
  };
}

function monitoringModelBuckets(models: AdminMonitoringModel[]) {
  return [
    aggregateModelByIds(models, [DEEPSEEK_FLASH_MODEL], FLASH_DISPLAY_NAME) ?? emptyModelBucket(FLASH_DISPLAY_NAME),
    aggregateModelByIds(models, [DEEPSEEK_PRO_MODEL], PRO_DISPLAY_NAME) ?? emptyModelBucket(PRO_DISPLAY_NAME),
    aggregateModelByIds(models, QWEN_MODEL_IDS, QWEN_DISPLAY_NAME) ?? emptyModelBucket(QWEN_DISPLAY_NAME),
    aggregateOtherModels(models) ?? emptyModelBucket(ELSE_DISPLAY_NAME),
  ];
}

function aggregateModels(matched: AdminMonitoringModel[], displayName: string): AdminMonitoringModel {
  const requestCount = matched.reduce((sum, model) => sum + model.request_count, 0);
  const weightedLatency = matched.reduce((sum, model) => sum + model.avg_latency_ms * model.request_count, 0);
  return {
    model_name: displayName,
    request_count: requestCount,
    total_tokens: matched.reduce((sum, model) => sum + model.total_tokens, 0),
    prompt_tokens: matched.reduce((sum, model) => sum + model.prompt_tokens, 0),
    cache_hit_tokens: matched.reduce((sum, model) => sum + model.cache_hit_tokens, 0),
    cache_miss_tokens: matched.reduce((sum, model) => sum + model.cache_miss_tokens, 0),
    completion_tokens: matched.reduce((sum, model) => sum + model.completion_tokens, 0),
    cost_cents: matched.reduce((sum, model) => sum + model.cost_cents, 0),
    cost_micro_cents: matched.reduce((sum, model) => sum + model.cost_micro_cents, 0),
    failed_requests: matched.reduce((sum, model) => sum + model.failed_requests, 0),
    avg_latency_ms: requestCount > 0 ? Math.round(weightedLatency / requestCount) : 0,
  };
}

function sumOtherSeriesMetric(item: AdminMonitoringSeriesPoint, key: SeriesMetricKey) {
  const excluded = MODEL_BUCKET_EXCLUDED_IDS.map((modelName) => modelName.toLowerCase());
  return Object.entries(item.models).reduce((sum, [modelName, model]) => {
    if (excluded.includes(modelName.toLowerCase())) return sum;
    return sum + Number(model?.[key] ?? 0);
  }, 0);
}

export function AdminMonitoringDashboard({
  onBack,
  targetUserId,
  onOpenUser,
  themeMode,
  onThemeChange,
  user,
  onLogout,
  onRequestAuth,
}: AdminMonitoringDashboardProps) {
  const [rangeMode, setRangeMode] = useState<RangeMode>(() => currentMonthValue());
  const rangeOptions = useMemo(() => monthRangeOptions(12), []);
  const [overview, setOverview] = useState<AdminMonitoringOverview | null>(null);
  const [userDetail, setUserDetail] = useState<AdminMonitoringUserDetail | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detailStatus, setDetailStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const params = useMemo(() => rangeParams(rangeMode), [rangeMode]);
  const isUserPage = Boolean(targetUserId);

  useEffect(() => {
    if (isUserPage) return;
    setStatus("loading");
    setError(null);
    void fetchAdminMonitoring(params)
      .then((data) => {
        setOverview(data);
        setStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "监控数据加载失败");
        setStatus("error");
      });
  }, [isUserPage, params]);

  useEffect(() => {
    if (!targetUserId) {
      setUserDetail(null);
      return;
    }
    setDetailStatus("loading");
    setError(null);
    void fetchAdminMonitoringUser(targetUserId, params)
      .then((data) => {
        setUserDetail(data);
        setDetailStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "用户监控数据加载失败");
        setDetailStatus("error");
      });
  }, [params, targetUserId]);

  const filteredUsers = useMemo(() => {
    const users = overview?.users ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter((item) =>
      [item.email, item.display_name, item.id].some((value) => String(value || "").toLowerCase().includes(normalized)),
    );
  }, [overview?.users, query]);

  if (!user?.isAdmin) {
    return (
      <main className="tl-app-bg flex min-h-screen items-center justify-center px-4 text-foreground">
        <section className="tl-panel w-full max-w-md rounded-2xl border p-6 text-center">
          <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold">仅管理员可访问</h1>
          <button className="tl-hover mt-5 rounded-full px-4 py-2 text-sm font-medium" onClick={onBack}>
            返回笔记本
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="tl-app-bg min-h-screen overflow-auto text-foreground">
      <header className="tl-app-bg-elevated tl-border sticky top-0 z-30 border-b px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button className="tl-hover flex h-10 w-10 items-center justify-center rounded-full" onClick={onBack} title="返回">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base font-semibold">{isUserPage ? "用户监控详情" : "ArborLearn 监控平台"}</h1>
              <p className="text-xs text-muted-foreground">
                {isUserPage ? "单个用户的 API、Token、消费与学习资产数据" : "实时读取后端数据库中的用户、用量与学习资产数据"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AccountMenu
              user={user}
              themeMode={themeMode}
              onThemeChange={onThemeChange}
              onLogout={onLogout}
              onRequestAuth={onRequestAuth}
              submenuSide="left"
            />
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <div className="flex justify-end">
          <MonthRangeSelect value={rangeMode} options={rangeOptions} onChange={setRangeMode} />
        </div>
        {isUserPage ? (
          <UserMonitoringPage status={detailStatus} detail={userDetail} error={error} rangeMode={rangeMode} />
        ) : (
          <OverviewPage
            status={status}
            error={error}
            overview={overview}
            users={filteredUsers}
            query={query}
            onQueryChange={setQuery}
            onOpenUser={onOpenUser}
            rangeMode={rangeMode}
          />
        )}
      </section>
    </main>
  );
}

function OverviewPage({
  status,
  error,
  overview,
  users,
  query,
  onQueryChange,
  onOpenUser,
  rangeMode,
}: {
  status: "loading" | "ready" | "error";
  error: string | null;
  overview: AdminMonitoringOverview | null;
  users: AdminMonitoringUser[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenUser?: (userId: string) => void;
  rangeMode: RangeMode;
}) {
  if (status === "loading") {
    return <LoadingPanel text="正在读取实时监控数据" />;
  }
  if (status === "error") {
    return <ErrorPanel text={error || "监控数据加载失败"} />;
  }
  if (!overview) return null;
  return (
    <>
      <OverviewCards overview={overview} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
        <section className="tl-panel rounded-2xl border p-5">
          <SectionTitle icon={BarChart3} title="全局 Token 趋势" aside={overview.range.label} />
          <UsageBars series={overview.series} rangeMode={rangeMode} />
        </section>
        <section className="tl-panel rounded-2xl border p-5">
          <SectionTitle icon={Gauge} title="模型用量" aside="deepseek" />
          <ModelUsage models={overview.models} />
        </section>
      </div>
      <section className="tl-panel rounded-2xl border p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionTitle icon={UserRound} title="用户监控" aside={`${users.length} / ${overview.users.length}`} />
          <label className="tl-input flex h-9 min-w-0 items-center gap-2 rounded-full border px-3 sm:w-72">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索用户"
            />
          </label>
        </div>
        <UserTable users={users} onOpenUser={onOpenUser} />
      </section>
      <section className="tl-panel rounded-2xl border p-5">
        <SectionTitle icon={Activity} title="最近模型调用" aside="实时日志" />
        <RecentEvents events={overview.recent_events} />
      </section>
    </>
  );
}

function UserMonitoringPage({
  status,
  detail,
  error,
  rangeMode,
}: {
  status: "loading" | "ready" | "error";
  detail: AdminMonitoringUserDetail | null;
  error: string | null;
  rangeMode: RangeMode;
}) {
  if (status === "loading") {
    return <LoadingPanel text="正在读取用户监控数据" />;
  }
  if (status === "error") {
    return <ErrorPanel text={error || "用户监控数据加载失败"} />;
  }
  if (!detail) return null;
  return (
    <>
      <section className="tl-panel rounded-2xl border p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold text-primary">User detail</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal">{detail.user.display_name || detail.user.email}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{detail.user.email}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat icon={Database} label="Tokens" value={formatNumber(detail.usage.total_tokens)} />
            <MiniStat icon={Activity} label="API 请求次数" value={formatNumber(detail.usage.request_count)} />
            <MiniStat icon={WalletCards} label="消费" value={formatCnyFromMicroCents(detail.usage.cost_micro_cents)} />
            <MiniStat icon={Clock} label="模型调用延迟" value={`${formatNumber(detail.usage.avg_latency_ms)}ms`} />
          </div>
        </div>
      </section>
      <section className="tl-panel rounded-2xl border p-5">
        <SectionTitle icon={BarChart3} title="每月用量" aside="消费金额" />
        <CostBars series={detail.series} rangeMode={rangeMode} />
      </section>
      <section className="grid gap-5 xl:grid-cols-4">
        <section className="tl-panel rounded-2xl border p-5">
          <ModelDeepSeekPanel
            displayName={FLASH_DISPLAY_NAME}
            modelNames={[DEEPSEEK_FLASH_MODEL]}
            model={aggregateModelByIds(detail.models, [DEEPSEEK_FLASH_MODEL], FLASH_DISPLAY_NAME)}
            series={detail.series}
            rangeMode={rangeMode}
          />
        </section>
        <section className="tl-panel rounded-2xl border p-5">
          <ModelDeepSeekPanel
            displayName={PRO_DISPLAY_NAME}
            modelNames={[DEEPSEEK_PRO_MODEL]}
            model={aggregateModelByIds(detail.models, [DEEPSEEK_PRO_MODEL], PRO_DISPLAY_NAME)}
            series={detail.series}
            rangeMode={rangeMode}
          />
        </section>
        <section className="tl-panel rounded-2xl border p-5">
          <ModelDeepSeekPanel
            displayName={QWEN_DISPLAY_NAME}
            modelNames={QWEN_MODEL_IDS}
            model={aggregateModelByIds(detail.models, QWEN_MODEL_IDS, QWEN_DISPLAY_NAME)}
            series={detail.series}
            rangeMode={rangeMode}
            showCacheBreakdown={false}
          />
        </section>
        <section className="tl-panel rounded-2xl border p-5">
          <ModelElsePanel model={aggregateOtherModels(detail.models)} series={detail.series} rangeMode={rangeMode} />
        </section>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="tl-panel rounded-2xl border p-5">
          <SectionTitle icon={NotebookTabs} title="学习资产" />
          <NotebookAssets notebooks={detail.notebooks} />
        </section>
        <section className="tl-panel rounded-2xl border p-5">
          <SectionTitle icon={Activity} title="最近模型调用" />
          <RecentEvents events={detail.recent_events} />
        </section>
      </section>
    </>
  );
}

function SectionTitle({ icon: Icon, title, aside }: { icon: React.ComponentType<{ className?: string }>; title: string; aside?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

function MonthRangeSelect({
  value,
  options,
  onChange,
}: {
  value: RangeMode;
  options: Array<{ value: string; label: string }>;
  onChange: (value: RangeMode) => void;
}) {
  return (
    <select
      className="tl-input h-9 rounded-full border px-3 text-xs font-medium outline-none"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function OverviewCards({ overview }: { overview: AdminMonitoringOverview }) {
  const cards = [
    { label: "总用户", value: formatNumber(overview.system.users), meta: `活跃 ${formatNumber(overview.system.active_users_30d)}`, icon: UserRound },
    { label: "API 请求", value: formatNumber(overview.usage.request_count), meta: `失败 ${formatNumber(overview.usage.failed_requests)}`, icon: Activity },
    { label: "Token", value: formatNumber(overview.usage.total_tokens), meta: `输入 ${formatNumber(overview.usage.prompt_tokens)}`, icon: Database },
    { label: "总消费", value: formatCnyFromMicroCents(overview.usage.cost_micro_cents), meta: `平均模型调用延迟 ${formatNumber(overview.usage.avg_latency_ms)}ms`, icon: WalletCards },
    { label: "笔记本", value: formatNumber(overview.system.notebooks), meta: `节点 ${formatNumber(overview.system.nodes)}`, icon: NotebookTabs },
    { label: "消息", value: formatNumber(overview.system.messages), meta: `长任务 ${formatNumber(overview.system.long_tasks)}`, icon: MessageSquareText },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div key={card.label} className="tl-panel rounded-2xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
            <card.icon className="h-4 w-4 text-primary" />
          </div>
          <p className="text-2xl font-semibold tracking-normal">{card.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{card.meta}</p>
        </div>
      ))}
    </div>
  );
}

function UsageBars({ series, rangeMode }: { series: AdminMonitoringSeriesPoint[]; rangeMode: RangeMode }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const byDate = new Map(series.map((item) => [item.date, item]));
  const points = monthDateKeys(rangeMode).map((date) => byDate.get(date) ?? ({ date, total_tokens: 0, models: {} } as AdminMonitoringSeriesPoint));
  const hasUsage = series.some((item) => item.total_tokens > 0);
  const maxTokens = Math.max(1, ...points.map((item) => item.total_tokens));
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  if (!hasUsage) return <EmptyState text="No model calls in this range" />;
  return (
    <div className="min-h-72">
      <div className="relative overflow-x-clip">
        <div className="flex h-56 items-end gap-2 border-b border-border/70 pb-2" onMouseLeave={() => setHoverIndex(null)}>
          {points.map((item, index) => {
            const flash = sumSeriesMetric(item, [DEEPSEEK_FLASH_MODEL], "total_tokens");
            const pro = sumSeriesMetric(item, [DEEPSEEK_PRO_MODEL], "total_tokens");
            const qwen = sumSeriesMetric(item, QWEN_MODEL_IDS, "total_tokens");
            const other = sumOtherSeriesMetric(item, "total_tokens");
            return (
              <div key={item.date} className="relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHoverIndex(index)}>
                {hoverIndex === index && <div className="absolute inset-y-0 left-1/2 z-10 border-l border-dashed border-muted-foreground" />}
                <div className="flex h-48 w-full max-w-10 flex-col justify-end overflow-hidden rounded-t-md">
                  {item.total_tokens > 0 && (
                    <>
                      <div className="bg-amber-400" style={{ height: `${(other / maxTokens) * 100}%` }} />
                      <div className="bg-rose-500" style={{ height: `${(qwen / maxTokens) * 100}%` }} />
                      <div className="bg-sky-500" style={{ height: `${(pro / maxTokens) * 100}%` }} />
                      <div className="bg-emerald-500" style={{ height: `${(flash / maxTokens) * 100}%` }} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{points[0]?.date.slice(5)}</span>
          <span>{points[points.length - 1]?.date.slice(5)}</span>
        </div>
        {hoverPoint && (
          <div className={cn("pointer-events-none absolute top-0 z-50 min-w-80 -translate-y-[calc(100%+0.75rem)] rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white shadow-2xl", tooltipPlacement(hoverIndex, points.length))}>
            <div className="mb-2 flex justify-between gap-5 font-semibold">
              <span>{hoverPoint.date}</span>
              <span>{formatNumber(hoverPoint.total_tokens)} tokens</span>
            </div>
            <TooltipRow color="bg-emerald-500" label={FLASH_DISPLAY_NAME} value={`${formatNumber(sumSeriesMetric(hoverPoint, [DEEPSEEK_FLASH_MODEL], "total_tokens"))} tokens`} />
            <TooltipRow color="bg-sky-500" label={PRO_DISPLAY_NAME} value={`${formatNumber(sumSeriesMetric(hoverPoint, [DEEPSEEK_PRO_MODEL], "total_tokens"))} tokens`} />
            <TooltipRow color="bg-rose-500" label={QWEN_DISPLAY_NAME} value={`${formatNumber(sumSeriesMetric(hoverPoint, QWEN_MODEL_IDS, "total_tokens"))} tokens`} />
            <TooltipRow color="bg-amber-400" label={ELSE_DISPLAY_NAME} value={`${formatNumber(sumOtherSeriesMetric(hoverPoint, "total_tokens"))} tokens`} />
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend color="bg-emerald-500" label={FLASH_DISPLAY_NAME} />
        <Legend color="bg-sky-500" label={PRO_DISPLAY_NAME} />
        <Legend color="bg-rose-500" label={QWEN_DISPLAY_NAME} />
        <Legend color="bg-amber-400" label={ELSE_DISPLAY_NAME} />
      </div>
    </div>
  );
}

function ModelUsage({ models }: { models: AdminMonitoringModel[] }) {
  const [showMore, setShowMore] = useState(false);
  const buckets = monitoringModelBuckets(models);
  const totalTokens = Math.max(1, buckets.reduce((sum, model) => sum + model.total_tokens, 0));
  const visibleBuckets = showMore ? buckets : buckets.slice(0, 2);
  const hiddenCount = Math.max(0, buckets.length - visibleBuckets.length);
  return (
    <div className="space-y-4">
      {visibleBuckets.map((model) => (
        <div key={model.model_name} className="rounded-xl border border-border/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-semibold">{model.model_name}</p>
              <p className="mt-1 text-xs text-muted-foreground">API 请求 {formatNumber(model.request_count)}</p>
            </div>
            <span className="text-sm font-semibold">{formatNumber(model.total_tokens)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className={modelAccent(model.model_name)} style={{ width: `${model.total_tokens > 0 ? Math.max(2, (model.total_tokens / totalTokens) * 100) : 0}%`, height: "100%" }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <span>输入 {formatNumber(model.prompt_tokens)}</span>
            <span>输出 {formatNumber(model.completion_tokens)}</span>
            <span>消费 {formatCnyFromMicroCents(model.cost_micro_cents)}</span>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="tl-hover flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-border/70 text-xs font-medium text-muted-foreground"
        onClick={() => setShowMore((value) => !value)}
      >
        <span>{showMore ? "收起" : `更多${hiddenCount ? ` ${hiddenCount}` : ""}`}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} />
      </button>
    </div>
  );
}

function ModelDeepSeekPanel({
  displayName,
  modelNames,
  model,
  series,
  rangeMode,
  showCacheBreakdown = true,
}: {
  displayName: string;
  modelNames: string[];
  model?: AdminMonitoringModel;
  series: AdminMonitoringSeriesPoint[];
  rangeMode: RangeMode;
  showCacheBreakdown?: boolean;
}) {
  const byDate = new Map(series.map((item) => [item.date, item]));
  const points = monthDateKeys(rangeMode).map((date) => {
    const item = byDate.get(date);
    return {
      date,
      requestCount: item ? sumSeriesMetric(item, modelNames, "request_count") : 0,
      totalTokens: item ? sumSeriesMetric(item, modelNames, "total_tokens") : 0,
      promptTokens: item ? sumSeriesMetric(item, modelNames, "prompt_tokens") : 0,
      cacheHitTokens: item ? sumSeriesMetric(item, modelNames, "cache_hit_tokens") : 0,
      cacheMissTokens: item ? sumSeriesMetric(item, modelNames, "cache_miss_tokens") || sumSeriesMetric(item, modelNames, "prompt_tokens") : 0,
      completionTokens: item ? sumSeriesMetric(item, modelNames, "completion_tokens") : 0,
    };
  });
  const maxRequest = Math.max(1, ...points.map((item) => item.requestCount));
  const maxTokens = Math.max(1, ...points.map((item) => item.totalTokens));
  return (
    <div>
      <SectionTitle icon={Gauge} title={displayName} />
      <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
        <MiniStat icon={Activity} label="API 请求次数" value={formatNumber(model?.request_count)} />
        <MiniStat icon={Database} label="Tokens" value={formatNumber(model?.total_tokens)} />
        <MiniStat icon={WalletCards} label="消费" value={formatCnyFromMicroCents(model?.cost_micro_cents)} />
        <MiniStat icon={Clock} label="模型调用延迟" value={`${formatNumber(model?.avg_latency_ms)}ms`} />
      </div>
      <div className="grid gap-6">
        <MiniLineChart title="API 请求次数" total={formatNumber(model?.request_count)} points={points.map((item) => ({ date: item.date, value: item.requestCount }))} max={maxRequest} valueLabel="请求次数" />
        <TokenStackChart points={points} max={maxTokens} showCacheBreakdown={showCacheBreakdown} />
      </div>
    </div>
  );
}

function ModelElsePanel({
  model,
  series,
  rangeMode,
}: {
  model?: AdminMonitoringModel;
  series: AdminMonitoringSeriesPoint[];
  rangeMode: RangeMode;
}) {
  const byDate = new Map(series.map((item) => [item.date, item]));
  const points = monthDateKeys(rangeMode).map((date) => {
    const item = byDate.get(date);
    return {
      date,
      requestCount: item ? sumOtherSeriesMetric(item, "request_count") : 0,
      totalTokens: item ? sumOtherSeriesMetric(item, "total_tokens") : 0,
      promptTokens: item ? sumOtherSeriesMetric(item, "prompt_tokens") : 0,
      cacheHitTokens: 0,
      cacheMissTokens: item ? sumOtherSeriesMetric(item, "prompt_tokens") : 0,
      completionTokens: item ? sumOtherSeriesMetric(item, "completion_tokens") : 0,
    };
  });
  const maxRequest = Math.max(1, ...points.map((item) => item.requestCount));
  const maxTokens = Math.max(1, ...points.map((item) => item.totalTokens));
  return (
    <div>
      <SectionTitle icon={Gauge} title={ELSE_DISPLAY_NAME} />
      <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
        <MiniStat icon={Activity} label="API 璇锋眰娆℃暟" value={formatNumber(model?.request_count)} />
        <MiniStat icon={Database} label="Tokens" value={formatNumber(model?.total_tokens)} />
        <MiniStat icon={WalletCards} label="娑堣垂" value={formatCnyFromMicroCents(model?.cost_micro_cents)} />
        <MiniStat icon={Clock} label="妯″瀷璋冪敤寤惰繜" value={`${formatNumber(model?.avg_latency_ms)}ms`} />
      </div>
      <div className="grid gap-6">
        <MiniLineChart title="API 璇锋眰娆℃暟" total={formatNumber(model?.request_count)} points={points.map((item) => ({ date: item.date, value: item.requestCount }))} max={maxRequest} valueLabel="璇锋眰娆℃暟" />
        <TokenStackChart points={points} max={maxTokens} showCacheBreakdown={false} />
      </div>
    </div>
  );
}

function CostBars({ series, rangeMode }: { series: AdminMonitoringSeriesPoint[]; rangeMode: RangeMode }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const byDate = new Map(series.map((item) => [item.date, item]));
  const points = monthDateKeys(rangeMode).map((date) => byDate.get(date) ?? ({ date, cost_micro_cents: 0, models: {} } as AdminMonitoringSeriesPoint));
  const hasCost = series.some((item) => item.cost_micro_cents > 0);
  const maxCost = Math.max(1, ...points.map((item) => item.cost_micro_cents));
  const totalCost = series.reduce((sum, item) => sum + item.cost_micro_cents, 0);
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  if (!hasCost) return <EmptyState text="No cost records in this range" />;
  return (
    <div className="min-h-72">
      <div className="mb-5 flex items-center gap-3 text-sm">
        <span className="font-semibold">Cost amount</span>
        <span className="text-muted-foreground">{formatCnyFromMicroCents(totalCost)}</span>
      </div>
      <div className="relative overflow-x-clip">
        <div className="flex h-52 items-end gap-2 border-b border-border/70 pb-2" onMouseLeave={() => setHoverIndex(null)}>
          {points.map((item, index) => {
            const flashCost = sumSeriesMetric(item, [DEEPSEEK_FLASH_MODEL], "cost_micro_cents");
            const proCost = sumSeriesMetric(item, [DEEPSEEK_PRO_MODEL], "cost_micro_cents");
            const qwenCost = sumSeriesMetric(item, QWEN_MODEL_IDS, "cost_micro_cents");
            const otherCost = sumOtherSeriesMetric(item, "cost_micro_cents");
            return (
              <div key={item.date} className="relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHoverIndex(index)}>
                {hoverIndex === index && <div className="absolute inset-y-0 left-1/2 z-10 border-l border-dashed border-neutral-700" />}
                <div className="flex h-44 w-full max-w-9 flex-col justify-end overflow-hidden rounded-t-md">
                  {item.cost_micro_cents > 0 && (
                    <>
                      <div className="bg-yellow-300" style={{ height: `${(otherCost / maxCost) * 100}%` }} />
                      <div className="bg-rose-500" style={{ height: `${(qwenCost / maxCost) * 100}%` }} />
                      <div className="bg-yellow-500" style={{ height: `${(flashCost / maxCost) * 100}%` }} />
                      <div className="bg-orange-500" style={{ height: `${(proCost / maxCost) * 100}%` }} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{points[0]?.date.slice(5)}</span>
          <span>{points[points.length - 1]?.date.slice(5)}</span>
        </div>
        {hoverPoint && (
          <div className={cn("pointer-events-none absolute top-0 z-50 min-w-80 -translate-y-[calc(100%+0.75rem)] rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white shadow-2xl", tooltipPlacement(hoverIndex, points.length))}>
            <div className="mb-2 flex justify-between gap-5 font-semibold">
              <span>{hoverPoint.date}</span>
              <span>{formatCnyFromMicroCents(hoverPoint.cost_micro_cents)}</span>
            </div>
            <TooltipRow color="bg-yellow-500" label={FLASH_DISPLAY_NAME} value={formatCnyFromMicroCents(sumSeriesMetric(hoverPoint, [DEEPSEEK_FLASH_MODEL], "cost_micro_cents"))} />
            <TooltipRow color="bg-orange-500" label={PRO_DISPLAY_NAME} value={formatCnyFromMicroCents(sumSeriesMetric(hoverPoint, [DEEPSEEK_PRO_MODEL], "cost_micro_cents"))} />
            <TooltipRow color="bg-rose-500" label={QWEN_DISPLAY_NAME} value={formatCnyFromMicroCents(sumSeriesMetric(hoverPoint, QWEN_MODEL_IDS, "cost_micro_cents"))} />
            <TooltipRow color="bg-yellow-300" label={ELSE_DISPLAY_NAME} value={formatCnyFromMicroCents(sumOtherSeriesMetric(hoverPoint, "cost_micro_cents"))} />
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend color="bg-yellow-500" label={FLASH_DISPLAY_NAME} />
        <Legend color="bg-orange-500" label={PRO_DISPLAY_NAME} />
        <Legend color="bg-rose-500" label={QWEN_DISPLAY_NAME} />
        <Legend color="bg-yellow-300" label={ELSE_DISPLAY_NAME} />
      </div>
    </div>
  );
}

function MiniLineChart({
  title,
  total,
  points,
  max,
  valueLabel,
}: {
  title: string;
  total: string;
  points: Array<{ date: string; value: number }>;
  max: number;
  valueLabel: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{total}</span>
      </div>
      <div className="relative overflow-x-clip">
        <div className="flex h-28 items-end gap-1 border-b border-border/70 pb-1" onMouseLeave={() => setHoverIndex(null)}>
          {points.map((point, index) => (
            <div
              key={point.date}
              className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              onMouseEnter={() => setHoverIndex(index)}
            >
              {hoverIndex === index && <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-muted-foreground" />}
              {point.value > 0 && (
                <div
                  className="w-full max-w-4 rounded-t bg-primary"
                  style={{ height: `${Math.max(3, (point.value / max) * 100)}%` }}
                  aria-label={`${point.date} ${valueLabel} ${point.value}`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{points[0]?.date.slice(5)}</span>
          <span>{points[points.length - 1]?.date.slice(5)}</span>
        </div>
        {hoverPoint && (
          <div className={cn("pointer-events-none absolute top-0 z-50 min-w-36 -translate-y-[calc(100%+0.75rem)] rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white shadow-2xl", tooltipPlacement(hoverIndex, points.length))}>
            <p className="font-semibold">{hoverPoint.date}</p>
            <p className="mt-2 text-neutral-300">{valueLabel} <span className="font-semibold text-white">{formatNumber(hoverPoint.value)}</span></p>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenStackChart({
  points,
  max,
  showCacheBreakdown = true,
}: {
  points: Array<{
    date: string;
    promptTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  max: number;
  showCacheBreakdown?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="text-sm font-semibold">Tokens</span>
        <span className="text-sm text-muted-foreground">{formatNumber(points.reduce((sum, item) => sum + item.totalTokens, 0))}</span>
      </div>
      <div className="relative overflow-x-clip">
      <div className="flex h-28 items-end gap-2 border-b border-border/70 pb-1" onMouseLeave={() => setHoverIndex(null)}>
        {points.length === 0 ? (
          <div className="h-full flex-1" />
        ) : (
          points.map((item, index) => (
            <div
              key={item.date}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHoverIndex(index)}
            >
              {hoverIndex === index && <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-muted-foreground" />}
              <div className="flex h-24 w-full max-w-5 flex-col justify-end overflow-hidden rounded-t">
                {item.totalTokens > 0 && (
                  <>
                    {showCacheBreakdown ? (
                      <>
                        <div className="bg-sky-300" style={{ height: `${(item.cacheHitTokens / max) * 100}%` }} />
                        <div className="bg-sky-500" style={{ height: `${(item.cacheMissTokens / max) * 100}%` }} />
                      </>
                    ) : (
                      <div className="bg-rose-500" style={{ height: `${(item.promptTokens / max) * 100}%` }} />
                    )}
                    <div className="bg-blue-600" style={{ height: `${(item.completionTokens / max) * 100}%` }} />
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{points[0]?.date.slice(5)}</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
      {hoverPoint && (
        <div className={cn("pointer-events-none absolute top-0 z-50 min-w-72 -translate-y-[calc(100%+0.75rem)] rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white shadow-2xl", tooltipPlacement(hoverIndex, points.length))}>
          <div className="mb-2 flex justify-between gap-5 font-semibold">
            <span>{hoverPoint.date}</span>
            <span>{formatNumber(hoverPoint.totalTokens)} tokens</span>
          </div>
          {showCacheBreakdown ? (
            <>
              <TooltipRow color="bg-sky-300" label="Input cache hit" value={`${formatNumber(hoverPoint.cacheHitTokens)} tokens`} />
              <TooltipRow color="bg-sky-500" label="Input cache miss" value={`${formatNumber(hoverPoint.cacheMissTokens)} tokens`} />
            </>
          ) : (
            <TooltipRow color="bg-rose-500" label="Input" value={`${formatNumber(hoverPoint.promptTokens)} tokens`} />
          )}
          <TooltipRow color="bg-blue-600" label="Output" value={`${formatNumber(hoverPoint.completionTokens)} tokens`} />
        </div>
      )}
      </div>
    </div>
  );
}

function UserTable({ users, onOpenUser }: { users: AdminMonitoringUser[]; onOpenUser?: (id: string) => void }) {
  if (users.length === 0) return <EmptyState text="暂无匹配用户" />;
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border/70 text-xs text-muted-foreground">
          <tr>
            <th className="py-3 font-medium">用户</th>
            <th className="py-3 font-medium">Token</th>
            <th className="py-3 font-medium">请求</th>
            <th className="py-3 font-medium">消费</th>
            <th className="py-3 font-medium">学习资产</th>
            <th className="py-3 font-medium">最近调用</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {users.map((item) => (
            <tr key={item.id} className="cursor-pointer transition hover:bg-foreground/5" onClick={() => onOpenUser?.(item.id)}>
              <td className="py-3 pr-3">
                <p className="font-medium">{item.display_name || item.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.email}</p>
              </td>
              <td className="py-3 pr-3 font-medium">{formatNumber(item.total_tokens)}</td>
              <td className="py-3 pr-3">{formatNumber(item.request_count)}</td>
              <td className="py-3 pr-3">{formatCnyFromMicroCents(item.cost_micro_cents)}</td>
              <td className="py-3 pr-3 text-xs text-muted-foreground">
                {formatNumber(item.notebook_count)} 笔记本 / {formatNumber(item.node_count)} 节点
              </td>
              <td className="py-3 text-xs text-muted-foreground">{formatDate(item.last_model_call_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotebookAssets({ notebooks }: { notebooks: AdminMonitoringUserDetail["notebooks"] }) {
  if (notebooks.length === 0) return <EmptyState text="该用户暂无笔记本" />;
  return (
    <div className="grid gap-2">
      {notebooks.map((notebook) => (
        <div key={notebook.id} className="rounded-xl border border-border/70 p-3">
          <p className="truncate text-sm font-medium">{notebook.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatNumber(notebook.node_count)} 节点 / {formatNumber(notebook.message_count)} 消息
          </p>
        </div>
      ))}
    </div>
  );
}

function RecentEvents({ events }: { events: AdminMonitoringEvent[] }) {
  if (events.length === 0) return <EmptyState text="当前范围内暂无调用日志" />;
  return (
    <div className="grid gap-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-xl border border-border/70 p-3 text-sm">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{event.user_display_name || event.user_email}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{event.node_title || event.notebook_title || event.call_type}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(event.created_at)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{event.model_name || "unknown"}</span>
            <span>{formatNumber(event.total_tokens)} tokens</span>
            <span>{formatCnyFromMicroCents(event.cost_micro_cents)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
      {label}
    </span>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-6 text-neutral-300">
      <span className="inline-flex items-center gap-2">
        <span className={cn("h-3 w-3 rounded-sm", color)} />
        {label}
      </span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function LoadingPanel({ text }: { text: string }) {
  return (
    <div className="tl-panel flex min-h-40 items-center justify-center gap-2 rounded-2xl border text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

function ErrorPanel({ text }: { text: string }) {
  return <div className="tl-panel rounded-2xl border border-destructive/30 p-5 text-sm text-destructive">{text}</div>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
      <FileText className="mb-2 h-5 w-5" />
      {text}
    </div>
  );
}
