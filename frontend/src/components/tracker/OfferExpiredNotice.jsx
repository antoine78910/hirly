import { useAppLocale } from "../../context/AppLocaleContext";

export default function OfferExpiredNotice({
  application,
  compact = false,
  className = "",
  testId = "offer-expired-notice",
}) {
  const { lang, t } = useAppLocale();
  const title =
    lang === "fr"
      ? application?.failure_message_fr || t("tracker.offerExpiredSorry")
      : application?.failure_message_en || t("tracker.offerExpiredSorry");
  const body = application?.credit_refunded_at
    ? t("tracker.expiredRefundBody")
    : t("tracker.offerExpiredBody");

  if (compact) {
    return (
      <div
        className={`rounded-xl bg-[#d9534f] px-3 py-2 text-center text-sm font-semibold text-white ${className}`}
        data-testid={testId}
      >
        {title}
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl bg-[#d9534f] px-4 py-4 text-center text-white shadow-sm ${className}`}
      data-testid={testId}
    >
      <p className="text-base font-bold sm:text-lg">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/95">{body}</p>
    </div>
  );
}
