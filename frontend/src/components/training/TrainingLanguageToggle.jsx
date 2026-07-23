import { useLocation, useNavigate } from "react-router-dom";
import { useTrainingLocale } from "../../context/TrainingLocaleContext";
import { replaceTrainingLocale } from "../../lib/trainingRoutes";

export default function TrainingLanguageToggle({ className = "" }) {
  const { lang } = useTrainingLocale();
  const navigate = useNavigate();
  const location = useLocation();

  const switchLang = (code) => {
    navigate(replaceTrainingLocale(location.pathname, location.search, code));
  };

  return (
    <fieldset
      className={`inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs font-bold ${className}`}
      aria-label="Language"
    >
      {["en", "fr"].map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => switchLang(code)}
          className={`rounded-md px-2.5 py-1.5 uppercase tracking-wide transition-colors ${
            lang === code ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          {code}
        </button>
      ))}
    </fieldset>
  );
}
