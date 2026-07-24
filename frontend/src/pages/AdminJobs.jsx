import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Target,
} from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmt = (value) => Number(value || 0).toLocaleString();

const STATUS_STYLES = {
  ok: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    bar: "bg-emerald-500",
    label: "On track",
    Icon: CheckCircle2,
  },
  warn: {
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    bar: "bg-amber-500",
    label: "Watch",
    Icon: AlertTriangle,
  },
  bad: {
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    bar: "bg-rose-500",
    label: "Needs attention",
    Icon: XCircle,
  },
};

function statusMeta(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.warn;
}

function formatGoalValue(goal) {
  const value = goal?.current;
  if (goal?.unit === "%") return `${Number(value || 0).toFixed(1)}%`;
  return fmt(value);
}

function formatGoalTarget(goal) {
  if (goal?.unit === "%") {
    const op = goal.direction === "lte" ? "≤" : "≥";
    return `${op} ${Number(goal.target || 0)}%`;
  }
  const op = goal.direction === "lte" ? "≤" : "≥";
  return `${op} ${fmt(goal.target)} ${goal.unit || ""}`.trim();
}

function FunnelGoalsPanel({ funnelGoals }) {
  if (!funnelGoals?.goals?.length) return null;
  const overall = statusMeta(funnelGoals.overall_status);
  const OverallIcon = overall.Icon;
  const funnel = funnelGoals.funnel || [];
  const signals = funnelGoals.signals || {};

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-zinc-900 p-2 text-white">
            <Target className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-zinc-900">Crawl funnel goals</h2>
            <p className="text-sm text-zinc-500">
              Primary target: 500k jobs touched / week via France Travail blitz + ATS boards.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${overall.badge}`}
        >
          <OverallIcon className="h-3.5 w-3.5" />
          {overall.label}
        </span>
      </div>

      {funnel.length ? (
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {funnel.map((step, index) => (
              <div key={step.id} className="flex flex-1 items-stretch gap-3">
                <div className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    {step.label}
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold text-zinc-900">
                    {fmt(step.value)}
                  </p>
                </div>
                {index < funnel.length - 1 ? (
                  <div className="hidden items-center text-zinc-300 lg:flex" aria-hidden>
                    →
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {funnelGoals.goals.map((goal) => {
          const meta = statusMeta(goal.status);
          const StatusIcon = meta.Icon;
          return (
            <div
              key={goal.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{goal.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{goal.description}</p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta.badge}`}
                >
                  <StatusIcon className="h-3 w-3" />
                  {meta.label}
                </span>
              </div>
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="font-display text-3xl font-bold text-zinc-950">
                  {formatGoalValue(goal)}
                </p>
                <p className="pb-1 text-xs font-medium text-zinc-500">
                  Goal {formatGoalTarget(goal)}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${meta.bar}`}
                  style={{
                    width: `${Math.max(4, Math.min(100, Number(goal.progress_pct || 0)))}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {signals.ft_last_run_fetched != null || signals.ats_last_run_refreshed != null ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
          {signals.ft_last_run_fetched != null ? (
            <span>
              Last FT run: {fmt(signals.ft_last_run_fetched)} fetched
              {signals.ft_last_run_errors ? ` · ${signals.ft_last_run_errors} errors` : " · clean"}
              {signals.ft_last_run_elapsed_ms != null
                ? ` · ${fmt(signals.ft_last_run_elapsed_ms)} ms`
                : ""}
            </span>
          ) : null}
          {signals.ats_last_run_refreshed != null ? (
            <span>
              Last ATS maintenance: {fmt(signals.ats_last_run_refreshed)} boards refreshed
              {signals.ats_last_run_errors ? ` · ${signals.ats_last_run_errors} errors` : ""}
            </span>
          ) : (
            <span>
              No in-process harvest summary yet (appears after a background or admin run).
            </span>
          )}
        </div>
      ) : (
        <div className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
          Live harvest signals appear after France Travail / ATS maintenance runs on this server.
        </div>
      )}
    </section>
  );
}

const SOURCE_COLORS = {
  jsearch: "#6366f1",
  france_travail: "#2563eb",
  greenhouse: "#16a34a",
  lever: "#ea580c",
  ashby: "#0891b2",
  smartrecruiters: "#db2777",
  recruitee: "#7c3aed",
  personio: "#0d9488",
  teamtailor: "#ca8a04",
  workday: "#475569",
  flatchr: "#f97316",
  other: "#a1a1aa",
  unknown: "#71717a",
};

function sourceColor(source) {
  return SOURCE_COLORS[source] || "#64748b";
}

