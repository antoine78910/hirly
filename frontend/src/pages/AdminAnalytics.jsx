import { useCallback, useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage, autoApplyApiUrl } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import AdminDataTable from "../components/admin/AdminDataTable";

const KPI_CARDS = [
  ["visitors", "Visitors"],
  ["signups", "Signups"],
  ["onboarding_completed", "Onboarding complete"],
  ["cv_uploaded", "CV uploaded"],
  ["swipe_users", "Swipe users"],
  ["total_swipes", "Total swipes"],
  ["right_swipes", "Right swipes"],
  ["applications_generated", "Applications generated"],
  ["prepared", "Prepared"],
  ["submitted", "Submitted"],
  ["blocked_or_failed", "Blocked / failed"],
  ["action_required", "Action required"],
];

const ATS_LABELS = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  unknown: "Unknown",
};

const fmt = (value) => Number(value || 0).toLocaleString();
const pct = (value) =>
  `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

const mergeTrendSeries = (series = {}) => {
  const dates = new Set();
  Object.values(series).forEach((items) => {
    (items || []).forEach((item) => dates.add(item.date));
  });
  return [...dates].sort().map((date) => ({
    date,
    signups: (series.signups || []).find((item) => item.date === date)?.count || 0,
    swipes: (series.swipes || []).find((item) => item.date === date)?.count || 0,
    applications: (series.applications || []).find((item) => item.date === date)?.count || 0,
    prepared: (series.prepared || []).find((item) => item.date === date)?.count || 0,
    submitted: (series.submitted || []).find((item) => item.date === date)?.count || 0,
  }));
};

function Card({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold">{fmt(value)}</p>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const columnHelper = createColumnHelper();

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const response = await api.get(autoApplyApiUrl("/admin/analytics"), { timeout: 60000 });
      setData(response.data);
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load analytics"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = data?.metrics || {};
  const funnel = data?.conversion_funnel || [];
  const ctas = data?.cta_analytics || [];
  const trend7 = mergeTrendSeries(data?.time_series?.last_7_days || {});
  const applicationFunnel = useMemo(() => data?.application_funnel || {}, [data]);
  const atsPerformance = useMemo(() => data?.ats_performance || data?.by_ats || {}, [data]);
  const adminOps = useMemo(() => data?.admin_ops || {}, [data]);

  const applicationFunnelRows = useMemo(
    () => Object.entries(applicationFunnel).map(([key, value]) => ({ key, value })),
    [applicationFunnel],
  );

  const adminOpsRows = useMemo(
    () => [
      {
        key: "open_action_required",
        label: "Open action required",
        value: fmt(adminOps.open_action_required),
      },
      { key: "open_blocked", label: "Open blocked", value: fmt(adminOps.open_blocked) },
      {
        key: "assigned_applications",
        label: "Assigned applications",
        value: fmt(adminOps.assigned_applications),
      },
      {
        key: "unassigned_applications",
        label: "Unassigned applications",
        value: fmt(adminOps.unassigned_applications),
      },
      {
        key: "average_unresolved_age",
        label: "Average unresolved age",
        value:
          adminOps.average_unresolved_age_hours == null
            ? "-"
            : `${fmt(adminOps.average_unresolved_age_hours)}h`,
      },
    ],
    [adminOps],
  );

  const atsPerformanceRows = useMemo(
    () =>
      Object.keys(ATS_LABELS).map((key) => ({
        key,
        label: ATS_LABELS[key],
        ...(atsPerformance[key] || {}),
      })),
    [atsPerformance],
  );

  const funnelColumns = useMemo(
    () => [
      columnHelper.accessor("label", {
        header: "Step",
        cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
      }),
      columnHelper.accessor("count", { header: "Count", cell: (info) => fmt(info.getValue()) }),
      columnHelper.accessor("previous_rate", {
        header: "Previous step conversion",
        cell: (info) => (info.getValue() == null ? "-" : pct(info.getValue())),
      }),
    ],
    [],
  );

  const ctaColumns = useMemo(
    () => [
      columnHelper.accessor("label", {
        header: "CTA",
        cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
      }),
      columnHelper.accessor("clicks", { header: "Clicks", cell: (info) => fmt(info.getValue()) }),
      columnHelper.accessor("conversion_to_signup", {
        header: "To signup",
        cell: (info) => pct(info.getValue()),
      }),
      columnHelper.accessor("conversion_to_onboarding", {
        header: "To onboarding",
        cell: (info) => pct(info.getValue()),
      }),
      columnHelper.accessor("conversion_to_first_swipe", {
        header: "To first swipe",
        cell: (info) => pct(info.getValue()),
      }),
    ],
    [],
  );

  const applicationFunnelColumns = useMemo(
    () => [
      columnHelper.accessor("key", {
        header: "Status",
        cell: (info) => (
          <span className="font-semibold capitalize">{info.getValue().replaceAll("_", " ")}</span>
        ),
      }),
      columnHelper.accessor("value", { header: "Count", cell: (info) => fmt(info.getValue()) }),
    ],
    [],
  );

  const adminOpsColumns = useMemo(
    () => [
      columnHelper.accessor("label", {
        header: "Metric",
        cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
      }),
      columnHelper.accessor("value", { header: "Value", cell: (info) => info.getValue() }),
    ],
    [],
  );

  const atsPerformanceColumns = useMemo(
    () => [
      columnHelper.accessor("label", {
        header: "ATS",
        cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.generated || row.applications_generated, {
        id: "generated",
        header: "Generated",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("prepared", {
        header: "Prepared",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("action_required", {
        header: "Action Required",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("submitted", {
        header: "Submitted",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("failed_blocked", {
        header: "Failed / Blocked",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("prepare_rate", {
        header: "Prepare rate",
        cell: (info) => pct(info.getValue()),
      }),
      columnHelper.accessor("failure_rate", {
        header: "Failure rate",
        cell: (info) => pct(info.getValue()),
      }),
    ],
    [],
  );

  const trendColumns = useMemo(
    () => [
      columnHelper.accessor("date", {
        header: "Date",
        cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
      }),
      columnHelper.accessor("signups", { header: "Signups", cell: (info) => fmt(info.getValue()) }),
      columnHelper.accessor("swipes", { header: "Swipes", cell: (info) => fmt(info.getValue()) }),
      columnHelper.accessor("applications", {
        header: "Applications",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("prepared", {
        header: "Prepared",
        cell: (info) => fmt(info.getValue()),
      }),
      columnHelper.accessor("submitted", {
        header: "Submitted",
        cell: (info) => fmt(info.getValue()),
      }),
    ],
    [],
  );

  return (
    <AdminShell
      title="Analytics"
      subtitle="Product KPIs, funnels, applications, ATS quality, and admin operations."
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid min-h-64 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : accessDenied ? (
        <AdminAccessDenied />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KPI_CARDS.map(([key, label]) => (
              <Card key={key} label={label} value={metrics[key]} />
            ))}
          </div>

          <Section
            title="Conversion Funnel"
            subtitle="Unique actors where available; application stages also include application records."
          >
            <AdminDataTable
              columns={funnelColumns}
              data={funnel}
              getRowId={(row) => row.key}
              searchPlaceholder="Search funnel steps…"
              emptyMessage="No analytics data yet."
            />
          </Section>

          <Section
            title="CTA Performance"
            subtitle="Click counts and downstream conversion from clicked CTA users."
          >
            <AdminDataTable
              columns={ctaColumns}
              data={ctas}
              getRowId={(row) => row.event}
              searchPlaceholder="Search CTAs…"
              emptyMessage="No analytics data yet."
            />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Application Status Breakdown">
              <AdminDataTable
                columns={applicationFunnelColumns}
                data={applicationFunnelRows}
                getRowId={(row) => row.key}
                searchPlaceholder="Search statuses…"
                emptyMessage="No analytics data yet."
              />
            </Section>

            <Section title="Admin Operations">
              <AdminDataTable
                columns={adminOpsColumns}
                data={adminOpsRows}
                getRowId={(row) => row.key}
                searchPlaceholder="Search metrics…"
                emptyMessage="No analytics data yet."
              />
            </Section>
          </div>

          <Section title="ATS Performance">
            <AdminDataTable
              columns={atsPerformanceColumns}
              data={atsPerformanceRows}
              getRowId={(row) => row.key}
              searchPlaceholder="Search ATS providers…"
              emptyMessage="No analytics data yet."
            />
          </Section>

          <Section
            title="Daily Trend"
            subtitle="Last 7 days. Full 30-day data is returned by the API."
          >
            <AdminDataTable
              columns={trendColumns}
              data={trend7}
              getRowId={(row) => row.date}
              searchPlaceholder="Search by date…"
              emptyMessage="No analytics data yet."
              initialSorting={[{ id: "date", desc: true }]}
            />
          </Section>
        </div>
      )}
    </AdminShell>
  );
}
