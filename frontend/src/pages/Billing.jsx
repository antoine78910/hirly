import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, CreditCard, Crown, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useUpgradeModal } from "../context/UpgradeModalContext";
import { useAppLocale } from "../context/AppLocaleContext";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

const BRAND_VIOLET = "#7C3AED";
const BRAND_VIOLET_SOFT = "rgba(124, 58, 237, 0.14)";

function BillingSection({ title, description, children }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <div className="md:w-1/3 md:shrink-0">
        <h2 className="mb-2 text-lg font-semibold text-zinc-900">{title}</h2>
        <p className="text-sm text-zinc-500">{description}</p>
      </div>
      <div className="min-w-0 md:w-2/3">{children}</div>
    </div>
  );
}

function formatPeriodDate(iso, lang) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatChartTooltipDate(iso, lang) {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

function toChartRows(series, lang) {
  return (series || []).map(({ date, count }) => ({
    date,
    applications: count,
    label: new Date(`${date}T12:00:00`).toLocaleDateString(
      lang === "fr" ? "fr-FR" : "en-US",
      { weekday: "short" },
    ),
  }));
}

function buildYAxisTicks(maxValue) {
  const top = Math.max(4, maxValue);
  const step = top <= 4 ? 1 : Math.ceil(top / 4);
  const ticks = [];
  for (let value = 0; value <= top; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return { top, ticks };
}

function UsageChartTooltip({ active, payload, lang, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const count = row?.applications ?? 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-zinc-900">
        {formatChartTooltipDate(row?.date, lang)}
      </p>
      <div className="flex items-center gap-2 text-zinc-600">
        <span
          className="inline-block size-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: BRAND_VIOLET }}
          aria-hidden
        />
        <span>{label}</span>
        <span className="ml-auto font-semibold tabular-nums text-zinc-900">{count}</span>
      </div>
    </div>
  );
}

function UsageChart({ data, label, lang }) {
  const { top, ticks } = useMemo(() => {
    const maxValue = data.reduce((max, row) => Math.max(max, row.applications || 0), 0);
    return buildYAxisTicks(maxValue);
  }, [data]);

  return (
    <div
      className="h-[240px] w-full min-w-0 overflow-hidden sm:h-[280px]"
      data-chart="billing-daily-usage"
      style={{ "--color-applications": BRAND_VIOLET }}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 12, right: 4, left: -8, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="#e4e4e7" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fontWeight: 500, fill: "#71717a" }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            domain={[0, top]}
            ticks={ticks}
            tick={{ fontSize: 10, fontWeight: 500, fill: "#71717a" }}
            width={28}
          />
          <Tooltip
            cursor={{ fill: BRAND_VIOLET_SOFT }}
            content={<UsageChartTooltip lang={lang} label={label} />}
          />
          <Bar dataKey="applications" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.applications > 0 ? BRAND_VIOLET : "#e4e4e7"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Billing() {
  const navigate = useNavigate();
  const { openUpgrade } = useUpgradeModal();
  const { t, lang } = useAppLocale();
  const [billing, setBilling] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [chartRange, setChartRange] = useState("7d");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, usageRes] = await Promise.all([
        api.get("/billing/status"),
        api.get("/billing/usage"),
      ]);
      setBilling(statusRes.data);
      setUsage(usageRes.data);
    } catch (_) {
      setBilling(null);
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { data } = await api.post("/billing/create-portal-session");
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast.error(t("settings.billingPortalError"));
    } catch (error) {
      toast.error(error?.response?.data?.detail || t("settings.billingPortalError"));
    } finally {
      setPortalLoading(false);
    }
  };

  const isPremium = Boolean(billing?.is_premium);
  const creditsUsed = usage?.credits_used ?? 0;
  const creditsTotal = usage?.credits_total ?? 0;
  const creditsRemaining = usage?.credits_remaining ?? 0;
  const usagePercent = usage?.usage_percent ?? 0;
  const periodLabel = usage
    ? `${formatPeriodDate(usage.period_start, lang)} - ${formatPeriodDate(usage.period_end, lang)}`
    : "";

  const chartData = useMemo(() => {
    const series = usage?.daily_usage?.[chartRange] || [];
    return toChartRows(series, lang);
  }, [usage, chartRange, lang]);

  const chartDays = chartRange === "7d" ? 7 : chartRange === "14d" ? 14 : 30;

  if (loading) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-linkedin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-white text-zinc-900 md:min-h-0">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 md:py-12">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 md:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </button>

        <h1 className="mb-8 font-display text-2xl font-bold tracking-tight">
          {t("billingPage.title")}
        </h1>

        <div className="space-y-10 md:space-y-12">
          <BillingSection
            title={t("billingPage.currentSubscription")}
            description={t("billingPage.currentSubscriptionDesc")}
          >
            <Card className="w-full min-w-0 overflow-hidden border-zinc-200 shadow-sm">
              <CardContent className="space-y-6 px-4 sm:px-6">
                {isPremium ? (
                  <div className="py-8 text-center">
                    <Crown className="mx-auto mb-4 h-12 w-12 text-linkedin" aria-hidden />
                    <h3 className="mb-2 text-lg font-semibold text-zinc-900">
                      {t("billingPage.premiumActive")}
                      {billing?.plan ? ` (${billing.plan})` : ""}
                    </h3>
                    <p className="mb-6 text-sm text-zinc-500">
                      {t("billingPage.premiumActiveDesc")}
                    </p>
                    <Button
                      onClick={openPortal}
                      disabled={portalLoading}
                      className="gradient-linkedin border-0 text-white hover:opacity-90"
                    >
                      {portalLoading ? t("common.loading") : t("billingPage.manageSubscription")}
                    </Button>
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <Crown className="mx-auto mb-4 h-12 w-12 text-zinc-400" aria-hidden />
                    <h3 className="mb-2 text-lg font-semibold text-zinc-900">
                      {t("billingPage.noSubscription")}
                    </h3>
                    <p className="mb-6 text-sm text-zinc-500">
                      {t("billingPage.noSubscriptionDesc")}
                    </p>
                    <Button
                      size="lg"
                      onClick={openUpgrade}
                      className="gradient-linkedin border-0 text-white hover:opacity-90"
                      data-testid="billing-view-plans"
                    >
                      {t("billingPage.viewPlans")}
                    </Button>
                  </div>
                )}

              </CardContent>
            </Card>
          </BillingSection>

          <BillingSection
            title={t("billingPage.usageCredits")}
            description={t("billingPage.usageCreditsDesc")}
          >
            <div className="min-w-0 space-y-8">
              <Card className="min-w-0 overflow-hidden border-zinc-200 shadow-sm">
                <CardHeader className="grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-4 sm:px-6">
                  <CardTitle className="text-zinc-900">{t("billingPage.currentCreditPeriod")}</CardTitle>
                  <div className="break-words text-sm text-zinc-500">{periodLabel}</div>
                </CardHeader>
                <CardContent className="space-y-6 px-4 sm:px-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="shrink-0 rounded-lg bg-violet-100 p-2">
                        <CreditCard className="h-5 w-5 text-linkedin" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-base font-semibold text-zinc-900">
                          {t("billingPage.creditsUsed")}
                        </h4>
                        <p className="text-sm text-zinc-500">
                          {t("billingPage.creditsOf", { used: creditsUsed, total: creditsTotal })}
                        </p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="text-2xl font-bold tabular-nums text-zinc-900">
                        {usagePercent}%
                      </span>
                      <p className="text-xs font-medium text-zinc-500">
                        {t("billingPage.usedThisPeriod")}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-500">
                        {t("billingPage.usageProgress")}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {t("billingPage.remaining", { n: creditsRemaining })}
                      </span>
                    </div>
                    <Progress
                      value={usagePercent}
                      className="h-2 bg-violet-100 [&>div]:bg-linkedin"
                    />
                  </div>
                </CardContent>

                {!isPremium ? (
                  <CardFooter className="mx-4 mb-4 rounded-lg border border-violet-200/70 bg-gradient-to-r from-violet-50 to-indigo-50/80 p-4 sm:mx-6 sm:mb-6">
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 rounded-lg bg-violet-200/60 p-2">
                          <TrendingUp className="h-4 w-4 text-linkedin" aria-hidden />
                        </div>
                        <div>
                          <h4 className="mb-1 text-sm font-semibold text-zinc-900">
                            {t("billingPage.getMoreCredits")}
                          </h4>
                          <p className="text-xs text-zinc-500">
                            {t("billingPage.getMoreCreditsDesc")}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 gradient-linkedin border-0 text-white hover:opacity-90"
                        onClick={openUpgrade}
                      >
                        {t("billingPage.subscribeNow")}
                      </Button>
                    </div>
                  </CardFooter>
                ) : null}
              </Card>

              <Card className="min-w-0 overflow-hidden border-zinc-200 shadow-sm">
                <CardHeader className="px-4 pb-2 sm:px-6">
                  <div className="flex flex-col gap-4">
                    <div className="min-w-0">
                      <CardTitle className="text-zinc-900">{t("billingPage.dailyUsage")}</CardTitle>
                      <CardDescription className="mt-1 text-zinc-500">
                        {t("billingPage.daysShown", { n: chartDays })}
                      </CardDescription>
                    </div>
                    <Tabs value={chartRange} onValueChange={setChartRange} className="w-full">
                      <TabsList className="grid h-auto w-full grid-cols-3 bg-zinc-100 sm:inline-flex sm:w-auto">
                        <TabsTrigger
                          value="7d"
                          className="px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-zinc-900 sm:px-3 sm:text-sm"
                        >
                          {t("billingPage.past7Days")}
                        </TabsTrigger>
                        <TabsTrigger
                          value="14d"
                          className="px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-zinc-900 sm:px-3 sm:text-sm"
                        >
                          {t("billingPage.past14Days")}
                        </TabsTrigger>
                        <TabsTrigger
                          value="30d"
                          className="px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-zinc-900 sm:px-3 sm:text-sm"
                        >
                          {t("billingPage.past30Days")}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2 sm:p-6">
                  <UsageChart
                    data={chartData}
                    label={t("billingPage.applications")}
                    lang={lang}
                  />
                </CardContent>
              </Card>
            </div>
          </BillingSection>
        </div>
      </div>
    </div>
  );
}
