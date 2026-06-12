import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  Loader2, MapPin, FileText, Mail, Download, MessageSquare, FileSearch, Sparkles,
  Search, CheckCircle2, Clock3, AlertCircle, ArrowRight, BriefcaseBusiness,
} from "lucide-react";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
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

const DISPLAY_STATUSES = {
  prepared: {
    label: "Prepared",
    stripLabel: "Ready",
    cta: "Ready",
    tintLight: "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80",
    tintDark: "bg-blue-100 text-blue-800 ring-1 ring-blue-200",
    strip: "bg-blue-50 text-blue-900",
    dotLight: "bg-blue-500",
    dotDark: "bg-blue-300",
  },
  submitted: {
    label: "Submitted",
    stripLabel: "Submitted",
    cta: "Applied",
    tintLight: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80",
    tintDark: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    strip: "bg-emerald-50 text-emerald-900",
    dotLight: "bg-emerald-500",
    dotDark: "bg-emerald-400",
  },
  action_required: {
    label: "Action required",
    stripLabel: "Action required",
    cta: "Answer questions",
    tintLight: "bg-orange-50 text-orange-900 ring-1 ring-orange-200/80",
    tintDark: "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
    strip: "bg-orange-50 text-orange-900",
    dotLight: "bg-orange-500",
    dotDark: "bg-orange-400",
  },
  blocked_captcha: {
    label: "Security check needed",
    stripLabel: "Security check needed",
    cta: "View issue",
    tintLight: "bg-orange-50 text-orange-900 ring-1 ring-orange-200/80",
    tintDark: "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
    strip: "bg-orange-50 text-orange-900",
    dotLight: "bg-orange-500",
    dotDark: "bg-orange-400",
  },
  pending: {
    label: "Application pending",
    stripLabel: "Pending",
    cta: "Finalizing",
    tintLight: "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
    tintDark: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    strip: "bg-amber-50 text-amber-900",
    dotLight: "bg-amber-500",
    dotDark: "bg-amber-400",
  },
  failed: {
    label: "Needs attention",
    stripLabel: "Needs attention",
    cta: "View issue",
    tintLight: "bg-rose-50 text-rose-900 ring-1 ring-rose-200/80",
    tintDark: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
    strip: "bg-rose-50 text-rose-900",
    dotLight: "bg-rose-500",
    dotDark: "bg-rose-400",
  },
  expired: {
    label: "Expired",
    stripLabel: "Expired",
    cta: "Expired",
    tintLight: "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200/80",
    tintDark: "bg-zinc-100 text-zinc-800 ring-1 ring-zinc-200",
    strip: "bg-zinc-50 text-zinc-700",
    dotLight: "bg-zinc-500",
    dotDark: "bg-zinc-400",
  },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "action_required", label: "Action required" },
  { key: "pending", label: "Pending" },
  { key: "submitted", label: "Submitted" },
  { key: "prepared", label: "Prepared" },
  { key: "failed", label: "Failed" },
  { key: "expired", label: "Expired" },
];

/** User-facing status only. Backend status persistence remains unchanged. */
const resolveDisplayStatus = ({ status, submission_status, user_facing_submission_status, manual_status, admin_status }) => {
  const values = [
    user_facing_submission_status,
    manual_status,
    admin_status,
    submission_status,
    status,
  ].filter(Boolean);
  if (values.some((v) => ["submitted", "manually_submitted"].includes(v))) return "submitted";
  if (values.some((v) => ["action_required", "needs_user_input"].includes(v))) return "action_required";
  if (values.some((v) => ["pending", "manual_review_needed", "manual_in_progress"].includes(v))) return "pending";
  if (values.some((v) => ["ready", "prepared"].includes(v))) return "prepared";
  if (values.includes("blocked_captcha")) return "blocked_captcha";
  if (values.some((v) => ["prepare_failed", "blocked", "failed"].includes(v))) return "failed";
  if (values.includes("expired")) return "expired";
  if (user_facing_submission_status === "pending") return "pending";
  return "pending";
};

