import { useRef, useState } from "react";
import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, API, getDirectApiBase, getSessionToken } from "../../lib/api";
import { shouldMockCvUpload } from "../../lib/demoCvUpload";
import { useAppLocale } from "../../context/AppLocaleContext";
import { formatUploadedDate } from "../../lib/appUi";
import { CV_MAX_BYTES } from "../../lib/cvUploadFormats";
import { Button } from "../ui/button";
import ProfileFormSection from "./ProfileFormSection";

const ACCEPTED_COVER_LETTER = ".pdf,.docx,.txt,.rtf";
const MAX_BYTES = CV_MAX_BYTES;

function CoverLetterEmptyState({ onUpload, uploading, t }) {
  return (
    <div className="shell-dashed flex flex-col items-center justify-center gap-4 rounded-lg border px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl shell-icon-box">
        <FileText className="h-6 w-6" aria-hidden />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="shell-title text-base font-semibold">
          {t("profile.documents.noCoverLetter")}
        </p>
        <p className="text-sm leading-relaxed shell-body">
          {t("profile.documents.noCoverLetterDesc")}
        </p>
      </div>
      <Button
        type="button"
        variant="brand"
        onClick={onUpload}
        disabled={uploading}
        data-testid="profile-upload-cover-letter"
      >
        <Upload className="h-4 w-4" />
        {uploading ? t("common.loading") : t("profile.documents.uploadCoverLetter")}
      </Button>
    </div>
  );
}

export default function ProfileCoverLetterSection({ profile, onCoverLetterChange }) {
  const { t, lang } = useAppLocale();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hasCoverLetter = Boolean(profile?.cover_letter_filename);

  const openPicker = () => {
    if (!uploading && !deleting) fileInputRef.current?.click();
  };

  const fetchCoverLetterBlob = async () => {
    if (shouldMockCvUpload()) return null;
    const token = getSessionToken();
    const res = await fetch(`${API}/profile/cover-letter/original`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return res.blob();
  };

  const uploadCoverLetter = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t("profile.documents.fileTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // Bypass the Vercel /api rewrite for large uploads (avoids proxy timeouts).
      const base = (getDirectApiBase() || "").replace(/\/+$/, "");
      const url = base ? `${base}/profile/cover-letter` : "/profile/cover-letter";
      await api.post(url, form, {
        timeout: 120000,
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(t("profile.documents.coverLetterUploadSuccess"));
      await onCoverLetterChange?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || t("profile.documents.coverLetterUploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const viewCoverLetter = async () => {
    try {
      const blob = await fetchCoverLetterBlob();
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

  const downloadCoverLetter = async () => {
    try {
      const blob = await fetchCoverLetterBlob();
      if (!blob) {
        toast.error(t("profile.documents.downloadError"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = profile?.cover_letter_filename || "cover_letter.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      toast.error(t("profile.documents.downloadError"));
    }
  };

  const removeCoverLetter = async () => {
    setDeleting(true);
    try {
      await api.delete("/profile/cover-letter");
      toast.success(t("profile.documents.coverLetterDeleteSuccess"));
      await onCoverLetterChange?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || t("profile.documents.coverLetterDeleteError"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ProfileFormSection
      title={t("profile.documents.coverLetterTitle")}
      description={t("profile.documents.coverLetterSectionDesc")}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_COVER_LETTER}
        className="hidden"
        onChange={(event) => uploadCoverLetter(event.target.files?.[0])}
        data-testid="profile-cover-letter-input"
      />

      {hasCoverLetter ? (
        <div className="space-y-4">
          <div className="shell-surface-sm rounded-md border px-4 py-3">
            <p className="shell-title truncate text-sm font-medium">
              {profile.cover_letter_filename}
            </p>
            {profile.cover_letter_uploaded_at ? (
              <p className="mt-0.5 text-sm shell-body">
                {t("profile.documents.uploadedOn", {
                  date: formatUploadedDate(lang, profile.cover_letter_uploaded_at),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="brand"
              onClick={openPicker}
              disabled={uploading || deleting}
              data-testid="profile-cover-letter-replace-btn"
            >
              <Upload className="h-4 w-4" />
              {uploading ? t("common.loading") : t("profile.documents.replaceCoverLetter")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="shell-border rounded-full"
              onClick={viewCoverLetter}
            >
              <Eye className="h-4 w-4" />
              {t("profile.documents.viewCoverLetter")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="shell-border rounded-full"
              onClick={downloadCoverLetter}
            >
              <Download className="h-4 w-4" />
              {t("profile.documents.downloadCoverLetter")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="shell-border rounded-full"
              onClick={removeCoverLetter}
              disabled={deleting}
              data-testid="profile-cover-letter-delete-btn"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? t("common.loading") : t("profile.documents.deleteCoverLetter")}
            </Button>
          </div>
        </div>
      ) : (
        <CoverLetterEmptyState onUpload={openPicker} uploading={uploading} t={t} />
      )}
    </ProfileFormSection>
  );
}
