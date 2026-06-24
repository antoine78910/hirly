import { useState } from "react";
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
import Logo from "@/components/Logo";
import { useAppLocale } from "@/context/AppLocaleContext";
import { getUpgradeContent } from "@/lib/appUi";
import { formatMoney } from "@/lib/currency";
import { notifyBillingUpdated } from "@/lib/billingEvents";
import {
  SUBSCRIPTION_TIERS,
} from "@/lib/subscriptionTiers";

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

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-state={selected ? "on" : "off"}
      onClick={onSelect}
      className={`relative cursor-pointer rounded-xl border-2 p-4 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 sm:p-6 ${
        selected
          ? "border-sprout-mint bg-card text-card-foreground ring-2 ring-violet-500/20"
          : "border-border bg-card text-card-foreground hover:border-violet-300"
      }`}
    >
      {tier.popular ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
          <span className="inline-flex items-center rounded-full border border-transparent bg-sprout-mint px-2 py-0.5 text-xs font-medium text-white">
            {t("upgrade.popular")}
          </span>
        </div>
      ) : null}
      <div className="space-y-0.5 sm:space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-linkedin">{tier.name}</div>
        <div className="text-xl font-bold sm:text-2xl">{formatMoney(price, lang)}</div>
        <div className="text-xs text-muted-foreground">{period}</div>
        <div className="text-[11px] font-medium leading-tight [overflow-wrap:anywhere] sm:text-xs">
          {t("upgrade.applications", { n: tier.applications })}
        </div>
      </div>
    </button>
  );
}

function PricingGrid({ isMonthly, selectedTier, onSelectTier, t, lang }) {
  return (
    <div
      role="radiogroup"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-6"
    >
      {SUBSCRIPTION_TIERS.map((tier) => (
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

export default function DesktopUpgradeModal({ open, onClose }) {
  const { t, lang } = useAppLocale();
  const { features: UPGRADE_FEATURES, stats: UPGRADE_STATS, benefits: UPGRADE_BENEFITS } = getUpgradeContent(t);
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [selectedTier, setSelectedTier] = useState("ultra");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [accessCode, setAccessCode] = useState("");

  const isMonthly = billingInterval === "monthly";

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const normalizedCode = accessCode.trim();
      if (normalizedCode) {
        const { data } = await api.post("/billing/redeem-master-code", {
          code: normalizedCode,
          plan: selectedTier,
          interval: billingInterval,
          source: "app",
        });
        if (data?.billing) {
          notifyBillingUpdated(data.billing);
        }
        toast.success("Test plan activated");
        setAccessCode("");
        onClose?.();
        return;
      }
      const { data } = await api.post("/billing/create-checkout-session", {
        plan: selectedTier,
        interval: billingInterval,
      });
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
        className="sprout fixed top-[50%] left-[50%] z-50 grid h-dvh w-full max-w-full translate-x-[-50%] translate-y-[-50%] gap-0 overflow-hidden rounded-lg border bg-background p-0 shadow-lg sm:h-[95vh] sm:max-w-[95vw] lg:max-w-6xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("upgrade.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("upgrade.subtitle")}
        </DialogDescription>

        <div className="absolute top-6 left-6 z-20 hidden lg:block">
          <Logo size={32} className="h-8 w-auto" />
        </div>

        <div className="flex h-full overflow-hidden">
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

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10">
            <div className="mb-4 flex justify-center lg:hidden">
              <Logo size={32} className="h-8 w-auto" />
            </div>

            <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
              <div className="pt-4 text-center sm:pt-8">
                <div className="mb-4 inline-flex items-center rounded-full bg-sprout-mint-soft px-3 py-1.5 text-sm font-medium text-linkedin">
                  <Star className="mr-2 size-4" aria-hidden />
                  {t("upgrade.limitedOffer")}
                </div>
                <h1 className="mb-2 text-2xl font-bold sm:text-3xl">{t("upgrade.title")}</h1>
                <p className="text-muted-foreground">
                  {t("upgrade.subtitle")}
                </p>
              </div>

              <Tabs value={billingInterval} onValueChange={setBillingInterval}>
                <div className="flex justify-center">
                  <div className="relative">
                    <span className="absolute -top-3 left-1/4 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-transparent bg-sprout-mint px-1.5 py-0.5 text-[10px] font-medium text-white">
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

                <TabsContent value="monthly" className="mt-4 outline-none sm:mt-6">
                  <PricingGrid
                    isMonthly
                    selectedTier={selectedTier}
                    onSelectTier={setSelectedTier}
                    t={t}
                    lang={lang}
                  />
                </TabsContent>
                <TabsContent value="weekly" className="mt-4 outline-none sm:mt-6">
                  <PricingGrid
                    isMonthly={false}
                    selectedTier={selectedTier}
                    onSelectTier={setSelectedTier}
                    t={t}
                    lang={lang}
                  />
                </TabsContent>
              </Tabs>

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

              <div className="space-y-4">
                <input
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-center font-mono text-sm font-semibold tracking-[0.2em] text-foreground outline-none transition-colors placeholder:tracking-normal placeholder:text-muted-foreground focus:border-violet-400"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="Access code"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  data-testid="upgrade-access-code-input"
                />
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
                  {t("upgrade.cta")}
                </button>

                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:gap-x-4 sm:text-xs">
                  {[t("upgrade.cancelAnytime"), t("upgrade.securePayments"), t("upgrade.instantAccess")].map((label) => (
                    <span key={label} className="flex max-w-full min-w-0 items-center gap-1 text-center leading-tight">
                      <Check className="size-3 shrink-0 text-linkedin sm:size-4" aria-hidden />
                      <span className="[overflow-wrap:anywhere]">{label}</span>
                    </span>
                  ))}
                </div>

                <div className="flex justify-center gap-4 text-sm text-muted-foreground">
                  <a
                    href="https://www.hirly.ai/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:text-foreground"
                  >
                    {t("upgrade.terms")}
                  </a>
                  <a
                    href="https://www.hirly.ai/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:text-foreground"
                  >
                    {t("upgrade.privacy")}
                  </a>
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                {t("upgrade.stripe")}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
