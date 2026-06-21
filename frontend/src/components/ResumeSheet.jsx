import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { FileText, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import ConfigureAiSettingsButton from "./settings/ConfigureAiSettingsButton";
import ResumeCurrentPreview from "./profile/ResumeCurrentPreview";
import { useAppLocale } from "../context/AppLocaleContext";
import { trackEvent } from "../lib/analytics";

const MAX_CV_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];
const ACCEPTED_EXT = [".pdf", ".docx", ".txt"];

function isAcceptedFile(file) {
  if (!file) return false;
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  return ACCEPTED_EXT.includes(ext) || ACCEPTED_TYPES.includes(file.type);
}

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
    if (!isAcceptedFile(file)) {
      toast.error("Please upload a PDF, DOCX, or TXT file.");
      return;
    }
    if (file.size > MAX_CV_BYTES) {
      toast.error("File must be 10MB or smaller.");
      return;
    }

    setSelectedName(file.name);
    setUploading(true);
    trackEvent("cv_upload_started", { source: "profile" });
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post("/profile/cv", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Resume updated. AI re-parsed your profile.");
      trackEvent("cv_upload_completed", { source: "profile" });
      onUploaded?.();
      onClose?.();
    } catch (e) {
      trackEvent("cv_upload_failed", {
        source: "profile",
        message: e?.response?.data?.detail || e?.message,
      });
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [onClose, onUploaded]);

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
            accept={ACCEPTED_EXT.join(",")}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleFile(file);
              event.target.value = "";
            }}
            data-testid="resume-file-input"
          />

          <button
            type="button"
            onClick={openPicker}
            disabled={uploading}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full gradient-linkedin text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
            data-testid="resume-upload-btn"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {uploading ? t("resumeSheet.uploading") : t("resumeSheet.selectFile")}
          </button>

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
