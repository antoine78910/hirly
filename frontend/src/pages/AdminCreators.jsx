import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  ExternalLink,
  Heart,
  Loader2,
  MessageCircle,
  Play,
  RefreshCw,
  Instagram,
  TrendingDown,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
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
import AddTrackedCreatorForm from "../components/admin/AddTrackedCreatorForm";

const ORANGE = "#f97316";
const BLUE = "#3b82f6";

const RANGE_OPTIONS = [
  { id: 7, label: "7 days" },
  { id: 14, label: "14 days" },
  { id: 30, label: "30 days" },
];

function TikTokIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
    </svg>
  );
}

function PlatformIcon({ platform, className = "h-4 w-4" }) {
  if (platform === "instagram") {
    return <Instagram className={className} aria-hidden />;
  }
  return <TikTokIcon className={className} />;
}

function platformLabel(platform) {
  if (platform === "instagram") return "Instagram";
  return "TikTok";
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

const isRefreshStale = (iso, intervalHours = 6) => {
  if (!iso) return true;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts >= intervalHours * 60 * 60 * 1000;
};

function creatorReachViews(creator, usesLikesProxy = false) {
  const views = Number(creator?.current?.views || 0);
  if (views > 0) return views;
  if (usesLikesProxy) return Number(creator?.current?.likes || 0);
  return views;
}

function truncateText(value, max = 72) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function DeltaBadge({ value, suffix = "" }) {
  const num = Number(value || 0);
  if (num === 0) {
    return <span className="text-xs font-medium text-zinc-500">0{suffix}</span>;
  }
  const positive = num > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${positive ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon className="h-3.5 w-3.5" />
      {fmtSigned(num)}{suffix}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, delta, deltaSuffix, accent = "text-zinc-600", href, hint }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-xs font-medium text-linkedin transition hover:text-linkedin-dark">
            Open
          </a>
        ) : null}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{fmtCompact(value)}</p>
      <div className="mt-2">
        <DeltaBadge value={delta} suffix={deltaSuffix} />
      </div>
      {hint ? <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
    </div>
  );
}

function ChartTooltip({ active, payload, usesLikesProxy }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">{fmtDateLong(row?.date)}</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ORANGE }} />
          Posted videos
          <span className="ml-auto font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">{row?.posted_videos ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BLUE }} />
          {usesLikesProxy ? "Likes" : "Views"}
          <span className="ml-auto font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">{fmtCompact(usesLikesProxy ? row?.likes : row?.views)}</span>
        </div>
      </div>
    </div>
  );
}

