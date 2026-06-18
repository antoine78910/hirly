import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { api, API, getSessionToken } from "../lib/api";
import { Download, FileText, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
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
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedName, setSelectedName] = useState("");

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

  const download = async () => {
    const token = getSessionToken();
    const res = await fetch(`${API}/profile/cv/original`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return toast.error("No original CV to download.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = profile?.cv_filename || "cv";
    a.click();
    URL.revokeObjectURL(url);
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
        className="max-w-md gap-0 rounded-2xl border-zinc-200 p-0 sm:max-w-md"
        data-testid="resume-sheet"
      >
        <div className="px-6 pb-6 pt-6">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="font-display text-xl font-bold text-zinc-900">
              Upload Resume
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-500">
              Upload your PDF resume to get started with personalized job applications.
            </DialogDescription>
          </DialogHeader>

          {profile?.cv_filename ? (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-100">
                <FileText className="h-5 w-5 text-violet-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900" data-testid="resume-filename">
                  {profile.cv_filename}
                </p>
                <p className="text-xs text-zinc-500">Current resume on file</p>
              </div>
              <button
                type="button"
                onClick={download}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-violet-600 transition-colors hover:border-violet-300 hover:bg-violet-50"
                data-testid="resume-download-btn"
                aria-label="Download resume"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
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
            className={`mt-5 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
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
                <p className="font-semibold text-zinc-900">Uploading…</p>
                <p className="mt-1 truncate text-sm text-zinc-500">{displayName}</p>
              </>
            ) : displayName ? (
              <>
                <p className="font-semibold text-zinc-900">Ready to upload</p>
                <p className="mt-1 truncate text-sm text-zinc-500">{displayName}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-zinc-900">Upload Document</p>
                <p className="mt-1 text-sm text-zinc-500">Drag and drop or click to browse</p>
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
            {uploading ? "Uploading…" : "Select File"}
          </button>

          <p className="mt-4 text-center text-xs text-zinc-400">PDF • Max. 10MB</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
