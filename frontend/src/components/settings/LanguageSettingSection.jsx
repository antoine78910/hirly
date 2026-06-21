import { Globe } from "lucide-react";
import { toast } from "sonner";
import LanguageSwitcher from "./LanguageSwitcher";
import { useAppLocale } from "../../context/AppLocaleContext";

export default function LanguageSettingSection({ variant = "profile" }) {
  const { lang, setLang, t } = useAppLocale();

  const handleLang = (next) => {
    if (next === lang) return;
    setLang(next);
    toast.success(next === "fr" ? t("settings.languageSetFr") : t("settings.languageSetEn"), {
      duration: 1800,
    });
  };

  if (variant === "mobile") {
    return (
      <section className="mt-7" data-testid="settings-language-section">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">
          {t("settings.languageTitle")}
        </h2>
        <p className="mb-3 px-1 text-sm text-sprout-muted">{t("settings.languageDesc")}</p>
        <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sprout-mint-soft">
              <Globe className="h-4 w-4 text-sprout-mint" />
            </div>
            <div className="min-w-0 flex-1">
              <LanguageSwitcher variant="dark" className="w-full justify-start" onLangChange={handleLang} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === "desktop") {
    const isDark = true;
    return (
      <section className="relative mt-10" data-testid="settings-language-section">
        <div className="mb-4 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-300">
            <Globe className="h-3.5 w-3.5" />
            {t("settings.languageTitle")}
          </div>
          <p className={`mt-3 text-base leading-relaxed ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
            {t("settings.languageDesc")}
          </p>
        </div>
        <div className="overflow-hidden rounded-[27px] border border-zinc-800 bg-zinc-900/95 px-5 py-5 sm:px-6">
          <LanguageSwitcher variant="dark" onLangChange={handleLang} />
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
      data-testid="profile-language-section"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50">
          <Globe className="h-5 w-5 text-linkedin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-zinc-900">{t("settings.languageTitle")}</p>
          <p className="mt-1 text-sm text-zinc-500">{t("settings.languageDesc")}</p>
          <div className="mt-3">
            <LanguageSwitcher variant="light" onLangChange={handleLang} />
          </div>
        </div>
      </div>
    </section>
  );
}
