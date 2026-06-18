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
import {
  SUBSCRIPTION_TIERS,
  UPGRADE_BENEFITS,
  UPGRADE_FEATURES,
  UPGRADE_STATS,
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
        <Icon className="text-primary" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-sm font-medium leading-snug">{title}</div>
        <p className="text-sm leading-normal text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function TierCard({ tier, selected, onSelect, isMonthly }) {
  const price = isMonthly ? tier.monthlyPrice : tier.weeklyPrice;
  const period = isMonthly ? "per month" : "per week";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-state={selected ? "on" : "off"}
      onClick={onSelect}
      className={`relative cursor-pointer rounded-xl border-2 p-4 text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6 ${
        selected
          ? "border-primary bg-card text-card-foreground ring-2 ring-primary/20"
          : "border-border bg-card text-card-foreground hover:border-primary/50"
      }`}
    >
      {tier.popular ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
          <span className="inline-flex items-center rounded-full border border-transparent bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            POPULAR
          </span>
        </div>
      ) : null}
      <div className="space-y-0.5 sm:space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-primary">{tier.name}</div>
        <div className="text-xl font-bold sm:text-2xl">${price.toFixed(2)}</div>
        <div className="text-xs text-muted-foreground">{period}</div>
        <div className="text-xs font-medium sm:text-sm">{tier.applications} Applications</div>
      </div>
    </button>
  );
}

function PricingGrid({ isMonthly, selectedTier, onSelectTier }) {
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
        />
      ))}
    </div>
  );
}

export default function DesktopUpgradeModal({ open, onClose }) {
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [selectedTier, setSelectedTier] = useState("ultra");
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const isMonthly = billingInterval === "monthly";

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const { data } = await api.post("/billing/create-checkout-session", {
        plan: selectedTier,
        interval: billingInterval,
      });
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast.error("Could not start checkout. Please try again.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Checkout failed. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent
        className="fixed top-[50%] left-[50%] z-50 grid h-dvh w-full max-w-full translate-x-[-50%] translate-y-[-50%] gap-0 overflow-hidden rounded-lg border bg-background p-0 shadow-lg sm:h-[95vh] sm:max-w-[95vw] lg:max-w-6xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Unlock Your Dream Career</DialogTitle>
        <DialogDescription className="sr-only">
          Join thousands who landed their dream jobs with Hirly
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
            <div className="grid grid-cols-3 gap-3">
              {UPGRADE_STATS.map((stat) => (
                <div key={stat.label} className="rounded-lg border bg-background/80 p-3 text-center">
                  <div className="text-lg font-bold text-primary">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
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
                <div className="mb-4 inline-flex items-center rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                  <Star className="mr-2 size-4" aria-hidden />
                  Limited Time Offer
                </div>
                <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Unlock Your Dream Career</h1>
                <p className="text-muted-foreground">
                  Join thousands who landed their dream jobs with Hirly
                </p>
              </div>

              <Tabs value={billingInterval} onValueChange={setBillingInterval}>
                <div className="flex justify-center">
                  <div className="relative">
                    <span className="absolute -top-3 left-1/4 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-transparent bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                      Save 25%
                    </span>
                    <TabsList className="grid h-9 w-full min-w-80 grid-cols-2 rounded-lg bg-muted p-[3px]">
                      <TabsTrigger value="monthly" className="h-[calc(100%-1px)] flex-1">
                        Monthly
                      </TabsTrigger>
                      <TabsTrigger value="weekly" className="h-[calc(100%-1px)] flex-1">
                        Weekly
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </div>

                <TabsContent value="monthly" className="mt-4 outline-none sm:mt-6">
                  <PricingGrid
                    isMonthly
                    selectedTier={selectedTier}
                    onSelectTier={setSelectedTier}
                  />
                </TabsContent>
                <TabsContent value="weekly" className="mt-4 outline-none sm:mt-6">
                  <PricingGrid
                    isMonthly={false}
                    selectedTier={selectedTier}
                    onSelectTier={setSelectedTier}
                  />
                </TabsContent>
              </Tabs>

              <div className="hidden sm:block">
                <div className="flex flex-col gap-6 rounded-xl border bg-muted py-6 text-card-foreground shadow-sm">
                  <div className="px-6">
                    <h3 className="mb-4 text-center text-lg font-semibold">Unlock Your Dream Career</h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {UPGRADE_BENEFITS.map((benefit) => (
                        <FeatureItem key={benefit.title} {...benefit} roundIcon={false} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={checkoutLoading}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {checkoutLoading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Rocket className="size-4" aria-hidden />
                  )}
                  Start Growing with Hirly
                </button>

                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-sm">
                  {["Cancel anytime", "Secure payments", "Instant access"].map((label) => (
                    <span key={label} className="flex items-center gap-1">
                      <Check className="size-3 shrink-0 text-primary sm:size-4" aria-hidden />
                      {label}
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
                    Terms of Use
                  </a>
                  <a
                    href="https://www.hirly.ai/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Secure checkout powered by Stripe
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
