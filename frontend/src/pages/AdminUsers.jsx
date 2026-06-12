import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmtDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data.users || []);
    } catch (err) {
      setUsers([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(err?.response?.data?.detail || "Could not load users");
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
      title="Users"
      subtitle="Inspect onboarding, profiles, and application activity."
      actions={<Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</Button>}
    >
      {accessDenied ? <AdminAccessDenied /> : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {!accessDenied ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3">CV</th>
                <th className="px-4 py-3">Applications</th>
                <th className="px-4 py-3">Last active</th>
                <th className="px-4 py-3">Plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={7}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : users.length ? users.map((user) => (
                <tr key={user.user_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link className="font-semibold text-linkedin hover:underline" to={`/admin/users/${user.user_id}`}>{user.email || user.user_id}</Link>
                    <p className="mt-0.5 text-xs text-zinc-400">{user.user_id}</p>
                  </td>
                  <td className="px-4 py-3">{user.name || "Unknown"}</td>
                  <td className="px-4 py-3">{user.profile_completion || 0}%</td>
                  <td className="px-4 py-3">{user.cv_uploaded ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{user.total_applications || 0}</td>
                  <td className="px-4 py-3">{fmtDate(user.last_active_at || user.created_at)}</td>
                  <td className="px-4 py-3 text-zinc-500">{user.plan || "Not connected"}</td>
                </tr>
              )) : (
                <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={7}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </AdminShell>
  );
}
