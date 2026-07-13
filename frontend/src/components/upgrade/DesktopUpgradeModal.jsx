import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Check,
  HeartHandshake,
  Loader2,
  Rocket,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { withDatafastAttribution } from "@/lib/datafast";
import Logo from "@/components/Logo";
import { useAppLocale } from "@/context/AppLocaleContext";
import { getUpgradeContent } from "@/lib/appUi";
import { formatMoney, formatUnitMoney } from "@/lib/currency";
import {
  SUBSCRIPTION_TIERS,
  tierApplicationsForInterval,
  tierPricePerApplication,
} from "@/lib/subscriptionTiers";
import LegalLink from "@/components/legal/LegalLink";

const FEATURE_ICONS = { zap: Zap, sparkles: Sparkles, rocket: Rocket, check: Check, heart: HeartHandshake };

function FeatureItem({ title, description, icon, roundIcon = true }) {
  const Icon = FEATURE_ICONS[icon] || Zap;
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-transparent bg-transparent px-4 py-3 text-sm">
      <div
        className={`flex size-8 shrink-0 items-center justify-center border bg-muted [&_svg]:size-4 ${
          roundIcon ? "rounded-full" : "rounded-sm"
        }`}
      >
        <Icon className="text-linkedin" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-sm font-medium leading-snug">{title}</div>
        <p className="text-sm leading-normal text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function TierCard({ tier, selected, onSelect, isMonthly, t, lang }) {
  const price = isMonthly ? tier.monthlyPrice : tier.weeklyPrice;
  const period = isMonthly ? t("upgrade.perMonth") : t("upgrade.perWeek");
  const applicationCount = tierApplicationsForInterval(tier, isMonthly);
  const unitPrice = tierPricePerApplication(tier, isMonthly);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-state={selected ? "on" : "off"}
      onClick={onSelect}
      className={`relative cursor-pointer rounded-xl border-2 px-2.5 pb-2.5 pt-5 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 sm:px-4 sm:pb-4 sm:pt-6 lg:px-6 lg:pb-6 lg:pt-7 ${
        selected
          ? "border-sprout-mint bg-card text-card-foreground ring-2 ring-violet-500/20"
          : "border-border bg-card text-card-foreground hover:border-violet-300"
      }`}
    >
      {tier.popular ? (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap sm:-top-3">
          <span className="inline-flex items-center rounded-full border border-transparent bg-sprout-mint px-1.5 py-0.5 text-[9px] font-medium text-white sm:px-2 sm:text-xs">
            {t("upgrade.popular")}
          </span>
        </div>
      ) : null}
      <div className="space-y-0.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-linkedin sm:text-xs">{tier.name}</div>
        <div className="text-base font-bold sm:text-xl lg:text-2xl">{formatMoney(price, lang)}</div>
        <div className="text-[10px] text-muted-foreground sm:text-xs">{period}</div>
        <div className="text-[9px] font-semibold leading-tight text-foreground [overflow-wrap:anywhere] sm:text-xs">
          {t("upgrade.applications", { n: applicationCount })}
        </div>
        <div className="text-[9px] leading-tight text-muted-foreground [overflow-wrap:anywhere] sm:text-[11px]">
          {t("upgrade.pricePerApplication", { price: formatUnitMoney(unitPrice, lang) })}
        </div>
      </div>
    </button>
  );
}

function PricingGrid({ tiers, isMonthly, selectedTier, onSelectTier, t, lang }) {
  const tierCount = tiers.length;
  const gridClass =
    tierCount === 1
      ? "grid grid-cols-1 gap-2 sm:gap-4"
      : tierCount === 2
        ? "grid grid-cols-2 gap-2 sm:gap-4"
        : "grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-6";

  return (
    <div role="radiogroup" className={gridClass}>
      {tiers.map((tier) => (
        <TierCard
          key={tier.id}
          tier={tier}
          selected={selectedTier === tier.id}
          onSelect={() => onSelectTier(tier.id)}
          isMonthly={isMonthly}
          t={t}
          lang={lang}
        />
      ))}
    </div>
  );
}

/** Applications count normalized to a monthly-equivalent, for ranking against SUBSCRIPTION_TIERS. */
function monthlyEquivalentApplications(billing) {
  if (!billing?.is_premium) return 0;
  const total = Number(billing.credits_total || 0);
  return billing.interval === "weekly" ? total * 4 : total;
}