const ApplicationStatusPill = ({ application, variant = "light" }) => {
  const key = resolveDisplayStatus(application);
  const s = DISPLAY_STATUSES[key] || DISPLAY_STATUSES.generated;
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

const statusMeta = (application) => DISPLAY_STATUSES[resolveDisplayStatus(application)] || DISPLAY_STATUSES.pending;

const isApplicationPrepared = (application) => {
  const status = resolveDisplayStatus(application);
  return ["prepared", "pending", "action_required", "blocked_captcha", "submitted", "failed"].includes(status)
    || ["ready", "prepared"].includes(application.submission_status)
    || (application.package_status && application.package_status !== "not_generated");
};

const applicationProgress = (application) => {
  const status = resolveDisplayStatus(application);
  const prepared = isApplicationPrepared(application);
  return [
    { key: "generated", label: "Generated", state: "done" },
    { key: "prepared", label: "Prepared", state: prepared ? "done" : "todo" },
    {
      key: "pending",
      label: "Pending",
      state: status === "submitted" ? "done" : ["pending", "action_required", "blocked_captcha", "failed"].includes(status) ? "current" : "todo",
    },
    {
      key: "submitted",
      label: "Submitted",
      state: status === "submitted" ? "done" : status === "failed" || status === "expired" ? "blocked" : "todo",
    },
  ];
};

const atsLabel = (application) => {
  const provider = application.job?.ats_provider || application.ats_provider || application.job?.source;
  if (!provider) return "ATS unknown";
  return String(provider).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const workModeLabel = (application) => {
  const job = application.job || {};
  const raw = job.work_location || job.work_mode || job.workplace_type || job.location_type;
  if (raw) return String(raw).replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  if (job.remote === true || String(job.remote || "").toLowerCase() === "true") return "Remote";
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

const relativeDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 wk ago";
  return `${Math.floor(days / 7)} wks ago`;
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

const emptyCopy = (filter) => ({
  all: "No applications yet. Swipe right on jobs to start tracking them here.",
  action_required: "No applications need answers right now.",
  pending: "No pending applications right now.",
  submitted: "No submitted applications yet.",
  prepared: "No prepared applications right now.",
  failed: "No failed applications right now.",
  expired: "No expired applications.",
}[filter] || "No applications found.");

const timelineFor = (application) => {
  const status = resolveDisplayStatus(application);
  const created = application.created_at;
  const items = [
    {
      key: "created",
      label: "Application created",
      detail: fmtFullDate(created),
      tone: "done",
    },
  ];
  if (application.package_status && application.package_status !== "not_generated") {
    items.push({
      key: "package",
      label: "Tailored package generated",
      detail: fmtFullDate(application.updated_at || created),
      tone: "done",
    });
  }
  const statusLabels = {
    submitted: "Application submitted",
    action_required: "Answers needed",
    pending: "Application pending",
    prepared: "Application prepared",
    blocked_captcha: "Security check needed",
    failed: "Needs attention",
    expired: "Application expired",
  };
  items.push({
    key: status,
    label: statusLabels[status] || "Application pending",
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

const applicationStatusMessage = (status) => {
  if (status === "submitted") return "Submitted";
  if (status === "pending") return "We're finalizing your application.";
  if (status === "ready" || status === "prepared") {
    return "Application prepared. Final submission is not enabled yet.";
  }
  if (status === "blocked" || status === "action_required") {
    return "A few answers are needed before this application can be prepared.";
  }
  if (status === "blocked_captcha") {
    return "An additional security check is required before this application can be completed.";
  }
  if (status === "prepare_failed") {
    return "Application package generated, but browser preparation failed.";
  }
  if (status === "failed") return "Submission failed.";
  if (status === "unknown") return "Submission status is unknown. Review before continuing.";
  return "Not submitted yet";
};

export default function Tracker() {
  const { user } = useAuth();
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
    toast.success("CV downloaded");
  };

  const handleDownloadCoverLetter = () => {
    if (!selected) return;
    downloadCoverLetter({
      contact: profile?.contact || {},
      letter: selected.cover_letter || {},
      job: selected.job,
      template: profile?.template_style || "modern",
    });
    toast.success("Cover letter downloaded");
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
    FILTERS.forEach((filter) => {
      if (filter.key !== "all") counts[filter.key] = 0;
    });
    apps.forEach((app) => {
      const status = resolveDisplayStatus(app);
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [apps]);

  const filteredApps = useMemo(() => (
    apps.filter((app) => {
      const status = resolveDisplayStatus(app);
      const statusMatch = statusFilter === "all" || status === statusFilter;
      return statusMatch && matchesSearch(app, searchQuery);
    })
  ), [apps, statusFilter, searchQuery]);
  const selectedTimeline = useMemo(() => selected ? timelineFor(selected) : [], [selected]);
  const hasActiveListFilters = statusFilter !== "all" || searchQuery.trim();
  const userEmail = (user?.email || "").trim().toLowerCase();
  const canShowInternalSubmitTest = internalSubmitTestEnabled && userEmail && internalSubmitEmails.has(userEmail);

  return (
    <AppPage className="bg-white text-zinc-900">
      <BrandHeader />

      <AppPageScroll>
        <div className="mx-auto max-w-md px-safe sm:px-5">
        {showResumeBanner ? (
          <section className="py-8 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border-2 border-linkedin/30 bg-violet-50">
              <FileSearch className="h-10 w-10 text-linkedin" strokeWidth={1.5} />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold tracking-tight">Add Your Resume</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600">
              Upload your main resume to activate job applications and track your progress.
            </p>
            <button
              type="button"
              onClick={() => setResumeOpen(true)}
              className="mt-8 w-full rounded-full gradient-linkedin py-3.5 text-base font-semibold text-white hover:opacity-90"
              data-testid="applications-upload-resume"
            >
              Upload Resume
            </button>
          </section>
        ) : null}

        <section className={showResumeBanner ? "mt-10 border-t border-zinc-100 pt-8 pb-8" : "pt-4 pb-8"}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-700">Applications</p>
            <h3 className="font-display text-2xl font-bold tracking-tight">Your applications</h3>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <h4 className="font-display text-lg font-bold tracking-tight">Summary</h4>
            {hasActiveListFilters ? (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("all");
                  setSearchQuery("");
                }}
                className="text-sm font-semibold text-linkedin"
              >
                Clear
              </button>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {[
              { label: "Total applications", value: summary.total, Icon: BriefcaseBusiness, tone: "border-zinc-200 bg-white text-zinc-900", sub: `${summary.submitted} submitted` },
              { label: "Success rate", value: `${summary.successRate}%`, Icon: CheckCircle2, tone: "border-emerald-100 bg-emerald-50 text-emerald-800", sub: "submitted / total" },
              { label: "Pending", value: summary.pending, Icon: Clock3, tone: "border-amber-100 bg-amber-50 text-amber-800", sub: "being finalized" },
              { label: "Action required", value: summary.actionRequired, Icon: AlertCircle, tone: "border-orange-100 bg-orange-50 text-orange-800", sub: `${summary.attention} need attention` },
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
            {FILTERS.map((item) => {
              const active = statusFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                    active ? "border-linkedin bg-linkedin text-white" : "border-zinc-200 bg-white text-zinc-600"
                  }`}
                >
                  {item.label}
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                    active ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-700"
                  }`}>
                    {filterCounts[item.key] || 0}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="mt-3 flex h-11 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 shadow-sm">
            <Search className="h-4 w-4 text-zinc-700" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search company, job, or location"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-600"
              data-testid="applications-search"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs font-semibold text-zinc-700"
              >
                Clear
              </button>
            ) : null}
          </label>

          {loading ? (
            <div className="mt-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-5 py-8 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-zinc-600 shadow-sm">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <p className="font-display text-lg font-bold text-zinc-900">Nothing here yet</p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600">
                {searchQuery.trim() ? "No applications match your search." : emptyCopy(statusFilter)}
              </p>
              <button
                type="button"
                onClick={() => { window.location.href = "/swipe"; }}
                className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-full bg-linkedin px-4 py-2 text-sm font-semibold text-white"
              >
                Back to swipe <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <ul className="mt-4 space-y-3" data-testid="applications-list">
              {filteredApps.map((a) => {
                const meta = statusMeta(a);
                const progress = applicationProgress(a);
                const workMode = workModeLabel(a);
                return (
                  <motion.li
                    key={a.application_id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="cursor-pointer overflow-hidden rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
                    onClick={() => openApplication(a)}
                    data-testid={`application-${a.application_id}`}
                  >
                    <div className={`flex items-center justify-between rounded-2xl px-3 py-2 text-xs font-bold ${meta.strip}`}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${meta.dotLight}`} />
                        {meta.stripLabel}
                      </span>
                      <span className="font-semibold">{relativeDate(a.submitted_at || a.updated_at || a.created_at)}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {progress.map((step) => (
                        <div key={step.key} className="min-w-0">
                          <div className={`h-1.5 rounded-full ${
                            step.state === "done" ? "bg-emerald-400" : step.state === "current" ? "bg-amber-400" : step.state === "blocked" ? "bg-rose-400" : "bg-zinc-200"
                          }`} />
                          <p className={`mt-1 truncate text-[10px] font-semibold ${
                            step.state === "todo" ? "text-zinc-600" : "text-zinc-800"
                          }`}>
                            {step.label}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex items-start gap-3">
                      <CompanyLogo company={a.job?.company} size="md" rounded="xl" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-base font-bold leading-tight text-zinc-900">
                          {a.job?.title || "Untitled role"}
                        </p>
                        <p className="mt-1 truncate text-sm text-zinc-600">{a.job?.company || "Unknown company"}</p>
                        <p className="mt-2 flex items-center gap-1 truncate text-xs text-zinc-600">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {a.job?.location || "Location not listed"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700">
                            {atsLabel(a)}
                          </span>
                          {workMode ? (
                            <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700">
                              {workMode}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700">
                            Updated {fmtDate(a.updated_at || a.created_at) || "recently"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
                      <p className="text-xs text-zinc-600">Applied {fmtDate(a.created_at) || "recently"}</p>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openApplication(a);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${meta.tintLight}`}
                      >
                        {meta.cta}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </ul>
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
                  <ApplicationStatusPill application={selected} variant="dark" />
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
                      <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">Next action</p>
                      <p className="mt-1 text-sm font-semibold text-zinc-900">{statusMeta(selected).cta}</p>
                    </div>
                    <ApplicationStatusPill application={selected} variant="dark" />
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">
                    {applicationStatusMessage(selected.user_facing_submission_status || selected.submission_status)}
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
                  <p className="text-sm font-semibold text-zinc-900">Generated documents</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { label: "CV", ready: Boolean(selected.tailored_resume) },
                      { label: "Cover", ready: Boolean(selected.cover_letter) },
                      { label: "Prep", ready: Boolean(selected.interview_prep?.length) },
                    ].map((doc) => (
                      <div key={doc.label} className="rounded-xl border border-sprout-border bg-sprout-surface px-3 py-2">
                        <p className="text-xs font-semibold text-zinc-900">{doc.label}</p>
                        <p className={`mt-1 text-[11px] font-semibold ${doc.ready ? "text-sprout-mint" : "text-zinc-700"}`}>
                          {doc.ready ? "Available" : "Pending"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-5 rounded-2xl border border-sprout-border bg-sprout-surface-2 p-4">
                  <p className="text-sm font-semibold text-zinc-900">Timeline</p>
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
                    <p className="text-sm font-semibold text-orange-800">Security check needed</p>
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
                        <p className="text-sm font-semibold text-orange-800">Action required</p>
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
                      <Sparkles className="w-3.5 h-3.5" /> Why you fit
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
