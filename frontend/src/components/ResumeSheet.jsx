import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, API, getSessionToken } from "../lib/api";
import { FileText, Upload, Download, Loader2 } from "lucide-react";
import Sheet from "./Sheet";

/** Resume slide-in. Shows current CV + lets user re-upload (uses same /profile/cv pipeline). */
export default function ResumeSheet({ open, profile, onClose, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post("/profile/cv", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Resume updated. AI re-parsed your profile.");
      onUploaded?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
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
    a.href = url; a.download = profile?.cv_filename || "cv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} title="Resume" onClose={onClose} testId="resume-sheet">
      <div className="space-y-5">
        {profile?.cv_filename ? (
          <div className="p-5 rounded-2xl border border-sprout-border bg-sprout-surface flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-sprout-mint-soft-2 grid place-items-center">
              <FileText className="w-6 h-6 text-sprout-mint" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white truncate" data-testid="resume-filename">{profile.cv_filename}</p>
              <p className="text-xs text-sprout-muted">Template: <span className="capitalize text-sprout-mint font-semibold">{profile.template_style || "modern"}</span></p>
            </div>
            <button
              onClick={download}
              className="w-10 h-10 rounded-full bg-sprout-surface-2 border border-sprout-border grid place-items-center hover:border-sprout-mint"
              data-testid="resume-download-btn"
              aria-label="Download"
            >
              <Download className="w-4 h-4 text-sprout-mint" />
            </button>
          </div>
        ) : (
          <div className="p-5 rounded-2xl border border-dashed border-sprout-border text-center text-sprout-muted">
            No resume on file yet.
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
          data-testid="resume-file-input"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-12 rounded-full bg-sprout-mint text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60"
          data-testid="resume-upload-btn"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? "Uploading…" : profile?.cv_filename ? "Upload a new resume" : "Upload resume"}
        </button>

        {profile?.summary && (
          <div className="rounded-2xl border border-sprout-border bg-sprout-surface p-5">
            <h3 className="text-[10px] font-bold text-sprout-mint uppercase tracking-[0.18em] mb-2">AI Summary</h3>
            <p className="text-zinc-200 leading-relaxed text-[15px]">{profile.summary}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
