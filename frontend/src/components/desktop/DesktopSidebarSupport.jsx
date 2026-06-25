import { useState } from "react";
import { Headphones, Sparkles } from "lucide-react";
import { useAppLocale } from "../../context/AppLocaleContext";
import { BRAND } from "../../lib/brand";
import SuggestFeatureDialog from "./SuggestFeatureDialog";

export default function DesktopSidebarSupport({ supportBtnClass, isDark = false }) {
  const { t } = useAppLocale();
  const [suggestOpen, setSuggestOpen] = useState(false);

  const openSupport = () => {
    window.open(`mailto:hi@hirly.com?subject=${encodeURIComponent(`${BRAND.NAME} support`)}`, "_blank", "noopener");
  };

  return (
    <>
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setSuggestOpen(true)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm ${supportBtnClass}`}
          data-testid="desktop-suggest-feature"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("suggestFeature.nav")}</span>
        </button>
        <button
          type="button"
          onClick={openSupport}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm ${supportBtnClass}`}
          data-testid="desktop-support"
        >
          <Headphones className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("common.support")}</span>
        </button>
      </div>

      <SuggestFeatureDialog open={suggestOpen} onClose={() => setSuggestOpen(false)} isDark={isDark} />
    </>
  );
}
