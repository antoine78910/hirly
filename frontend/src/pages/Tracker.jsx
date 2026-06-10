import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  Loader2, MapPin, FileText, Mail, Download, MessageSquare, FileSearch, Sparkles,
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

const DISPLAY_STATUSES = {
  generated: {
    label: "Generated",
    tintLight: "bg-violet-50 text-violet-700 ring-1 ring-violet-200/80",
    tintDark: "bg-sprout-mint-soft text-sprout-mint",
    dotLight: "bg-violet-500",
    dotDark: "bg-sprout-mint",
  },
  ready: {
    label: "Ready to submit",
    tintLight: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
    tintDark: "bg-amber-500/15 text-amber-300",
    dotLight: "bg-amber-500",
    dotDark: "bg-amber-400",
  },
  prepared: {
    label: "Prepared",
    tintLight: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
    tintDark: "bg-amber-500/15 text-amber-300",
    dotLight: "bg-amber-500",
    dotDark: "bg-amber-400",
  },
  submitted: {
    label: "Submitted",
    tintLight: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
    tintDark: "bg-emerald-500/15 text-emerald-300",
    dotLight: "bg-emerald-500",
    dotDark: "bg-emerald-400",
  },
  viewed: {
    label: "Viewed",
    tintLight: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
    tintDark: "bg-amber-500/15 text-amber-300",
    dotLight: "bg-amber-500",
    dotDark: "bg-amber-400",
  },
  interview: {
    label: "Interview",
    tintLight: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
    tintDark: "bg-emerald-500/15 text-emerald-300",
    dotLight: "bg-emerald-500",
    dotDark: "bg-emerald-400",
  },
  offer: {
    label: "Offer",
    tintLight: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200/80",
    tintDark: "bg-fuchsia-500/15 text-fuchsia-300",
    dotLight: "bg-fuchsia-500",
    dotDark: "bg-fuchsia-400",
  },
  rejected: {
    label: "Rejected",
    tintLight: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80",
    tintDark: "bg-rose-500/15 text-rose-300",
    dotLight: "bg-rose-500",
    dotDark: "bg-rose-400",
  },
  action_required: {
    label: "Action required",
    tintLight: "bg-orange-50 text-orange-700 ring-1 ring-orange-200/80",
    tintDark: "bg-orange-500/15 text-orange-300",
    dotLight: "bg-orange-500",
    dotDark: "bg-orange-400",
  },
  blocked_captcha: {
    label: "CAPTCHA required",
    tintLight: "bg-orange-50 text-orange-700 ring-1 ring-orange-200/80",
    tintDark: "bg-orange-500/15 text-orange-300",
    dotLight: "bg-orange-500",
    dotDark: "bg-orange-400",
  },
  prepare_failed: {
    label: "Prepare failed",
    tintLight: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80",
    tintDark: "bg-rose-500/15 text-rose-300",
    dotLight: "bg-rose-500",
    dotDark: "bg-rose-400",
  },
  pending: {
    label: "Application pending",
    tintLight: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
    tintDark: "bg-amber-500/15 text-amber-300",
    dotLight: "bg-amber-500",
    dotDark: "bg-amber-400",
  },
  unknown: {
    label: "Status unknown",
    tintLight: "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200/80",
    tintDark: "bg-zinc-500/15 text-zinc-300",
    dotLight: "bg-zinc-500",
    dotDark: "bg-zinc-400",
  },
  failed: {
    label: "Submission failed",
    tintLight: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80",
    tintDark: "bg-rose-500/15 text-rose-300",
    dotLight: "bg-rose-500",
    dotDark: "bg-rose-400",
  },
};

/** One user-facing status: pipeline updates win, then submission state. */
const resolveDisplayStatus = ({ status, submission_status, user_facing_submission_status }) => {
  if (status === "offer") return "offer";
  if (status === "rejected") return "rejected";
  if (status === "interview") return "interview";
  if (status === "viewed") return "viewed";
  if (user_facing_submission_status === "pending") return "pending";
  if (user_facing_submission_status === "submitted") return "submitted";
  if (submission_status === "blocked" || submission_status === "action_required") return "action_required";
  if (submission_status === "blocked_captcha") return "blocked_captcha";
  if (submission_status === "prepare_failed") return "prepare_failed";
  if (submission_status === "failed") return "failed";
  if (submission_status === "ready") return "ready";
  if (submission_status === "prepared") return "prepared";
  if (submission_status === "submitted") return "submitted";
  if (submission_status === "unknown") return "unknown";
  return "generated";
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

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    return "Human verification is required before this application can be completed.";
  }
  if (status === "prepare_failed") {
    return "Application package generated, but browser preparation failed.";
  }
  if (status === "failed") return "Submission failed.";
  if (status === "unknown") return "Submission status is unknown. Review before continuing.";
  return "Not submitted yet";
};

