import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { BRAND } from "../lib/brand";
import { Button } from "../components/ui/button";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "action_required", label: "Action Required" },
  { key: "blocked", label: "Blocked" },
  { key: "blocked_captcha", label: "CAPTCHA" },
  { key: "prepare_failed", label: "Prepare Failed" },
  { key: "prepared", label: "Prepared" },
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

export default function AdminApplications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const queryFilter = useMemo(
    () => FILTERS.some((item) => item.key === activeFilter) ? activeFilter : "all",
    [activeFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = queryFilter === "all" ? "" : `?filter=${encodeURIComponent(queryFilter)}`;
      const { data } = await api.get(`/admin/applications${params}`);
      setApplications(data.applications || []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load admin applications");
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
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{BRAND.NAME} Admin</p>
            <h1 className="font-display text-2xl font-bold">Operations Queue</h1>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
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

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">ATS</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>
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
                      {statusLabel(app.submission_status)}
                    </span>
                    <p className="mt-1 text-xs text-zinc-400 capitalize">{statusLabel(app.package_status)}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{fmtDate(app.updated_at)}</td>
                </tr>
              )) : (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>No applications found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
