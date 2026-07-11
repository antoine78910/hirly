import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import { BRAND } from "../../lib/brand";

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf,.doc,.docx,.txt,text/plain";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || "").trim());
}

export default function ContactSupportDialog({ open, onClose }) {
  const { user } = useAuth();
  const { t } = useAppLocale();
  const fileInputRef = useRef(null);

  const [replyEmail, setReplyEmail] = useState(user?.email || "");
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
    if (!open) {
      setMessage("");
      setFiles([]);
      return undefined;
    }
    setReplyEmail(user?.email || "");
    return undefined;
  }, [open, user?.email]);

  if (!open) return null;

  const addFiles = (incoming) => {
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) break;
      if (file.size > MAX_BYTES) {
        toast.error(t("contactSupport.fileTooLarge"));
        continue;
      }
      next.push({ file, id: `${file.name}-${file.size}-${Date.now()}` });
    }
    setFiles(next);
  };

  const removeFile = (id) => {
    setFiles((current) => current.filter((item) => item.id !== id));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const text = message.trim();
    const email = replyEmail.trim();
    if (!text || sending) return;
    if (!isValidEmail(email)) {
      toast.error(t("contactSupport.invalidEmail"));
      return;
    }

    setSending(true);
    try {
      const form = new FormData();
      form.append("reply_email", email);
      form.append("message", text);
      files.forEach(({ file }) => form.append("files", file));

      await api.post("/feedback/contact", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

      toast.success(t("contactSupport.success"));
      setFiles([]);
      setMessage("");
      onClose?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || t("contactSupport.error", { email: BRAND.SUPPORT_EMAIL }));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label={t("common.cancel")}
        onClick={onClose}
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-sprout-border bg-sprout-surface text-white shadow-2xl sm:rounded-2xl"
        data-testid="contact-support-dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-sprout-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
                <MessageSquare className="h-4 w-4" />
              </span>
              <h2 className="font-display text-lg font-bold tracking-tight">
                {t("contactSupport.title")}
              </h2>
            </div>
            <p className="mt-1 text-sm text-sprout-muted">
              {t("contactSupport.subtitle", { email: BRAND.SUPPORT_EMAIL })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sprout-muted hover:bg-sprout-surface-2"
            aria-label={t("common.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block text-sm font-semibold text-white">
            {t("contactSupport.emailLabel")}
            <input
              type="email"
              value={replyEmail}
              onChange={(e) => setReplyEmail(e.target.value)}
              placeholder={t("contactSupport.emailPlaceholder")}
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-sprout-border bg-sprout-bg px-3 py-3 text-sm text-white outline-none placeholder:text-sprout-dim focus:border-violet-400"
              data-testid="contact-support-email"
            />
          </label>
          <p className="mt-1.5 text-xs text-sprout-muted">{t("contactSupport.emailHint")}</p>

          <label className="mt-5 block text-sm font-semibold text-white">
            {t("contactSupport.messageLabel")}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder={t("contactSupport.messagePlaceholder")}
              className="mt-2 w-full resize-y rounded-xl border border-sprout-border bg-sprout-bg px-3 py-3 text-sm text-white outline-none placeholder:text-sprout-dim focus:border-violet-400"
              data-testid="contact-support-message"
            />
          </label>

          <div className="mt-5">
            <p className="text-sm font-semibold text-white">{t("contactSupport.attachmentsLabel")}</p>
            <p className="mt-1 text-xs text-sprout-muted">{t("contactSupport.attachmentsHint")}</p>

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

            {files.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {files.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-sprout-border bg-sprout-bg px-3 py-2 text-sm"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-sprout-muted" />
                    <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sprout-muted hover:bg-sprout-surface-2"
                      aria-label={t("contactSupport.removeFile")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {files.length < MAX_FILES ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-dashed border-sprout-border px-3 py-2 text-sm font-medium text-sprout-muted transition-colors hover:border-violet-400/50 hover:text-violet-300"
                data-testid="contact-support-add-file"
              >
                <Paperclip className="h-4 w-4" />
                {t("contactSupport.addAttachment")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-sprout-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-sprout-muted hover:bg-sprout-surface-2"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!message.trim() || !replyEmail.trim() || sending}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            data-testid="contact-support-submit"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sending ? t("contactSupport.sending") : t("contactSupport.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
