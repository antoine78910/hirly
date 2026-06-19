import { useAppLocale } from "../../context/AppLocaleContext";

export default function LanguageSwitcher({ className = "", variant = "light" }) {
  const { lang, setLang, t } = useAppLocale();
  const isDark = variant === "dark";

  return (
    <div
      className={`inline-flex rounded-xl border p-1 ${isDark ? "border-zinc-700 bg-zinc-900" : "border-zinc-200 bg-zinc-100"} ${className}`}
      role="group"
      aria-label={t("common.language")}
      data-testid="language-switcher"
    >
      {[
        { id: "en", label: t("common.english") },
        { id: "fr", label: t("common.french") },
      ].map(({ id, label }) => {
        const active = lang === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setLang(id)}
            aria-pressed={active}
            data-testid={`language-${id}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? isDark
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "bg-white text-zinc-900 shadow-sm"
                : isDark
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
