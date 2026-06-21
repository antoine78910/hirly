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
        <h2 className="mb-1 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">
          {t("settings.languageTitle")}
        </h2>
        <p className="mb-3 px-1 text-sm text-sprout-muted">{t("settings.languageDesc")}</p>
        <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sprout-border bg-sprout-surface-2 text-zinc-300">
              <Globe className="h-4 w-4" strokeWidth={1.9} />
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
      <section className="mt-10" data-testid="settings-language-section">
        <div className="mb-4">
          <h2 className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
            {t("settings.languageTitle")}
          </h2>
          <p className={`mt-2 text-sm leading-relaxed ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
            {t("settings.languageDesc")}
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-5 sm:px-6">
          <LanguageSwitcher variant="dark" onLangChange={handleLang} />
        </div>
      </section>
    );
  }

  return (
    <section
      className="shell-surface p-4"
      data-testid="profile-language-section"
    >
      <div className="flex items-start gap-3">
        <div className="shell-icon-box grid h-10 w-10 shrink-0 place-items-center rounded-xl shell-border">
          <Globe className="h-4 w-4" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="shell-title font-semibold">{t("settings.languageTitle")}</p>
          <p className="mt-1 text-sm shell-body">{t("settings.languageDesc")}</p>
          <div className="mt-3">
            <LanguageSwitcher variant="light" className="dark:hidden" onLangChange={handleLang} />
            <LanguageSwitcher variant="dark" className="hidden dark:inline-flex" onLangChange={handleLang} />
          </div>
        </div>
      </div>
    </section>
  );
}
