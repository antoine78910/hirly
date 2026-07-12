import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { fetchTrackerPageData, fetchDemoSwipeHistory } from "../lib/demoApplications";
import { applyFromPassedJob } from "../lib/applyFromPassed";
import { FINANCE_DEMO_CHANGED } from "../lib/financeDemoApi";
import { DEMO_ACCOUNT_CHANGED } from "../lib/demoAccount";
import {
  Loader2, Search, AlertCircle, ArrowRight, BriefcaseBusiness, Send, Zap,
  Clock3, Sparkles, CheckCircle2, FileSearch,
} from "lucide-react";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import CompanyLogo from "../components/CompanyLogo";
import ResumeSheet from "../components/ResumeSheet";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { motion } from "framer-motion";
import ApplicationDetailPanel from "../components/tracker/ApplicationDetailPanel";
import { downloadTailoredCV, downloadCoverLetter } from "../lib/pdf";
import { trackEvent } from "../lib/analytics";
import { useAuth } from "../context/AuthContext";
import { useAppLocale } from "../context/AppLocaleContext";
import { resolveDisplayStatus } from "../lib/applicationReview";
import { getApplicationCoverLetter, getApplicationResume, hasApplicationDocuments } from "../lib/applicationDocuments";
import {
  getApplicationDisplayStatuses,
  getTrackerEmptyCopy,
  getTrackerFilterTabs,
  getTrackerQuickFilters,
  getPackageErrorMessage,
} from "../lib/appUi";
import { useUpgradeModal } from "../context/UpgradeModalContext";

const QUICK_FILTER_ICONS = {
  submitted: Send,
  pending: Clock3,
  prepared: Sparkles,
  action_required: AlertCircle,
};

const fmtListDate = (iso, lang) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const listStatusLabel = (application, t) => {
  const key = resolveDisplayStatus(application);
  const labels = {
    submitted: t("tracker.listViewApplication"),
    pending: t("tracker.listApplying"),
    prepared: t("tracker.listViewPackage"),
    action_required: t("tracker.listAnswerQuestions"),
    blocked_captcha: t("tracker.listSecurityCheck"),
    failed: t("tracker.viewIssue"),
    expired: t("tracker.expired"),
  };
  return labels[key] || t("tracker.listViewDetails");
};

function TrackerApplicationRow({ application, onOpen, t, lang }) {
  const title = application.job?.title || t("tracker.untitledRole");
  const company = application.job?.company || t("tracker.unknownCompany");
  const date = fmtListDate(application.created_at, lang);
  const statusLabel = listStatusLabel(application, t);

  return (
    <button
      type="button"
      onClick={() => onOpen(application)}
      className="shell-border shell-inset flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors active:bg-zinc-100 dark:active:bg-zinc-800 md:rounded-xl md:p-3.5"
      data-testid={`application-${application.application_id}`}
    >
      <CompanyLogo company={application.job?.company} size="sm" rounded="xl" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="shell-title truncate text-[15px] font-semibold leading-snug">{title}</p>
        <p className="truncate text-sm text-zinc-500">{company}</p>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="truncate">{date || t("tracker.recently")}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-linkedin">
            <Zap className="h-3 w-3" fill="currentColor" />
            1
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate font-medium text-zinc-600">{statusLabel}</span>
        </div>
      </div>
    </button>
  );
}

function TrackerPassedRow({ row, onApplyNow, applyingId, t, lang }) {
  const job = row.job;
  if (!job) return null;
  const title = job.title || t("tracker.untitledRole");
  const company = job.company || t("tracker.unknownCompany");
  const date = fmtListDate(row.created_at, lang);
  const applying = applyingId === job.job_id;

  return (
    <div
      className="shell-border shell-inset flex w-full items-center gap-3 rounded-2xl p-3 md:rounded-xl md:p-3.5"
      data-testid={`passed-job-${job.job_id}`}
    >
      <CompanyLogo company={job.company} size="sm" rounded="xl" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="shell-title truncate text-[15px] font-semibold leading-snug">{title}</p>
        <p className="truncate text-sm text-zinc-500">{company}</p>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="truncate">{date || t("tracker.recently")}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-linkedin">
            <Zap className="h-3 w-3" fill="currentColor" />
            1
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate font-medium text-zinc-600">{t("history.passed")}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onApplyNow(job.job_id)}
        disabled={applying}
        className="shrink-0 rounded-full bg-linkedin px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        data-testid={`passed-apply-${job.job_id}`}
      >
        {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("history.generatePackage")}
      </button>
    </div>
  );
}

