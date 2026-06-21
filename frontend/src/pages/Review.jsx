import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { filterApplicationsForReview } from "../lib/applicationReview";
import { useAiSettings } from "../hooks/useAiSettings";
import { useAppLocale } from "../context/AppLocaleContext";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import CompanyLogo from "../components/CompanyLogo";
import CVPreview from "../components/CVPreview";
import CoverLetterPreview from "../components/CoverLetterPreview";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function Review() {
  const { t } = useAppLocale();
  const { settings } = useAiSettings();
  const reviewEnabled = settings.reviewDocuments;
  const [apps, setApps] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, profileRes] = await Promise.all([
        api.get("/applications"),
        api.get("/profile"),
      ]);
      setApps(appsRes.data?.applications || []);
      setProfile(profileRes.data || null);
    } catch (_) {
      toast.error(t("review.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reviewQueue = useMemo(
    () => filterApplicationsForReview(apps, reviewEnabled),
    [apps, reviewEnabled],
  );

  const openApplication = async (application) => {
    try {
      const { data } = await api.get(`/applications/${application.application_id}`);
      setSelected(data);
      setOpen(true);
    } catch (_) {
      toast.error(t("review.openError"));
    }
  };

  const approveAndSubmit = async () => {
    if (!selected?.job_id) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/applications/greenhouse/browser-submit", {
        job_id: selected.job_id,
      });
      const status = data?.submission_status;
      if (status === "submitted") {
        toast.success(t("review.submitted"));
      } else if (status === "action_required") {
        toast(t("review.actionRequired"), { description: t("review.actionRequiredDesc") });
      } else {
        toast.success(t("review.approved"), { description: t("review.approvedDesc") });
      }
      setOpen(false);
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail?.message || (typeof detail === "string" ? detail : t("review.submitError")));
    } finally {
      setSubmitting(false);
    }
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
            <section className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-violet-600">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold text-zinc-900">{t("review.disabledTitle")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-600">
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
            <section className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-zinc-500 shadow-sm">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold text-zinc-900">{t("review.allCaughtUp")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-600">
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
                      <p className="font-display text-lg font-bold leading-tight text-zinc-900">
                        {app.job?.title}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-600">{app.job?.company}</p>
                      {app.job?.location ? (
                        <p className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500">
                          <MapPin className="h-3.5 w-3.5" />
                          {app.job.location}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                          {t("review.readyToReview")}
                        </span>
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
                          {fmtDate(app.created_at)
                            ? t("review.generatedOn", { date: fmtDate(app.created_at) })
                            : t("review.generatedRecently")}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="mt-2 h-5 w-5 shrink-0 text-zinc-400" />
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </AppPageScroll>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto p-0" data-testid="review-application-dialog">
          {selected ? (
            <>
              <DialogHeader className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-6 pb-4 pt-6">
                <div className="flex items-start gap-3">
                  <CompanyLogo company={selected.job?.company} size="sm" rounded="xl" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-violet-600">{selected.job?.company}</p>
                    <DialogTitle className="font-display text-2xl tracking-tight text-zinc-900">
                      {selected.job?.title}
                    </DialogTitle>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-5 px-6 py-5">
                <p className="text-sm text-zinc-600">
                  {t("review.dialogHint")}
                </p>

                <Tabs defaultValue="cv">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="cv">
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      {t("review.cv")}
                    </TabsTrigger>
                    <TabsTrigger value="cover">
                      <Mail className="mr-1.5 h-3.5 w-3.5" />
                      {t("review.coverLetter")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="cv" className="mt-4">
                    <CVPreview
                      contact={profile?.contact || {}}
                      resume={selected.tailored_resume || {}}
                      job={selected.job}
                      template={profile?.template_style || "modern"}
                    />
                  </TabsContent>
                  <TabsContent value="cover" className="mt-4">
                    <CoverLetterPreview
                      contact={profile?.contact || {}}
                      letter={selected.cover_letter || {}}
                      job={selected.job}
                    />
                  </TabsContent>
                </Tabs>

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
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