function sourceLabel(source, fallbackLabel) {
  if (fallbackLabel) return fallbackLabel;
  return String(source || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateShort(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MetricCard({ title, value, sub }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      <p className="mt-2 font-display text-3xl font-bold text-zinc-950">{fmt(value)}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function InventoryTooltip({ active, payload, label, sourceLabels }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-zinc-800">{fmtDateShort(label)}</p>
      <p className="mt-1 text-zinc-500">{fmt(total)} imports</p>
      <div className="mt-2 space-y-1">
        {payload
          .filter((entry) => Number(entry.value || 0) > 0)
          .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
          .map((entry) => (
            <div key={entry.dataKey} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-zinc-600">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                {sourceLabels[entry.dataKey] || sourceLabel(entry.dataKey)}
              </span>
              <span className="font-semibold text-zinc-800">{fmt(entry.value)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function AdminJobs() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const response = await api.get("/admin/jobs/inventory", { params: { days: Number(days) } });
      setData(response.data);
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load job inventory"));
      }
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const sourceLabels = useMemo(() => {
    const map = {};
    (data?.by_source || []).forEach((row) => {
      map[row.source] = row.label;
    });
    return map;
  }, [data?.by_source]);

  const chartData = useMemo(() => {
    return (data?.daily || []).map((row) => ({
      ...row,
      label: fmtDateShort(row.date),
    }));
  }, [data?.daily]);

  const chartSources = data?.chart_sources || [];

  return (
    <AdminShell
      title="Job inventory"
      subtitle="Fill target: 500k touches / week. Daily activity by source + funnel goals below."
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      }
    >
      {loading && !data ? (
        <div className="grid min-h-64 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : accessDenied ? (
        <AdminAccessDenied />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {data?.warnings?.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Some inventory metrics are temporarily unavailable: {data.warnings.join("; ")}.
            </div>
          ) : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Briefcase className="h-4 w-4" />
              <span>
                Activity based on `imported_at` (re-imports count as new touches).
                {data?.activity_capped ? " Chart may be capped at 15,000 recent rows." : null}
              </span>
            </div>
            <Tabs value={days} onValueChange={setDays}>
              <TabsList>
                <TabsTrigger value="7">7 days</TabsTrigger>
                <TabsTrigger value="14">14 days</TabsTrigger>
                <TabsTrigger value="30">30 days</TabsTrigger>
                <TabsTrigger value="90">90 days</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Total jobs"
              value={data?.total_jobs}
              sub="All cached offers in Supabase"
            />
            <MetricCard
              title="Auto-apply ready (A/B)"
              value={data?.valid_ab_jobs}
              sub="Validated tiers A and B"
            />
            <MetricCard
              title="Imports last 24h"
              value={data?.imports_last_24h}
              sub="Touched in the last day"
            />
            <MetricCard
              title="Imports last 7d"
              value={data?.imports_last_7d}
              sub="Touched in the last 7 days"
            />
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-zinc-900">
                  Daily imports by source
                </h2>
                <p className="text-sm text-zinc-500">Stacked activity for the selected period.</p>
              </div>
            </div>
            <div className="mt-6 h-80 w-full">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                      tick={{ fill: "#71717a", fontSize: 12 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tick={{ fill: "#71717a", fontSize: 12 }}
                      allowDecimals={false}
                    />
                    <Tooltip content={<InventoryTooltip sourceLabels={sourceLabels} />} />
                    <Legend />
                    {chartSources.map((source) => (
                      <Area
                        key={source}
                        type="monotone"
                        dataKey={source}
                        name={sourceLabels[source] || sourceLabel(source)}
                        stackId="imports"
                        stroke={sourceColor(source)}
                        fill={sourceColor(source)}
                        fillOpacity={0.55}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center text-sm text-zinc-500">
                  No import activity in this period.
                </div>
              )}
            </div>
          </section>

          <FunnelGoalsPanel funnelGoals={data?.funnel_goals} />

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-bold text-zinc-900">Sources breakdown</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Share of the full inventory by ingestion provider.
            </p>
            <div className="mt-4 space-y-3">
              {(data?.by_source || []).map((row) => {
                const pct = Math.max(0, Math.min(100, Number(row.share_pct || 0)));
                return (
                  <div key={row.source}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 font-medium text-zinc-800">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: sourceColor(row.source) }}
                        />
                        {row.label}
                      </span>
                      <span className="text-zinc-500">
                        {fmt(row.count)}
                        {" · "}
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${pct}%`, backgroundColor: sourceColor(row.source) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}
