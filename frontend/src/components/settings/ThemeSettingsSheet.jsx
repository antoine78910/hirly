import { Check, Moon, Sun } from "lucide-react";
import Sheet from "../Sheet";
import { useAppLocale } from "../../context/AppLocaleContext";
import { useMobileTheme } from "../../context/MobileThemeContext";
import { toast } from "sonner";

const OPTIONS = [
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
];

export default function ThemeSettingsSheet({ open, onClose }) {
  const { t } = useAppLocale();
  const { theme, setMobileTheme } = useMobileTheme();

  const choose = (next) => {
    if (next === theme) {
      onClose?.();
      return;
    }
    setMobileTheme(next);
    toast.success(t("settings.themeSaved"));
    onClose?.();
  };

  return (
    <Sheet open={open} title={t("settings.theme")} onClose={onClose} testId="theme-settings-sheet">
      <p className="text-sm text-sprout-muted">{t("settings.themeIntro")}</p>
      <div className="mt-5 space-y-3">
        {OPTIONS.map(({ id, icon: Icon }) => {
          const selected = theme === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              data-testid={`theme-option-${id}`}
              className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors ${
                selected
                  ? "border-violet-400/60 bg-violet-500/10"
                  : "border-sprout-border bg-sprout-surface hover:bg-sprout-surface-2"
              }`}
            >
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${
                  selected
                    ? "border-violet-400/40 bg-violet-500/15 text-violet-300"
                    : "border-sprout-border bg-sprout-surface-2 text-sprout-muted"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-white">
                  {t(id === "dark" ? "settings.themeDark" : "settings.themeLight")}
                </span>
                <span className="mt-1 block text-sm text-sprout-muted">
                  {t(id === "dark" ? "settings.themeDarkHint" : "settings.themeLightHint")}
                </span>
              </span>
              {selected ? <Check className="h-5 w-5 shrink-0 text-violet-400" /> : null}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
