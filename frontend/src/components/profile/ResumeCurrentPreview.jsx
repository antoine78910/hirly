import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { API, getSessionToken } from "../../lib/api";
import { fetchDemoCvOriginal, shouldMockCvUpload } from "../../lib/demoCvUpload";
import { useAppLocale } from "../../context/AppLocaleContext";

function isStaticPreviewUrl(url) {
  return typeof url === "string" && (url.startsWith("/") || url.startsWith("http"));
}

function inferResumeMime(profile) {
  if (profile?.cv_mime) return profile.cv_mime;
  const name = (profile?.cv_filename || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function inlinePreviewMode(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return null;
}

/** Read-only resume preview — PDF iframe or document image. No edit actions. */
export default function ResumeCurrentPreview({
  profile,
  active = true,
  compact = false,
  isExample = false,
}) {
  const { t } = useAppLocale();
  const [loading, setLoading] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [mode, setMode] = useState(null);

  const staticPreviewUrl = profile?.cv_preview_url;
  const hasResume = Boolean(profile?.cv_filename || profile?.cv_text || staticPreviewUrl);
  const filename = profile?.cv_filename || t("profile.documents.resumeFallbackName");
  const previewHeight = compact ? "h-64" : "h-[28rem]";
  const sectionLabel = isExample ? t("resumeSheet.exampleResume") : t("resumeSheet.currentResume");

  useEffect(() => {
    if (!active || !hasResume) {
      setBlobUrl(null);
      setMode(null);
      setLoading(false);
      return undefined;
    }

    if (staticPreviewUrl && isStaticPreviewUrl(staticPreviewUrl)) {
      setBlobUrl(staticPreviewUrl);
      setMode("image");
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;
    const mime = inferResumeMime(profile);
    const previewMode = inlinePreviewMode(mime);

    async function loadBinaryPreview() {
      setLoading(true);
      setBlobUrl(null);
      setMode(null);
      try {
        let blob = null;
        if (shouldMockCvUpload()) {
          blob = await fetchDemoCvOriginal();
        }
        if (!blob) {
          const token = getSessionToken();
          const res = await fetch(`${API}/profile/cv/original`, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error("missing original");
          blob = await res.blob();
        }
        const resolvedMime = blob.type || mime;
        const resolvedMode = inlinePreviewMode(resolvedMime);
        if (!resolvedMode) {
          if (!cancelled) setMode("unsupported");
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setBlobUrl(objectUrl);
        setMode(resolvedMode);
      } catch {
        if (!cancelled && staticPreviewUrl) {
          setBlobUrl(staticPreviewUrl);
          setMode("image");
        } else if (!cancelled) {
          setMode("unsupported");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (previewMode) {
      loadBinaryPreview();
    } else {
      setMode("unsupported");
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    active,
    hasResume,
    profile?.cv_filename,
    profile?.cv_mime,
    profile?.cv_text,
    staticPreviewUrl,
    profile,
  ]);

  if (!hasResume) return null;

  return (
    <section className="space-y-2" data-testid="resume-current-preview">
      <p className="text-xs font-semibold uppercase tracking-wide shell-body">{sectionLabel}</p>

      <div className="shell-surface-sm overflow-hidden shadow-sm">
        <div className={`relative ${previewHeight} overflow-hidden bg-zinc-200 dark:bg-zinc-800`}>
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">{t("resumeSheet.previewLoading")}</span>
            </div>
          ) : mode === "pdf" && blobUrl ? (
            <iframe
              src={`${blobUrl}#toolbar=0&navpanes=0&view=FitH`}
              title={t("resumeSheet.previewFrameTitle")}
              className="ph-no-capture h-full w-full border-0 bg-white"
              data-testid="resume-preview-pdf"
            />
          ) : mode === "image" && blobUrl ? (
            <img
              src={blobUrl}
              alt={filename}
              className="ph-no-capture pointer-events-none h-full w-full select-none object-contain object-top bg-white"
              draggable={false}
              data-testid="resume-preview-image"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-zinc-500">
              <FileText className="h-8 w-8 text-violet-400" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{filename}</p>
              <p className="max-w-xs text-xs leading-relaxed">{t("resumeSheet.pdfPreviewOnly")}</p>
            </div>
          )}
        </div>

        <div className="shell-border-b flex items-center gap-2 bg-white px-3 py-2.5 dark:bg-zinc-900 sm:px-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-100 dark:bg-violet-500/20">
            <FileText className="h-4 w-4 text-linkedin" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="shell-title truncate text-sm font-medium" data-testid="resume-filename">
              {filename}
            </p>
            <p className="text-xs shell-body">
              {isExample ? t("resumeSheet.exampleOnFile") : t("resumeSheet.previewReadOnly")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
