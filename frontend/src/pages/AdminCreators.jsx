import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BarChart3,
  Calendar,
  ChevronDown,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const ORANGE = "#f97316";
const BLUE = "#3b82f6";
const GREEN = "#22c55e";
const RED = "#ef4444";

const RANGE_OPTIONS = [
  { id: 7, label: "7 days" },
  { id: 14, label: "14 days UTC" },
  { id: 30, label: "30 days" },
];

function TikTokIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
    </svg>
  );
}

const fmtCompact = (value) => {
  if (typeof value === "string") return value;
  const num = Number(value || 0);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return num.toLocaleString();
};

const fmtSigned = (value) => {
  const num = Number(value || 0);
  if (num === 0) return "0";
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${fmtCompact(num)}`;
};

const fmtDateShort = (iso) => {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const fmtDateLong = (iso) => {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

const fmtDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function DeltaBadge({ value, suffix = "" }) {
  const num = Number(value || 0);
  if (num === 0) {
    return <span className="text-xs font-medium text-zinc-500">0{suffix}</span>;
  }
  const positive = num > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
      <Icon className="h-3.5 w-3.5" />
      {fmtSigned(num)}{suffix}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, delta, deltaSuffix, accent = "text-zinc-300", href }) {
  const content = (
    <div className="group relative overflow-hidden rounded-2xl border border-white/8 bg-[#121214] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/12 hover:bg-[#151518]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-xs font-medium text-zinc-500 transition hover:text-zinc-300">
            Open
          </a>
        ) : null}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tracking-tight text-white">{fmtCompact(value)}</p>
      <div className="mt-2">
        <DeltaBadge value={delta} suffix={deltaSuffix} />
      </div>
    </div>
  );
  return content;
}

function ChartTooltip({ active, payload, usesLikesProxy }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-white/10 bg-[#1a1a1d] px-4 py-3 text-xs shadow-2xl">
      <p className="mb-2 font-semibold text-white">{fmtDateLong(row?.date)}</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-zinc-300">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ORANGE }} />
          Posted videos
          <span className="ml-auto font-semibold text-white tabular-nums">{row?.posted_videos ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-300">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BLUE }} />
          {usesLikesProxy ? "Likes" : "Views"}
          <span className="ml-auto font-semibold text-white tabular-nums">{fmtCompact(usesLikesProxy ? row?.likes : row?.views)}</span>
        </div>
      </div>
    </div>
  );
}

function CreatorChip({ creator, selected, onToggle }) {
  const active = selected;
  return (
    <button
      type="button"
      onClick={() => onToggle(creator.creator_id)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-white/20 bg-white/10 text-white"
          : "border-white/8 bg-transparent text-zinc-400 hover:border-white/12 hover:text-zinc-200"
      }`}
    >
      {creator.avatar_url ? (
        <img src={creator.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold uppercase">
          {(creator.name || "?").slice(0, 1)}
        </span>
      )}
      {creator.name}
      <span className="text-zinc-500">@{creator.handle}</span>
    </button>
  );
}

