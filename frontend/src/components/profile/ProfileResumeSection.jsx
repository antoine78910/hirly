import { Download, Eye, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { API, getSessionToken } from "../../lib/api";
import { fetchDemoCvOriginal, shouldMockCvUpload } from "../../lib/demoCvUpload";
import { useAppLocale } from "../../context/AppLocaleContext";
import { Button } from "../ui/button";
import ConfigureAiSettingsButton from "../settings/ConfigureAiSettingsButton";
import ResumeCurrentPreview from "./ResumeCurrentPreview";
import ResumeExamplePreview from "./ResumeExamplePreview";
import ProfileFormSection from "./ProfileFormSection";

function ResumeEmptyState({ onUpload, t }) {
  return (
    <div className="shell-dashed flex flex-col items-center justify-center gap-4 rounded-lg border px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl shell-icon-box">
        <FileText className="h-6 w-6" aria-hidden />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="shell-title text-base font-semibold">{t("profile.documents.noResume")}</p>
        <p className="text-sm leading-relaxed shell-body">{t("profile.documents.noResumeDesc")}</p>
      </div>
      <Button type="button" variant="brand" onClick={onUpload} data-testid="profile-upload-resume">
        <Upload className="h-4 w-4" />
        {t("profile.documents.uploadResume")}
      </Button>
    </div>
  );
}

/** Resume file preview with view, download, and replace actions. */
export default function ProfileResumeSection({ profile, onUploadResume, showAiFooter = true }) {
  const { t } = useAppLocale();
  const hasResume = Boolean(profile?.cv_text || profile?.cv_filename);

  const fetchResumeBlob = async () => {
    if (shouldMockCvUpload()) {
      return fetchDemoCvOriginal();
    }
    const token = getSessionToken();
    const res = await fetch(`${API}/profile/cv/original`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return res.blob();
  };

  const downloadResume = async () => {
    try {
      const blob = await fetchResumeBlob();
      if (!blob) {
        toast.error(t("profile.documents.downloadError"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = profile?.cv_filename || "resume.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      toast.error(t("profile.documents.downloadError"));
    }
  };

  const viewResume = async () => {
    try {
      const blob = await fetchResumeBlob();
      if (!blob) {
        toast.error(t("profile.documents.viewError"));
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (_) {
      toast.error(t("profile.documents.viewError"));
    }
  };

  return (
    <ProfileFormSection
      title={t("profile.documents.resumeTitle")}
      description={t("profile.documents.resumeSectionDesc")}
      footer={
        showAiFooter ? (
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed shell-body">
              {t("profile.documents.configureAiSettingsHint")}
            </p>
            <ConfigureAiSettingsButton
              className="shrink-0 sm:w-auto"
              testId="profile-resume-ai-settings-footer"
            />
          </div>
        ) : null
      }
    >
      {hasResume ? (
        <div className="space-y-4">
          <ResumeCurrentPreview profile={profile} active compact />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="brand"
              onClick={onUploadResume}
              data-testid="profile-resume-replace-btn"
            >
              <Upload className="h-4 w-4" />
              {t("profile.documents.replaceResume")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="shell-border rounded-full"
              onClick={viewResume}
              data-testid="profile-resume-view-btn"
            >
              <Eye className="h-4 w-4" />
              {t("profile.documents.viewResume")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="shell-border rounded-full"
              onClick={downloadResume}
              data-testid="profile-resume-download-btn"
            >
              <Download className="h-4 w-4" />
              {t("profile.documents.downloadResume")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <ResumeEmptyState onUpload={onUploadResume} t={t} />
          <ResumeExamplePreview compact />
        </div>
      )}
    </ProfileFormSection>
  );
}
