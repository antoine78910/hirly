import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Zap, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { applyFromPassedJob } from "../lib/applyFromPassed";
import CompanyLogo from "../components/CompanyLogo";
import { toast } from "sonner";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import { TitleHeader } from "../components/app/AppScreenHeader";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import { useAppLocale } from "../context/AppLocaleContext";
import { getHistoryTabs, getPackageErrorMessage } from "../lib/appUi";
import { useUpgradeModal } from "../context/UpgradeModalContext";

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function JobRow({ row, tab, onApplyNow, onViewApplication, t }) {
  const job = row.job;
  if (!job) return null;
  return (
    <div
      className="shell-surface-sm flex items-start gap-4 rounded-2xl p-4"
      data-testid={`history-row-${job.job_id}`}
    >
      <CompanyLogo company={job.company} size="md" rounded="xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="shell-title line-clamp-2 font-display text-[17px] font-bold leading-tight">
            {job.title}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-linkedin">
            <Zap className="h-4 w-4" />1
          </span>
        </div>
        <p className="mt-0.5 text-sm text-zinc-500">{job.company}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-zinc-400">{formatDate(row.created_at)}</span>
          <button
            type="button"
            onClick={() => (tab === "right" ? onViewApplication() : onApplyNow(job.job_id))}
            className="h-9 rounded-full bg-linkedin px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            data-testid={
              tab === "right" ? `history-view-${job.job_id}` : `history-apply-${job.job_id}`
            }
          >
            {tab === "right" ? t("history.viewApplication") : t("history.generatePackage")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function History() {
  const navigate = useNavigate();
  const { t } = useAppLocale();
  const { openUpgrade } = useUpgradeModal();
  const tabs = getHistoryTabs(t);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (searchParams.get("tab") === "left" ? "left" : "right"));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (direction) => {
      setLoading(true);
      try {
        const { data } = await api.get(`/swipes/history?direction=${direction}&limit=100`);
        setRows(data.swipes || []);
      } catch {
        toast.error(t("history.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    load(tab === "left" ? "left" : "right");
  }, [tab, load]);

  const switchTab = (key) => {
    setTab(key);
    setSearchParams({ tab: key });
  };

  const applyNow = async (jobId) => {
    try {
      await applyFromPassedJob(api, jobId);
      toast.success(t("history.packageGenerated"));
      navigate("/tracker");
    } catch (e) {
      if (e?.response?.status === 402) openUpgrade();
      toast.error(getPackageErrorMessage(t, e));
    }
  };

  const title = tab === "left" ? t("history.passedTitle") : t("history.generatedTitle");
  const emptyMessage = tab === "left" ? t("history.noPassed") : t("history.noGenerated");

  return (
    <AppPage className={SHELL_PAGE_CLASS}>
      <TitleHeader
        title={title}
        leftAction={
          <button
            type="button"
            onClick={() => navigate("/swipe")}
            className="grid h-9 w-9 place-items-center rounded-full text-zinc-600 hover:bg-zinc-100"
            aria-label={t("common.back")}
            data-testid="history-back-mobile"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        }
      />

      <AppPageScroll className={APP_CONTENT_WIDTH}>
        <button
          type="button"
          onClick={() => navigate("/swipe")}
          className="mb-4 hidden items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 md:inline-flex"
          data-testid="history-back-desktop"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("tracker.backToSwipe")}
        </button>

        <DesktopPageHeader title={title} subtitle={t("history.subtitle")} />
        <div
          className="mt-6 flex gap-2 rounded-full border border-zinc-200 bg-zinc-100 p-1"
          data-testid="history-tabs"
        >
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => switchTab(tabItem.key)}
              data-testid={tabItem.testid}
              className={`relative h-10 flex-1 rounded-full text-sm font-semibold transition-colors ${
                tab === tabItem.key ? "text-violet-800" : "text-zinc-500"
              }`}
            >
              {tab === tabItem.key ? (
                <motion.span
                  layoutId="history-tab-pill"
                  className="absolute inset-0 rounded-full bg-white shadow-sm"
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                />
              ) : null}
              <span className="relative">{tabItem.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3" data-testid="history-list">
          {loading ? (
            <div className="grid place-items-center py-16" data-testid="history-loading">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            </div>
          ) : null}
          {!loading && rows.length === 0 ? (
            <div className="py-20 text-center" data-testid="history-empty">
              <p className="text-zinc-500">{emptyMessage}</p>
            </div>
          ) : null}
          {!loading &&
            rows.map((r) => (
              <JobRow
                key={r.job_id}
                row={r}
                tab={tab}
                onApplyNow={applyNow}
                onViewApplication={() => navigate("/tracker")}
                t={t}
              />
            ))}
        </div>
      </AppPageScroll>
    </AppPage>
  );
}
