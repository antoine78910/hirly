import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmt = (value) => Number(value || 0).toLocaleString();
const label = (value) => String(value || "unknown").replaceAll("_", " ");

function MetricCard({ title, value, sub }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      <p className="mt-2 font-display text-3xl font-bold text-zinc-950">{fmt(value)}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export default function AdminOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const response = await api.get("/admin/overview");
      setData(response.data);
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(err?.response?.data?.detail || "Could not load overview");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = data?.metrics || {};
  const conversion = metrics.conversion || {};

  return (
    <AdminShell
      title="Overview"
      subtitle="Operational health across users and applications."
      actions={<Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</Button>}
    >
      {loading ? (
        <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>
      ) : accessDenied ? (
        <AdminAccessDenied />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Total users" value={metrics.total_users} />
            <MetricCard title="New users today" value={metrics.new_users_today} />
            <MetricCard title="Applications today" value={metrics.applications_today} />
            <MetricCard title="Prepared applications" value={metrics.prepared_applications} />
            <MetricCard title="Action required" value={metrics.action_required} />
            <MetricCard title="Failed / blocked" value={metrics.failed_blocked} />
            <MetricCard title="Submitted" value={metrics.submitted} />
            <MetricCard title="Generated to submitted" value={conversion.submitted} sub={`${fmt(conversion.generated)} generated · ${fmt(conversion.prepared)} prepared`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-display text-lg font-bold">Top blockers</h2>
              <div className="mt-4 space-y-2">
                {(data.top_blockers || []).length ? data.top_blockers.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
                    <span>{item.label}</span>
                    <span className="font-semibold">{fmt(item.count)}</span>
                  </div>
                )) : <p className="text-sm text-zinc-500">No blockers recorded.</p>}
              </div>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-display text-lg font-bold">Latest needing attention</h2>
              <div className="mt-4 space-y-2">
                {(data.latest_attention || []).length ? data.latest_attention.map((app) => (
                  <Link key={app.application_id} to={`/admin/applications/${app.application_id}`} className="block rounded-md bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">{app.company || "Unknown"}</span>
                      <span className="capitalize text-zinc-500">{label(app.submission_status)}</span>
                    </div>
                    <p className="mt-1 text-zinc-500">{app.title || "Unknown role"} · {app.user_email || app.user_id}</p>
                  </Link>
                )) : <p className="text-sm text-zinc-500">No applications currently need attention.</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
