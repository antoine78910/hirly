import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { shouldMockCvUpload, uploadProfileCv } from "../lib/demoCvUpload";
import { CV_ACCEPT_ATTR, CV_MAX_BYTES, CV_MAX_MB, isAcceptedCvFile, isLegacyDocFile } from "../lib/cvUploadFormats";
import { FileText, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import ConfigureAiSettingsButton from "./settings/ConfigureAiSettingsButton";
import { Button } from "./ui/button";
import ResumeCurrentPreview from "./profile/ResumeCurrentPreview";
import { useAppLocale } from "../context/AppLocaleContext";
import { trackEvent } from "../lib/analytics";

/** Centered resume upload modal — drag & drop + file picker. */
export default function ResumeSheet({ open, profile, onClose, onUploaded }) {
  const { t } = useAppLocale();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedName, setSelectedName] = useState("");

  const hasResume = Boolean(profile?.cv_filename || profile?.cv_text);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (isLegacyDocFile(file)) {
      toast.error(t("resumeSheet.legacyDocError"));
      return;
    }
    if (!isAcceptedCvFile(file)) {
      toast.error(t("resumeSheet.fileTypeError"));
      return;
    }
    if (file.size > CV_MAX_BYTES) {
      toast.error(t("resumeSheet.fileSizeError", { maxMb: CV_MAX_MB }));
      return;
    }

    setSelectedName(file.name);
    setUploading(true);
    trackEvent("cv_upload_started", { source: "profile" });
    try {
      await uploadProfileCv(file, api);
      if (!shouldMockCvUpload()) {
        toast.success(t("resumeSheet.uploadSuccess"));
      }
      trackEvent("cv_upload_completed", { source: "profile" });
      onUploaded?.();
      onClose?.();
    } catch (e) {
      trackEvent("cv_upload_failed", {
        source: "profile",
        message: e?.response?.data?.detail || e?.message,
      });
      if (!shouldMockCvUpload()) {
        toast.error(e?.response?.data?.detail || t("resumeSheet.uploadError"));
      }
    } finally {
      setUploading(false);
    }
  }, [onClose, onUploaded, t]);

  const openPicker = () => {
    if (!uploading) inputRef.current?.click();
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const displayName = selectedName || profile?.cv_filename;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !uploading) onClose?.();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-lg gap-0 overflow-y-auto rounded-2xl border-zinc-200 p-0 sm:max-w-lg"
        data-testid="resume-sheet"
      >
        <div className="px-6 pb-6 pt-6">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="font-display text-xl font-bold text-zinc-900">
              {hasResume ? t("resumeSheet.updateTitle") : t("resumeSheet.uploadTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-500">
              {hasResume ? t("resumeSheet.updateDesc") : t("resumeSheet.uploadDesc")}
            </DialogDescription>
          </DialogHeader>

          {hasResume ? (
            <div className="mt-5">
              <ResumeCurrentPreview profile={profile} active={open} />
            </div>
          ) : null}

          {hasResume ? (
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("resumeSheet.replaceZoneTitle")}
            </p>
          ) : null}

          <div
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPicker();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            data-testid="resume-dropzone"
            className={`${hasResume ? "mt-2" : "mt-5"} cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
              dragOver
                ? "scale-[1.01] border-violet-500 bg-violet-50"
                : "border-zinc-200 bg-white hover:border-violet-300 hover:bg-violet-50/40"
            } ${uploading ? "pointer-events-none opacity-60" : ""}`}
          >
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-zinc-100">
              <Upload className="h-7 w-7 text-zinc-500" strokeWidth={1.75} />
            </div>
            {displayName && uploading ? (
              <>
                <p className="font-semibold text-zinc-900">{t("resumeSheet.uploading")}</p>
                <p className="mt-1 truncate text-sm text-zinc-500">{displayName}</p>
              </>
            ) : displayName && selectedName ? (
              <>
                <p className="font-semibold text-zinc-900">{t("resumeSheet.readyToUpload")}</p>
                <p className="mt-1 truncate text-sm text-zinc-500">{displayName}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-zinc-900">
                  {hasResume ? t("resumeSheet.replaceZoneTitle") : t("resumeSheet.uploadDocument")}
                </p>
                <p className="mt-1 text-sm text-zinc-500">{t("resumeSheet.dropHint")}</p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={CV_ACCEPT_ATTR}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleFile(file);
              event.target.value = "";
            }}
            data-testid="resume-file-input"
          />

          <Button
            type="button"
            variant="brand"
            className="mt-5 h-12 w-full"
            onClick={openPicker}
            disabled={uploading}
            data-testid="resume-upload-btn"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {uploading ? t("resumeSheet.uploading") : t("resumeSheet.selectFile")}
          </Button>

          <ConfigureAiSettingsButton
            className="mt-3 w-full"
            onBeforeNavigate={onClose}
            testId="resume-sheet-ai-settings-btn"
          />

          <p className="mt-4 text-center text-xs text-zinc-400">{t("resumeSheet.fileFormats")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
