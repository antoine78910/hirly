import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmtDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AdminCreators() {
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data } = await api.get("/admin/creators");
      setCreators(data.creators || []);
    } catch (err) {
      setCreators([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load creators"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell
      title="Creators"
      subtitle="Track creator signup, courses, and learner progression."
      actions={(
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {!accessDenied ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Creator</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Courses</th>
                <th className="px-4 py-3">Students</th>
                <th className="px-4 py-3">Avg progress</th>
                <th className="px-4 py-3">First course</th>
                <th className="px-4 py-3">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={7}>
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : creators.length ? creators.map((creator) => (
                <tr key={creator.creator_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-900">{creator.display_name || "Unknown creator"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{creator.email || creator.user_id || "—"}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">{creator.creator_id}</p>
                  </td>
                  <td className="px-4 py-3">{fmtDate(creator.joined_at)}</td>
                  <td className="px-4 py-3">{creator.courses_count || 0}</td>
                  <td className="px-4 py-3">{creator.students_count || 0}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-violet-700">{creator.avg_progress_percent || 0}%</span>
                  </td>
                  <td className="px-4 py-3">{fmtDate(creator.first_course_at)}</td>
                  <td className="px-4 py-3">{fmtDate(creator.last_active_at)}</td>
                </tr>
              )) : (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={7}>
                    No creators found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </AdminShell>
  );
}
