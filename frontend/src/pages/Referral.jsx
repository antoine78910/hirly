import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import ReferralPanel from "../components/profile/ReferralPanel";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import { useAppLocale } from "../context/AppLocaleContext";

export default function Referral() {
  const navigate = useNavigate();
  const { t } = useAppLocale();

  return (
    <div className="min-h-dvh bg-white pb-10 text-zinc-900 md:min-h-0">
      <div className={`${APP_CONTENT_WIDTH} pt-5 md:py-8`}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 grid h-10 w-10 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 md:hidden"
          aria-label={t("common.close")}
          data-testid="referral-close"
        >
          <X className="h-6 w-6" />
        </button>

        <DesktopPageHeader
          title={t("referralPanel.pageTitle")}
          subtitle={t("referralPanel.pageSubtitle")}
        />

        <ReferralPanel />
      </div>
    </div>
  );
}
