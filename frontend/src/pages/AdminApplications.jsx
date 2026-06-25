import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "action_required", label: "Action Required" },
  { key: "blocked", label: "Blocked" },
  { key: "blocked_captcha", label: "CAPTCHA" },
  { key: "prepare_failed", label: "Prepare Failed" },
  { key: "prepared", label: "Prepared" },
  { key: "manual_review_needed", label: "Needs Human Completion" },
  { key: "manual_in_progress", label: "Manual In Progress" },
  { key: "manually_submitted", label: "Manually Submitted" },
  { key: "needs_user_input", label: "Needs User Input" },
];

const statusLabel = (value) => {
  if (!value) return "Unknown";
  return String(value).replaceAll("_", " ");
};

const fmtDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const ageLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 36e5));
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export default function AdminApplications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const queryFilter = useMemo(
    () => FILTERS.some((item) => item.key === activeFilter) ? activeFilter : "all",
    [activeFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const params = queryFilter === "all" ? "" : `?filter=${encodeURIComponent(queryFilter)}`;
      const { data } = await api.get(`/admin/applications${params}`);
      setApplications(data.applications || []);
    } catch (err) {
      setApplications([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load admin applications"));
      }
    } finally {
      setLoading(false);
    }
  }, [queryFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (key) => {
    if (key === "all") setSearchParams({});
    else setSearchParams({ filter: key });
  };

  return (
    <AdminShell
      title="Operations Queue"
      subtitle="Resolve failed and blocked applications."
      actions={(
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => {
            const active = queryFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                  active
                    ? "border-linkedin bg-linkedin text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {accessDenied ? (
          <AdminAccessDenied />
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        ) : null}

        {!accessDenied ? <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">ATS</th>
                <th className="px-4 py-3">User-facing status</th>
                <th className="px-4 py-3">Manual status</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3">Age</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={9}>
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : applications.length ? applications.map((app) => (
                <tr key={app.application_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link className="font-semibold text-linkedin hover:underline" to={`/admin/applications/${app.application_id}`}>
                      {app.user_email || app.user_id}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-400">{app.user_id}</p>
                  </td>
                  <td className="px-4 py-3 font-medium">{app.company || "Unknown"}</td>
                  <td className="px-4 py-3">{app.title || "Unknown role"}</td>
                  <td className="px-4 py-3 capitalize">{app.ats_provider || "unknown"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold capitalize text-zinc-700">
                      {statusLabel(app.user_facing_submission_status || app.submission_status)}
                    </span>
                    <p className="mt-1 text-xs text-zinc-400 capitalize">{statusLabel(app.package_status)}</p>
                  </td>
                  <td className="px-4 py-3 capitalize">{statusLabel(app.manual_status || app.admin_status)}</td>
                  <td className="px-4 py-3">{app.assigned_to || "Unassigned"}</td>
                  <td className="px-4 py-3">{ageLabel(app.created_at)}</td>
                  <td className="px-4 py-3 text-zinc-600">{fmtDate(app.updated_at)}</td>
                </tr>
              )) : (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={9}>No applications found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div> : null}
    </AdminShell>
  );
}
