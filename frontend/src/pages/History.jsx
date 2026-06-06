import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Zap, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

const TABS = [
  { key: "right", label: "Generated", testid: "history-tab-liked" },
  { key: "left",  label: "Passed",  testid: "history-tab-skipped" },
];

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function JobRow({ row, onApplyNow }) {
  const job = row.job;
  if (!job) return null;
  return (
    <div
      className="rounded-2xl border border-sprout-border bg-sprout-surface p-4 flex items-start gap-4"
      data-testid={`history-row-${job.job_id}`}
    >
      <div className="w-16 h-16 rounded-xl bg-white grid place-items-center font-display font-black text-2xl text-zinc-900 shrink-0">
        {(job.company || "?").trim().charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-display font-bold text-white text-[17px] leading-tight line-clamp-2">{job.title}</p>
          <span className="inline-flex items-center gap-1 text-sprout-mint text-sm font-semibold shrink-0">
            <Zap className="w-4 h-4" />{row.match_score ?? 1}
          </span>
        </div>
        <p className="text-sprout-muted text-sm mt-0.5">{job.company}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-sprout-dim">{formatDate(row.created_at)}</span>
          <button
            onClick={() => onApplyNow(job.job_id)}
            className="px-4 h-9 rounded-full bg-sprout-mint text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            data-testid={`history-apply-${job.job_id}`}
          >
            Generate Package
          </button>
        </div>
      </div>
    </div>
  );
}

export default function History() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("tab") === "left" ? "left" : "right";
  const [tab, setTab] = useState(initial);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (direction) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/swipes/history?direction=${direction}&limit=100`);
      setRows(data.swipes || []);
    } catch (e) {
      toast.error("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const switchTab = (k) => {
    setTab(k);
    setSearchParams({ tab: k });
  };

  const applyNow = async (jobId) => {
    try {
      // remove the prior swipe so the job is eligible, then post a right-swipe
      await api.delete(`/swipes/${jobId}`);
      await api.post("/swipe", { job_id: jobId, direction: "right" });
      toast.success("Application package generated. Not submitted yet.");
      load(tab);
    } catch (e) {
      toast.error("Could not generate package. Try again.");
    }
  };

  const title = tab === "left" ? "Jobs you passed" : "Generated packages";

  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white pb-28 max-w-md mx-auto px-5">
      <header className="pt-6 flex items-center gap-3" data-testid="history-header">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface"
          data-testid="history-back-btn"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="font-display font-bold text-xl flex-1 text-center pr-10">{title}</h1>
      </header>

      <div className="mt-6 flex gap-2 p-1 rounded-full bg-sprout-surface border border-sprout-border" data-testid="history-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            data-testid={t.testid}
            className={`relative flex-1 h-10 rounded-full text-sm font-semibold transition-colors ${
              tab === t.key ? "text-violet-800" : "text-zinc-500"
            }`}
          >
            {tab === t.key && (
              <motion.span
                layoutId="history-tab-pill"
                className="absolute inset-0 rounded-full selection-tab-on"
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3" data-testid="history-list">
        {loading && (
          <div className="py-16 grid place-items-center" data-testid="history-loading">
            <Loader2 className="w-5 h-5 animate-spin text-sprout-muted" />
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="py-20 text-center" data-testid="history-empty">
            <p className="text-sprout-muted">No {tab === "left" ? "passed" : "generated"} jobs yet.</p>
          </div>
        )}
        {!loading && rows.map((r) => <JobRow key={r.job_id} row={r} onApplyNow={applyNow} />)}
      </div>
    </div>
  );
}
