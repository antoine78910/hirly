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
import { Briefcase, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmt = (value) => Number(value || 0).toLocaleString();

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
  return String(source || "unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
      subtitle="Total cached offers and daily import activity by source."
      actions={(
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
      {loading && !data ? (
        <div className="grid min-h-64 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : accessDenied ? (
        <AdminAccessDenied />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : (
        <div className="space-y-6">
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
            <MetricCard title="Total jobs" value={data?.total_jobs} sub="All cached offers in Supabase" />
            <MetricCard title="Auto-apply ready (A/B)" value={data?.valid_ab_jobs} sub="Validated tiers A and B" />
            <MetricCard title="Imports last 24h" value={data?.imports_last_24h} sub="Touched in the last day" />
            <MetricCard title="Imports last 7d" value={data?.imports_last_7d} sub="Touched in the last 7 days" />
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-zinc-900">Daily imports by source</h2>
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
                <div className="grid h-full place-items-center text-sm text-zinc-500">No import activity in this period.</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-bold text-zinc-900">Sources breakdown</h2>
            <p className="mt-1 text-sm text-zinc-500">Share of the full inventory by ingestion provider.</p>
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
