import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

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
const pct = (value) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

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

function EmptyRow({ colSpan, label = "No analytics data yet." }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-zinc-500">{label}</td>
    </tr>
  );
}

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
      const response = await api.get("/admin/analytics");
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
  const applicationFunnel = data?.application_funnel || {};
  const atsPerformance = data?.ats_performance || data?.by_ats || {};
  const trend7 = mergeTrendSeries(data?.time_series?.last_7_days || {});
  const adminOps = data?.admin_ops || {};

  return (
    <AdminShell
      title="Analytics"
      subtitle="Product KPIs, funnels, applications, ATS quality, and admin operations."
      actions={(
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
      {loading ? (
        <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>
      ) : accessDenied ? <AdminAccessDenied /> : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KPI_CARDS.map(([key, label]) => <Card key={key} label={label} value={metrics[key]} />)}
          </div>

          <Section title="Conversion Funnel" subtitle="Unique actors where available; application stages also include application records.">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Step</th>
                  <th className="px-4 py-3">Count</th>
                  <th className="px-4 py-3">Previous step conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {funnel.length ? funnel.map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-3 font-semibold">{row.label}</td>
                    <td className="px-4 py-3">{fmt(row.count)}</td>
                    <td className="px-4 py-3">{row.previous_rate == null ? "-" : pct(row.previous_rate)}</td>
                  </tr>
                )) : <EmptyRow colSpan={3} />}
              </tbody>
            </table>
          </Section>

          <Section title="CTA Performance" subtitle="Click counts and downstream conversion from clicked CTA users.">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">CTA</th>
                  <th className="px-4 py-3">Clicks</th>
                  <th className="px-4 py-3">To signup</th>
                  <th className="px-4 py-3">To onboarding</th>
                  <th className="px-4 py-3">To first swipe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ctas.length ? ctas.map((row) => (
                  <tr key={row.event}>
                    <td className="px-4 py-3 font-semibold">{row.label}</td>
                    <td className="px-4 py-3">{fmt(row.clicks)}</td>
                    <td className="px-4 py-3">{pct(row.conversion_to_signup)}</td>
                    <td className="px-4 py-3">{pct(row.conversion_to_onboarding)}</td>
                    <td className="px-4 py-3">{pct(row.conversion_to_first_swipe)}</td>
                  </tr>
                )) : <EmptyRow colSpan={5} />}
              </tbody>
            </table>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Application Status Breakdown">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-zinc-100">
                  {Object.entries(applicationFunnel).length ? Object.entries(applicationFunnel).map(([key, value]) => (
                    <tr key={key}>
                      <td className="px-4 py-3 font-semibold capitalize">{key.replaceAll("_", " ")}</td>
                      <td className="px-4 py-3 text-right">{fmt(value)}</td>
                    </tr>
                  )) : <EmptyRow colSpan={2} />}
                </tbody>
              </table>
            </Section>

            <Section title="Admin Operations">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-zinc-100">
                  <tr><td className="px-4 py-3 font-semibold">Open action required</td><td className="px-4 py-3 text-right">{fmt(adminOps.open_action_required)}</td></tr>
                  <tr><td className="px-4 py-3 font-semibold">Open blocked</td><td className="px-4 py-3 text-right">{fmt(adminOps.open_blocked)}</td></tr>
                  <tr><td className="px-4 py-3 font-semibold">Assigned applications</td><td className="px-4 py-3 text-right">{fmt(adminOps.assigned_applications)}</td></tr>
                  <tr><td className="px-4 py-3 font-semibold">Unassigned applications</td><td className="px-4 py-3 text-right">{fmt(adminOps.unassigned_applications)}</td></tr>
                  <tr><td className="px-4 py-3 font-semibold">Average unresolved age</td><td className="px-4 py-3 text-right">{adminOps.average_unresolved_age_hours == null ? "-" : `${fmt(adminOps.average_unresolved_age_hours)}h`}</td></tr>
                </tbody>
              </table>
            </Section>
          </div>

          <Section title="ATS Performance">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">ATS</th>
                  <th className="px-4 py-3">Generated</th>
                  <th className="px-4 py-3">Prepared</th>
                  <th className="px-4 py-3">Action Required</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Failed / Blocked</th>
                  <th className="px-4 py-3">Prepare rate</th>
                  <th className="px-4 py-3">Failure rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {Object.keys(ATS_LABELS).map((key) => {
                  const row = atsPerformance[key] || {};
                  return (
                    <tr key={key}>
                      <td className="px-4 py-3 font-semibold">{ATS_LABELS[key]}</td>
                      <td className="px-4 py-3">{fmt(row.generated || row.applications_generated)}</td>
                      <td className="px-4 py-3">{fmt(row.prepared)}</td>
                      <td className="px-4 py-3">{fmt(row.action_required)}</td>
                      <td className="px-4 py-3">{fmt(row.submitted)}</td>
                      <td className="px-4 py-3">{fmt(row.failed_blocked)}</td>
                      <td className="px-4 py-3">{pct(row.prepare_rate)}</td>
                      <td className="px-4 py-3">{pct(row.failure_rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="Daily Trend" subtitle="Last 7 days. Full 30-day data is returned by the API.">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Signups</th>
                  <th className="px-4 py-3">Swipes</th>
                  <th className="px-4 py-3">Applications</th>
                  <th className="px-4 py-3">Prepared</th>
                  <th className="px-4 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {trend7.length ? trend7.map((row) => (
                  <tr key={row.date}>
                    <td className="px-4 py-3 font-semibold">{row.date}</td>
                    <td className="px-4 py-3">{fmt(row.signups)}</td>
                    <td className="px-4 py-3">{fmt(row.swipes)}</td>
                    <td className="px-4 py-3">{fmt(row.applications)}</td>
                    <td className="px-4 py-3">{fmt(row.prepared)}</td>
                    <td className="px-4 py-3">{fmt(row.submitted)}</td>
                  </tr>
                )) : <EmptyRow colSpan={6} />}
              </tbody>
            </table>
          </Section>
        </div>
      )}
    </AdminShell>
  );
}
