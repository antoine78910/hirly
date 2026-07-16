import { useEffect, useMemo, useState } from "react";
import {
  FileText, Info, Loader2, Mail, ArrowLeft,
  MapPin, MessageSquare, Sparkles, UserRoundCheck, Wallet,
  Bell, ShieldCheck, Clock3, AlertCircle,
} from "lucide-react";
import { api } from "../../lib/api";
import { formatCompactMoney } from "../../lib/currency";
import {
  buildApplicationTimeline,
  filterApplicationEmails,
  formatTimelineDate,
  formatTimelineDateTime,
} from "../../lib/applicationTimeline";
import CompanyLogo from "../CompanyLogo";
import ApplicationDocumentsView from "./ApplicationDocumentsView";
import { DialogHeader, DialogTitle } from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Button } from "../ui/button";
import { hasApplicationDocuments } from "../../lib/applicationDocuments";

const TIMELINE_ICONS = {
  interview: MessageSquare,
  offer: Sparkles,
  submitted: UserRoundCheck,
  email: Mail,
  package: FileText,
  created: Sparkles,
  review: ShieldCheck,
  notification: Bell,
  pending: Clock3,
  prepared: Sparkles,
  security: ShieldCheck,
  action_required: AlertCircle,
  failed: AlertCircle,
  expired: Clock3,
};

function jobSalaryLabel(job, lang) {
  const min = job?.salary_min;
  const max = job?.salary_max;
  if (!min && !max) return null;
  if (min && max) return `${formatCompactMoney(min, lang)} - ${formatCompactMoney(max, lang)}`;
  if (min) return `${formatCompactMoney(min, lang)}+`;
  return formatCompactMoney(max, lang);
}