function CreatorChip({ creator, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(creator.creator_id)}
      aria-pressed={selected}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        selected
          ? "border-linkedin/30 bg-linkedin/10 text-linkedin"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      }`}
    >
      {creator.avatar_url ? (
        <img src={creator.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold uppercase text-zinc-700">
          {(creator.name || "?").slice(0, 1)}
        </span>
      )}
      {creator.name}
      <span className="text-zinc-500">@{creator.handle}</span>
      <PlatformIcon platform={creator.platform} className="h-3.5 w-3.5 text-zinc-400" />
    </button>
  );
}

function videoReachViews(video, usesLikesProxy = false) {
  const views = Number(video?.views || 0);
  if (views > 0) return views;
  if (usesLikesProxy) return Number(video?.likes || 0);
  return views;
}

function TopVideoRow({ video, maxViews, usesLikesProxy, viewsLabel = "Views" }) {
  const views = videoReachViews(video, usesLikesProxy);
  const width = maxViews > 0 ? Math.max(8, (views / maxViews) * 100) : 0;
  const label = truncateText(video.description || "Untitled video");

  return (
    <a
      href={video.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="group relative flex min-h-[72px] items-center gap-3 border-t border-zinc-100 px-4 py-3 transition hover:bg-zinc-50 first:border-t-0 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
    >
      <div className="absolute inset-y-0 left-16 right-0 pointer-events-none">
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-r from-sky-50 via-sky-100/80 to-sky-200/60"
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md bg-zinc-900 text-white">
        {video.cover_url ? (
          <img src={video.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play className="h-4 w-4 fill-current" />
          </div>
        )}
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {video.creator_name || "Creator"}
          {video.posted_at ? ` · ${fmtDateShort(video.posted_at.slice(0, 10))}` : ""}
        </p>
      </div>
      <div className="relative ml-auto shrink-0 pr-1 text-right">
        <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{fmtCompact(views)}</div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{viewsLabel}</div>
      </div>
    </a>
  );
}

function TopAccountRow({ creator, maxViews, usesLikesProxy }) {
  const views = creatorReachViews(creator, usesLikesProxy);
  const width = maxViews > 0 ? Math.max(8, (views / maxViews) * 100) : 0;

  return (
    <a
      href={creator.profile_url || undefined}
      target="_blank"
      rel="noreferrer"
      className="group relative flex min-h-[72px] items-center gap-3 border-t border-zinc-100 px-4 py-3 transition hover:bg-zinc-50 first:border-t-0 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
    >
      <div className="absolute inset-y-0 left-16 right-0 pointer-events-none">
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-r from-violet-50 via-violet-100/80 to-violet-200/60"
          style={{ width: `${width}%` }}
        />
      </div>
      {creator.avatar_url ? (
        <img src={creator.avatar_url} alt="" className="relative h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white" />
      ) : (
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700">
          {(creator.name || "?").slice(0, 1)}
        </div>
      )}
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{creator.name}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">@{creator.handle}</p>
      </div>
      <div className="relative ml-auto shrink-0 pr-1 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {fmtCompact(views)}
      </div>
    </a>
  );
}

function AccountSelector({ creators, selectedIds, onToggle, onSelectAll, onClear }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const selectedCount = selectedIds.length;
  const totalCount = creators.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      >
        <Users className="h-4 w-4 text-zinc-500" />
        Select accounts
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
          {selectedCount}/{totalCount}
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-72 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-2 pb-2 dark:border-zinc-800">
            <button
              type="button"
              onClick={onSelectAll}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-semibold text-linkedin transition hover:bg-linkedin/10"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={selectedCount <= 1}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Clear
            </button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto py-2">
            {creators.map((creator) => {
              const selected = selectedIds.includes(creator.creator_id);
              return (
                <button
                  key={creator.creator_id}
                  type="button"
                  onClick={() => onToggle(creator.creator_id)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition ${
                    selected ? "bg-linkedin/10 text-linkedin" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${selected ? "border-linkedin bg-linkedin text-white" : "border-zinc-300 bg-white"}`}>
                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{creator.name}</span>
                  <span className="truncate text-xs text-zinc-500">@{creator.handle}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
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
  const skipNextLoadRef = useRef(false);
  const selectedIdsRef = useRef(selectedIds);

  selectedIdsRef.current = selectedIds;

  const load = useCallback(async (rangeDays = days, creatorFilter = selectedIdsRef.current) => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const params = { days: rangeDays };
      if (creatorFilter.length) params.creator_ids = creatorFilter.join(",");
      const { data: payload } = await api.get("/admin/creator-social", { params });
      setData(payload);
      if (!creatorFilter.length && payload?.creators?.length) {
        skipNextLoadRef.current = true;
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
  }, [days]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = {};
      if (selectedIdsRef.current.length === 1) {
        params.creator_id = selectedIdsRef.current[0];
      }
      const { data: payload } = await api.post("/admin/creator-social/refresh", null, { params });
      setData(payload.dashboard || payload);
      const errors = payload.errors || [];
      if (errors.length) {
        const labels = errors
          .map((item) => {
            const handle = item.handle ? `@${item.handle}` : "";
            const name = item.name || item.creator_id || "Account";
            return handle ? `${name} (${handle})` : name;
          })
          .join(", ");
        toast.error(`Could not refresh: ${labels}`);
      } else {
        toast.success("Creator stats refreshed");
      }
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not refresh social stats"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    load(days, selectedIds);
  }, [days, selectedIds, load]);

  useEffect(() => {
    if (loading || accessDenied || autoRefreshedRef.current) return;
    const maintenance = data?.maintenance;
    const intervalHours = maintenance?.interval_hours || 6;
    const stale = maintenance?.stale ?? isRefreshStale(data?.last_refreshed_at, intervalHours);
    if (!stale) return;
    autoRefreshedRef.current = true;
    refresh();
  }, [loading, accessDenied, data?.last_refreshed_at, data?.maintenance, refresh]);

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

  const selectAllCreators = () => {
    setSelectedIds(creators.map((creator) => creator.creator_id));
  };

  const clearCreatorSelection = () => {
    if (creators.length <= 1) return;
    setSelectedIds([creators[0].creator_id]);
  };

  const filteredCreators = creators.filter((creator) => selectedIds.includes(creator.creator_id));

  const topVideos = useMemo(() => {
    return [...(data?.videos || [])]
      .map((video) => ({
        ...video,
        reach: videoReachViews(video, usesLikesProxy),
      }))
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 5);
  }, [data?.videos, usesLikesProxy]);

  const recentVideos = useMemo(() => {
    return [...(data?.videos || [])].sort((a, b) => {
      const aTime = a.posted_at || "";
      const bTime = b.posted_at || "";
      return bTime.localeCompare(aTime);
    });
  }, [data?.videos]);

  const topAccounts = useMemo(() => {
    return [...filteredCreators]
      .map((creator) => ({
        ...creator,
        reach: creatorReachViews(creator, usesLikesProxy),
      }))
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 5);
  }, [filteredCreators, usesLikesProxy]);

  const handleCreatorAdded = useCallback(async (creator) => {
    await load(days, selectedIdsRef.current);
    if (creator?.creator_id) {
      setSelectedIds((prev) => (prev.includes(creator.creator_id) ? prev : [...prev, creator.creator_id]));
    }
  }, [days, load]);

  const maxTopVideoViews = topVideos[0]?.reach || 0;
  const maxTopAccountViews = topAccounts[0]?.reach || 0;

  const maintenance = data?.maintenance;
  const trackingIntervalHours = maintenance?.interval_hours || 6;
  const trackingEnabled = maintenance?.loop_enabled !== false;
  const trackingStale = maintenance?.stale ?? isRefreshStale(data?.last_refreshed_at, trackingIntervalHours);

  return (
    <AdminShell
      enableDarkMode
      title="Creators"
      subtitle="TikTok and Instagram performance tracking for Hirly content creators."
      actions={(
        <Button variant="outline" onClick={refresh} disabled={loading || refreshing} className="cursor-pointer dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh stats
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : null}

      {!accessDenied ? (
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          <div className="border-b border-zinc-200 px-5 py-4 sm:px-6 dark:border-zinc-800">
            <AddTrackedCreatorForm onAdded={handleCreatorAdded} disabled={loading || refreshing} />
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <AccountSelector
                  creators={creators}
                  selectedIds={selectedIds}
                  onToggle={toggleCreator}
                  onSelectAll={selectAllCreators}
                  onClear={clearCreatorSelection}
                />
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
                {["tiktok", "instagram"].map((platform) => (
                  <div
                    key={platform}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                  >
                    <PlatformIcon platform={platform} className="h-4 w-4" />
                    {platformLabel(platform)}
                  </div>
                ))}
                <div className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-950" role="group" aria-label="Date range">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDays(option.id)}
                      aria-pressed={days === option.id}
                      className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        days === option.id
                          ? "bg-linkedin text-white shadow-sm"
                          : "text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Last refreshed {fmtDateTime(data?.last_refreshed_at)}
              {trackingEnabled
                ? ` · Auto-tracking every ${trackingIntervalHours}h`
                : " · Auto-tracking disabled on server"}
              {maintenance?.next_due_at ? ` · Next scheduled refresh ${fmtDateTime(maintenance.next_due_at)}` : ""}
              {trackingStale ? " · Data is stale, refresh recommended." : ""}
              {usesLikesProxy ? " · Per-video views unavailable from TikTok — showing likes as reach proxy." : ""}
            </p>
          </div>

          {error ? (
            <div className="mx-5 mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 sm:mx-6">
              {error}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="grid min-h-80 place-items-center">
              <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard icon={Video} label="Posted videos" value={summary.posted_videos} delta={summary.posted_videos_delta} accent="text-orange-500" />
                <KpiCard icon={AtSign} label="Active accounts" value={summary.active_accounts} delta={0} accent="text-violet-500" />
                <KpiCard icon={Play} label={viewsLabel} value={summary.views} delta={summary.views_delta} accent="text-sky-500" />
                <KpiCard icon={Heart} label="Likes" value={summary.likes} delta={summary.likes_delta} accent="text-pink-500" />
                <KpiCard icon={MessageCircle} label="Comments" value={summary.comments} delta={summary.comments_period} accent="text-emerald-500" />
                <KpiCard
                  icon={BarChart3}
                  label="Engagement"
                  value={`${summary.engagement_rate ?? 0}%`}
                  delta={summary.engagement_rate_period ?? 0}
                  accent="text-amber-500"
                  hint="(likes + favorites + comments + shares) / views"
                />
                <KpiCard icon={Users} label="Followers" value={summary.followers} delta={summary.followers_delta} accent="text-cyan-600" />
                <KpiCard icon={Calendar} label={`Posted (${days}d)`} value={summary.posted_videos_period} delta={summary.views_period ?? 0} accent="text-orange-400" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                    <div>
                      <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">Top videos</h2>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Highest {viewsLabel.toLowerCase()} in the selected period.</p>
                    </div>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">By {viewsLabel.toLowerCase()}</span>
                  </div>
                  {topVideos.length ? (
                    <div>
                      {topVideos.map((video) => (
                        <TopVideoRow
                          key={`${video.creator_id}-${video.video_id}`}
                          video={video}
                          maxViews={maxTopVideoViews}
                          usesLikesProxy={usesLikesProxy}
                          viewsLabel={viewsLabel}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="px-5 py-8 text-sm text-zinc-500">No video stats yet. Refresh stats to load views.</p>
                  )}
                </section>

                <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                    <div>
                      <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">Top accounts</h2>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Accounts ranked by total {viewsLabel.toLowerCase()}.</p>
                    </div>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">By {viewsLabel.toLowerCase()}</span>
                  </div>
                  {topAccounts.length ? (
                    <div>
                      {topAccounts.map((creator) => (
                        <TopAccountRow
                          key={creator.creator_id}
                          creator={creator}
                          maxViews={maxTopAccountViews}
                          usesLikesProxy={usesLikesProxy}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="px-5 py-8 text-sm text-zinc-500">No accounts selected.</p>
                  )}
                </section>
              </div>

              <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                  <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">Posted videos</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">All tracked posts with {viewsLabel.toLowerCase()}, likes, and comments.</p>
                </div>
                {recentVideos.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Post</th>
                          <th className="px-5 py-3 font-semibold">Account</th>
                          <th className="px-5 py-3 font-semibold">Date</th>
                          <th className="px-5 py-3 font-semibold">{viewsLabel}</th>
                          <th className="px-5 py-3 font-semibold">Likes</th>
                          <th className="px-5 py-3 font-semibold">Comments</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {recentVideos.map((video) => (
                          <tr key={`${video.creator_id}-${video.video_id}`} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                            <td className="px-5 py-3">
                              <a
                                href={video.url || undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-w-[280px] items-center gap-3 text-zinc-900 hover:text-linkedin"
                              >
                                <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-zinc-900">
                                  {video.cover_url ? (
                                    <img src={video.cover_url} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-white">
                                      <Play className="h-4 w-4 fill-current" />
                                    </div>
                                  )}
                                </div>
                                <span className="line-clamp-2 font-medium">{truncateText(video.description || "Untitled video", 96)}</span>
                              </a>
                            </td>
                            <td className="px-5 py-3 text-zinc-700">{video.creator_name || "Creator"}</td>
                            <td className="px-5 py-3 text-zinc-600">{video.posted_at ? fmtDateLong(video.posted_at.slice(0, 10)) : "—"}</td>
                            <td className="px-5 py-3 font-mono font-semibold text-sky-700">{fmtCompact(videoReachViews(video, usesLikesProxy))}</td>
                            <td className="px-5 py-3 font-mono text-pink-600">{fmtCompact(video.likes)}</td>
                            <td className="px-5 py-3 font-mono text-emerald-600">{fmtCompact(video.comments)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-5 py-8 text-sm text-zinc-500">No posts loaded yet. Click Refresh stats to fetch per-post metrics.</p>
                )}
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">Metrics</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Daily posted videos and {viewsLabel.toLowerCase()} over the selected period.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                      <span className="h-2 w-2 rounded-sm bg-orange-500" />
                      Posted videos
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                      <span className="h-2 w-2 rounded-full bg-sky-500" />
                      {viewsLabel}
                    </span>
                  </div>
                </div>

                <div className="h-[320px] w-full min-w-0 rounded-xl bg-white p-2 dark:bg-zinc-900">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e4e4e7" vertical={false} />
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
                      <Tooltip content={<ChartTooltip usesLikesProxy={usesLikesProxy} />} cursor={{ fill: "rgba(10, 102, 194, 0.06)" }} />
                      <Bar yAxisId="right" dataKey="posted_videos" fill={ORANGE} radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="metric_line"
                        stroke={BLUE}
                        fill={BLUE}
                        fillOpacity={0.12}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, fill: BLUE }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                  <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">Daily breakdown</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">One row per day — videos posted and engagement deltas.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Date</th>
                        <th className="px-5 py-3 font-semibold">Videos</th>
                        <th className="px-5 py-3 font-semibold">{viewsLabel}</th>
                        <th className="px-5 py-3 font-semibold">Likes</th>
                        <th className="px-5 py-3 font-semibold">Comments</th>
                        <th className="px-5 py-3 font-semibold">Followers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {(data?.daily || []).slice().reverse().map((row) => (
                        <tr key={row.date} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                          <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{fmtDateLong(row.date)}</td>
                          <td className="px-5 py-3 tabular-nums text-orange-600">{row.posted_videos || 0}</td>
                          <td className="px-5 py-3 tabular-nums text-sky-600">{fmtCompact(usesLikesProxy ? row.likes : row.views)}</td>
                          <td className="px-5 py-3 tabular-nums text-pink-600">{fmtCompact(row.likes)}</td>
                          <td className="px-5 py-3 tabular-nums text-emerald-600">{fmtCompact(row.comments)}</td>
                          <td className="px-5 py-3 tabular-nums text-zinc-700">{fmtCompact(row.followers)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                  <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">Accounts</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Linked TikTok and Instagram profiles with live totals.</p>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  {filteredCreators.map((creator) => (
                    <div key={creator.creator_id} className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
                      <div className="flex items-start gap-4">
                        {creator.avatar_url ? (
                          <img src={creator.avatar_url} alt="" className="h-14 w-14 rounded-2xl object-cover ring-2 ring-white" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-200 text-lg font-bold text-zinc-700">
                            {(creator.name || "?").slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">{creator.name}</h3>
                            <PlatformIcon platform={creator.platform} className="h-4 w-4 text-zinc-500" />
                          </div>
                          <a
                            href={creator.profile_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-sm text-linkedin hover:text-linkedin-dark"
                          >
                            @{creator.handle}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                            <div>
                              <p className="text-zinc-500">{viewsLabel}</p>
                              <p className="font-semibold text-sky-700">{fmtCompact(creatorReachViews(creator, usesLikesProxy))}</p>
                            </div>
                            <div><p className="text-zinc-500">Followers</p><p className="font-semibold text-zinc-900">{fmtCompact(creator.current?.followers)}</p></div>
                            <div><p className="text-zinc-500">Videos</p><p className="font-semibold text-zinc-900">{creator.current?.videos ?? 0}</p></div>
                            <div><p className="text-zinc-500">Likes</p><p className="font-semibold text-zinc-900">{fmtCompact(creator.current?.likes)}</p></div>
                            <div><p className="text-zinc-500">Updated</p><p className="font-semibold text-zinc-600">{fmtDateTime(creator.last_refreshed_at)}</p></div>
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
