import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  Loader2, MapPin, FileText, Mail, Download, MessageSquare, FileSearch, Sparkles,
  Search, CheckCircle2, Clock3, AlertCircle, ArrowRight, BriefcaseBusiness, Send, Zap,
} from "lucide-react";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import CompanyLogo from "../components/CompanyLogo";
import ResumeSheet from "../components/ResumeSheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { motion } from "framer-motion";
import CVPreview from "../components/CVPreview";
import CoverLetterPreview from "../components/CoverLetterPreview";
import { downloadTailoredCV, downloadCoverLetter } from "../lib/pdf";
import { trackEvent } from "../lib/analytics";
import { useAuth } from "../context/AuthContext";
import { useAppLocale } from "../context/AppLocaleContext";
import { resolveDisplayStatus } from "../lib/applicationReview";
import {
  getApplicationDisplayStatuses,
  getTrackerEmptyCopy,
  getTrackerFilterTabs,
  getTrackerQuickFilters,
} from "../lib/appUi";

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

const fmtFullDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

const timelineFor = (application, t) => {
  const status = resolveDisplayStatus(application);
  const created = application.created_at;
  const items = [
    {
      key: "created",
      label: t("tracker.timelineCreated"),
      detail: fmtFullDate(created),
      tone: "done",
    },
  ];
  if (application.package_status && application.package_status !== "not_generated") {
    items.push({
      key: "package",
      label: t("tracker.timelinePackage"),
      detail: fmtFullDate(application.updated_at || created),
      tone: "done",
    });
  }
  const statusLabels = {
    submitted: t("tracker.timelineSubmitted"),
    action_required: t("tracker.timelineAnswersNeeded"),
    pending: t("tracker.timelinePending"),
    prepared: t("tracker.timelinePrepared"),
    blocked_captcha: t("tracker.timelineSecurity"),
    failed: t("tracker.timelineFailed"),
    expired: t("tracker.timelineExpired"),
  };
  items.push({
    key: status,
    label: statusLabels[status] || t("tracker.timelinePending"),
    detail: fmtFullDate(application.submitted_at || application.updated_at || created),
    tone: status === "submitted" || status === "prepared" ? "done" : status === "failed" || status === "expired" ? "error" : "current",
  });
  return items;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, lang } = useAppLocale();
  const activeTab = searchParams.get("tab") === "passed" ? "passed" : "applications";
  const { user } = useAuth();
  const displayStatuses = useMemo(() => getApplicationDisplayStatuses(t), [t]);
  const filters = useMemo(() => getTrackerFilterTabs(t), [t]);
  const quickFilters = useMemo(() => getTrackerQuickFilters(t), [t]);
  const [profile, setProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
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
      const { data } = await api.get("/swipes/history?direction=left&limit=100");
      setPassedRows(data.swipes || []);
    } catch {
      toast.error(t("history.loadError"));
    } finally {
      setPassedLoading(false);
    }
  };

  const applyPassedJob = async (jobId) => {
    setApplyingPassedId(jobId);
    try {
      await api.delete(`/swipes/${jobId}`);
      await api.post("/swipe", { job_id: jobId, direction: "right" });
      toast.success(t("history.packageGenerated"));
      await Promise.all([loadPassed(), load()]);
      setActiveTab("applications");
    } catch {
      toast.error(t("history.packageError"));
    } finally {
      setApplyingPassedId(null);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([api.get("/applications"), api.get("/profile")]);
      setApps(a.data.applications || []);
      setProfile(p.data || null);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    trackEvent("tracker_view");
    load();
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
      resume: selected.tailored_resume || {},
      job: selected.job,
      template: profile?.template_style || "modern",
    });
    toast.success(t("tracker.cvDownloaded"));
  };

  const handleDownloadCoverLetter = () => {
    if (!selected) return;
    downloadCoverLetter({
      contact: profile?.contact || {},
      letter: selected.cover_letter || {},
      job: selected.job,
      template: profile?.template_style || "modern",
    });
    toast.success(t("tracker.coverDownloaded"));
  };

  const openApplication = async (app) => {
    setSelected(app);
    setOpen(true);
    try {
      const { data } = await api.get(`/applications/${app.application_id}`);
      setSelected(data);
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
  const selectedTimeline = useMemo(
    () => (selected ? timelineFor(selected, t) : []),
    [selected, t],
  );
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
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600">
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

        <section className={activeTab === "applications" && showResumeBanner ? "mt-6 border-t border-zinc-100 pt-6 pb-8 md:mt-10 md:pt-8" : "pb-8 pt-3 md:pt-4"}>
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
            <div className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-5 py-8 text-center">
              <div className="shell-surface mx-auto grid h-12 w-12 place-items-center rounded-2xl text-zinc-600 dark:text-zinc-400">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <p className="shell-title font-display text-lg font-bold">{t("tracker.nothingYet")}</p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600">
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

          {pageLoading ? (
            <div className="mt-12 flex justify-center" data-testid="passed-loading">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : filteredPassed.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-5 py-8 text-center" data-testid="passed-empty">
              <div className="shell-surface mx-auto grid h-12 w-12 place-items-center rounded-2xl text-zinc-600 dark:text-zinc-400">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <p className="shell-title font-display text-lg font-bold">{t("tracker.nothingYet")}</p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600">
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
          className="sprout max-w-2xl max-h-[90dvh] overflow-y-auto p-0 bg-sprout-surface border-sprout-border text-zinc-900"
          data-testid="application-detail"
        >
          {selected && (
            <>
              <DialogHeader className="px-6 pt-6 pb-3 border-b border-sprout-border sticky top-0 bg-sprout-surface z-10">
                <div className="flex items-start gap-3">
                  <CompanyLogo company={selected.job?.company} size="sm" rounded="xl" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-sprout-mint">{selected.job?.company}</p>
                    <DialogTitle className="font-display text-2xl tracking-tight text-zinc-900">{selected.job?.title}</DialogTitle>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <ApplicationStatusPill application={selected} variant="dark" displayStatuses={displayStatuses} />
                  {selected.match_score && (<span className="text-xs font-semibold text-sprout-mint">{selected.match_score}% match</span>)}
                  {selected.job?.location && (
                    <span className="text-xs text-zinc-700 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{selected.job.location}</span>
                  )}
                </div>
              </DialogHeader>

              <div className="px-6 pb-6 pt-4">
                <div className="p-4 rounded-2xl bg-sprout-surface-2 border border-sprout-border mb-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">{t("tracker.nextAction")}</p>
                      <p className="mt-1 text-sm font-semibold text-zinc-900">{statusMeta(selected, displayStatuses).cta}</p>
                    </div>
                    <ApplicationStatusPill application={selected} variant="dark" displayStatuses={displayStatuses} />
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">
                    {applicationStatusMessage(selected.user_facing_submission_status || selected.submission_status, t)}
                  </p>
                  {(selected.submission_status === "ready" || selected.submission_status === "prepared") && (
                    <Button
                      disabled
                      className="mt-3 w-full rounded-full bg-sprout-mint text-white hover:opacity-90"
                      data-testid="submit-application-btn"
                    >
                      Ready to submit
                    </Button>
                  )}
                  {canShowInternalSubmitTest
                    && selected.job?.ats_provider === "greenhouse"
                    && (selected.submission_status === "ready" || selected.submission_status === "prepared") && (
                    <Button
                      onClick={testFinalSubmit}
                      disabled={submittingFinal}
                      variant="outline"
                      className="mt-2 w-full rounded-full border-amber-300/50 bg-amber-400/10 text-amber-800 hover:bg-amber-400/20"
                      data-testid="test-final-submit-btn"
                    >
                      {submittingFinal ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Test final submit
                    </Button>
                  )}
                  {selected.job?.ats_provider === "greenhouse" && ["ready", "prepared", "blocked", "action_required", "prepare_failed"].includes(selected.submission_status) && (
                    <Button
                      onClick={prepareGreenhouseAgain}
                      disabled={preparingAgain}
                      variant="outline"
                      className="mt-3 w-full rounded-full border-sprout-border text-zinc-900 hover:bg-sprout-surface-2"
                      data-testid="prepare-greenhouse-again-top-btn"
                    >
                      {preparingAgain ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Prepare again
                    </Button>
                  )}
                </div>

                <div className="mb-5 rounded-2xl border border-sprout-border bg-sprout-surface-2 p-4">
                  <p className="text-sm font-semibold text-zinc-900">{t("tracker.generatedDocs")}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { label: t("review.cv"), ready: Boolean(selected.tailored_resume) },
                      { label: t("review.coverLetter"), ready: Boolean(selected.cover_letter) },
                      { label: t("interviews.likelyQuestions"), ready: Boolean(selected.interview_prep?.length) },
                    ].map((doc) => (
                      <div key={doc.label} className="rounded-xl border border-sprout-border bg-sprout-surface px-3 py-2">
                        <p className="text-xs font-semibold text-zinc-900">{doc.label}</p>
                        <p className={`mt-1 text-[11px] font-semibold ${doc.ready ? "text-sprout-mint" : "text-zinc-700"}`}>
                          {doc.ready ? t("tracker.available") : t("tracker.pending")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-5 rounded-2xl border border-sprout-border bg-sprout-surface-2 p-4">
                  <p className="text-sm font-semibold text-zinc-900">{t("tracker.timeline")}</p>
                  <div className="mt-4 space-y-4">
                    {selectedTimeline.map((item, index) => {
                      const done = item.tone === "done";
                      const error = item.tone === "error";
                      return (
                        <div key={`${item.key}-${index}`} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`grid h-7 w-7 place-items-center rounded-full ${
                              done ? "bg-sprout-mint text-white" : error ? "bg-rose-500 text-white" : "bg-amber-400 text-zinc-900"
                            }`}>
                              {error ? <AlertCircle className="h-4 w-4" /> : done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                            </div>
                            {index < selectedTimeline.length - 1 ? <div className="h-7 w-px bg-sprout-border" /> : null}
                          </div>
                          <div className="min-w-0 pb-2">
                            <p className="text-sm font-semibold text-zinc-900">{item.label}</p>
                            {item.detail ? <p className="mt-0.5 text-xs text-zinc-700">{item.detail}</p> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {selected.submission_status === "blocked_captcha" && (
                  <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-400/30 mb-5" data-testid="captcha-required-state">
                    <p className="text-sm font-semibold text-orange-800">{t("tracker.securityCheck")}</p>
                    <p className="mt-1 text-sm text-zinc-700">
                      The application form needs an additional security check before it can be completed.
                    </p>
                  </div>
                )}

                {selected.submission_status === "prepare_failed" && (
                  <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-400/30 mb-5" data-testid="prepare-failed-state">
                    <p className="text-sm font-semibold text-rose-800">Preparation failed</p>
                    <p className="mt-1 text-sm text-zinc-700">
                      The CV and cover letter were generated, but the browser preparation step needs to be retried.
                    </p>
                  </div>
                )}

                {(selected.submission_status === "blocked" || selected.submission_status === "action_required") && (selected.prepared_missing_information || []).length > 0 && (
                  <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-400/30 mb-5" data-testid="missing-info-form">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-orange-800">{t("tracker.actionRequired")}</p>
                        <p className="mt-1 text-sm text-zinc-700">
                          A few answers are needed to complete this application. It will not be submitted automatically.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {missingFieldsForForm(selected.prepared_missing_information || [])
                        .map((item) => {
                          const options = item.options || [];
                          const value = missingAnswers[item.field_name] || "";
                          return (
                            <label key={`${item.field_name}-${item.reason}`} className="block text-zinc-900">
                              <span className="block text-xs font-semibold text-zinc-800 mb-1">{item.label || item.field_name}</span>
                              {options.length > 0 ? (
                                <select
                                  value={value}
                                  onChange={(e) => setMissingAnswers((prev) => ({ ...prev, [item.field_name]: e.target.value }))}
                                  className="w-full h-11 rounded-xl bg-sprout-surface border border-sprout-border px-3 text-sm text-zinc-900"
                                  data-testid={`missing-field-${item.field_name}`}
                                >
                                  <option value="">Select an answer</option>
                                  {options.map((opt) => (
                                    <option key={`${item.field_name}-${optionValue(opt)}`} value={optionValue(opt)}>
                                      {optionLabel(opt)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={value}
                                  onChange={(e) => setMissingAnswers((prev) => ({ ...prev, [item.field_name]: e.target.value }))}
                                  className="w-full h-11 rounded-xl bg-sprout-surface border border-sprout-border px-3 text-sm text-zinc-900 placeholder:text-zinc-600"
                                  placeholder="Enter answer"
                                  data-testid={`missing-field-${item.field_name}`}
                                />
                              )}
                              <span className="mt-1 block text-[11px] text-zinc-600">
                                {item.suggested_profile_key ? `Can be reused as ${item.suggested_profile_key.replaceAll("_", " ")}` : item.reason}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                    <label className="mt-4 flex items-start gap-3 rounded-xl border border-sprout-border bg-sprout-surface/70 p-3 text-sm text-zinc-800">
                      <input
                        type="checkbox"
                        checked={saveMissingToProfile}
                        onChange={(e) => setSaveMissingToProfile(e.target.checked)}
                        className="mt-1 h-4 w-4 accent-sprout-mint"
                        data-testid="save-missing-to-profile-checkbox"
                      />
                      <span>
                        <span className="block font-semibold text-zinc-900">Save these answers to my profile for future applications</span>
                        <span className="mt-0.5 block text-xs text-zinc-600">Use this for reusable legal or work-preference answers only.</span>
                      </span>
                    </label>
                    <Button
                      onClick={resolveMissingInfo}
                      disabled={savingMissing}
                      className="mt-4 w-full rounded-full bg-sprout-mint text-white hover:opacity-90"
                      data-testid="save-missing-info-btn"
                    >
                      {savingMissing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Save answers
                    </Button>
                    <Button
                      onClick={prepareGreenhouseAgain}
                      disabled={preparingAgain}
                      variant="outline"
                      className="mt-2 w-full rounded-full border-sprout-border text-zinc-900 hover:bg-sprout-surface-2"
                      data-testid="prepare-greenhouse-again-btn"
                    >
                      {preparingAgain ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Prepare again
                    </Button>
                  </div>
                )}

                {selected.match_reasons?.length > 0 && (
                  <div className="p-4 rounded-2xl bg-sprout-mint-soft border border-sprout-mint/30 mb-5">
                    <p className="text-[11px] font-bold text-sprout-mint uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> {t("tracker.whyFit")}
                    </p>
                    <ul className="space-y-1.5">
                      {selected.match_reasons.map((r, i) => (
                        <li key={i} className="text-sm text-zinc-800 leading-snug flex gap-2">
                          <span className="text-sprout-mint">→</span><span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Tabs defaultValue="cv">
                  <TabsList className="grid grid-cols-3 w-full bg-sprout-surface-2 border border-sprout-border">
                    <TabsTrigger value="cv" className="data-[state=active]:bg-white data-[state=active]:!text-zinc-900 text-zinc-700" data-testid="tab-tailored-cv">
                      <FileText className="w-3.5 h-3.5 mr-1" />CV
                    </TabsTrigger>
                    <TabsTrigger value="cover" className="data-[state=active]:bg-white data-[state=active]:!text-zinc-900 text-zinc-700" data-testid="tab-cover-letter">
                      <Mail className="w-3.5 h-3.5 mr-1" />Cover
                    </TabsTrigger>
                    <TabsTrigger value="prep" className="data-[state=active]:bg-white data-[state=active]:!text-zinc-900 text-zinc-700" data-testid="tab-interview-prep">
                      <MessageSquare className="w-3.5 h-3.5 mr-1" />Prep
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="cv" className="mt-4 space-y-3 [&_.text-sprout-muted]:!text-zinc-700 [&_.text-sprout-dim]:!text-zinc-600 [&_.text-zinc-200]:!text-zinc-800 [&_.text-zinc-300]:!text-zinc-700 [&_.text-zinc-400]:!text-zinc-700 [&_.text-zinc-500]:!text-zinc-700">
                    <CVPreview
                      contact={profile?.contact || {}}
                      resume={selected.tailored_resume || {}}
                      job={selected.job}
                      template={profile?.template_style || "modern"}
                    />
                    <Button onClick={handleDownloadCV} className="w-full rounded-full bg-sprout-mint text-white hover:opacity-90" data-testid="download-cv-pdf-btn">
                      <Download className="w-4 h-4 mr-1.5" /> Download PDF
                    </Button>
                  </TabsContent>

                  <TabsContent value="cover" className="mt-4 space-y-3 [&_.text-sprout-muted]:!text-zinc-700 [&_.text-sprout-dim]:!text-zinc-600 [&_.text-zinc-200]:!text-zinc-800 [&_.text-zinc-300]:!text-zinc-700 [&_.text-zinc-400]:!text-zinc-700 [&_.text-zinc-500]:!text-zinc-700">
                    <CoverLetterPreview contact={profile?.contact || {}} letter={selected.cover_letter || {}} job={selected.job} />
                    <Button onClick={handleDownloadCoverLetter} className="w-full rounded-full bg-sprout-mint text-white hover:opacity-90" data-testid="download-cover-pdf-btn">
                      <Download className="w-4 h-4 mr-1.5" /> Download PDF
                    </Button>
                  </TabsContent>

                  <TabsContent value="prep" className="mt-4">
                    {selected.interview_prep?.length > 0 ? (
                      <ul className="space-y-3" data-testid="interview-prep-list">
                        {selected.interview_prep.map((q, i) => (
                          <li key={i} className="p-4 rounded-2xl bg-sprout-surface-2 border border-sprout-border">
                            <p className="text-xs font-semibold text-zinc-700 mb-1">Likely question {i + 1}</p>
                            <p className="text-sm text-zinc-800">{q}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-zinc-700 text-center py-8">No prep questions generated yet.</p>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </AppPage>
  );
}