export default function Tracker() {
  const [profile, setProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [missingAnswers, setMissingAnswers] = useState({});
  const [saveMissingToProfile, setSaveMissingToProfile] = useState(false);
  const [savingMissing, setSavingMissing] = useState(false);
  const [preparingAgain, setPreparingAgain] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);

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

  const hasResume = Boolean(profile?.cv_text);

  return (
    <AppPage className="bg-white text-zinc-900">
      <BrandHeader />

      <AppPageScroll>
        <div className="mx-auto max-w-md px-safe sm:px-5">
        {!hasResume ? (
          <section className="py-8 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border-2 border-linkedin/30 bg-violet-50">
              <FileSearch className="h-10 w-10 text-linkedin" strokeWidth={1.5} />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold tracking-tight">Add Your Resume</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-500">
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

        <section className={hasResume ? "pt-4" : "mt-10 border-t border-zinc-100 pt-8"}>
          <h3 className="font-display text-lg font-bold">Your recent applications</h3>
          {loading ? (
            <div className="mt-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : apps.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">No results found.</p>
          ) : (
            <ul className="mt-4 divide-y divide-zinc-100" data-testid="applications-list">
              {apps.map((a) => (
                <motion.li
                  key={a.application_id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="cursor-pointer py-4 first:pt-2"
                  onClick={() => openApplication(a)}
                  data-testid={`application-${a.application_id}`}
                >
                  <div className="flex items-start gap-2.5 sm:gap-3">
                    <CompanyLogo company={a.job?.company} size="sm" rounded="xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-linkedin">{a.job?.company || "—"}</p>
                        <ApplicationStatusPill application={a} />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-semibold text-zinc-900 sm:text-base">
                        {a.job?.title || "Untitled"}
                      </p>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {a.job?.location || "—"} · {fmtDate(a.created_at)}
                      </p>
                    </div>
                  </div>
                </motion.li>
              ))}
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
          className="sprout max-w-2xl max-h-[90dvh] overflow-y-auto p-0 bg-sprout-surface border-sprout-border text-white"
          data-testid="application-detail"
        >
          {selected && (
            <>
              <DialogHeader className="px-6 pt-6 pb-3 border-b border-sprout-border sticky top-0 bg-sprout-surface z-10">
                <div className="flex items-start gap-3">
                  <CompanyLogo company={selected.job?.company} size="sm" rounded="xl" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-sprout-mint">{selected.job?.company}</p>
                    <DialogTitle className="font-display text-2xl tracking-tight text-white">{selected.job?.title}</DialogTitle>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <ApplicationStatusPill application={selected} variant="dark" />
                  {selected.match_score && (<span className="text-xs font-semibold text-sprout-mint">{selected.match_score}% match</span>)}
                  {selected.job?.location && (
                    <span className="text-xs text-sprout-muted inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{selected.job.location}</span>
                  )}
                </div>
              </DialogHeader>

              <div className="px-6 pb-6 pt-4">
                <div className="p-4 rounded-2xl bg-sprout-surface-2 border border-sprout-border mb-5">
                  <p className="text-sm font-semibold text-white">Application package generated</p>
                  <p className="mt-1 text-sm text-sprout-muted">
                    {applicationStatusMessage(selected.user_facing_submission_status || selected.submission_status)}
                  </p>
                  {(selected.submission_status === "ready" || selected.submission_status === "prepared") && (
                    <Button
                      disabled
                      className="mt-3 w-full rounded-full bg-sprout-mint hover:opacity-90 text-black"
                      data-testid="submit-application-btn"
                    >
                      Ready to submit
                    </Button>
                  )}
                  {selected.job?.ats_provider === "greenhouse" && ["ready", "prepared", "blocked", "action_required", "prepare_failed"].includes(selected.submission_status) && (
                    <Button
                      onClick={prepareGreenhouseAgain}
                      disabled={preparingAgain}
                      variant="outline"
                      className="mt-3 w-full rounded-full border-sprout-border text-white hover:bg-sprout-surface-2"
                      data-testid="prepare-greenhouse-again-top-btn"
                    >
                      {preparingAgain ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Prepare again
                    </Button>
                  )}
                </div>

                {selected.submission_status === "blocked_captcha" && (
                  <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-400/30 mb-5" data-testid="captcha-required-state">
                    <p className="text-sm font-semibold text-orange-200">Human verification required</p>
                    <p className="mt-1 text-sm text-sprout-muted">
                      The application form needs an additional security check before it can be completed.
                    </p>
                  </div>
                )}

                {selected.submission_status === "prepare_failed" && (
                  <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-400/30 mb-5" data-testid="prepare-failed-state">
                    <p className="text-sm font-semibold text-rose-200">Preparation failed</p>
                    <p className="mt-1 text-sm text-sprout-muted">
                      The CV and cover letter were generated, but the browser preparation step needs to be retried.
                    </p>
                  </div>
                )}

                {(selected.submission_status === "blocked" || selected.submission_status === "action_required") && (selected.prepared_missing_information || []).length > 0 && (
                  <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-400/30 mb-5" data-testid="missing-info-form">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-orange-200">Action required</p>
                        <p className="mt-1 text-sm text-sprout-muted">
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
                            <label key={`${item.field_name}-${item.reason}`} className="block">
                              <span className="block text-xs font-semibold text-zinc-200 mb-1">{item.label || item.field_name}</span>
                              {options.length > 0 ? (
                                <select
                                  value={value}
                                  onChange={(e) => setMissingAnswers((prev) => ({ ...prev, [item.field_name]: e.target.value }))}
                                  className="w-full h-11 rounded-xl bg-sprout-surface border border-sprout-border px-3 text-sm text-white"
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
                                  className="w-full h-11 rounded-xl bg-sprout-surface border border-sprout-border px-3 text-sm text-white placeholder:text-sprout-dim"
                                  placeholder="Enter answer"
                                  data-testid={`missing-field-${item.field_name}`}
                                />
                              )}
                              <span className="mt-1 block text-[11px] text-sprout-dim">
                                {item.suggested_profile_key ? `Can be reused as ${item.suggested_profile_key.replaceAll("_", " ")}` : item.reason}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                    <label className="mt-4 flex items-start gap-3 rounded-xl border border-sprout-border bg-sprout-surface/70 p-3 text-sm text-zinc-200">
                      <input
                        type="checkbox"
                        checked={saveMissingToProfile}
                        onChange={(e) => setSaveMissingToProfile(e.target.checked)}
                        className="mt-1 h-4 w-4 accent-sprout-mint"
                        data-testid="save-missing-to-profile-checkbox"
                      />
                      <span>
                        <span className="block font-semibold text-white">Save these answers to my profile for future applications</span>
                        <span className="mt-0.5 block text-xs text-sprout-muted">Use this for reusable legal or work-preference answers only.</span>
                      </span>
                    </label>
                    <Button
                      onClick={resolveMissingInfo}
                      disabled={savingMissing}
                      className="mt-4 w-full rounded-full bg-sprout-mint hover:opacity-90 text-black"
                      data-testid="save-missing-info-btn"
                    >
                      {savingMissing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Save answers
                    </Button>
                    <Button
                      onClick={prepareGreenhouseAgain}
                      disabled={preparingAgain}
                      variant="outline"
                      className="mt-2 w-full rounded-full border-sprout-border text-white hover:bg-sprout-surface-2"
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
                        <li key={i} className="text-sm text-zinc-200 leading-snug flex gap-2">
                          <span className="text-sprout-mint">→</span><span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Tabs defaultValue="cv">
                  <TabsList className="grid grid-cols-3 w-full bg-sprout-surface-2 border border-sprout-border">
                    <TabsTrigger value="cv" className="data-[state=active]:bg-sprout-mint data-[state=active]:text-black text-sprout-muted" data-testid="tab-tailored-cv">
                      <FileText className="w-3.5 h-3.5 mr-1" />CV
                    </TabsTrigger>
                    <TabsTrigger value="cover" className="data-[state=active]:bg-sprout-mint data-[state=active]:text-black text-sprout-muted" data-testid="tab-cover-letter">
                      <Mail className="w-3.5 h-3.5 mr-1" />Cover
                    </TabsTrigger>
                    <TabsTrigger value="prep" className="data-[state=active]:bg-sprout-mint data-[state=active]:text-black text-sprout-muted" data-testid="tab-interview-prep">
                      <MessageSquare className="w-3.5 h-3.5 mr-1" />Prep
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="cv" className="mt-4 space-y-3">
                    <CVPreview
                      contact={profile?.contact || {}}
                      resume={selected.tailored_resume || {}}
                      job={selected.job}
                      template={profile?.template_style || "modern"}
                    />
                    <Button onClick={handleDownloadCV} className="w-full rounded-full bg-sprout-mint hover:opacity-90 text-black" data-testid="download-cv-pdf-btn">
                      <Download className="w-4 h-4 mr-1.5" /> Download PDF
                    </Button>
                  </TabsContent>

                  <TabsContent value="cover" className="mt-4 space-y-3">
                    <CoverLetterPreview contact={profile?.contact || {}} letter={selected.cover_letter || {}} job={selected.job} />
                    <Button onClick={handleDownloadCoverLetter} className="w-full rounded-full bg-sprout-mint hover:opacity-90 text-black" data-testid="download-cover-pdf-btn">
                      <Download className="w-4 h-4 mr-1.5" /> Download PDF
                    </Button>
                  </TabsContent>

                  <TabsContent value="prep" className="mt-4">
                    {selected.interview_prep?.length > 0 ? (
                      <ul className="space-y-3" data-testid="interview-prep-list">
                        {selected.interview_prep.map((q, i) => (
                          <li key={i} className="p-4 rounded-2xl bg-sprout-surface-2 border border-sprout-border">
                            <p className="text-xs font-semibold text-sprout-muted mb-1">Likely question {i + 1}</p>
                            <p className="text-sm text-zinc-200">{q}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-sprout-muted text-center py-8">No prep questions generated yet.</p>
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
