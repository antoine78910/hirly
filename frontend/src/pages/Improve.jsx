import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  TrendingUp, Eye, FileText, Target, Award, Sparkles, Loader2, ExternalLink,
} from "lucide-react";
import { api } from "../lib/api";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";

const IMPACT_COLORS = {
  high:   "bg-rose-500/15 text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low:    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const LABEL_COLORS = {
  Strong:        "text-emerald-300",
  Solid:         "text-sprout-mint",
  Promising:     "text-amber-300",
  "Needs work":  "text-rose-300",
};

export default function Improve() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const { data } = await api.get(`/coach/improve${refresh ? "?refresh=true" : ""}`);
      setData(data);
    } catch (e) {
      if (e?.response?.status === 400) navigate("/onboarding");
      else toast.error(e?.response?.data?.detail || "Could not load analysis");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (loading) {
    return (
      <AppPage className="sprout grid place-items-center bg-sprout-bg md:bg-transparent">
        <Loader2 className="w-5 h-5 animate-spin text-sprout-muted md:text-zinc-400" />
      </AppPage>
    );
  }

  const r = data?.recruiter_view || {};
  const labelColor = LABEL_COLORS[r.label] || "text-white";

  return (
    <AppPage className="sprout bg-sprout-bg text-white md:bg-transparent md:py-8 dark:md:text-zinc-100">
      <header className="mx-auto flex w-full max-w-md shrink-0 items-center justify-between px-5 pt-6 md:hidden" data-testid="improve-header">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-white" strokeWidth={2} />
          <h1 className="font-display font-bold text-3xl tracking-tight">Improve</h1>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="text-sprout-mint text-sm font-semibold disabled:opacity-50"
          data-testid="improve-refresh"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <AppPageScroll className={APP_CONTENT_WIDTH}>
      <DesktopPageHeader
        title="Opportunities"
        subtitle="Your AI career coach — profile analysis, gaps, and quick wins."
        actions={(
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-violet-600 hover:bg-violet-50 disabled:opacity-50"
            data-testid="improve-refresh-desktop"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      />
      <p className="mt-1 text-sm text-sprout-muted md:hidden">Your AI career coach, updated daily. Tap Refresh to re-run.</p>

      {/* What recruiters see */}
      <section
        className="mt-6 rounded-3xl p-6 bg-swiipr-gradient relative overflow-hidden"
        data-testid="recruiter-view"
      >
        <Eye className="absolute -right-4 -top-4 w-28 h-28 text-white/10" />
        <p className="text-xs uppercase tracking-widest text-white/80 font-bold flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" /> What recruiters see
        </p>
        <div className="mt-3 flex items-end gap-3">
          <p className="font-display font-black text-5xl text-white" data-testid="recruiter-score">{r.score ?? "—"}</p>
          <p className={`font-semibold mb-2 ${labelColor}`} data-testid="recruiter-label">{r.label || ""}</p>
        </div>
        <p className="mt-3 text-white/90 text-[15px] leading-relaxed" data-testid="recruiter-summary">{r.summary}</p>
      </section>

      {/* Tips */}
      {data?.tips?.length > 0 && (
        <section className="mt-7" data-testid="improve-tips">
          <h3 className="text-xs uppercase tracking-[0.16em] text-sprout-muted px-1 mb-3">Quick wins</h3>
          <ul className="space-y-2">
            {data.tips.map((t, i) => (
              <li key={i} className="flex gap-3 items-start p-3 rounded-xl bg-sprout-surface border border-sprout-border">
                <Sparkles className="w-4 h-4 text-sprout-mint mt-0.5 shrink-0" />
                <span className="text-zinc-200 text-[15px] leading-snug">{t}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Resume tips */}
      {data?.resume_tips?.length > 0 && (
        <section className="mt-7" data-testid="resume-tips">
          <h3 className="text-xs uppercase tracking-[0.16em] text-sprout-muted px-1 mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Resume suggestions
          </h3>
          <div className="space-y-3">
            {data.resume_tips.map((t, i) => (
              <div key={i} className="p-4 rounded-2xl border border-sprout-border bg-sprout-surface" data-testid={`resume-tip-${i}`}>
                <p className="font-semibold text-white">{t.title}</p>
                <p className="mt-1.5 text-sm text-sprout-muted">{t.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skill gaps */}
      {data?.skill_gaps?.length > 0 && (
        <section className="mt-7" data-testid="skill-gaps">
          <h3 className="text-xs uppercase tracking-[0.16em] text-sprout-muted px-1 mb-3 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" /> Skill gaps
          </h3>
          <div className="space-y-3">
            {data.skill_gaps.map((g, i) => {
              const impactStyle = IMPACT_COLORS[(g.impact || "medium").toLowerCase()] || IMPACT_COLORS.medium;
              return (
                <div key={i} className="p-4 rounded-2xl border border-sprout-border bg-sprout-surface" data-testid={`skill-gap-${i}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">{g.skill}</p>
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full border ${impactStyle}`}>
                      {g.impact} impact
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-sprout-muted">{g.why}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Certifications */}
      {data?.certifications?.length > 0 && (
        <section className="mt-7" data-testid="certifications">
          <h3 className="text-xs uppercase tracking-[0.16em] text-sprout-muted px-1 mb-3 flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5" /> Recommended certifications
          </h3>
          <div className="space-y-3">
            {data.certifications.map((c, i) => (
              <button
                key={i}
                onClick={() => {
                  const url = `https://www.google.com/search?q=${encodeURIComponent(`${c.name} ${c.provider || ""}`)}`;
                  window.open(url, "_blank", "noopener");
                }}
                className="w-full text-left p-4 rounded-2xl border border-sprout-border bg-sprout-surface hover:bg-sprout-surface-2 transition-colors flex items-start gap-3"
                data-testid={`certification-${i}`}
              >
                <div className="w-10 h-10 rounded-xl bg-sprout-mint-soft-2 grid place-items-center shrink-0">
                  <Award className="w-5 h-5 text-sprout-mint" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{c.name}</p>
                  <p className="text-sm text-sprout-muted">{c.provider}{c.duration ? ` · ${c.duration}` : ""}</p>
                  {c.why && <p className="mt-1.5 text-sm text-sprout-muted">{c.why}</p>}
                </div>
                <ExternalLink className="w-4 h-4 text-sprout-muted mt-2 shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}
      </AppPageScroll>
    </AppPage>
  );
}
