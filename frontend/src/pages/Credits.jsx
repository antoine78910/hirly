import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { X, Check, Gift } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { withDatafastAttribution } from "../lib/datafast";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";

const CREDIT_PACKS = [
  { id: "pack-50", credits: 50, price: "5,99 EUR", save: "Save 16%" },
  { id: "pack-100", credits: 100, price: "9,99 EUR", save: "Save 25%" },
  { id: "pack-200", credits: 200, price: "17,99 EUR", save: "Save 30%" },
];

const PREMIUM_FEATURES = [
  "Unlimited swipes",
  "Early access to new features",
  "AI answers for optional cover letters",
  "Access to advanced filters",
  "Pro support from the team",
];

export default function Credits() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scrollRef = useRef(null);
  const [selectedPack, setSelectedPack] = useState("pack-50");
  const [selectedPlan, setSelectedPlan] = useState("monthly");
  const [billing, setBilling] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const checkoutStatus = searchParams.get("checkout");

  const loadBilling = async () => {
    try {
      const { data } = await api.get("/billing/status");
      setBilling(data);
    } catch (_) {
      setBilling(null);
    }
  };

  useEffect(() => {
    if (checkoutStatus === "success") toast.success("Payment received");
    if (checkoutStatus === "cancelled") toast("Checkout cancelled");
    loadBilling();
  }, [checkoutStatus]);

  const buyPack = () => {
    const pack = CREDIT_PACKS.find((p) => p.id === selectedPack);
    toast.success(`${pack.credits} application credits - checkout coming soon`);
  };

  const getPremium = async () => {
    setLoadingPlan(selectedPlan);
    try {
      const { data } = await api.post("/billing/create-checkout-session", withDatafastAttribution({
        plan: selectedPlan,
        source: "credits",
      }));
      if (!data?.url) throw new Error("Missing checkout URL");
      window.location.href = data.url;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not start checkout");
    } finally {
      setLoadingPlan(null);
    }
  };

  const manageBilling = async () => {
    setPortalLoading(true);
    try {
      const { data } = await api.post("/billing/create-portal-session");
      if (!data?.url) throw new Error("Missing portal URL");
      window.location.href = data.url;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white text-zinc-900 md:min-h-0">
      <div className={`${APP_CONTENT_WIDTH} pb-10 pt-5 md:py-8`}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 grid h-10 w-10 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 md:hidden"
          aria-label="Close"
          data-testid="credits-close"
        >
          <X className="h-6 w-6" />
        </button>

        <DesktopPageHeader
          title="Credits"
          subtitle="Apply to as many jobs as you want with application credits or Premium."
        />

        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight md:hidden">
          Apply to as many jobs as you want
        </h1>

        {billing?.is_premium ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            Premium active{billing.plan ? ` - ${billing.plan}` : ""}
          </div>
        ) : checkoutStatus === "success" ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            Payment received. Your subscription is being confirmed.
          </div>
        ) : checkoutStatus === "cancelled" ? (
          <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-700">
            Checkout cancelled. You can choose a plan when ready.
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {CREDIT_PACKS.map((pack) => {
            const active = selectedPack === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => setSelectedPack(pack.id)}
                className={`min-w-[78%] shrink-0 snap-center rounded-2xl border-2 bg-white p-6 text-left transition-all ${
                  active
                    ? "border-linkedin shadow-[0_4px_24px_-6px_rgba(124,58,237,0.35)]"
                    : "border-zinc-200 hover:border-violet-200"
                }`}
                data-testid={`credit-pack-${pack.id}`}
              >
                <p className="font-display text-2xl font-bold leading-snug">
                  {pack.credits} Application Credits
                </p>
                <div className="mt-10 flex items-end justify-between">
                  <span className="text-lg text-zinc-500">{pack.price}</span>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                    {pack.save}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={buyPack}
          className="mt-4 w-full rounded-full border border-zinc-200 py-3.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          data-testid="credits-buy-pack"
        >
          Buy {CREDIT_PACKS.find((p) => p.id === selectedPack)?.credits} credits
        </button>

        <div className="relative my-8 flex items-center">
          <div className="h-px flex-1 border-t border-dashed border-zinc-300" />
          <span className="px-4 text-sm text-zinc-400">or</span>
          <div className="h-px flex-1 border-t border-dashed border-zinc-300" />
        </div>

        <div className="rounded-2xl border-2 border-violet-300/80 bg-gradient-to-br from-violet-50/80 via-fuchsia-50/50 to-violet-50/80 p-5">
          <ul className="space-y-4">
            {PREMIUM_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-zinc-800">{feature}</span>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-100 text-linkedin">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-white/70 p-1">
            {[
              { id: "monthly", label: "Monthly" },
              { id: "quarterly", label: "Quarterly" },
            ].map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlan(plan.id)}
                className={`rounded-full px-4 py-2 text-sm font-bold ${
                  selectedPlan === plan.id
                    ? "gradient-linkedin text-white"
                    : "text-zinc-700 hover:bg-white"
                }`}
                data-testid={`credits-plan-${plan.id}`}
              >
                {plan.label}
              </button>
            ))}
          </div>

          {billing?.is_premium ? (
            <button
              type="button"
              onClick={manageBilling}
              disabled={portalLoading}
              className="mt-6 w-full rounded-full gradient-linkedin py-4 text-base font-bold text-white shadow-[0_8px_32px_-8px_rgba(124,58,237,0.45)] hover:opacity-90 disabled:opacity-60"
              data-testid="credits-manage-billing"
            >
              {portalLoading ? "Opening..." : "Manage billing"}
            </button>
          ) : (
            <button
              type="button"
              onClick={getPremium}
              disabled={Boolean(loadingPlan)}
              className="mt-6 w-full rounded-full gradient-linkedin py-4 text-base font-bold text-white shadow-[0_8px_32px_-8px_rgba(124,58,237,0.45)] hover:opacity-90 disabled:opacity-60"
              data-testid="credits-get-premium"
            >
              {loadingPlan ? "Opening checkout..." : "Get Premium"}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate("/referral")}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-300/70 bg-violet-50/40 py-4 text-sm font-semibold text-linkedin hover:bg-violet-50"
          data-testid="credits-referral-link"
        >
          <Gift className="h-4 w-4" />
          Give Premium, Get Premium - earn free credits
        </button>
      </div>
    </div>
  );
}