export default function DesktopUpgradeModal({ open, onClose }) {
  const { t, lang } = useAppLocale();
  const location = useLocation();
  const returnPath = `${location.pathname}${location.search}`;
  const { features: UPGRADE_FEATURES, stats: UPGRADE_STATS, benefits: UPGRADE_BENEFITS } = getUpgradeContent(t);
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [selectedTier, setSelectedTier] = useState("ultra");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [currentBilling, setCurrentBilling] = useState(null);

  const isMonthly = billingInterval === "monthly";
  const isExistingSubscriber = Boolean(currentBilling?.is_premium);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get("/billing/status")
      .then(({ data }) => {
        if (!cancelled) setCurrentBilling(data || null);
      })
      .catch(() => {
        if (!cancelled) setCurrentBilling(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Existing subscribers can only move to a strictly higher tier (proration handles the
  // upgrade); lock their billing interval to whatever they're already on.
  useEffect(() => {
    if (isExistingSubscriber && currentBilling?.interval) {
      setBillingInterval(currentBilling.interval === "weekly" ? "weekly" : "monthly");
    }
  }, [isExistingSubscriber, currentBilling]);

  const currentMonthlyEquivalent = useMemo(
    () => monthlyEquivalentApplications(currentBilling),
    [currentBilling],
  );
  const availableTiers = useMemo(() => {
    if (!isExistingSubscriber) return SUBSCRIPTION_TIERS;
    return SUBSCRIPTION_TIERS.filter((tier) => tier.applications > currentMonthlyEquivalent);
  }, [isExistingSubscriber, currentMonthlyEquivalent]);
  const hasUpgradeOption = availableTiers.length > 0;

  useEffect(() => {
    if (!availableTiers.some((tier) => tier.id === selectedTier)) {
      const nearestUpgrade = availableTiers[availableTiers.length - 1];
      if (nearestUpgrade) setSelectedTier(nearestUpgrade.id);
    }
  }, [availableTiers, selectedTier]);

  const handleManageSubscription = async () => {
    setCheckoutLoading(true);
    try {
      const { data } = await api.post("/billing/create-portal-session");
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast.error(t("upgrade.checkoutError"));
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("upgrade.checkoutFailed"));
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      if (isExistingSubscriber) {
        const { data } = await api.post("/billing/create-upgrade-session", {
          plan: selectedTier,
          interval: billingInterval,
          return_path: returnPath,
        });
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        toast.error(t("upgrade.checkoutError"));
        return;
      }
      const { data } = await api.post("/billing/create-checkout-session", withDatafastAttribution({
        plan: selectedTier,
        interval: billingInterval,
        source: "app",
        return_path: returnPath,
      }));
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast.error(t("upgrade.checkoutError"));
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("upgrade.checkoutFailed"));
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent
        className="sprout fixed top-[50%] left-[50%] z-50 flex h-auto max-h-dvh w-full max-w-full translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden rounded-lg border bg-background p-0 shadow-lg sm:h-[95vh] sm:max-w-[95vw] lg:max-w-6xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("upgrade.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("upgrade.subtitle")}
        </DialogDescription>

        <div className="absolute top-6 left-6 z-20 hidden lg:block">
          <Logo size={32} className="h-8 w-auto" />
        </div>

        <div className="flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden">
          <div className="hidden w-1/3 flex-col justify-between border-r bg-secondary/30 p-8 lg:flex">
            <div className="flex flex-1 flex-col justify-center">
              <div className="flex flex-col gap-6">
                {UPGRADE_FEATURES.map((feature) => (
                  <FeatureItem key={feature.title} {...feature} roundIcon />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {UPGRADE_STATS.map((stat) => (
                <div key={stat.label} className="min-w-0 rounded-lg border bg-background/80 px-1 py-2.5 text-center sm:px-2 sm:py-3">
                  <div className="text-base font-bold leading-none text-linkedin sm:text-lg">{stat.value}</div>
                  <div className="mt-1 text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere] sm:text-xs">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            <div className="p-4 sm:p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:p-10">
              <div className="mb-2 flex justify-center lg:hidden">
                <Logo size={28} className="h-7 w-auto sm:h-8" />
              </div>

              <div className="mx-auto max-w-3xl space-y-3 sm:space-y-6">
                <div className="text-center sm:pt-8">
                  <div className="mb-2 inline-flex items-center rounded-full bg-sprout-mint-soft px-2.5 py-1 text-xs font-medium text-linkedin sm:mb-4 sm:px-3 sm:py-1.5 sm:text-sm">
                    <Star className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" aria-hidden />
                    {t("upgrade.limitedOffer")}
                  </div>
                  <h1 className="mb-1 text-xl font-bold sm:mb-2 sm:text-3xl">{t("upgrade.title")}</h1>
                  <p className="hidden text-sm text-muted-foreground sm:block">
                    {t("upgrade.subtitle")}
                  </p>
                </div>

                {!hasUpgradeOption ? (
                  <div className="rounded-xl border border-border bg-muted px-6 py-8 text-center">
                    <h2 className="text-lg font-semibold">{t("upgrade.bestPlanTitle")}</h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">{t("upgrade.bestPlanDesc")}</p>
                  </div>
                ) : isExistingSubscriber ? (
                  <>
                    <div className="flex justify-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                        {t("upgrade.yourBilling")}: {isMonthly ? t("upgrade.monthly") : t("upgrade.weekly")}
                      </span>
                    </div>
                    <PricingGrid
                      tiers={availableTiers}
                      isMonthly={isMonthly}
                      selectedTier={selectedTier}
                      onSelectTier={setSelectedTier}
                      t={t}
                      lang={lang}
                    />
                    <p className="text-center text-xs text-muted-foreground">
                      {t("upgrade.prorationNote")}
                    </p>
                  </>
                ) : (
                  <Tabs value={billingInterval} onValueChange={setBillingInterval}>
                    <div className="flex justify-center">
                      <div className="relative">
                        <span className="absolute -top-2.5 left-1/4 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-transparent bg-sprout-mint px-1.5 py-0.5 text-[9px] font-medium text-white sm:-top-3 sm:text-[10px]">
                          {t("upgrade.save25")}
                        </span>
                        <TabsList className="grid h-9 w-full min-w-0 max-w-full grid-cols-2 rounded-lg bg-muted p-[3px] sm:min-w-80">
                          <TabsTrigger value="monthly" className="h-[calc(100%-1px)] min-w-0 flex-1 px-2 text-xs sm:text-sm">
                            {t("upgrade.monthly")}
                          </TabsTrigger>
                          <TabsTrigger value="weekly" className="h-[calc(100%-1px)] min-w-0 flex-1 px-2 text-xs sm:text-sm">
                            {t("upgrade.weekly")}
                          </TabsTrigger>
                        </TabsList>
                      </div>
                    </div>

                    <TabsContent value="monthly" className="mt-3 outline-none sm:mt-6">
                      <PricingGrid
                        tiers={availableTiers}
                        isMonthly
                        selectedTier={selectedTier}
                        onSelectTier={setSelectedTier}
                        t={t}
                        lang={lang}
                      />
                    </TabsContent>
                    <TabsContent value="weekly" className="mt-3 outline-none sm:mt-6">
                      <PricingGrid
                        tiers={availableTiers}
                        isMonthly={false}
                        selectedTier={selectedTier}
                        onSelectTier={setSelectedTier}
                        t={t}
                        lang={lang}
                      />
                    </TabsContent>
                  </Tabs>
                )}

                <div className="hidden sm:block">
                  <div className="flex flex-col gap-6 rounded-xl border bg-muted py-6 text-card-foreground shadow-sm">
                    <div className="px-6">
                      <h3 className="mb-4 text-center text-lg font-semibold">{t("upgrade.title")}</h3>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {UPGRADE_BENEFITS.map((benefit) => (
                          <FeatureItem key={benefit.title} {...benefit} roundIcon={false} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="hidden text-center text-xs text-muted-foreground sm:block">
                  {t("upgrade.stripe")}
                </p>
              </div>
            </div>

            <div className="shrink-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
              <div className="mx-auto max-w-3xl space-y-2.5 sm:space-y-4">
                {!hasUpgradeOption ? (
                  <button
                    type="button"
                    onClick={handleManageSubscription}
                    disabled={checkoutLoading}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md gradient-linkedin px-6 text-sm font-medium whitespace-nowrap text-white shadow-[0_8px_32px_-8px_rgba(124,58,237,0.35)] transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {checkoutLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    {t("upgrade.manageSubscription")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={checkoutLoading}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md gradient-linkedin px-6 text-sm font-medium whitespace-nowrap text-white shadow-[0_8px_32px_-8px_rgba(124,58,237,0.35)] transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {checkoutLoading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Rocket className="size-4" aria-hidden />
                    )}
                    {isExistingSubscriber ? t("upgrade.upgradeCta") : t("upgrade.cta")}
                  </button>
                )}

                <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground sm:gap-x-4 sm:text-xs">
                  {[t("upgrade.cancelAnytime"), t("upgrade.securePayments"), t("upgrade.instantAccess")].map((label) => (
                    <span key={label} className="flex max-w-full min-w-0 items-center gap-1 text-center leading-tight">
                      <Check className="size-3 shrink-0 text-linkedin sm:size-4" aria-hidden />
                      <span className="[overflow-wrap:anywhere]">{label}</span>
                    </span>
                  ))}
                </div>

                <div className="hidden justify-center gap-4 text-sm text-muted-foreground sm:flex">
                  <LegalLink page="terms" className="text-xs hover:text-foreground">
                    {t("upgrade.terms")}
                  </LegalLink>
                  <LegalLink page="privacy" className="text-xs hover:text-foreground">
                    {t("upgrade.privacy")}
                  </LegalLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
