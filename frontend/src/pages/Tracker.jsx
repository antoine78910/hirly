import { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import {
  Loader2, Sparkles, MapPin, Building2, FileText, Mail, Download, MessageSquare, Star,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { motion } from "framer-motion";
import CVPreview from "../components/CVPreview";
import CoverLetterPreview from "../components/CoverLetterPreview";
import { downloadTailoredCV, downloadCoverLetter } from "../lib/pdf";

const STATUSES = [
  { value: "applied",   label: "Generated", tint: "bg-sprout-mint-soft text-sprout-mint",  dot: "bg-sprout-mint" },
  { value: "viewed",    label: "Viewed",    tint: "bg-amber-500/15 text-amber-300",        dot: "bg-amber-400" },
  { value: "interview", label: "Interview", tint: "bg-emerald-500/15 text-emerald-300",    dot: "bg-emerald-400" },
  { value: "rejected",  label: "Rejected",  tint: "bg-rose-500/15 text-rose-300",          dot: "bg-rose-400" },
  { value: "offer",     label: "Offer",     tint: "bg-fuchsia-500/15 text-fuchsia-300",    dot: "bg-fuchsia-400" },
];

const SUBMISSION_STATUSES = {
  not_submitted: { label: "Not submitted yet", tint: "bg-zinc-500/15 text-zinc-300", dot: "bg-zinc-400" },
  ready: { label: "Ready to submit", tint: "bg-amber-500/15 text-amber-300", dot: "bg-amber-400" },
  submitted: { label: "Submitted", tint: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-400" },
  failed: { label: "Submission failed", tint: "bg-rose-500/15 text-rose-300", dot: "bg-rose-400" },
  blocked: { label: "Action required", tint: "bg-orange-500/15 text-orange-300", dot: "bg-orange-400" },
};

const StatusPill = ({ status }) => {
  const s = STATUSES.find((x) => x.value === status) || STATUSES[0];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.tint}`} data-testid={`status-pill-${status}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

const SubmissionPill = ({ status }) => {
  const s = SUBMISSION_STATUSES[status || "not_submitted"] || SUBMISSION_STATUSES.not_submitted;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.tint}`} data-testid={`submission-pill-${status || "not_submitted"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
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

export default function Tracker() {
  const [profile, setProfile] = useState(null);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [missingAnswers, setMissingAnswers] = useState({});
  const [savingMissing, setSavingMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([api.get("/applications"), api.get("/profile")]);
      setApps(a.data.applications || []);
      setProfile(p.data || null);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selected) return;
    const initial = {};
    missingFieldsForForm(selected.prepared_missing_information || []).forEach((item) => {
      if (item?.field_name) initial[item.field_name] = "";
    });
    setMissingAnswers(initial);
  }, [selected]);

  const changeStatus = async (id, status) => {
    try {
      await api.patch(`/applications/${id}/status`, { status });
      setApps((prev) => prev.map((a) => a.application_id === id ? { ...a, status } : a));
      toast.success("Status updated");
    } catch { toast.error("Failed to update"); }
  };

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
        save_to_profile: true,
      });
      const { data } = await api.get(`/applications/${selected.application_id}`);
      const updated = data;
      setSelected(updated);
      setApps((prev) => prev.map((a) => a.application_id === updated.application_id ? updated : a));
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

  const submitGreenhouseApplication = async () => {
    if (!selected?.job_id) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/applications/greenhouse/submit", { job_id: selected.job_id });
      if (data.dry_run) {
        toast.success("Dry run successful — application was not sent.");
      } else {
        toast.success("Application submitted");
      }
      await refreshApplication(selected.application_id);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail?.message || (typeof detail === "string" ? detail : "Submission failed"));
      try { await refreshApplication(selected.application_id); } catch {}
    } finally {
      setSubmitting(false);
    }
  };

  const positive = useMemo(() => apps.filter((a) => ["interview", "offer"].includes(a.status)).length, [apps]);
  const reviews = useMemo(() =>
    apps
      .filter((a) => a.match_score && a.match_reasons?.length)
      .slice(0, 8)
      .map((a) => ({
        application_id: a.application_id,
        company: a.job?.company,
        title: a.job?.title,
        score: a.match_score,
        reason: a.match_reasons[0],
        status: a.status,
      })),
  [apps]);

  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white pb-28">
      <header className="px-5 pt-6 max-w-md mx-auto">
        <h1 className="font-display font-black text-3xl tracking-tighter text-white">Activity</h1>
        <p className="text-sm text-sprout-muted mt-1">
          {apps.length} package{apps.length === 1 ? "" : "s"} generated · {positive} in motion
        </p>
      </header>

      {/* Stats bar */}
      {!loading && apps.length > 0 && (
        <div className="px-5 mt-4 max-w-md mx-auto grid grid-cols-3 gap-3">
          {[
            {
              label: "Applied",
              value: apps.length,
              color: "text-sprout-mint",
              bg: "bg-sprout-mint-soft",
            },
            {
              label: "Interviews",
              value: apps.filter((a) => a.status === "interview").length,
              color: "text-emerald-300",
              bg: "bg-emerald-500/10",
            },
            {
              label: "Offers",
              value: apps.filter((a) => a.status === "offer").length,
              color: "text-fuchsia-300",
              bg: "bg-fuchsia-500/10",
            },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-2xl border border-sprout-border bg-sprout-surface p-4 text-center`}
            >
              <p className={`font-display font-black text-3xl tracking-tighter ${s.color}`}>
                {s.value}
              </p>
              <p className="text-[11px] text-sprout-muted mt-1 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 mt-5 max-w-md mx-auto">
        <Tabs defaultValue="applications">
          <TabsList className="grid grid-cols-2 w-full bg-sprout-surface border border-sprout-border rounded-full h-10 p-1">
            <TabsTrigger
              value="applications"
              className="rounded-full data-[state=active]:bg-sprout-mint data-[state=active]:text-black text-sprout-muted font-semibold"
              data-testid="tab-applications"
            >
              Applications
            </TabsTrigger>
            <TabsTrigger
              value="reviews"
              className="rounded-full data-[state=active]:bg-sprout-mint data-[state=active]:text-black text-sprout-muted font-semibold"
              data-testid="tab-reviews"
            >
              Reviews
            </TabsTrigger>
          </TabsList>

          <TabsContent value="applications" className="mt-5">
            {loading ? (
              <div className="flex justify-center mt-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-muted" /></div>
            ) : apps.length === 0 ? (
              <div className="mt-16 text-center text-sprout-muted">
                <Sparkles className="w-7 h-7 mx-auto mb-2 text-sprout-dim" />
                <p>No generated application packages yet. Start swiping.</p>
              </div>
            ) : (
              <ul className="space-y-2.5" data-testid="applications-list">
                {apps.map((a, i) => (
                  <motion.li
                    key={a.application_id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="rounded-2xl border border-sprout-border bg-sprout-surface hover:border-sprout-border-2 transition-colors p-4 cursor-pointer"
                    onClick={() => openApplication(a)}
                    data-testid={`application-${a.application_id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-sprout-mint font-semibold">
                          <Building2 className="w-3.5 h-3.5" /> {a.job?.company || "—"}
                        </div>
                        <p className="font-display font-bold text-[17px] leading-tight truncate text-white mt-0.5">{a.job?.title || "Untitled"}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-sprout-muted">
                          <MapPin className="w-3 h-3" /> {a.job?.location || "—"}
                          {a.match_score && <span className="text-sprout-mint font-semibold">· {a.match_score}%</span>}
                          <span className="text-sprout-dim">· {fmtDate(a.created_at)}</span>
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                        <Select value={a.status} onValueChange={(v) => changeStatus(a.application_id, v)}>
                          <SelectTrigger
                            className="h-8 rounded-full text-[11px] bg-sprout-surface-2 border-sprout-border text-white px-3 w-[112px]"
                            data-testid={`status-select-${a.application_id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-sprout-surface border-sprout-border text-white">
                            {STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusPill status={a.status} />
                      <SubmissionPill status={a.submission_status} />
                    </div>
                  </motion.li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="mt-5">
            {loading ? (
              <div className="flex justify-center mt-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-muted" /></div>
            ) : reviews.length === 0 ? (
              <div className="mt-16 text-center text-sprout-muted">
                <Star className="w-7 h-7 mx-auto mb-2 text-sprout-dim" />
                <p>AI match reviews appear here after you swipe.</p>
              </div>
            ) : (
              <ul className="space-y-2.5" data-testid="reviews-list">
                {reviews.map((r, i) => (
                  <motion.li
                    key={r.application_id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="rounded-2xl border border-sprout-border bg-sprout-surface p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-xs text-sprout-mint font-semibold">{r.company}</p>
                        <p className="font-display font-bold text-white text-[15px] truncate">{r.title}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-sprout-mint-soft text-sprout-mint text-xs font-bold px-2.5 py-1">
                        <Sparkles className="w-3 h-3" /> {r.score}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-sprout-muted leading-relaxed">"{r.reason}"</p>
                  </motion.li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sprout max-w-2xl max-h-[90dvh] overflow-y-auto p-0 bg-sprout-surface border-sprout-border text-white"
          data-testid="application-detail"
        >
          {selected && (
            <>
              <DialogHeader className="px-6 pt-6 pb-3 border-b border-sprout-border sticky top-0 bg-sprout-surface z-10">
                <p className="text-xs font-semibold text-sprout-mint">{selected.job?.company}</p>
                <DialogTitle className="font-display text-2xl tracking-tight text-white">{selected.job?.title}</DialogTitle>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <StatusPill status={selected.status} />
                  <SubmissionPill status={selected.submission_status} />
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
                    {selected.submission_status === "submitted"
                      ? "Submitted"
                      : selected.submission_status === "ready"
                        ? "Ready to submit"
                        : selected.submission_status === "blocked"
                          ? "Not submitted yet. Submission is blocked until missing information is resolved."
                          : "Not submitted yet"}
                  </p>
                  {selected.submission_status === "ready" && (
                    <Button
                      onClick={submitGreenhouseApplication}
                      disabled={submitting}
                      className="mt-3 w-full rounded-full bg-sprout-mint hover:opacity-90 text-black"
                      data-testid="submit-application-btn"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Submit application
                    </Button>
                  )}
                </div>

                {selected.submission_status === "blocked" && (selected.prepared_missing_information || []).length > 0 && (
                  <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-400/30 mb-5" data-testid="missing-info-form">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-orange-200">Action required</p>
                        <p className="mt-1 text-sm text-sprout-muted">
                          Answer these required fields to make this application ready. It will not be submitted automatically.
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
                                    <option key={`${item.field_name}-${opt.value || opt.label}`} value={opt.value || opt.label}>
                                      {opt.label || opt.value}
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
                              <span className="mt-1 block text-[11px] text-sprout-dim">{item.reason}</span>
                            </label>
                          );
                        })}
                    </div>
                    <Button
                      onClick={resolveMissingInfo}
                      disabled={savingMissing}
                      className="mt-4 w-full rounded-full bg-sprout-mint hover:opacity-90 text-black"
                      data-testid="save-missing-info-btn"
                    >
                      {savingMissing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      Save answers
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

    </div>
  );
}
