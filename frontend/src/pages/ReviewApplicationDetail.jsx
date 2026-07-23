import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronRight, FileText, Loader2, Mail, MapPin } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAiSettings } from "../hooks/useAiSettings";
import { useAppLocale } from "../context/AppLocaleContext";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import CompanyLogo from "../components/CompanyLogo";
import CVPreview from "../components/CVPreview";
import CoverLetterPreview from "../components/CoverLetterPreview";
import ResumeCurrentPreview from "../components/profile/ResumeCurrentPreview";
import {
  getApplicationCoverLetter,
  getApplicationResume,
  hasApplicationCoverLetter,
  hasApplicationResume,
} from "../lib/applicationDocuments";
import { cvPhotoDataUrl, resolveCvDisplayTemplate, withContactPhoto } from "../lib/cvTemplate";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

const DOC_TYPES = new Set(["cv", "cover"]);

function coverLetterBodyText(letter) {
  return [letter?.greeting, ...(letter?.paragraphs || []), letter?.sign_off, letter?.signature_name]
    .filter(Boolean)
    .join("\n\n");
}

function DocumentPreviewCard({ title, description, icon: Icon, children, onOpen, testId }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="shell-surface group flex w-full flex-col overflow-hidden rounded-3xl text-left transition-transform hover:border-violet-200 hover:shadow-md active:scale-[0.99] dark:hover:border-violet-500/40"
      data-testid={testId}
    >
      <div className="relative h-52 overflow-hidden bg-zinc-50 sm:h-60">
        <div className="pointer-events-none absolute inset-0 origin-top scale-[0.72] sm:scale-[0.78]">
          {children}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-white/30 to-white dark:from-zinc-950/10 dark:via-zinc-950/30 dark:to-zinc-950" />
      </div>
      <div className="flex items-center gap-3 border-t shell-border px-4 py-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-400">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold shell-title">{title}</p>
          <p className="mt-0.5 text-sm shell-body">{description}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-sprout-dim transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

export default function ReviewApplicationDetail() {
  const { applicationId, docType } = useParams();
  const navigate = useNavigate();
  const { t } = useAppLocale();
  const { settings } = useAiSettings();
  const reviewEnabled = settings.reviewDocuments;

  const [application, setApplication] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cvSourceSaving, setCvSourceSaving] = useState(false);
  const [editingCoverLetter, setEditingCoverLetter] = useState(false);
  const [coverLetterDraft, setCoverLetterDraft] = useState("");
  const [savingCoverLetter, setSavingCoverLetter] = useState(false);
  const [editingCv, setEditingCv] = useState(false);
  const [cvExperienceDraft, setCvExperienceDraft] = useState([]);
  const [cvEducationDraft, setCvEducationDraft] = useState([]);
  const [cvLanguagesDraft, setCvLanguagesDraft] = useState("");
  const [savingCv, setSavingCv] = useState(false);

  const isReader = DOC_TYPES.has(docType);
  const hasCv = hasApplicationResume(application);
  const hasCover = hasApplicationCoverLetter(application);

  const load = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      const [{ data: appData }, profileRes] = await Promise.all([
        api.get(`/applications/${applicationId}`),
        api.get("/profile").catch(() => ({ data: null })),
      ]);
      setApplication(appData);
      setProfile(profileRes?.data || null);
    } catch (_) {
      toast.error(t("review.openError"));
      navigate("/review", { replace: true });
    } finally {
      setLoading(false);
    }
  }, [applicationId, navigate, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!reviewEnabled) return;
    if (docType && !DOC_TYPES.has(docType)) {
      navigate(`/review/${applicationId}`, { replace: true });
    }
  }, [applicationId, docType, navigate, reviewEnabled]);

  const contact = useMemo(
    () => withContactPhoto(profile?.contact || {}, cvPhotoDataUrl(profile)),
    [profile],
  );

  const resume = getApplicationResume(application);
  const coverLetter = getApplicationCoverLetter(application);
  const template = resolveCvDisplayTemplate(
    resume?.template_recommendation || profile?.template_style,
  );
  const job = application?.job;
  const cvSource = application?.cv_source || "tailored";
  const hasOriginalCv = Boolean(profile?.cv_filename);

  const changeCvSource = async (source) => {
    if (!application?.application_id || source === cvSource || cvSourceSaving) return;
    setCvSourceSaving(true);
    try {
      const { data } = await api.post(`/applications/${application.application_id}/cv-source`, {
        source,
      });
      setApplication(data);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(
        detail?.message || (typeof detail === "string" ? detail : t("review.cvSourceUpdateError")),
      );
    } finally {
      setCvSourceSaving(false);
    }
  };

  const startEditCoverLetter = () => {
    setCoverLetterDraft(coverLetterBodyText(coverLetter));
    setEditingCoverLetter(true);
  };

  const saveCoverLetter = async () => {
    if (!application?.application_id) return;
    setSavingCoverLetter(true);
    try {
      const { data } = await api.patch(`/applications/${application.application_id}/cover-letter`, {
        body_text: coverLetterDraft,
      });
      setApplication(data);
      setEditingCoverLetter(false);
      toast.success(t("review.coverLetterSaved"));
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(
        detail?.message || (typeof detail === "string" ? detail : t("review.coverLetterSaveError")),
      );
    } finally {
      setSavingCoverLetter(false);
    }
  };

  const startEditCv = () => {
    setCvExperienceDraft(
      (resume.experience || []).map((entry) => ({
        role: entry.role || "",
        company: entry.company || "",
        location: entry.location || "",
        duration: entry.duration || "",
        highlightsText: (entry.highlights || []).join("\n"),
      })),
    );
    setCvEducationDraft(
      (resume.education || []).map((entry) => ({
        degree: entry.degree || "",
        school: entry.school || "",
        year: entry.year || "",
      })),
    );
    setCvLanguagesDraft((resume.languages || []).join("\n"));
    setEditingCv(true);
  };

  const updateExperienceField = (index, field, value) => {
    setCvExperienceDraft((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const updateEducationField = (index, field, value) => {
    setCvEducationDraft((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const saveCv = async () => {
    if (!application?.application_id) return;
    setSavingCv(true);
    try {
      const { data } = await api.patch(`/applications/${application.application_id}/resume`, {
        experience: cvExperienceDraft.map((entry) => ({
          role: entry.role,
          company: entry.company,
          location: entry.location,
          duration: entry.duration,
          highlights: entry.highlightsText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        })),
        education: cvEducationDraft,
        languages: cvLanguagesDraft
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setApplication(data);
      setEditingCv(false);
      toast.success(t("review.cvSaved"));
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(
        detail?.message || (typeof detail === "string" ? detail : t("review.cvSaveError")),
      );
    } finally {
      setSavingCv(false);
    }
  };

  const approveAndSubmit = async () => {
    if (!application?.application_id) return;
    setSubmitting(true);
    try {
      await api.post(`/applications/${application.application_id}/approve-documents`);
      let submitStatus = null;
      if (application?.job_id) {
        try {
          const { data } = await api.post("/applications/greenhouse/submit", {
            job_id: application.job_id,
          });
          submitStatus = data?.submission_status;
        } catch {
          // Manual fulfillment or unsupported ATS — document approval is enough.
        }
      }
      if (submitStatus === "submitted") {
        toast.success(t("review.submitted"));
      } else if (submitStatus === "action_required") {
        toast(t("review.actionRequired"), { description: t("review.actionRequiredDesc") });
      } else {
        toast.success(t("review.approved"), { description: t("review.approvedDesc") });
      }
      navigate("/review", { replace: true });
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(
        detail?.message || (typeof detail === "string" ? detail : t("review.submitError")),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const readerTitle = docType === "cv" ? t("review.cv") : t("review.coverLetter");

  return (
    <AppPage className={SHELL_PAGE_CLASS}>
      <BrandHeader />

      <AppPageScroll withBottomNavPad={!isReader}>
        <div
          className={
            isReader ? "mx-auto w-full max-w-4xl px-4 py-4 md:px-8 md:py-6" : APP_CONTENT_WIDTH
          }
        >
          <div className="mb-4 flex items-center gap-2">
            <Link
              to={isReader ? `/review/${applicationId}` : "/review"}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-semibold shell-body transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              data-testid="review-detail-back"
            >
              <ArrowLeft className="h-4 w-4" />
              {isReader ? t("review.backToDocuments") : t("review.backToQueue")}
            </Link>
          </div>

          {loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : !application ? null : isReader ? (
            <div data-testid="review-document-reader">
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-400">
                  {application.job?.company}
                </p>
                <h1 className="font-display text-2xl font-bold tracking-tight shell-title">
                  {readerTitle}
                </h1>
                <p className="mt-1 text-sm shell-body">{application.job?.title}</p>
              </div>

              {docType === "cv" ? (
                hasCv ? (
                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="inline-flex rounded-full border shell-border bg-sprout-surface p-1">
                        {[
                          { value: "tailored", label: t("review.cvSourceTailored") },
                          { value: "original", label: t("review.cvSourceOriginal") },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => changeCvSource(option.value)}
                            disabled={
                              cvSourceSaving || (option.value === "original" && !hasOriginalCv)
                            }
                            data-testid={`cv-source-${option.value}`}
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              cvSource === option.value
                                ? "gradient-linkedin text-white"
                                : "shell-body hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {cvSource === "tailored" ? (
                        editingCv ? (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setEditingCv(false)}
                              disabled={savingCv}
                              data-testid="cv-cancel-edit"
                            >
                              {t("review.cancelEdit")}
                            </Button>
                            <Button onClick={saveCv} disabled={savingCv} data-testid="cv-save">
                              {savingCv ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              {t("review.saveCv")}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" onClick={startEditCv} data-testid="cv-edit">
                            {t("review.editCv")}
                          </Button>
                        )
                      ) : null}
                    </div>

                    {cvSource === "original" ? (
                      <ResumeCurrentPreview profile={profile} active compact />
                    ) : editingCv ? (
                      <div className="ph-no-capture space-y-6" data-testid="cv-edit-form">
                        {cvExperienceDraft.length > 0 ? (
                          <div>
                            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide shell-body">
                              {t("review.experience")}
                            </h3>
                            <div className="space-y-4">
                              {cvExperienceDraft.map((entry, index) => (
                                <div
                                  key={JSON.stringify(entry)}
                                  className="shell-surface space-y-2 rounded-2xl border shell-border p-3"
                                >
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                      placeholder={t("review.role")}
                                      value={entry.role}
                                      onChange={(e) =>
                                        updateExperienceField(index, "role", e.target.value)
                                      }
                                    />
                                    <input
                                      className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                      placeholder={t("review.duration")}
                                      value={entry.duration}
                                      onChange={(e) =>
                                        updateExperienceField(index, "duration", e.target.value)
                                      }
                                    />
                                    <input
                                      className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                      placeholder={t("review.company")}
                                      value={entry.company}
                                      onChange={(e) =>
                                        updateExperienceField(index, "company", e.target.value)
                                      }
                                    />
                                    <input
                                      className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                      placeholder={t("review.location")}
                                      value={entry.location}
                                      onChange={(e) =>
                                        updateExperienceField(index, "location", e.target.value)
                                      }
                                    />
                                  </div>
                                  <Textarea
                                    value={entry.highlightsText}
                                    onChange={(e) =>
                                      updateExperienceField(index, "highlightsText", e.target.value)
                                    }
                                    rows={4}
                                    placeholder={t("review.highlightsHint")}
                                    className="text-sm"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {cvEducationDraft.length > 0 ? (
                          <div>
                            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide shell-body">
                              {t("review.education")}
                            </h3>
                            <div className="space-y-3">
                              {cvEducationDraft.map((entry, index) => (
                                <div
                                  key={JSON.stringify(entry)}
                                  className="shell-surface grid grid-cols-3 gap-2 rounded-2xl border shell-border p-3"
                                >
                                  <input
                                    className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                    placeholder={t("review.degree")}
                                    value={entry.degree}
                                    onChange={(e) =>
                                      updateEducationField(index, "degree", e.target.value)
                                    }
                                  />
                                  <input
                                    className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                    placeholder={t("review.school")}
                                    value={entry.school}
                                    onChange={(e) =>
                                      updateEducationField(index, "school", e.target.value)
                                    }
                                  />
                                  <input
                                    className="rounded-lg border shell-border bg-transparent px-3 py-2 text-sm"
                                    placeholder={t("review.year")}
                                    value={entry.year}
                                    onChange={(e) =>
                                      updateEducationField(index, "year", e.target.value)
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div>
                          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide shell-body">
                            {t("review.languages")}
                          </h3>
                          <Textarea
                            value={cvLanguagesDraft}
                            onChange={(e) => setCvLanguagesDraft(e.target.value)}
                            rows={4}
                            placeholder={t("review.languagesHint")}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    ) : (
                      <CVPreview
                        contact={contact}
                        resume={resume}
                        job={job}
                        template={template}
                        theme="light"
                      />
                    )}
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm shell-body">
                    {t("tracker.cvUnavailable")}
                  </p>
                )
              ) : hasCover ? (
                <div>
                  <div className="mb-4 flex justify-end">
                    {editingCoverLetter ? (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setEditingCoverLetter(false)}
                          disabled={savingCoverLetter}
                          data-testid="cover-letter-cancel-edit"
                        >
                          {t("review.cancelEdit")}
                        </Button>
                        <Button
                          onClick={saveCoverLetter}
                          disabled={savingCoverLetter}
                          data-testid="cover-letter-save"
                        >
                          {savingCoverLetter ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {t("review.saveCoverLetter")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={startEditCoverLetter}
                        data-testid="cover-letter-edit"
                      >
                        {t("review.editCoverLetter")}
                      </Button>
                    )}
                  </div>
                  {editingCoverLetter ? (
                    <Textarea
                      value={coverLetterDraft}
                      onChange={(e) => setCoverLetterDraft(e.target.value)}
                      rows={16}
                      className="text-sm leading-relaxed"
                      data-testid="cover-letter-textarea"
                    />
                  ) : (
                    <CoverLetterPreview
                      contact={contact}
                      letter={coverLetter}
                      job={job}
                      theme="light"
                    />
                  )}
                </div>
              ) : (
                <p className="py-10 text-center text-sm shell-body">
                  {t("tracker.coverUnavailable")}
                </p>
              )}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              data-testid="review-application-detail"
            >
              <div className="flex items-start gap-4">
                <CompanyLogo company={job?.company} size="md" rounded="xl" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-violet-400">{job?.company}</p>
                  <h1 className="font-display text-2xl font-bold tracking-tight shell-title">
                    {job?.title}
                  </h1>
                  {job?.location ? (
                    <p className="mt-2 inline-flex items-center gap-1 text-sm shell-body">
                      <MapPin className="h-3.5 w-3.5" />
                      {job.location}
                    </p>
                  ) : null}
                </div>
              </div>

              <p className="mt-5 text-sm leading-relaxed shell-body">{t("review.pageHint")}</p>

              <div className="mt-6 space-y-4">
                {hasCv ? (
                  <DocumentPreviewCard
                    title={t("review.cv")}
                    description={t("review.tapToRead")}
                    icon={FileText}
                    onOpen={() => navigate(`/review/${applicationId}/cv`)}
                    testId="review-open-cv"
                  >
                    <CVPreview
                      contact={contact}
                      resume={resume}
                      job={job}
                      template={template}
                      theme="light"
                    />
                  </DocumentPreviewCard>
                ) : null}

                {hasCover ? (
                  <DocumentPreviewCard
                    title={t("review.coverLetter")}
                    description={t("review.tapToRead")}
                    icon={Mail}
                    onOpen={() => navigate(`/review/${applicationId}/cover`)}
                    testId="review-open-cover"
                  >
                    <CoverLetterPreview
                      contact={contact}
                      letter={coverLetter}
                      job={job}
                      theme="light"
                    />
                  </DocumentPreviewCard>
                ) : null}
              </div>

              <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t shell-border bg-sprout-bg/95 px-4 py-4 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
                <Button
                  onClick={approveAndSubmit}
                  disabled={submitting}
                  className="w-full rounded-full gradient-linkedin text-white hover:opacity-90"
                  data-testid="review-approve-submit-btn"
                >
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t("review.approveSubmit")}
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </AppPageScroll>
    </AppPage>
  );
}