const ApplicationStatusPill = ({ application, variant = "light", displayStatuses }) => {
  const key = resolveDisplayStatus(application);
  const s = displayStatuses[key] || displayStatuses.pending;
  const tint = variant === "dark" ? s.tintDark : s.tintLight;
  const dot = variant === "dark" ? s.dotDark : s.dotLight;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tint}`}
      data-testid={`status-pill-${key}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {s.label}
    </span>
  );
};

const statusMeta = (application, displayStatuses) => (
  displayStatuses[resolveDisplayStatus(application)] || displayStatuses.pending
);

const isApplicationPrepared = (application) => {
  const status = resolveDisplayStatus(application);
  return ["prepared", "pending", "action_required", "blocked_captcha", "submitted", "failed"].includes(status)
    || ["ready", "prepared"].includes(application.submission_status)
    || (application.package_status && application.package_status !== "not_generated");
};

const applicationProgress = (application, t) => {
  const status = resolveDisplayStatus(application);
  const prepared = isApplicationPrepared(application);
  return [
    { key: "generated", label: t("tracker.generated"), state: "done" },
    { key: "prepared", label: t("tracker.prepared"), state: prepared ? "done" : "todo" },
    {
      key: "pending",
      label: t("tracker.pending"),
      state: status === "submitted" ? "done" : ["pending", "action_required", "blocked_captcha", "failed"].includes(status) ? "current" : "todo",
    },
    {
      key: "submitted",
      label: t("tracker.submitted"),
      state: status === "submitted" ? "done" : status === "failed" || status === "expired" ? "blocked" : "todo",
    },
  ];
};

const atsLabel = (application, t) => {
  const provider = application.job?.ats_provider || application.ats_provider || application.job?.source;
  if (!provider) return t("tracker.atsUnknown");
  return String(provider).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const workModeLabel = (application, t) => {
  const job = application.job || {};
  const raw = job.work_location || job.work_mode || job.workplace_type || job.location_type;
  if (raw) return String(raw).replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  if (job.remote === true || String(job.remote || "").toLowerCase() === "true") return t("swipe.remote");
  return null;
};

const envEmailSet = (value) => new Set(
  String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

const internalSubmitTestEnabled = process.env.REACT_APP_ENABLE_INTERNAL_SUBMIT_TEST === "true";
const internalSubmitEmails = envEmailSet(
  process.env.REACT_APP_REAL_SUBMIT_ALLOWED_EMAILS || process.env.REACT_APP_ADMIN_EMAILS
);

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const relativeDate = (iso, t) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return t("tracker.today");
  if (days === 1) return t("tracker.yesterday");
  if (days < 7) return t("tracker.daysAgo", { n: days });
  if (days < 14) return t("tracker.oneWeekAgo");
  return t("tracker.weeksAgo", { n: Math.floor(days / 7) });
};

const matchesSearch = (application, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    application.job?.company,
    application.job?.title,
    application.job?.location,
  ].some((value) => String(value || "").toLowerCase().includes(q));
};

const missingFieldsForForm = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.field_name || seen.has(item.field_name)) return false;
    seen.add(item.field_name);
    return true;
  });
};

const optionValue = (option) => {
  if (typeof option === "string") return option;
  return option?.value || option?.label || "";
};

const optionLabel = (option) => {
  if (typeof option === "string") return option;
  return option?.label || option?.value || "";
};