function TimelineEventRow({ event, isLast, lang, t, onViewEmail }) {
  const Icon = TIMELINE_ICONS[event.kind] || Mail;
  const timestamp = formatTimelineDateTime(event.at, lang);

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="grid h-9 w-9 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        {!isLast ? <div className="my-1 w-px flex-1 bg-zinc-200" /> : null}
      </div>
      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-5"}`}>
        <p className="text-[11px] font-medium text-zinc-500">{timestamp}</p>
        <p className="mt-0.5 text-sm font-bold text-zinc-900">{event.title}</p>
        <p className="mt-0.5 text-sm text-zinc-600">{event.description}</p>
        {event.email ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-sm font-semibold text-zinc-900">{event.email.subject}</p>
            {event.email.preview ? (
              <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{event.email.preview}</p>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() => onViewEmail(event.email)}
              className="mt-3 rounded-full bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800"
              data-testid="timeline-view-email-btn"
            >
              {t("tracker.viewEmail")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ApplicationEmailRow({ message, onOpen, t, lang }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(message)}
      className="flex w-full items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-colors hover:bg-zinc-50"
      data-testid={`application-inbox-${message.id}`}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-600">
        <Mail className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-bold text-zinc-900">{message.from}</p>
          <span className="shrink-0 text-[11px] text-zinc-500">
            {formatTimelineDate(message.received_at || message.date, lang)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-zinc-800">{message.subject}</p>
        <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{message.preview || message.body}</p>
      </div>
    </button>
  );
}

export default function ApplicationDetailPanel({
  application,
  profile,
  userPicture,
  displayStatuses,
  statusMeta,
  applicationStatusMessage,
  ApplicationStatusPill,
  t,
  lang,
  onDownloadCV,
  onDownloadCoverLetter,
  missingAnswers,
  setMissingAnswers,
  saveMissingToProfile,
  setSaveMissingToProfile,
  savingMissing,
  resolveMissingInfo,
  preparingAgain,
  prepareGreenhouseAgain,
  submittingFinal,
  testFinalSubmit,
  canShowInternalSubmitTest,
  missingFieldsForForm,
  optionValue,
  optionLabel,
  onBack,
  activeTab = "application",
  onTabChange,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [emails, setEmails] = useState([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [viewingEmail, setViewingEmail] = useState(null);
  const [timelineRevision, setTimelineRevision] = useState(0);

  useEffect(() => {
    const bumpTimeline = () => setTimelineRevision((value) => value + 1);
    window.addEventListener("hirly:ai-settings-changed", bumpTimeline);
    window.addEventListener("hirly:notification-settings-changed", bumpTimeline);
    return () => {
      window.removeEventListener("hirly:ai-settings-changed", bumpTimeline);
      window.removeEventListener("hirly:notification-settings-changed", bumpTimeline);
    };
  }, []);

  useEffect(() => {
    if (!application?.application_id) return undefined;
    let cancelled = false;
    (async () => {
      setLoadingEmails(true);
      try {
        const { data } = await api.get("/emails", { params: { sync: false, limit: 100 } });
        if (!cancelled) setEmails(data?.messages || []);
      } catch {
        if (!cancelled) setEmails([]);
      } finally {
        if (!cancelled) setLoadingEmails(false);
      }
    })();
    return () => { cancelled = true; };
  }, [application?.application_id]);

  const timeline = useMemo(
    () => buildApplicationTimeline(application, emails, t, lang),
    [application, emails, t, lang, timelineRevision],
  );
  const appEmails = useMemo(
    () => filterApplicationEmails(emails, application),
    [emails, application],
  );

  const salary = jobSalaryLabel(application.job, lang);
  const appliedDate = formatTimelineDate(
    application.submitted_at || application.created_at,
    lang,
  );
  const isExpired = application.user_facing_submission_status === "expired"
    || application.submission_status === "expired"
    || application.manual_status === "offer_expired";

  if (!application) return null;

  if (viewingEmail) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={() => setViewingEmail(null)}
            className="text-sm font-semibold text-zinc-900"
            data-testid="application-email-back"
          >
            ← {t("emails.back")}
          </button>
          <h2 className="mt-2 font-display text-lg font-bold text-zinc-900">{viewingEmail.subject}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {viewingEmail.from}
            {" · "}
            {formatTimelineDateTime(viewingEmail.received_at || viewingEmail.date, lang)}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
            {viewingEmail.body || viewingEmail.preview || t("tracker.emailBodyUnavailable")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DialogHeader className="sticky top-0 z-10 shrink-0 border-b border-zinc-200 bg-white px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-700 hover:text-zinc-900"
          data-testid="application-detail-back"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </button>
        <div className="flex items-start gap-3">
          <CompanyLogo company={application.job?.company} size="sm" rounded="xl" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-display text-xl font-bold leading-tight tracking-tight text-zinc-900 sm:text-2xl">
              {application.job?.title || t("tracker.untitledRole")}
            </DialogTitle>
            <p className="mt-0.5 text-sm font-medium text-zinc-500">
              {application.job?.company || t("tracker.unknownCompany")}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-600">
          {salary ? (
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" />
              {salary}
            </span>
          ) : null}
          {application.job?.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {application.job.location}
            </span>
          ) : null}
          {appliedDate ? <span>{appliedDate}</span> : null}
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 font-medium text-zinc-700"
            data-testid="application-tap-details"
          >
            <Info className="h-3.5 w-3.5" />
            {t("tracker.tapForDetails")}
          </button>
        </div>
        {detailsOpen && application.job?.description ? (
          <p className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700">
            {application.job.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ApplicationStatusPill application={application} variant="dark" displayStatuses={displayStatuses} />
          {application.match_score ? (
            <span className="text-xs font-semibold text-linkedin">{application.match_score}% match</span>
          ) : null}
        </div>
      </DialogHeader>

      <Tabs value={activeTab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col">
        <TabsList
          className="sticky top-0 z-[1] mx-4 mt-3 grid h-auto grid-cols-4 gap-1 rounded-full bg-zinc-100 p-1 sm:mx-6"
          data-testid="application-detail-tabs"
        >
          <TabsTrigger
            value="application"
            className="rounded-full px-2 py-2 text-[11px] font-semibold data-[state=active]:bg-zinc-900 data-[state=active]:text-white sm:text-xs"
          >
            {t("tracker.tabApplication")}
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="rounded-full px-2 py-2 text-[11px] font-semibold data-[state=active]:bg-zinc-900 data-[state=active]:text-white sm:text-xs"
          >
            {t("tracker.tabDocuments")}
          </TabsTrigger>
          <TabsTrigger
            value="timeline"
            className="rounded-full px-2 py-2 text-[11px] font-semibold data-[state=active]:bg-zinc-900 data-[state=active]:text-white sm:text-xs"
          >
            {t("tracker.tabTimeline")}
          </TabsTrigger>
          <TabsTrigger
            value="inbox"
            className="rounded-full px-2 py-2 text-[11px] font-semibold data-[state=active]:bg-zinc-900 data-[state=active]:text-white sm:text-xs"
          >
            {t("tracker.tabInbox")}
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
          <TabsContent value="application" className="mt-0 space-y-4">
            {isExpired ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="expired-credit-refund-notice">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800">
                  <Wallet className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-amber-900">{t("tracker.expiredRefundTitle")}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-amber-800">{t("tracker.expiredRefundBody")}</p>
                </div>
              </div>
            ) : null}
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">{t("tracker.nextAction")}</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">{statusMeta(application, displayStatuses).cta}</p>
                </div>
                <ApplicationStatusPill application={application} variant="dark" displayStatuses={displayStatuses} />
              </div>
              <p className="mt-2 text-sm text-zinc-700">
                {applicationStatusMessage(application.user_facing_submission_status || application.submission_status, t)}
              </p>
              {(application.submission_status === "ready" || application.submission_status === "prepared") && (
                <Button
                  disabled
                  className="mt-3 w-full rounded-full bg-linkedin text-white hover:opacity-90"
                  data-testid="submit-application-btn"
                >
                  Ready to submit
                </Button>
              )}
              {canShowInternalSubmitTest
                && application.job?.ats_provider === "greenhouse"
                && (application.submission_status === "ready" || application.submission_status === "prepared") && (
                <Button
                  onClick={testFinalSubmit}
                  disabled={submittingFinal}
                  variant="outline"
                  className="mt-2 w-full rounded-full"
                  data-testid="test-final-submit-btn"
                >
                  {submittingFinal ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Test final submit
                </Button>
              )}
              {application.job?.ats_provider === "greenhouse"
                && ["ready", "prepared", "blocked", "action_required", "prepare_failed"].includes(application.submission_status) && (
                <Button
                  onClick={prepareGreenhouseAgain}
                  disabled={preparingAgain}
                  variant="outline"
                  className="mt-3 w-full rounded-full"
                  data-testid="prepare-greenhouse-again-top-btn"
                >
                  {preparingAgain ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Prepare again
                </Button>
              )}
            </div>

            {application.submission_status === "blocked_captcha" && (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4" data-testid="captcha-required-state">
                <p className="text-sm font-semibold text-orange-800">{t("tracker.securityCheck")}</p>
                <p className="mt-1 text-sm text-zinc-700">
                  The application form needs an additional security check before it can be completed.
                </p>
              </div>
            )}

            {application.submission_status === "prepare_failed" && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4" data-testid="prepare-failed-state">
                <p className="text-sm font-semibold text-rose-800">Preparation failed</p>
                <p className="mt-1 text-sm text-zinc-700">
                  The CV and cover letter were generated, but the browser preparation step needs to be retried.
                </p>
              </div>
            )}

            {(application.submission_status === "blocked" || application.submission_status === "action_required")
              && (application.prepared_missing_information || []).length > 0 && (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4" data-testid="missing-info-form">
                <p className="text-sm font-semibold text-orange-800">{t("tracker.actionRequired")}</p>
                <p className="mt-1 text-sm text-zinc-700">
                  A few answers are needed to complete this application. It will not be submitted automatically.
                </p>
                <div className="mt-4 space-y-3">
                  {missingFieldsForForm(application.prepared_missing_information || []).map((item) => {
                    const options = item.options || [];
                    const value = missingAnswers[item.field_name] || "";
                    return (
                      <label key={`${item.field_name}-${item.reason}`} className="block text-zinc-900">
                        <span className="mb-1 block text-xs font-semibold text-zinc-800">{item.label || item.field_name}</span>
                        {options.length > 0 ? (
                          <select
                            value={value}
                            onChange={(e) => setMissingAnswers((prev) => ({ ...prev, [item.field_name]: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
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
                            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-500"
                            placeholder="Enter answer"
                            data-testid={`missing-field-${item.field_name}`}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
                <label className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-200 bg-white/80 p-3 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    checked={saveMissingToProfile}
                    onChange={(e) => setSaveMissingToProfile(e.target.checked)}
                    className="mt-1 h-4 w-4 accent-linkedin"
                    data-testid="save-missing-to-profile-checkbox"
                  />
                  <span>
                    <span className="block font-semibold text-zinc-900">Save these answers to my profile for future applications</span>
                  </span>
                </label>
                <Button
                  onClick={resolveMissingInfo}
                  disabled={savingMissing}
                  className="mt-4 w-full rounded-full bg-linkedin text-white hover:opacity-90"
                  data-testid="save-missing-info-btn"
                >
                  {savingMissing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Save answers
                </Button>
              </div>
            )}

            {application.match_reasons?.length > 0 && (
              <div className="rounded-2xl border border-linkedin/20 bg-linkedin/5 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-linkedin">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("tracker.whyFit")}
                </p>
                <ul className="space-y-1.5">
                  {application.match_reasons.map((reason, index) => (
                    <li key={index} className="flex gap-2 text-sm leading-snug text-zinc-800">
                      <span className="text-linkedin">→</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {application.interview_prep?.length > 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-sm font-semibold text-zinc-900">{t("interviews.likelyQuestions")}</p>
                <ul className="mt-3 space-y-2">
                  {application.interview_prep.map((question, index) => (
                    <li key={index} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
                      {question}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {hasApplicationDocuments(application) ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-900">{t("tracker.documentsSection")}</p>
                  <button
                    type="button"
                    onClick={() => onTabChange?.("documents")}
                    className="text-xs font-semibold text-linkedin"
                    data-testid="application-open-documents-tab"
                  >
                    {t("tracker.viewAllDocuments")}
                  </button>
                </div>
                <ApplicationDocumentsView
                  application={application}
                  profile={profile}
                  userPicture={userPicture}
                  t={t}
                  onDownloadCV={onDownloadCV}
                  onDownloadCoverLetter={onDownloadCoverLetter}
                  compact
                />
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <ApplicationDocumentsView
              application={application}
              profile={profile}
              userPicture={userPicture}
              t={t}
              onDownloadCV={onDownloadCV}
              onDownloadCoverLetter={onDownloadCoverLetter}
            />
          </TabsContent>

          <TabsContent value="timeline" className="mt-0">
            {timeline.length > 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                {timeline.map((event, index) => (
                  <TimelineEventRow
                    key={event.key}
                    event={event}
                    isLast={index === timeline.length - 1}
                    lang={lang}
                    t={t}
                    onViewEmail={setViewingEmail}
                  />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-zinc-500">{t("tracker.timelineEmpty")}</p>
            )}
          </TabsContent>

          <TabsContent value="inbox" className="mt-0 space-y-3">
            {loadingEmails ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              </div>
            ) : appEmails.length > 0 ? (
              appEmails.map((message) => (
                <ApplicationEmailRow
                  key={message.id}
                  message={message}
                  onOpen={setViewingEmail}
                  t={t}
                  lang={lang}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center">
                <Mail className="mx-auto mb-2 h-8 w-8 text-zinc-300" />
                <p className="text-sm font-medium text-zinc-700">{t("tracker.inboxEmpty")}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("emails.syncInbox")}</p>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
