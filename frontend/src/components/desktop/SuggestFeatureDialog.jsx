import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useAppLocale } from "../../context/AppLocaleContext";

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function readFilePreview(file) {
  return URL.createObjectURL(file);
}

export default function SuggestFeatureDialog({ open, onClose, isDark = false, audience = "user" }) {
  const { user, hasTrainingAccess } = useAuth();
  const { t } = useAppLocale();
  const fileInputRef = useRef(null);

  const [category, setCategory] = useState("feature");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return undefined;
    setFiles((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.preview));
      return [];
    });
    setMessage("");
    setCategory("feature");
    return undefined;
  }, [open]);

  if (!open) return null;

  const panel = isDark
    ? "border-zinc-800 bg-zinc-950 text-white"
    : "border-zinc-200 bg-white text-zinc-900";
  const muted = isDark ? "text-zinc-500" : "text-zinc-500";
  const field = isDark
    ? "border-zinc-800 bg-zinc-900 text-white placeholder:text-zinc-600"
    : "border-zinc-200 bg-zinc-50 text-zinc-900 placeholder:text-zinc-400";
  const chipOff = isDark
    ? "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300";
  const chipOn = isDark
    ? "border-violet-500 bg-violet-500/15 text-violet-200"
    : "border-violet-300 bg-violet-50 text-violet-700";

  const categories = [
    { id: "feature", label: t("suggestFeature.categoryFeature") },
    { id: "problem", label: t("suggestFeature.categoryProblem") },
    { id: "other", label: t("suggestFeature.categoryOther") },
  ];

  const addFiles = (incoming) => {
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) break;
      if (!file.type.startsWith("image/")) {
        toast.error(t("suggestFeature.imagesOnly"));
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(t("suggestFeature.fileTooLarge"));
        continue;
      }
      next.push({ file, preview: readFilePreview(file), id: `${file.name}-${file.size}-${Date.now()}` });
    }
    setFiles(next);
  };

  const removeFile = (id) => {
    setFiles((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((item) => item.id !== id);
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const form = new FormData();
      form.append("message", text);
      form.append("category", category);
      form.append("audience", audience === "creator" || hasTrainingAccess ? "creator" : "user");
      files.forEach(({ file }) => form.append("files", file));

      await api.post("/feedback/suggest-feature", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success(t("suggestFeature.success"));
      files.forEach((item) => URL.revokeObjectURL(item.preview));
      setFiles([]);
      setMessage("");
      setCategory("feature");
      onClose?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || t("suggestFeature.error"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        aria-label={t("common.cancel")}
        onClick={onClose}
      />
      <form
        onSubmit={handleSubmit}
        className={`relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl ${panel}`}
        data-testid="suggest-feature-dialog"
      >
        <div className={`flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6 ${isDark ? "border-zinc-800" : "border-zinc-100"}`}>
          <div>
            <div className="flex items-center gap-2">
              <span className={`grid h-8 w-8 place-items-center rounded-xl ${isDark ? "bg-violet-500/15 text-violet-300" : "bg-violet-100 text-violet-600"}`}>
                <Sparkles className="h-4 w-4" />
              </span>
              <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
                {t("suggestFeature.title")}
              </h2>
            </div>
            <p className={`mt-1 text-sm ${muted}`}>{t("suggestFeature.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isDark ? "text-zinc-400 hover:bg-zinc-900" : "text-zinc-500 hover:bg-zinc-100"}`}
            aria-label={t("common.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${muted}`}>
            {t("suggestFeature.typeLabel")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  category === item.id ? chipOn : chipOff
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className={`mt-5 block text-sm font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>
            {t("suggestFeature.detailsLabel")}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder={t("suggestFeature.detailsPlaceholder")}
              className={`mt-2 w-full resize-y rounded-xl border px-3 py-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/60 ${field}`}
              data-testid="suggest-feature-message"
            />
          </label>

          <div className="mt-5">
            <p className={`text-sm font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>
              {t("suggestFeature.attachmentsLabel")}
            </p>
            <p className={`mt-1 text-xs ${muted}`}>{t("suggestFeature.attachmentsHint")}</p>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((item) => (
                <div
                  key={item.id}
                  className={`group relative h-20 w-20 overflow-hidden rounded-xl border ${isDark ? "border-zinc-700" : "border-zinc-200"}`}
                >
                  <img src={item.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(item.id)}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={t("suggestFeature.removeImage")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {files.length < MAX_FILES ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium transition-colors ${
                    isDark
                      ? "border-zinc-700 text-zinc-500 hover:border-violet-500/50 hover:text-violet-300"
                      : "border-zinc-300 text-zinc-500 hover:border-violet-300 hover:text-violet-600"
                  }`}
                  data-testid="suggest-feature-add-images"
                >
                  <ImagePlus className="h-4 w-4" />
                  {t("suggestFeature.addImages")}
                </button>
              ) : null}
            </div>
          </div>

          {user?.email ? (
            <p className={`mt-4 text-xs ${muted}`}>
              {t("suggestFeature.sentAs", { email: user.email })}
            </p>
          ) : null}
        </div>

        <div className={`flex items-center justify-end gap-2 border-t px-5 py-4 sm:px-6 ${isDark ? "border-zinc-800" : "border-zinc-100"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${isDark ? "text-zinc-400 hover:bg-zinc-900" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!message.trim() || sending}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            data-testid="suggest-feature-submit"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sending ? t("suggestFeature.sending") : t("suggestFeature.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
