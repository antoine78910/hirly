import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAppLocale } from "../../context/AppLocaleContext";
import { Button } from "../ui/button";

/** Link to /settings (AI application toggles). */
export default function ConfigureAiSettingsButton({
  variant = "outline",
  className = "",
  onBeforeNavigate,
  testId = "configure-ai-settings-btn",
}) {
  const navigate = useNavigate();
  const { t } = useAppLocale();

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      data-testid={testId}
      onClick={() => {
        onBeforeNavigate?.();
        navigate("/settings");
      }}
    >
      <Sparkles className="h-4 w-4" />
      {t("profile.documents.configureAiSettings")}
    </Button>
  );
}
