import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import { BRAND } from "../../lib/brand";

const BULLET_KEYS = [
  "deleteAccountDialog.bulletProfile",
  "deleteAccountDialog.bulletApplications",
  "deleteAccountDialog.bulletSwipes",
  "deleteAccountDialog.bulletBilling",
  "deleteAccountDialog.bulletSessions",
];

export default function DeleteAccountDialog({ open, onClose }) {
  const { logout } = useAuth();
  const { t } = useAppLocale();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !deleting) onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, deleting]);

  useEffect(() => {
    if (!open) setDeleting(false);
  }, [open]);

  if (!open) return null;

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.delete("/profile");
      toast.success(t("settings.accountDeleted"));
      onClose?.();
      await logout();
    } catch {
      toast.error(t("settings.deleteError"));
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label={t("deleteAccountDialog.cancel")}
        disabled={deleting}
        onClick={() => {
          if (!deleting) onClose?.();
        }}
      />
      <div
        className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl sm:rounded-2xl"
        data-testid="delete-account-dialog"
        role="alertdialog"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-description"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-100 text-rose-600">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <h2
                id="delete-account-title"
                className="font-display text-lg font-bold tracking-tight text-zinc-900"
              >
                {t("deleteAccountDialog.title")}
              </h2>
            </div>
            <p id="delete-account-description" className="mt-2 text-sm font-medium text-zinc-600">
              {t("deleteAccountDialog.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
            aria-label={t("deleteAccountDialog.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-zinc-600">
            {t("deleteAccountDialog.intro", { brand: BRAND.NAME })}
          </p>
          <ul className="mt-4 space-y-2.5">
            {BULLET_KEYS.map((key) => (
              <li key={key} className="flex items-start gap-2.5 text-sm text-zinc-800">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"
                  aria-hidden="true"
                />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800">
            {t("deleteAccountDialog.warning")}
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            data-testid="delete-account-cancel"
          >
            {t("deleteAccountDialog.cancel")}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            data-testid="delete-account-confirm"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {deleting ? t("deleteAccountDialog.deleting") : t("deleteAccountDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
