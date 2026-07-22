import { useFeatureFlagEnabled } from "@posthog/react";
import { Wrench } from "lucide-react";

import { useAppLocale } from "../../context/AppLocaleContext";

export const MAINTENANCE_BANNER_FLAG_KEY = "maintenance-banner";

const COPY = {
  en: {
    title: "Scheduled maintenance",
    message: "Some features may be temporarily unavailable. We're working to restore full service.",
  },
  fr: {
    title: "Maintenance en cours",
    message:
      "Certaines fonctionnalités peuvent être temporairement indisponibles. Nous rétablissons le service au plus vite.",
  },
} as const;

export default function MaintenanceBanner() {
  const enabled = useFeatureFlagEnabled(MAINTENANCE_BANNER_FLAG_KEY, false);
  const { lang } = useAppLocale();

  if (!enabled) return null;

  const copy = COPY[lang === "fr" ? "fr" : "en"];

  return (
    <aside
      aria-live="polite"
      className="sticky top-0 z-[9998] border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
      data-testid="maintenance-banner"
      role="status"
    >
      <div className="mx-auto flex max-w-6xl items-start justify-center gap-2 sm:items-center">
        <Wrench aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
        <p className="text-left text-sm leading-5 sm:text-center">
          <strong className="font-semibold">{copy.title}.</strong> <span>{copy.message}</span>
        </p>
      </div>
    </aside>
  );
}