export default function AdminCreators() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [days, setDays] = useState(14);
  const [selectedIds, setSelectedIds] = useState([]);
  const autoRefreshedRef = useRef(false);

  const load = useCallback(async (rangeDays = days) => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const params = { days: rangeDays };
      if (selectedIds.length === 1) params.creator_id = selectedIds[0];
      const { data: payload } = await api.get("/admin/creator-social", { params });
      setData(payload);
      if (!selectedIds.length && payload?.creators?.length) {
        setSelectedIds(payload.creators.map((item) => item.creator_id));
      }
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load creator analytics"));
      }
    } finally {
      setLoading(false);
    }
  }, [days, selectedIds]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = {};
      if (selectedIds.length === 1) params.creator_id = selectedIds[0];
      const { data: payload } = await api.post("/admin/creator-social/refresh", null, { params });
      setData(payload.dashboard || payload);
      const errors = payload.errors || [];
      if (errors.length) {
        toast.error(`Some accounts could not be refreshed (${errors.length})`);
      } else {
        toast.success("Creator stats refreshed");
      }
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not refresh TikTok stats"));
    } finally {
      setRefreshing(false);
    }
  }, [selectedIds]);

  useEffect(() => {
    load(days);
  }, [days, selectedIds, load]);

  useEffect(() => {
    if (loading || accessDenied || data?.last_refreshed_at || autoRefreshedRef.current) return;
    autoRefreshedRef.current = true;
    refresh();
  }, [loading, accessDenied, data?.last_refreshed_at, refresh]);

  const creators = data?.creators || [];
  const summary = data?.summary || {};
  const usesLikesProxy = Boolean(data?.uses_likes_as_views_proxy);
  const viewsLabel = usesLikesProxy ? "Likes" : "Views";

  const chartData = useMemo(() => {
    return (data?.daily || []).map((row) => ({
      ...row,
      label: fmtDateShort(row.date),
      metric_line: usesLikesProxy ? row.likes : row.views,
    }));
  }, [data?.daily, usesLikesProxy]);

  const maxVideos = useMemo(
    () => Math.max(5, ...chartData.map((row) => row.posted_videos || 0)),
    [chartData],
  );
  const maxMetric = useMemo(
    () => Math.max(5, ...chartData.map((row) => row.metric_line || 0)),
    [chartData],
  );

  const toggleCreator = (creatorId) => {
    setSelectedIds((prev) => {
      if (prev.includes(creatorId)) {
        const next = prev.filter((id) => id !== creatorId);
        return next.length ? next : prev;
      }
      return [...prev, creatorId];
    });
  };

  const filteredCreators = creators.filter((creator) => selectedIds.includes(creator.creator_id));

  return (
    <AdminShell
      title="Creators"
      subtitle="TikTok performance tracking for Hirly content creators — daily posts, reach, and engagement."
      actions={(
        <Button variant="outline" onClick={refresh} disabled={loading || refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh TikTok
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : null}

      {!accessDenied ? (
        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl">
          <div className="border-b border-white/8 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300">
                  <Users className="h-4 w-4" />
                  Select accounts
                  <ChevronDown className="h-4 w-4 text-zinc-500" />
                </div>
                {creators.map((creator) => (
                  <CreatorChip
                    key={creator.creator_id}
                    creator={creator}
                    selected={selectedIds.includes(creator.creator_id)}
                    onToggle={toggleCreator}
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300">
                  <TikTokIcon className="h-4 w-4" />
                  TikTok
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDays(option.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        days === option.id ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Last refreshed {fmtDateTime(data?.last_refreshed_at)}
              {usesLikesProxy ? " · Per-video views unavailable from TikTok — showing likes as reach proxy." : ""}
            </p>
          </div>

          {error ? (
            <div className="mx-5 mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 sm:mx-6">
              {error}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="grid min-h-80 place-items-center">
              <Loader2 className="h-7 w-7 animate-spin text-zinc-500" />
            </div>
          ) : (
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard icon={Video} label="Posted videos" value={summary.posted_videos} delta={summary.posted_videos_delta} accent="text-orange-400" />
                <KpiCard icon={AtSign} label="Active accounts" value={summary.active_accounts} delta={0} accent="text-violet-400" />
                <KpiCard icon={Eye} label={viewsLabel} value={summary.views} delta={summary.views_delta} accent="text-sky-400" />
                <KpiCard icon={Heart} label="Likes" value={summary.likes} delta={summary.likes_delta} accent="text-pink-400" />
                <KpiCard icon={MessageCircle} label="Comments" value={summary.comments} delta={summary.comments_period} accent="text-emerald-400" />
                <KpiCard icon={BarChart3} label="Engagement" value={`${summary.engagement_rate ?? 0}%`} delta={0} accent="text-amber-400" />
                <KpiCard icon={Users} label="Followers" value={summary.followers} delta={summary.followers_delta} accent="text-cyan-400" />
                <KpiCard icon={Calendar} label={`Posted (${days}d)`} value={summary.posted_videos_period} delta={0} accent="text-orange-300" />
              </div>

              <section className="rounded-2xl border border-white/8 bg-[#0f0f11] p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Metrics</h2>
                    <p className="text-sm text-zinc-500">Daily posted videos and {viewsLabel.toLowerCase()} over the selected period.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
                      <span className="h-2 w-2 rounded-sm bg-orange-400" />
                      Posted videos
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
                      <span className="h-2 w-2 rounded-full bg-sky-400" />
                      {viewsLabel}
                    </span>
                  </div>
                </div>

                <div className="h-[320px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: "#71717a", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, maxMetric * 1.15]}
                        tickFormatter={fmtCompact}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: "#71717a", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, maxVideos + 1]}
                        allowDecimals={false}
                      />
                      <Tooltip content={<ChartTooltip usesLikesProxy={usesLikesProxy} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar yAxisId="right" dataKey="posted_videos" fill={ORANGE} radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Line yAxisId="left" type="monotone" dataKey="metric_line" stroke={BLUE} strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: BLUE }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="rounded-2xl border border-white/8 bg-[#0f0f11] overflow-hidden">
                <div className="border-b border-white/8 px-5 py-4">
                  <h2 className="font-display text-lg font-bold text-white">Daily breakdown</h2>
                  <p className="text-sm text-zinc-500">One row per day — videos posted and engagement deltas.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Date</th>
                        <th className="px-5 py-3 font-semibold">Videos</th>
                        <th className="px-5 py-3 font-semibold">{viewsLabel}</th>
                        <th className="px-5 py-3 font-semibold">Likes</th>
                        <th className="px-5 py-3 font-semibold">Comments</th>
                        <th className="px-5 py-3 font-semibold">Followers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/6">
                      {(data?.daily || []).slice().reverse().map((row) => (
                        <tr key={row.date} className="transition hover:bg-white/[0.02]">
                          <td className="px-5 py-3 font-medium text-white">{fmtDateLong(row.date)}</td>
                          <td className="px-5 py-3 tabular-nums text-orange-300">{row.posted_videos || 0}</td>
                          <td className="px-5 py-3 tabular-nums text-sky-300">{fmtCompact(usesLikesProxy ? row.likes : row.views)}</td>
                          <td className="px-5 py-3 tabular-nums text-pink-300">{fmtCompact(row.likes)}</td>
                          <td className="px-5 py-3 tabular-nums text-emerald-300">{fmtCompact(row.comments)}</td>
                          <td className="px-5 py-3 tabular-nums text-zinc-300">{fmtCompact(row.followers)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-2xl border border-white/8 bg-[#0f0f11] overflow-hidden">
                <div className="border-b border-white/8 px-5 py-4">
                  <h2 className="font-display text-lg font-bold text-white">Accounts</h2>
                  <p className="text-sm text-zinc-500">Linked TikTok profiles and live totals.</p>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  {filteredCreators.map((creator) => (
                    <div key={creator.creator_id} className="rounded-2xl border border-white/8 bg-[#121214] p-4">
                      <div className="flex items-start gap-4">
                        {creator.avatar_url ? (
                          <img src={creator.avatar_url} alt="" className="h-14 w-14 rounded-2xl object-cover ring-2 ring-white/10" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-lg font-bold">
                            {(creator.name || "?").slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-lg font-bold text-white">{creator.name}</h3>
                            <TikTokIcon className="h-4 w-4 text-zinc-400" />
                          </div>
                          <a
                            href={creator.profile_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300"
                          >
                            @{creator.handle}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                            <div><p className="text-zinc-500">Followers</p><p className="font-semibold text-white">{fmtCompact(creator.current?.followers)}</p></div>
                            <div><p className="text-zinc-500">Videos</p><p className="font-semibold text-white">{creator.current?.videos ?? 0}</p></div>
                            <div><p className="text-zinc-500">Likes</p><p className="font-semibold text-white">{fmtCompact(creator.current?.likes)}</p></div>
                            <div><p className="text-zinc-500">Updated</p><p className="font-semibold text-zinc-300">{fmtDateTime(creator.last_refreshed_at)}</p></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      ) : null}
    </AdminShell>
  );
}
