import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MapPin,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { filterApplicationsForReview } from "../lib/applicationReview";
import { fetchTrackerPageData } from "../lib/demoApplications";
import { isApplicationGenerating } from "../lib/applicationDocuments";
import { useAiSettings } from "../hooks/useAiSettings";
import { useAppLocale } from "../context/AppLocaleContext";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import CompanyLogo from "../components/CompanyLogo";

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function Review() {
  const { t } = useAppLocale();
  const navigate = useNavigate();
  const { settings } = useAiSettings();
  const reviewEnabled = settings.reviewDocuments;
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { applications } = await fetchTrackerPageData(api);
      setApps(applications);
    } catch (_) {
      toast.error(t("review.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!reviewEnabled) return undefined;
    const generating = apps.some(isApplicationGenerating);
    if (!generating) return undefined;
    const timer = window.setInterval(() => {
      load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [apps, reviewEnabled, load]);

  const reviewQueue = useMemo(
    () => filterApplicationsForReview(apps, reviewEnabled),
    [apps, reviewEnabled],
  );

  const openApplication = (application) => {
    navigate(`/review/${application.application_id}`);
  };

  return (
    <AppPage className={SHELL_PAGE_CLASS}>
      <BrandHeader />

      <AppPageScroll>
        <div className={APP_CONTENT_WIDTH}>
          <DesktopPageHeader
            title={t("review.title")}
            subtitle={reviewEnabled ? t("review.subtitleOn") : t("review.subtitleOff")}
          />

          {!reviewEnabled ? (
            <section className="mt-6 rounded-3xl border border-dashed shell-dashed shell-inset px-6 py-10 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/15 text-violet-400">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold shell-title">{t("review.disabledTitle")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed shell-body">
                {t("review.disabledBody")}
              </p>
              <Link
                to="/settings"
                className="mt-6 inline-flex items-center gap-2 rounded-full gradient-linkedin px-5 py-2.5 text-sm font-semibold text-white"
              >
                <Settings className="h-4 w-4" />
                {t("review.openAiSettings")}
              </Link>
            </section>
          ) : loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : reviewQueue.length === 0 ? (
            <section className="mt-6 rounded-3xl border border-dashed shell-dashed shell-inset px-6 py-10 text-center">
              <div className="shell-surface mx-auto grid h-14 w-14 place-items-center rounded-2xl text-sprout-muted shadow-sm">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold shell-title">{t("review.allCaughtUp")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed shell-body">
                {t("review.emptyBody")}
              </p>
              <Link
                to="/swipe"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-linkedin px-5 py-2.5 text-sm font-semibold text-white"
              >
                {t("review.backToJobs")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          ) : (
            <ul className="mt-6 space-y-3" data-testid="review-queue">
              {reviewQueue.map((app) => (
                <motion.li
                  key={app.application_id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <button
                    type="button"
                    onClick={() => openApplication(app)}
                    className="shell-surface flex w-full items-start gap-4 rounded-3xl p-4 text-left transition-transform hover:border-violet-200 hover:shadow-md active:scale-[0.99] dark:hover:border-violet-500/40"
                    data-testid={`review-item-${app.application_id}`}
                  >
                    <CompanyLogo company={app.job?.company} size="md" rounded="xl" />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-lg font-bold leading-tight shell-title">
                        {app.job?.title}
                      </p>
                      <p className="mt-0.5 text-sm shell-body">{app.job?.company}</p>
                      {app.job?.location ? (
                        <p className="mt-2 inline-flex items-center gap-1 text-xs shell-body">
                          <MapPin className="h-3.5 w-3.5" />
                          {app.job.location}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-400">
                          {t("review.readyToReview")}
                        </span>
                        <span className="rounded-full shell-chip-count px-2.5 py-1 text-[11px] font-semibold shell-body">
                          {fmtDate(app.created_at)
                            ? t("review.generatedOn", { date: fmtDate(app.created_at) })
                            : t("review.generatedRecently")}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="mt-2 h-5 w-5 shrink-0 text-sprout-dim" />
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </AppPageScroll>
    </AppPage>
  );
}
