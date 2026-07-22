import { useId } from "react";
import { useAppLocale } from "../../context/AppLocaleContext";
import { APP_LANGUAGES } from "../../lib/appUi";

const LANGUAGE_LABEL_KEYS = {
  en: "common.english",
  fr: "common.french",
  de: "common.german",
  es: "common.spanish",
  it: "common.italian",
};

/** A compact, explicit public-site selector for every supported UI locale. */
export default function LandingLanguageSelector() {
  const { lang, setLang, t } = useAppLocale();
  const id = useId();

  return (
    <div className="flex items-center">
      <label htmlFor={id} className="sr-only">
        {t("common.language")}
      </label>
      <select
        id={id}
        value={lang}
        onChange={(event) => setLang(event.target.value)}
        data-testid="landing-language-selector"
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:border-linkedin hover:text-linkedin focus:border-linkedin focus:outline-none focus:ring-2 focus:ring-linkedin/20"
      >
        {APP_LANGUAGES.map((value) => (
          <option key={value} value={value}>
            {t(LANGUAGE_LABEL_KEYS[value])}
          </option>
        ))}
      </select>
    </div>
  );
}
