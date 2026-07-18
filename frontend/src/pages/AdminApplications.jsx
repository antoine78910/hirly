import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import { AdminPipelineSteps } from "../components/admin/AdminPipelineSteps";

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
  { key: "offer_expired", label: "Offer Expired" },
];

const statusLabel = (value) => {
  if (!value) return "Unknown";
  return String(value).replaceAll("_", " ");
};

const COMPLETED_STATUSES = new Set([
  "completed",
  "manually_submitted",
  "sent",
  "submitted",
  "success",
]);

const ACTIONABLE_STATUSES = new Set([
  "action_required",
  "blocked",
  "blocked_captcha",
  "failed",
  "manual_blocked",
  "manual_in_progress",
  "manual_review_needed",
  "pending",
  "prepare_failed",
  "prepared",
  "queued",
  "ready",
]);

const statusBadgeClass = (value) => {
  const status = String(value || "").toLowerCase();
  if (COMPLETED_STATUSES.has(status)) {
    return "border border-emerald-200 bg-emerald-100 text-emerald-700";
  }
  if (status === "needs_user_input") {
    return "border border-amber-200 bg-amber-100 text-amber-800";
  }
  if (ACTIONABLE_STATUSES.has(status)) {
    return "border border-red-200 bg-red-100 text-red-700";
  }
  return "border border-zinc-200 bg-zinc-100 text-zinc-700";
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
      subtitle="Complete generated applications manually and resolve blocked submissions."
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

        {!accessDenied ? (
          <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" data-testid="admin-auto-apply-queue-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Auto-apply waiting list</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Production queue status across users (empty list is expected when nothing is pending).
                </p>
              </div>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                {applications.filter((a) => ["queued", "running", "awaiting_review"].includes(a.auto_apply_queue_status)).length} active
              </span>
            </div>
            {applications.filter((a) => ["queued", "running", "awaiting_review"].includes(a.auto_apply_queue_status)).length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500" data-testid="admin-auto-apply-queue-empty">
                Queue is empty — no applications waiting for auto-apply right now.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {applications
                  .filter((a) => ["queued", "running", "awaiting_review"].includes(a.auto_apply_queue_status))
                  .slice(0, 20)
                  .map((app) => (
                    <li key={app.application_id} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm">
                      <Link className="min-w-0 font-semibold text-linkedin hover:underline" to={`/admin/applications/${app.application_id}`}>
                        <span className="truncate">{app.company || "Unknown"} · {app.title || "Role"}</span>
                      </Link>
                      <span className="shrink-0 capitalize text-xs font-semibold text-zinc-600">
                        {String(app.auto_apply_queue_status || "").replaceAll("_", " ")}
                        {app.auto_apply_provider ? ` · ${app.auto_apply_provider}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : null}

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
                <th className="px-4 py-3">Pipeline</th>
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
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={10}>
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : applications.length ? applications.map((app) => {
                const submissionStatus = app.user_facing_submission_status || app.submission_status;
                const manualStatus = app.manual_status || app.admin_status;
                return (
                <tr key={app.application_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link className="font-semibold text-linkedin hover:underline" to={`/admin/applications/${app.application_id}`}>
                      {app.user_email || app.user_id}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-400">{app.user_id}</p>
                  </td>
                  <td className="px-4 py-3 font-medium">{app.company || "Unknown"}</td>
                  <td className="px-4 py-3">{app.title || "Unknown role"}</td>
                  <td className="px-4 py-3 capitalize">{app.ats_provider || app.auto_apply_provider || "unknown"}</td>
                  <td className="px-4 py-3 min-w-[280px]">
                    <AdminPipelineSteps application={app} compact />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(submissionStatus)}`}>
                      {statusLabel(submissionStatus)}
                    </span>
                    <p className="mt-1 text-xs text-zinc-400 capitalize">{statusLabel(app.package_status)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(manualStatus)}`}>
                      {statusLabel(manualStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{app.assigned_to || "Unassigned"}</td>
                  <td className="px-4 py-3">{ageLabel(app.created_at)}</td>
                  <td className="px-4 py-3 text-zinc-600">{fmtDate(app.updated_at)}</td>
                </tr>
                );
              }) : (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={10}>No applications found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div> : null}
    </AdminShell>
  );
}
