import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAppLocale } from "../../context/AppLocaleContext";

/** Link to /settings (AI application toggles). */
export default function ConfigureAiSettingsButton({
  className = "",
  onBeforeNavigate,
  testId = "configure-ai-settings-btn",
}) {
  const navigate = useNavigate();
  const { t } = useAppLocale();

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        onBeforeNavigate?.();
        navigate("/settings");
      }}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white gradient-linkedin shadow-[0_8px_28px_rgba(124,58,237,0.35)] transition-opacity hover:opacity-90 ${className}`}
    >
      <Sparkles className="h-4 w-4" />
      {t("profile.documents.configureAiSettings")}
    </button>
  );
}
