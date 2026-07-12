import { useEffect, useState } from "react";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useAppLocale } from "../context/AppLocaleContext";
import OnboardingContactPhoneStep from "./onboarding/OnboardingContactPhoneStep";
import {
  formatContactPhone,
  isValidContactPhone,
  parseStoredContactPhone,
} from "../lib/onboardingContactPhone";

export default function PhoneSheet({ open, profile, onClose, onSaved }) {
  const { t, lang } = useAppLocale();
  const [phonePrefix, setPhonePrefix] = useState(() => (lang === "fr" ? "+33" : "+1"));
  const [phoneLocal, setPhoneLocal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const parsed = parseStoredContactPhone(profile?.contact?.phone, lang);
    setPhonePrefix(parsed.prefix);
    setPhoneLocal(parsed.local);
  }, [open, profile?.contact?.phone, lang]);

  const savePhone = async () => {
    if (!isValidContactPhone(phoneLocal)) {
      toast.error(t("phoneSheet.invalidPhone"));
      return;
    }
    setSaving(true);
    try {
      const phone = formatContactPhone(phonePrefix, phoneLocal);
      await api.put("/profile/contact", { phone });
      const nextProfile = {
        ...(profile || {}),
        contact: { ...(profile?.contact || {}), phone },
      };
      toast.success(t("phoneSheet.saved"));
      onSaved?.(nextProfile);
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("phoneSheet.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose?.();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-lg gap-0 overflow-y-auto rounded-2xl border-zinc-200 p-0 sm:max-w-lg"
        data-testid="phone-sheet"
      >
        <div className="px-6 pb-6 pt-6">
          <DialogHeader className="space-y-2 text-left">
            <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-600">
              <Phone className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <DialogTitle className="font-display text-xl font-bold text-zinc-900">
              {t("phoneSheet.title")}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-500">
              {t("phoneSheet.desc")}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <OnboardingContactPhoneStep
              lang={lang}
              phonePrefix={phonePrefix}
              phoneLocal={phoneLocal}
              onPrefixChange={setPhonePrefix}
              onPhoneChange={setPhoneLocal}
            />
          </div>

          <Button
            type="button"
            variant="brand"
            className="mt-5 h-12 w-full rounded-full"
            onClick={savePhone}
            disabled={saving || !isValidContactPhone(phoneLocal)}
            data-testid="phone-sheet-save-btn"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t("phoneSheet.saving") : t("phoneSheet.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
