import { useState } from "react";
import { Download, FileText, Loader2, Mail } from "lucide-react";
import CVPreview from "../CVPreview";
import CoverLetterPreview from "../CoverLetterPreview";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  getApplicationCoverLetter,
  getApplicationResume,
  hasApplicationCoverLetter,
  hasApplicationResume,
  isApplicationGenerating,
} from "../../lib/applicationDocuments";
import { cvPhotoDataUrl, resolveCvDisplayTemplate, withContactPhoto } from "../../lib/cvTemplate";

export default function ApplicationDocumentsView({
  application,
  profile,
  userPicture,
  t,
  onDownloadCV,
  onDownloadCoverLetter,
  compact = false,
}) {
  const [docTab, setDocTab] = useState(() => (hasApplicationResume(application) ? "cv" : "cover"));

  const resume = getApplicationResume(application);
  const coverLetter = getApplicationCoverLetter(application);
  const hasCv = hasApplicationResume(application);
  const hasCover = hasApplicationCoverLetter(application);
  const generating = isApplicationGenerating(application);
  const template = resolveCvDisplayTemplate(
    resume?.template_recommendation || profile?.template_style,
  );
  const contact = withContactPhoto(profile?.contact || {}, cvPhotoDataUrl(profile));
  const job = application?.job;

  if (generating && !hasCv && !hasCover) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
        <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-linkedin" />
        <p className="text-sm font-medium text-zinc-700">{t("toasts.generatingApp")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("toasts.generatingAppDesc")}</p>
      </div>
    );
  }

  if (!hasCv && !hasCover) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-zinc-300" />
        <p className="text-sm font-medium text-zinc-700">{t("tracker.documentsEmpty")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("tracker.documentsEmptyHint")}</p>
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <Tabs value={docTab} onValueChange={setDocTab}>
        <div className="flex items-center justify-between gap-3">
          <TabsList className="grid h-auto grid-cols-2 gap-1 rounded-full bg-zinc-100 p-1">
            <TabsTrigger
              value="cv"
              disabled={!hasCv}
              className="rounded-full px-3 py-2 text-xs font-semibold data-[state=active]:bg-zinc-900 data-[state=active]:text-white sm:text-sm"
              data-testid="application-doc-tab-cv"
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {t("review.cv")}
            </TabsTrigger>
            <TabsTrigger
              value="cover"
              disabled={!hasCover}
              className="rounded-full px-3 py-2 text-xs font-semibold data-[state=active]:bg-zinc-900 data-[state=active]:text-white sm:text-sm"
              data-testid="application-doc-tab-cover"
            >
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              {t("review.coverLetter")}
            </TabsTrigger>
          </TabsList>
          {!compact ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={docTab === "cv" ? onDownloadCV : onDownloadCoverLetter}
              className="shrink-0 rounded-full"
              data-testid={docTab === "cv" ? "download-cv-pdf-btn" : "download-cover-pdf-btn"}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              PDF
            </Button>
          ) : null}
        </div>

        <TabsContent value="cv" className="mt-3">
          {hasCv ? (
            <CVPreview
              contact={contact}
              resume={resume}
              job={job}
              template={template}
              theme="light"
            />
          ) : (
            <p className="py-6 text-center text-sm text-zinc-500">{t("tracker.cvUnavailable")}</p>
          )}
        </TabsContent>

        <TabsContent value="cover" className="mt-3">
          {hasCover ? (
            <CoverLetterPreview contact={contact} letter={coverLetter} job={job} theme="light" />
          ) : (
            <p className="py-6 text-center text-sm text-zinc-500">
              {t("tracker.coverUnavailable")}
            </p>
          )}
        </TabsContent>
      </Tabs>

      {compact ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDownloadCV}
            disabled={!hasCv}
            className="rounded-full"
            data-testid="download-cv-pdf-btn-compact"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("tracker.downloadCv")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDownloadCoverLetter}
            disabled={!hasCover}
            className="rounded-full"
            data-testid="download-cover-pdf-btn-compact"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("tracker.downloadCoverLetter")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