const applicationStatusMessage = (status, t) => {
  if (status === "submitted") return t("tracker.statusSubmitted");
  if (status === "pending") return t("tracker.statusFinalizing");
  if (status === "ready" || status === "prepared") return t("tracker.statusPrepared");
  if (status === "blocked" || status === "action_required") return t("tracker.statusBlocked");
  if (status === "blocked_captcha") return t("tracker.statusCaptcha");
  if (status === "prepare_failed") return t("tracker.statusPrepareFailed");
  if (status === "failed") return t("tracker.statusFailed");
  if (status === "unknown") return t("tracker.statusUnknown");
  return t("tracker.statusNotSubmitted");
};

export default function Tracker() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, lang } = useAppLocale();
  const activeTab = searchParams.get("tab") === "passed" ? "passed" : "applications";
  const { user } = useAuth();
  const { openUpgrade } = useUpgradeModal();
  const displayStatuses = useMemo(() => getApplicationDisplayStatuses(t), [t]);
  const filters = useMemo(() => getTrackerFilterTabs(t), [t]);
  const quickFilters = useMemo(() => getTrackerQuickFilters(t), [t]);
  const [profile, setProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("application");
  const [missingAnswers, setMissingAnswers] = useState({});
  const [saveMissingToProfile, setSaveMissingToProfile] = useState(false);
  const [savingMissing, setSavingMissing] = useState(false);
  const [preparingAgain, setPreparingAgain] = useState(false);
  const [submittingFinal, setSubmittingFinal] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [passedRows, setPassedRows] = useState([]);
  const [passedLoading, setPassedLoading] = useState(false);
  const [applyingPassedId, setApplyingPassedId] = useState(null);

  const setActiveTab = (tab) => {
    if (tab === "passed") {
      setSearchParams({ tab: "passed" }, { replace: true });
      return;
    }
    setSearchParams({}, { replace: true });
  };

  const loadPassed = async () => {
    setPassedLoading(true);
    try {
      const rows = await fetchDemoSwipeHistory(api, "left", { limit: 100 });
      setPassedRows(rows);
    } catch {
      toast.error(t("history.loadError"));
    } finally {
      setPassedLoading(false);
    }
  };

  const applyPassedJob = async (jobId) => {
    setApplyingPassedId(jobId);
    try {
      await applyFromPassedJob(api, jobId);
      toast.success(t("history.packageGenerated"));
      await Promise.all([loadPassed(), load()]);
      setActiveTab("applications");
    } catch (e) {
      if (e?.response?.status === 402) openUpgrade();
      toast.error(getPackageErrorMessage(t, e));
    } finally {
      setApplyingPassedId(null);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { applications, profile } = await fetchTrackerPageData(api);
      setApps(applications);
      setProfile(profile);
    } catch {
      setApps([]);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    trackEvent("tracker_view");
    load();
  }, [location.pathname, location.search]);

  useEffect(() => {
    const refresh = () => load();
    window.addEventListener(FINANCE_DEMO_CHANGED, refresh);
    window.addEventListener(DEMO_ACCOUNT_CHANGED, refresh);
    return () => {
      window.removeEventListener(FINANCE_DEMO_CHANGED, refresh);
      window.removeEventListener(DEMO_ACCOUNT_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    if (activeTab === "passed") loadPassed();
  }, [activeTab]);

  useEffect(() => {
    if (!selected) return;
    const initial = {};
    missingFieldsForForm(selected.prepared_missing_information || []).forEach((item) => {
      if (item?.field_name) initial[item.field_name] = "";
    });
    setMissingAnswers(initial);
    setSaveMissingToProfile(false);
  }, [selected]);

  const handleDownloadCV = () => {
    if (!selected) return;
    downloadTailoredCV({
      contact: profile?.contact || {},
      resume: getApplicationResume(selected),
      job: selected.job,
      template: profile?.template_style || "modern",
    });
    toast.success(t("tracker.cvDownloaded"));
  };

  const handleDownloadCoverLetter = () => {
    if (!selected) return;
    const letter = getApplicationCoverLetter(selected);
    downloadCoverLetter({
      contact: profile?.contact || {},
      letter,
      job: selected.job,
      template: letter.template || (letter.subject ? "french_formal" : (profile?.template_style || "modern")),
    });
    toast.success(t("tracker.coverDownloaded"));
  };

  const openApplication = async (app) => {
    setSelected(app);
    setDetailTab(hasApplicationDocuments(app) ? "documents" : "application");
    setOpen(true);
    try {
      const { data } = await api.get(`/applications/${app.application_id}`);
      setSelected(data);
      setDetailTab(hasApplicationDocuments(data) ? "documents" : "application");
      setApps((prev) => prev.map((a) => a.application_id === data.application_id ? data : a));
    } catch {
      // Keep the list record visible if refresh fails.
    }
  };

  const resolveMissingInfo = async () => {
    if (!selected) return;
    setSavingMissing(true);
    try {
      await api.post(`/applications/${selected.application_id}/resolve-missing-info`, {
        answers: missingAnswers,
        save_to_profile: saveMissingToProfile,
      });
      const { data } = await api.get(`/applications/${selected.application_id}`);
      const updated = data;
      setSelected(updated);
      setApps((prev) => prev.map((a) => a.application_id === updated.application_id ? updated : a));
      trackEvent("action_required_answer_saved", {
        application_id: selected.application_id,
        save_to_profile: saveMissingToProfile,
      });
      toast.success(updated.submission_status === "ready" ? "Ready to submit" : "Answers saved");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail?.message || (typeof detail === "string" ? detail : "Could not save answers"));
    } finally {
      setSavingMissing(false);
    }
  };

  const refreshApplication = async (applicationId) => {
    const { data } = await api.get(`/applications/${applicationId}`);
    setSelected(data);
    setApps((prev) => prev.map((a) => a.application_id === data.application_id ? data : a));
    return data;
  };

  const prepareGreenhouseAgain = async () => {
    if (!selected?.job_id) return;
    setPreparingAgain(true);
    trackEvent("prepare_again_clicked", {
      application_id: selected.application_id,
      job_id: selected.job_id,
      ats_provider: selected.job?.ats_provider,
    });
    try {
      const { data } = await api.post("/applications/greenhouse/prepare-browser-fill", { job_id: selected.job_id });
      const status = data?.submission_status;
      toast.success(status === "prepared" || status === "ready" ? "Application prepared" : "Prepare finished");
      await refreshApplication(selected.application_id);
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail?.message || (typeof detail === "string" ? detail : "Prepare failed"));
      try { await refreshApplication(selected.application_id); } catch {}
    } finally {
      setPreparingAgain(false);
    }
  };

  const testFinalSubmit = async () => {
    if (!selected?.job_id) return;
    const confirmed = window.confirm("This may submit a real application. Continue?");
    if (!confirmed) return;
    setSubmittingFinal(true);
    try {
      const { data } = await api.post("/applications/greenhouse/browser-submit", { job_id: selected.job_id });
      const status = data?.submission_status;
      if (data?.dry_run) {
        toast.success("Dry run completed", { description: "The application was filled but submit was not clicked." });
      } else if (status === "submitted") {
        toast.success("Application submitted");
      } else if (status === "action_required") {
        toast("Action required", { description: "A few answers are needed before this can be completed." });
      } else if (status === "blocked_captcha" || data?.manual_fallback_triggered || status === "unknown") {
        toast("Application pending", { description: "We are finalizing this application." });
      } else {
        toast.error("Submit did not complete", { description: "The application has been saved for review." });
      }
      await refreshApplication(selected.application_id);
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail?.message || (typeof detail === "string" ? detail : "Final submit test failed"));
      try { await refreshApplication(selected.application_id); } catch {}
    } finally {
      setSubmittingFinal(false);
    }
  };

  const profileLoaded = !loading || profile !== null;
  const hasResume = Boolean(profile?.cv_text);
  const showResumeBanner = profileLoaded && !hasResume;
  const summary = useMemo(() => {
    const counts = { total: apps.length, submitted: 0, pending: 0, attention: 0, actionRequired: 0, successRate: 0 };
    apps.forEach((app) => {
      const status = resolveDisplayStatus(app);
      if (status === "submitted") counts.submitted += 1;
      if (status === "pending") counts.pending += 1;
      if (["action_required", "failed", "blocked_captcha", "expired"].includes(status)) counts.attention += 1;
      if (status === "action_required" || status === "blocked_captcha") counts.actionRequired += 1;
    });
    counts.successRate = counts.total ? Math.round((counts.submitted / counts.total) * 100) : 0;
    return counts;
  }, [apps]);

  const filterCounts = useMemo(() => {
    const counts = { all: apps.length };
    filters.forEach((filter) => {
      if (filter.key !== "all") counts[filter.key] = 0;
    });
    apps.forEach((app) => {
      const status = resolveDisplayStatus(app);
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [apps, filters]);

  const filteredApps = useMemo(() => (
    apps.filter((app) => {
      const status = resolveDisplayStatus(app);
      const statusMatch = statusFilter === "all" || status === statusFilter;
      return statusMatch && matchesSearch(app, searchQuery);
    })
  ), [apps, statusFilter, searchQuery]);

  const filteredPassed = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return passedRows;
    return passedRows.filter((row) => {
      const job = row.job || {};
      return [job.company, job.title, job.location].some(
        (value) => String(value || "").toLowerCase().includes(q),
      );
    });
  }, [passedRows, searchQuery]);

  const pageLoading = activeTab === "passed" ? passedLoading : loading;
  const hasActiveListFilters = statusFilter !== "all" || searchQuery.trim();
  const userEmail = (user?.email || "").trim().toLowerCase();
  const canShowInternalSubmitTest = internalSubmitTestEnabled && userEmail && internalSubmitEmails.has(userEmail);

  return (
    <AppPage className={SHELL_PAGE_CLASS}>
      <BrandHeader />

      <AppPageScroll>
        <div className={APP_CONTENT_WIDTH}>
        <DesktopPageHeader
          title={t("tracker.title")}
          subtitle={t("tracker.subtitle")}
        />

        {/* Sprout-style primary tabs (mobile-first) */}
        <div className="shell-border-b flex md:mt-2">
          <button
            type="button"
            onClick={() => setActiveTab("applications")}
            className={`relative flex-1 py-3 text-sm font-semibold transition-colors ${
              activeTab === "applications" ? "text-linkedin" : "shell-tab-inactive hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
            data-testid="tracker-tab-applications"
          >
            {t("tracker.title")}
            {activeTab === "applications" ? (
              <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-linkedin" />
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("passed")}
            className={`relative flex-1 py-3 text-sm font-semibold transition-colors ${
              activeTab === "passed" ? "text-linkedin" : "shell-tab-inactive hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
            data-testid="tracker-tab-skipped"
          >
            {t("tracker.skippedJobs")}
            {activeTab === "passed" ? (
              <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-linkedin" />
            ) : null}
          </button>
        </div>

        {activeTab === "applications" && showResumeBanner ? (
          <section className="py-8 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border-2 border-linkedin/30 bg-violet-50">
              <FileSearch className="h-10 w-10 text-linkedin" strokeWidth={1.5} />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold tracking-tight">{t("tracker.addResume")}</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed shell-body">
              {t("tracker.addResumeBody")}
            </p>
            <button
              type="button"
              onClick={() => setResumeOpen(true)}
              className="mt-8 w-full rounded-full gradient-linkedin py-3.5 text-base font-semibold text-white hover:opacity-90"
              data-testid="applications-upload-resume"
            >
              {t("tracker.uploadResume")}
            </button>
          </section>
        ) : null}

        <section className={activeTab === "applications" && showResumeBanner ? "mt-6 border-t shell-border-b pt-6 pb-8 md:mt-10 md:pt-8" : "pb-8 pt-3 md:pt-4"}>
          {activeTab === "applications" ? (
          <>
          {/* Status filter chips — horizontal scroll with counts */}
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar" data-testid="tracker-status-filters">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${
                statusFilter === "all"
                  ? "border-linkedin bg-linkedin text-white"
                  : "shell-chip-idle"
              }`}
            >
              {t("tracker.all")}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                statusFilter === "all" ? "bg-white/20" : "shell-chip-count"
              }`}>
                {filterCounts.all || 0}
              </span>
            </button>
            {quickFilters.map((item) => {
              const Icon = QUICK_FILTER_ICONS[item.key] || Clock3;
              const active = statusFilter === item.key;
              const count = filterCounts[item.key] || 0;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${
                    active ? "border-linkedin bg-linkedin text-white" : "shell-chip-idle"
                  }`}
                  data-testid={`tracker-filter-${item.key}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  {item.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    active ? "bg-white/20" : "shell-chip-count"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="shell-search mt-2 flex h-10 items-center gap-2 rounded-xl px-3 md:h-11 md:rounded-2xl">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("tracker.searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-sm shell-title outline-none placeholder:shell-body"
              data-testid="applications-search"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs font-semibold text-linkedin"
              >
                {t("common.clear")}
              </button>
            ) : null}
          </label>

          {/* Summary stats — desktop only */}
          <div className="mt-6 hidden md:block">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-lg font-bold tracking-tight">{t("tracker.summary")}</h4>
              {hasActiveListFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setSearchQuery("");
                  }}
                  className="text-sm font-semibold text-linkedin"
                >
                  {t("common.clear")}
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {[
                { label: t("tracker.totalApplications"), value: summary.total, Icon: BriefcaseBusiness, tone: "shell-surface-sm text-zinc-900 dark:text-zinc-100", sub: t("tracker.submittedCount", { n: summary.submitted }) },
                { label: t("tracker.successRate"), value: `${summary.successRate}%`, Icon: CheckCircle2, tone: "border-emerald-100 bg-emerald-50 text-emerald-800", sub: t("tracker.submittedOverTotal") },
                { label: t("tracker.pending"), value: summary.pending, Icon: Clock3, tone: "border-amber-100 bg-amber-50 text-amber-800", sub: t("tracker.beingFinalized") },
                { label: t("tracker.actionRequired"), value: summary.actionRequired, Icon: AlertCircle, tone: "border-orange-100 bg-orange-50 text-orange-800", sub: t("tracker.needAttentionCount", { n: summary.attention }) },
              ].map(({ label, value, Icon, tone, sub }) => (
                <div key={label} className={`rounded-2xl border p-3 ${tone}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <p className="truncate text-[11px] font-semibold">{label}</p>
                  </div>
                  <p className="mt-2 font-display text-3xl font-black leading-none">{value}</p>
                  <p className="mt-1 truncate text-[11px] font-medium">{sub}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {filters.map((item) => {
                const active = statusFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStatusFilter(item.key)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      active ? "border-linkedin bg-linkedin text-white" : "shell-chip-idle"
                    }`}
                  >
                    {item.label}
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                      active ? "bg-white/20 text-white" : "shell-chip-count text-zinc-700 dark:text-zinc-300"
                    }`}>
                      {filterCounts[item.key] || 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {pageLoading ? (
            <div className="mt-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed shell-dashed shell-inset px-5 py-8 text-center">
              <div className="shell-surface mx-auto grid h-12 w-12 place-items-center rounded-2xl text-sprout-muted">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <p className="shell-title font-display text-lg font-bold">{t("tracker.nothingYet")}</p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed shell-body">
                {searchQuery.trim() ? t("tracker.noSearchMatch") : getTrackerEmptyCopy(t, statusFilter)}
              </p>
              <button
                type="button"
                onClick={() => { window.location.href = "/swipe"; }}
                className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-full bg-linkedin px-4 py-2 text-sm font-semibold text-white"
              >
                {t("tracker.backToSwipe")} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2 md:mt-4 md:space-y-3" data-testid="applications-list">
              {filteredApps.map((a) => (
                <motion.li
                  key={a.application_id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <TrackerApplicationRow
                    application={a}
                    onOpen={openApplication}
                    t={t}
                    lang={lang}
                  />
                </motion.li>
              ))}
            </ul>
          )}
          </>
          ) : (
          <>
          <label className="shell-search mt-2 flex h-10 items-center gap-2 rounded-xl px-3 md:h-11 md:rounded-2xl">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("tracker.searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-sm shell-title outline-none placeholder:shell-body"
              data-testid="passed-search"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs font-semibold text-linkedin"
              >
                {t("common.clear")}
              </button>
            ) : null}
          </label>

          <p className="mt-3 text-xs leading-relaxed shell-body md:mt-4">
            {t("history.generatePackageHint")}
          </p>

          {pageLoading ? (
            <div className="mt-12 flex justify-center" data-testid="passed-loading">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : filteredPassed.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed shell-dashed shell-inset px-5 py-8 text-center" data-testid="passed-empty">
              <div className="shell-surface mx-auto grid h-12 w-12 place-items-center rounded-2xl text-sprout-muted">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <p className="shell-title font-display text-lg font-bold">{t("tracker.nothingYet")}</p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed shell-body">
                {searchQuery.trim() ? t("tracker.noSearchMatch") : t("history.noPassed")}
              </p>
              <button
                type="button"
                onClick={() => navigate("/swipe")}
                className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-full bg-linkedin px-4 py-2 text-sm font-semibold text-white"
              >
                {t("tracker.backToSwipe")} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2 md:mt-4 md:space-y-3" data-testid="passed-list">
              {filteredPassed.map((row) => (
                <motion.li
                  key={row.swipe_id || row.job_id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <TrackerPassedRow
                    row={row}
                    onApplyNow={applyPassedJob}
                    applyingId={applyingPassedId}
                    t={t}
                    lang={lang}
                  />
                </motion.li>
              ))}
            </ul>
          )}
          </>
          )}
        </section>

        </div>
      </AppPageScroll>

      <ResumeSheet
        open={resumeOpen}
        profile={profile}
        onClose={() => setResumeOpen(false)}
        onUploaded={load}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-zinc-200 bg-white p-0 text-zinc-900 sm:h-auto sm:max-h-[90dvh] sm:rounded-lg"
          data-testid="application-detail"
        >
          {selected && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ApplicationDetailPanel
              application={selected}
              profile={profile}
              displayStatuses={displayStatuses}
              statusMeta={statusMeta}
              applicationStatusMessage={applicationStatusMessage}
              ApplicationStatusPill={ApplicationStatusPill}
              t={t}
              lang={lang}
              onDownloadCV={handleDownloadCV}
              onDownloadCoverLetter={handleDownloadCoverLetter}
              missingAnswers={missingAnswers}
              setMissingAnswers={setMissingAnswers}
              saveMissingToProfile={saveMissingToProfile}
              setSaveMissingToProfile={setSaveMissingToProfile}
              savingMissing={savingMissing}
              resolveMissingInfo={resolveMissingInfo}
              preparingAgain={preparingAgain}
              prepareGreenhouseAgain={prepareGreenhouseAgain}
              submittingFinal={submittingFinal}
              testFinalSubmit={testFinalSubmit}
              canShowInternalSubmitTest={canShowInternalSubmitTest}
              missingFieldsForForm={missingFieldsForForm}
              optionValue={optionValue}
              optionLabel={optionLabel}
              onBack={() => setOpen(false)}
              activeTab={detailTab}
              onTabChange={setDetailTab}
            />
            </div>
          )}
        </DialogContent>
      </Dialog>

    </AppPage>
  );
}
