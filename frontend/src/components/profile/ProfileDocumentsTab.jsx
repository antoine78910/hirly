import { useCallback, useRef, useState } from "react";
import { Eye, File, FileStack, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, API, getSessionToken } from "../../lib/api";
import { shouldMockCvUpload } from "../../lib/demoCvUpload";
import { useAppLocale } from "../../context/AppLocaleContext";
import { formatUploadedDate } from "../../lib/appUi";
import { Button } from "../ui/button";
import ProfileResumeSection from "./ProfileResumeSection";
import ProfileFormSection from "./ProfileFormSection";

const ACCEPTED_DOCUMENTS = ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function DocumentEmptyState({ icon: Icon, title, description, actionLabel, onAction, testId, disabled }) {
  return (
    <div className="shell-dashed flex flex-col items-center justify-center gap-4 rounded-lg border px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl shell-icon-box">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="shell-title text-base font-semibold">{title}</p>
        <p className="text-sm leading-relaxed shell-body">{description}</p>
      </div>
      <Button
        type="button"
        variant="brand"
        onClick={onAction}
        disabled={disabled}
        data-testid={testId}
      >
        <Upload className="h-4 w-4" />
        {actionLabel}
      </Button>
    </div>
  );
}

function AdditionalDocumentRow({ doc, onView, onDelete, deleting, lang, t }) {
  return (
    <div
      role="listitem"
      className="shell-surface-sm flex flex-wrap items-center gap-4 rounded-md p-4"
      data-testid={`profile-document-${doc.id}`}
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-sm shell-border shell-icon-box">
        <File className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="shell-title truncate text-sm font-medium">{doc.name}</p>
        <p className="text-sm shell-body">
          {t("profile.documents.uploadedOn", { date: formatUploadedDate(lang, doc.uploaded_at) })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onView(doc)}
          aria-label={t("profile.documents.viewDocument")}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onDelete(doc)}
          disabled={deleting}
          aria-label={t("profile.documents.deleteDocument")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function ProfileDocumentsTab({ profile, onUploadResume, onDocumentsChange }) {
  const { t, lang } = useAppLocale();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const additionalDocuments = profile?.additional_documents || profile?.extras?.additional_documents || [];

  const openDocumentPicker = () => {
    if (!uploading) fileInputRef.current?.click();
  };

  const uploadDocument = useCallback(async (file) => {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast.error(t("profile.documents.fileTooLarge"));
      return;
    }
    setUploading(true);
    try {
      if (shouldMockCvUpload()) {
        await onDocumentsChange?.();
        return;
      }
      const form = new FormData();
      form.append("file", file);
      await api.post("/profile/documents", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(t("profile.documents.uploadSuccess"));
      await onDocumentsChange?.();
    } catch (error) {
      if (!shouldMockCvUpload()) {
        toast.error(error?.response?.data?.detail || t("profile.documents.uploadError"));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [onDocumentsChange, t]);

  const viewDocument = async (doc) => {
    try {
      if (shouldMockCvUpload()) return;
      const token = getSessionToken();
      const url = `${API}/profile/documents/${doc.id}`;
      const res = await fetch(url, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        toast.error(t("profile.documents.viewError"));
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (_) {
      toast.error(t("profile.documents.viewError"));
    }
  };

  const deleteDocument = async (doc) => {
    setDeletingId(doc.id);
    try {
      await api.delete(`/profile/documents/${doc.id}`);
      toast.success(t("profile.documents.deleteSuccess"));
      await onDocumentsChange?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || t("profile.documents.deleteError"));
    } finally {
      setDeletingId(null);
    }
  };

  const uploadedCountLabel = additionalDocuments.length === 1
    ? t("profile.documents.uploadedCountOne")
    : t("profile.documents.uploadedCountMany", { n: additionalDocuments.length });

  return (
    <div className="space-y-8 pb-6" data-testid="profile-documents">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_DOCUMENTS}
        className="hidden"
        onChange={(event) => uploadDocument(event.target.files?.[0])}
        data-testid="profile-document-input"
      />

      <ProfileResumeSection
        profile={profile}
        onUploadResume={onUploadResume}
      />

      <ProfileFormSection
        title={t("profile.documents.additionalTitle")}
        description={t("profile.documents.additionalSectionDesc")}
      >
        {additionalDocuments.length > 0 ? (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="shell-title min-w-0 text-sm">{uploadedCountLabel}</p>
              <Button
                type="button"
                variant="brand"
                size="sm"
                className="shrink-0"
                onClick={openDocumentPicker}
                disabled={uploading}
                data-testid="profile-upload-additional"
              >
                {uploading ? t("common.loading") : t("profile.documents.uploadDocument")}
              </Button>
            </div>
            <div role="list" className="flex flex-col gap-4">
              {additionalDocuments.map((doc) => (
                <AdditionalDocumentRow
                  key={doc.id}
                  doc={doc}
                  onView={viewDocument}
                  onDelete={deleteDocument}
                  deleting={deletingId === doc.id}
                  lang={lang}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : (
          <DocumentEmptyState
            icon={FileStack}
            title={t("profile.documents.noAdditional")}
            description={t("profile.documents.noAdditionalDesc")}
            actionLabel={uploading ? t("common.loading") : t("profile.documents.uploadDocument")}
            onAction={openDocumentPicker}
            disabled={uploading}
            testId="profile-upload-additional-empty"
          />
        )}
      </ProfileFormSection>
    </div>
  );
}
